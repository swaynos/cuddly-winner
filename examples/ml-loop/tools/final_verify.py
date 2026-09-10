"""Immutable fixed-seed success verifier for the ml-loop optimization task."""

from __future__ import annotations

import sys

if not sys.flags.isolated:
    raise SystemExit("final_verify.py requires isolated Python mode (-I)")

import argparse
import json
import logging
import math
import statistics
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TARGET_MEDIAN = 0.85
MINIMUM_IMPROVEMENT = 0.005
FIXED_SEEDS = (1, 2, 3)


class VerificationError(RuntimeError):
    """Raised when final evidence is invalid or below the success contract."""


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


def _trusted_boundary(root: Path, checker_sha256: str):
    checker_path = root / "tools" / "check_immutable.py"
    actual = _sha256(checker_path)
    if actual != checker_sha256:
        raise VerificationError(
            f"checker sha256 mismatch (expected {checker_sha256}, got {actual})"
        )
    checker = _load_namespace(checker_path, "_ml_loop_final_checker")
    check = checker.get("check")
    if not callable(check):
        raise VerificationError("immutable checker does not export check")
    failures = check(root)
    if failures:
        raise VerificationError("immutable check failed:\n" + "\n".join(failures))
    runner = _load_namespace(root / "tools" / "run_experiment.py", "_ml_loop_runner")
    run_experiment = runner.get("run_experiment")
    if not callable(run_experiment):
        raise VerificationError("immutable runner does not export run_experiment")
    return check, run_experiment


def _load_baseline(root: Path) -> float:
    try:
        raw = json.loads((root / "tools" / "baseline.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise VerificationError(f"could not read recorded baseline: {error}") from error
    if not isinstance(raw, dict) or set(raw) != {
        "schema_version", "seeds", "scores", "median"
    }:
        raise VerificationError("recorded baseline has unexpected fields")
    if raw["schema_version"] != 1 or raw["seeds"] != list(FIXED_SEEDS):
        raise VerificationError("recorded baseline uses the wrong schema or seed set")
    scores = raw["scores"]
    if not isinstance(scores, list) or len(scores) != len(FIXED_SEEDS) or any(
        isinstance(score, bool)
        or not isinstance(score, (int, float))
        or not math.isfinite(score)
        for score in scores
    ):
        raise VerificationError("recorded baseline scores are invalid")
    calculated = float(statistics.median(scores))
    recorded = raw["median"]
    if (
        isinstance(recorded, bool)
        or not isinstance(recorded, (int, float))
        or not math.isfinite(recorded)
        or abs(float(recorded) - calculated) > 1e-12
    ):
        raise VerificationError("recorded baseline median does not match its scores")
    return calculated


def verify(root: Path, checker_sha256: str) -> tuple[list[float], float, float]:
    """Regenerate all fixed-seed artifacts and enforce both success conditions."""
    sys.dont_write_bytecode = True
    root = root.resolve()
    check, run_experiment = _trusted_boundary(root, checker_sha256)
    scores: list[float] = []
    try:
        baseline_median = _load_baseline(root)
        with tempfile.TemporaryDirectory(prefix="ml-loop-final-") as temp_dir:
            for seed in FIXED_SEEDS:
                artifact_path = Path(temp_dir) / f"candidate-{seed}.json"
                scores.append(
                    run_experiment(root, seed, checker_sha256, artifact_path)
                )
    finally:
        failures = check(root)
        if _sha256(root / "tools" / "check_immutable.py") != checker_sha256:
            failures.insert(
                0,
                "tools/check_immutable.py changed during final verification",
            )
        if failures:
            raise VerificationError(
                "post-final-verification immutable check failed:\n"
                + "\n".join(failures)
            )

    candidate_median = float(statistics.median(scores))
    improvement = candidate_median - baseline_median
    print("fixed-seed scores: " + ", ".join(
        f"{seed}={score:.6f}" for seed, score in zip(FIXED_SEEDS, scores)
    ))
    print(f"recorded baseline median: {baseline_median:.6f}")
    print(f"candidate median: {candidate_median:.6f}")
    print(f"improvement: {improvement:.6f}")

    reasons = []
    if candidate_median < TARGET_MEDIAN:
        reasons.append(
            f"median {candidate_median:.6f} is below target {TARGET_MEDIAN:.6f}"
        )
    if improvement < MINIMUM_IMPROVEMENT:
        reasons.append(
            f"improvement {improvement:.6f} is below minimum "
            f"{MINIMUM_IMPROVEMENT:.6f}"
        )
    if reasons:
        raise VerificationError("; ".join(reasons))
    return scores, candidate_median, improvement


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--checker-sha256", required=True)
    args = parser.parse_args()
    try:
        _scores, candidate_median, improvement = verify(
            args.root,
            args.checker_sha256,
        )
    except (OSError, RuntimeError, TypeError, ValueError) as error:
        raise SystemExit(f"final verification failed: {error}") from error
    print(
        "final-verification-ok: "
        f"median={candidate_median:.6f} improvement={improvement:.6f}"
    )
    print(f"Score: {candidate_median:.6f}")


if __name__ == "__main__":
    main()
