"""Immutable wrapper for one mutable trainer run and trusted score calculation."""

from __future__ import annotations

import sys

if not sys.flags.isolated:
    raise SystemExit("run_experiment.py requires isolated Python mode (-I)")

import argparse
import json
import logging
import math
import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class IntegrityError(RuntimeError):
    """Raised when the immutable execution or scoring boundary changes."""


def _sha256(path: Path) -> str:
    logging.disable(logging.CRITICAL)
    try:
        from hashlib import sha256
    finally:
        logging.disable(logging.NOTSET)
    return sha256(path.read_bytes()).hexdigest()


def _load_namespace(path: Path, name: str) -> dict[str, object]:
    namespace: dict[str, object] = {
        "__file__": str(path),
        "__name__": name,
        "__package__": None,
    }
    exec(compile(path.read_bytes(), str(path), "exec"), namespace)
    return namespace


def _load_checker(root: Path, expected_checker_sha256: str):
    checker_path = root / "tools" / "check_immutable.py"
    actual = _sha256(checker_path)
    if actual != expected_checker_sha256:
        raise IntegrityError(
            "checker sha256 mismatch "
            f"(expected {expected_checker_sha256}, got {actual})"
        )
    namespace = _load_namespace(checker_path, "_ml_loop_check_immutable")
    check = namespace.get("check")
    if not callable(check):
        raise IntegrityError("immutable checker does not export check")
    return check


def _assert_integrity(
    root: Path,
    expected_checker_sha256: str,
    check,
    stage: str,
) -> None:
    checker_path = root / "tools" / "check_immutable.py"
    actual = _sha256(checker_path)
    failures = [] if actual == expected_checker_sha256 else [
        "tools/check_immutable.py: sha256 mismatch "
        f"(expected {expected_checker_sha256}, got {actual})"
    ]
    if not failures:
        failures.extend(check(root))
    if failures:
        raise IntegrityError(
            f"{stage} immutable check failed:\n" + "\n".join(failures)
        )


def _score_candidate(root: Path, artifact_path: Path) -> float:
    heldout_path = root / "tools" / "heldout.py"
    score_path = root / "tools" / "score.py"
    heldout = _load_namespace(heldout_path, "_ml_loop_heldout")
    scorer = _load_namespace(score_path, "_ml_loop_score")
    get_heldout_data = heldout.get("get_heldout_data")
    evaluate_candidate = scorer.get("evaluate_candidate")
    if not callable(get_heldout_data) or not callable(evaluate_candidate):
        raise IntegrityError("trusted evaluator exports are missing")
    rows, labels = get_heldout_data()
    score = evaluate_candidate(artifact_path, rows, labels)
    if not isinstance(score, (int, float)) or not math.isfinite(score):
        raise ValueError("evaluator returned a non-finite score")
    return float(score)


def run_experiment(
    root: Path,
    seed: int,
    expected_checker_sha256: str,
    artifact_path: Path,
) -> float:
    """Run mutable training between integrity checks, then score its artifact."""
    sys.dont_write_bytecode = True
    root = root.resolve()
    artifact_path = artifact_path.resolve()
    if artifact_path.is_relative_to(root):
        artifacts_root = (root / "artifacts").resolve()
        if not artifact_path.is_relative_to(artifacts_root):
            raise ValueError("artifact output inside the package must stay under artifacts/")

    check = _load_checker(root, expected_checker_sha256)
    _assert_integrity(root, expected_checker_sha256, check, "pre-training")

    completed: subprocess.CompletedProcess[str] | None = None
    training_error = ""
    try:
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.unlink(missing_ok=True)
        environment = {
            key: value
            for key, value in os.environ.items()
            if key not in {"PYTHONHOME", "PYTHONPATH", "PYTHONSTARTUP"}
        }
        environment.update({
            "CANDIDATE_ARTIFACT_PATH": str(artifact_path),
            "PYTHONDONTWRITEBYTECODE": "1",
            "TRAIN_SEED": str(seed),
        })
        completed = subprocess.run(
            [sys.executable, "-B", str(root / "train.py")],
            cwd=root,
            env=environment,
            check=False,
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        training_error = "trainer timed out after 120 seconds"
    finally:
        _assert_integrity(root, expected_checker_sha256, check, "post-training")

    if training_error:
        raise RuntimeError(training_error)
    if completed is not None and (completed.stdout.strip() or completed.stderr.strip()):
        raise RuntimeError(
            "trainer stdout/stderr must be empty "
            f"(stdout={len(completed.stdout)} chars, stderr={len(completed.stderr)} chars)"
        )
    if completed is None or completed.returncode != 0:
        raise RuntimeError(
            f"trainer exited {None if completed is None else completed.returncode}"
        )
    if artifact_path.is_symlink() or not artifact_path.is_file():
        raise ValueError("trainer did not produce a regular candidate artifact")

    try:
        score = _score_candidate(root, artifact_path)
    finally:
        _assert_integrity(root, expected_checker_sha256, check, "post-scoring")
    return score


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--checker-sha256", required=True)
    parser.add_argument("--seed", type=int, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        score = run_experiment(
            root,
            args.seed,
            args.checker_sha256,
            root / "artifacts" / "candidate.json",
        )
    except (IntegrityError, OSError, RuntimeError, TypeError, ValueError) as error:
        raise SystemExit(str(error)) from error
    print(json.dumps({"score": score, "seed": args.seed}, sort_keys=True))


if __name__ == "__main__":
    main()
