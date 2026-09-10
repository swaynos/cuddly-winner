"""Mutable trainer for the ml-loop optimization example.

The trainer writes model parameters, never a score. The frozen evaluator loads
the candidate artifact and measures it on held-out data.
"""

from __future__ import annotations

import json
import math
import os
import random
from pathlib import Path

from prepare import get_training_data


MAX_TRAIN_STEPS = 5000
TRAIN_SEED = int(os.environ.get("TRAIN_SEED", 2026))
LEARNING_RATE = 0.03
BATCH_SIZE = 32

MODEL_TYPE = "fixed-basis-logistic-v1"
FEATURE_ORDER = ["x0", "x1", "x2", "x0*x1"]

# The starting candidate is deliberately linear. Enabling the fixed interaction
# feature is one bounded optimization lever with clear room to improve.
ACTIVE_FEATURES = 3


def _basis(row: list[float]) -> list[float]:
    x0, x1, x2 = row
    return [x0, x1, x2, x0 * x1]


def _sigmoid(value: float) -> float:
    if value >= 0.0:
        return 1.0 / (1.0 + math.exp(-value))
    exp_value = math.exp(value)
    return exp_value / (1.0 + exp_value)


def run_experiment() -> None:
    rng = random.Random(TRAIN_SEED)
    rows, labels = get_training_data()
    weights = [rng.gauss(0.0, 0.01) for _ in FEATURE_ORDER]
    for index in range(ACTIVE_FEATURES, len(weights)):
        weights[index] = 0.0
    bias = 0.0
    indices = list(range(len(rows)))

    steps = 0
    while steps < MAX_TRAIN_STEPS:
        rng.shuffle(indices)
        for start in range(0, len(indices), BATCH_SIZE):
            if steps >= MAX_TRAIN_STEPS:
                break
            batch = indices[start : start + BATCH_SIZE]
            gradient = [0.0] * len(weights)
            bias_gradient = 0.0
            for row_index in batch:
                values = _basis(rows[row_index])
                margin = bias + sum(
                    weights[index] * values[index]
                    for index in range(ACTIVE_FEATURES)
                )
                error = _sigmoid(margin) - labels[row_index]
                bias_gradient += error
                for index in range(ACTIVE_FEATURES):
                    gradient[index] += error * values[index]
            scale = LEARNING_RATE / len(batch)
            bias -= scale * bias_gradient
            for index in range(ACTIVE_FEATURES):
                weights[index] -= scale * gradient[index]
            steps += 1

    artifact = {
        "schema_version": 1,
        "model_type": MODEL_TYPE,
        "feature_order": FEATURE_ORDER,
        "weights": weights,
        "bias": bias,
    }
    default_artifact = Path(__file__).resolve().parent / "artifacts" / "candidate.json"
    artifact_path = Path(os.environ.get("CANDIDATE_ARTIFACT_PATH", default_artifact))
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_path.write_text(
        json.dumps(artifact, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
if __name__ == "__main__":
    run_experiment()
