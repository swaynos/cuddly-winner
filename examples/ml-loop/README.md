# ml-loop — Karpathy Loop Example

A complete, runnable example of the Karpathy loop strategy applied to a small
binary classification problem via `@autonomous`. No dependencies beyond Python stdlib.

## What this demonstrates

- A frozen evaluator (`prepare.py`) that produces a consistent, deterministic
  score so results from different `train.py` configurations are directly comparable.
- A mutable training target (`train.py`) with deliberate room for improvement:
  the baseline logistic regression scores ~70-75%; a well-tuned nonlinear
  model can reach ~85-90%.
- A `program.md` with explicit stop criteria, constraints, and acceptance criteria.
- An `opencode-karpathy.json` config that wires the loop: baseline command,
  score file, noise probe seeds, and immutability declarations.

## How to run

```bash
cd examples/ml-loop
opencode
```

Then invoke `@autonomous`. It reads the `AGENTS.md` strategy directive
(`strategy: karpathy`) and delegates to the `@karpathy` strategy subagent, which:

1. Reads `program.md` and restates the objective.
2. Establishes a baseline score (~0.745 with default seed).
3. Probes the noise floor across three seeds.
4. Proposes one change for Autonomous to implement, then measures and decides
   KEEP or REVERT.
5. Repeats until accuracy >= 0.85 or 10 consecutive non-improvements.

Autonomous owns any project edits and experiment log persistence.

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
