# ml-loop: Binary Classification

## Problem

Improve the validation accuracy of a binary classifier trained on a
synthetic dataset. The evaluator (`prepare.py`) is frozen. Only the
training implementation (`train.py`) may change.

## Goals

- Push validation accuracy from the ~70% linear baseline toward 85%+.
- Demonstrate the Karpathy loop's measure-one-change-at-a-time discipline
  on a real (if small) learning problem.

## Non-goals

- Achieving perfect accuracy (the dataset has inherent noise).
- Using any ML library. All model code must use Python stdlib only.
- Changing the dataset, split, or evaluation metric.

## Constraints

- `prepare.py` is frozen. No edits permitted.
- No external dependencies. `import` only from Python stdlib and `prepare`.
- `TRAIN_SEED` must remain overridable via environment variable.
- `MAX_TRAIN_STEPS = 5000` is the step budget. Do not switch to wall-clock.
- Final score must be written to `logs/latest_score.txt` as a bare float.
- A line matching `Score: <value>` must be printed to stdout.

## Acceptance Criteria

1. `python3 train.py` completes without error and prints a line containing `Score:`.
2. `cat logs/latest_score.txt` outputs a float in `[0.0, 1.0]`.
3. Validation accuracy with the default seed (`TRAIN_SEED=2026`) is >= 0.85.
4. `TRAIN_SEED=1 python3 train.py` and `TRAIN_SEED=2 python3 train.py` complete
   without error (noise probe compatibility).
5. The file `prepare.py` is byte-for-byte identical to the original
   (verify with `git diff prepare.py` — expected: no output).

## Verification

```bash
python3 train.py
cat logs/latest_score.txt
TRAIN_SEED=1 python3 train.py
TRAIN_SEED=2 python3 train.py
TRAIN_SEED=3 python3 train.py
git diff prepare.py
```

## Stop Criteria

Stop when **either** condition is met:

- Validation accuracy >= 0.85 with default seed (`TRAIN_SEED=2026`).
- 10 consecutive iterations with no KEEP decision.

## Mutable Targets

- `train.py` — all of it. Architecture, optimizer, features, schedule.

## Immutable Targets

- `prepare.py` — frozen evaluator. Do not touch.
