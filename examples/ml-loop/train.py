"""
train.py — Mutable training target for the ml-loop Karpathy example.

THE AGENT HAS FULL CONTROL OVER THIS FILE.

Starting baseline: a logistic regression trained with mini-batch SGD.
This intentionally uses a linear model so there is room to improve.
Expected baseline accuracy: ~68-72%.
Target: >= 0.85 accuracy (see SPEC.md stop criteria).

Levers the agent may try (one per iteration):
  - Architecture: add hidden layer(s), change width, change activation
  - Optimizer: momentum, adaptive LR (implement from scratch — no deps)
  - Schedule: LR decay by epoch
  - Features: explicit interaction terms (x0*x1, etc.)
  - Regularization: L2 weight decay
  - Batch size
  - Initialization: e.g. He init vs. zeros

Rules:
  - No imports beyond Python stdlib.
  - TRAIN_SEED must remain overridable via env var for noise probing.
  - MAX_TRAIN_STEPS must remain the step budget (not wall-clock).
  - Final score must be written to logs/latest_score.txt as a float.
  - Print a line containing "Score: <value>" to stdout.
"""

from __future__ import annotations

import math
import os
import random
from pathlib import Path

from prepare import accuracy, get_dataset

# ── Config ────────────────────────────────────────────────────────────────────
MAX_TRAIN_STEPS = 5000
TRAIN_SEED      = int(os.environ.get("TRAIN_SEED", 2026))
LEARNING_RATE   = 0.05
BATCH_SIZE      = 32

# ── Model: logistic regression ────────────────────────────────────────────────

class LogisticRegression:
    def __init__(self, n_features: int, rng: random.Random) -> None:
        # Small random init
        self.w = [rng.gauss(0, 0.01) for _ in range(n_features)]
        self.b = 0.0

    def _sigmoid(self, z: float) -> float:
        # Numerically stable sigmoid
        if z >= 0:
            return 1.0 / (1.0 + math.exp(-z))
        e = math.exp(z)
        return e / (1.0 + e)

    def predict_proba(self, x: list[float]) -> float:
        z = sum(wi * xi for wi, xi in zip(self.w, x)) + self.b
        return self._sigmoid(z)

    def predict(self, x: list[float]) -> int:
        return 1 if self.predict_proba(x) >= 0.5 else 0

    def update(self, x: list[float], y: int, lr: float) -> None:
        """Single SGD step (binary cross-entropy gradient)."""
        p = self.predict_proba(x)
        error = p - y                        # d_loss/d_logit
        self.b -= lr * error
        for i in range(len(self.w)):
            self.w[i] -= lr * error * x[i]


# ── Training loop ─────────────────────────────────────────────────────────────

def run_experiment() -> None:
    rng = random.Random(TRAIN_SEED)

    X_train, y_train, X_val, y_val = get_dataset()
    n_features = len(X_train[0])
    model = LogisticRegression(n_features, rng)

    n = len(X_train)
    indices = list(range(n))

    steps  = 0
    epochs = 0

    while steps < MAX_TRAIN_STEPS:
        rng.shuffle(indices)
        for start in range(0, n, BATCH_SIZE):
            if steps >= MAX_TRAIN_STEPS:
                break
            batch = indices[start : start + BATCH_SIZE]
            for i in batch:
                model.update(X_train[i], y_train[i], LEARNING_RATE)
            steps += 1
        epochs += 1

    # ── Evaluate ──────────────────────────────────────────────────────────────
    y_pred = [model.predict(x) for x in X_val]
    score  = accuracy(y_val, y_pred)

    print(f"EXPERIMENT COMPLETE. Epochs: {epochs}, Steps: {steps}, Score: {score:.6f}")

    logs_dir = Path("logs")
    logs_dir.mkdir(parents=True, exist_ok=True)
    (logs_dir / "latest_score.txt").write_text(str(score))


if __name__ == "__main__":
    run_experiment()
