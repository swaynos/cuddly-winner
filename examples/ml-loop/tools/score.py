"""Evaluator-owned candidate validation and held-out accuracy scoring."""

from __future__ import annotations

import sys

if not sys.flags.isolated:
    raise SystemExit("score.py requires isolated Python mode (-I)")

import argparse
import json
import math
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MODEL_TYPE = "fixed-basis-logistic-v1"
FEATURE_ORDER = ["x0", "x1", "x2", "x0*x1"]
ARTIFACT_KEYS = {"schema_version", "model_type", "feature_order", "weights", "bias"}


def _number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number")
    result = float(value)
    if not math.isfinite(result) or abs(result) > 100.0:
        raise ValueError(f"{name} must be finite and have magnitude at most 100")
    return result


def _load_candidate(artifact_path: Path) -> tuple[list[float], float]:
    try:
        raw = json.loads(
            artifact_path.read_text(encoding="utf-8"),
            parse_constant=lambda value: (_ for _ in ()).throw(
                ValueError(f"invalid JSON constant: {value}")
            ),
        )
    except (OSError, json.JSONDecodeError, ValueError) as error:
        raise ValueError(f"could not read candidate artifact: {error}") from error

    if not isinstance(raw, dict) or set(raw) != ARTIFACT_KEYS:
        raise ValueError("candidate artifact has unexpected fields")
    if raw["schema_version"] != 1 or raw["model_type"] != MODEL_TYPE:
        raise ValueError("candidate artifact has an unsupported schema or model type")
    if raw["feature_order"] != FEATURE_ORDER:
        raise ValueError("candidate artifact has an unsupported feature order")
    if not isinstance(raw["weights"], list) or len(raw["weights"]) != len(FEATURE_ORDER):
        raise ValueError(f"candidate artifact must contain {len(FEATURE_ORDER)} weights")

    weights = [
        _number(value, f"weights[{index}]")
        for index, value in enumerate(raw["weights"])
    ]
    return weights, _number(raw["bias"], "bias")


def _basis(row: list[float]) -> list[float]:
    x0, x1, x2 = row
    return [x0, x1, x2, x0 * x1]


def evaluate_candidate(
    artifact_path: Path,
    rows: list[list[float]],
    labels: list[int],
) -> float:
    """Return held-out accuracy for one validated candidate artifact."""
    if not rows or len(rows) != len(labels):
        raise ValueError("held-out rows and labels must be non-empty and aligned")
    weights, bias = _load_candidate(artifact_path)
    predictions = [
        1 if bias + sum(
            weight * value for weight, value in zip(weights, _basis(row))
        ) >= 0.0 else 0
        for row in rows
    ]
    return sum(
        actual == predicted for actual, predicted in zip(labels, predictions)
    ) / len(labels)


def _load_heldout(path: Path) -> tuple[list[list[float]], list[int]]:
    namespace = {
        "__file__": str(path),
        "__name__": "_ml_loop_heldout",
        "__package__": None,
    }
    exec(compile(path.read_bytes(), str(path), "exec"), namespace)
    return namespace["get_heldout_data"]()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    root = args.root.resolve()
    artifact_path = root / "artifacts" / "candidate.json"
    try:
        rows, labels = _load_heldout(root / "tools" / "heldout.py")
        score = evaluate_candidate(artifact_path, rows, labels)
    except (OSError, TypeError, ValueError) as error:
        raise SystemExit(str(error)) from error

    score_log = root / "logs" / "latest_score.txt"
    score_log.parent.mkdir(parents=True, exist_ok=True)
    score_log.write_text(f"{score:.6f}\n", encoding="utf-8")
    print(f"Score: {score:.6f}")


if __name__ == "__main__":
    main()
