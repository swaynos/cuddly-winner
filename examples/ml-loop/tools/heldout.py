"""Fixed held-out data for the immutable evaluator."""

from __future__ import annotations

import math


_HELDOUT_SEED = 7331
_HELDOUT_SIZE = 240


def _lcg(state: int) -> tuple[int, float]:
    state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
    return state, state / 0x100000000


def _randn_pair(state: int) -> tuple[int, float, float]:
    state, u1 = _lcg(state)
    state, u2 = _lcg(state)
    radius = math.sqrt(-2.0 * math.log(max(u1, 1e-12)))
    angle = 2.0 * math.pi * u2
    return state, radius * math.cos(angle), radius * math.sin(angle)


def get_heldout_data() -> tuple[list[list[float]], list[int]]:
    """Return the fixed examples used only for final scoring."""
    state = _HELDOUT_SEED
    features: list[list[float]] = []
    labels: list[int] = []

    for _ in range(_HELDOUT_SIZE):
        state, x0, x1 = _randn_pair(state)
        state, x2, noise = _randn_pair(state)
        features.append([x0, x1, x2])
        labels.append(1 if x0 * x1 + 0.5 * x2 + 0.1 * noise > 0.0 else 0)

    return features, labels
