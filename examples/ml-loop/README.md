# ml-loop — Karpathy Loop Example

A complete, runnable example of the `@karpathy` loop applied to a small
binary classification problem. No dependencies beyond Python stdlib.

## What this demonstrates

- A frozen evaluator (`prepare.py`) that produces a consistent, deterministic
  score so results from different `train.py` configurations are directly comparable.
- A mutable training target (`train.py`) with deliberate room for improvement:
  the baseline logistic regression scores ~70-75%; a well-tuned nonlinear
  model can reach ~85-90%.
- A `program.md` with explicit stop criteria, constraints, and acceptance criteria.
- A `.opencode/karpathy.json` config that wires the loop: baseline command,
  score file, noise probe seeds, and immutability declarations.
- A `.opencode/immutable.json` that activates the ImmutabilityGuard plugin to
  prevent any agent from accidentally editing `prepare.py`.

## How to run

```bash
cd examples/ml-loop
opencode
```

Then invoke `@karpathy`. The agent will:

1. Read `program.md` and restate the objective.
2. Establish a baseline score (~0.745 with default seed).
3. Probe the noise floor across three seeds.
4. Propose one change, implement it, measure, and decide KEEP or REVERT.
5. Repeat until accuracy >= 0.85 or 10 consecutive non-improvements.

Results are logged to `experiments.md` (created by the agent on first run).

## Running manually

```bash
# Default seed
python3 train.py

# Noise probe
TRAIN_SEED=1 python3 train.py
TRAIN_SEED=2 python3 train.py
TRAIN_SEED=3 python3 train.py

# Read latest score
cat logs/latest_score.txt
```

## Expected trajectory

| Iteration | Change | Score |
|---|---|---|
| Baseline | logistic regression | ~0.72 |
| 1 | feature interaction terms (x0*x1) | ~0.76 |
| 2 | hidden layer (MLP) | ~0.82 |
| 3 | momentum / LR tuning | ~0.86+ |

Actual results depend on what the agent proposes and in what order.
