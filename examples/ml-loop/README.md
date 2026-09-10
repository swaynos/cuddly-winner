# ML Scalar Optimization Package

This directory is a complete schema-v1 generated-agent package for a small
binary-classifier optimization. It uses only the Python standard library.

## Scoring Boundary

- `train.py` is the only file the generated agent may edit. It writes a
  fixed-schema model artifact at the path selected by the runner and must not
  emit non-whitespace stdout or stderr.
- `prepare.py` supplies deterministic training examples only.
- `tools/heldout.py` owns separate deterministic held-out examples.
- `tools/score.py` validates and scores an artifact. Its standalone diagnostic
  command writes `logs/latest_score.txt`, but final verification never reads it.
- `tools/run_experiment.py` checks the pinned checker digest, immutable hashes,
  and exact whole-package inventory before and after each trainer child process,
  rejects any non-whitespace trainer output, then scores through explicitly
  loaded evaluator files.
- `tools/final_verify.py` retrains seeds `1`, `2`, and `3` into temporary
  artifacts, computes their median, and enforces both success conditions.
- `tools/baseline.json` records baseline scores of `0.7125` for all three seeds.
- `tools/check_immutable.py` derives mutable source and generated output paths
  from the manifest, hashes every other file, and rejects any other added,
  removed, rewritten, or non-regular package entry. No cache is excluded:
  every `__pycache__` directory, `.pyc`, `.pyo`, and other executable bytecode
  or cache artifact anywhere in the package is an unexpected entry.
- `tools/check_train_boundary.py` is itself hash-checked, then parses `train.py`
  during every whole-package check. It permits only standard-library and
  `prepare` imports and rejects direct evaluator, held-out, or score references,
  common score/accuracy/evaluation identifiers, direct dynamic-code imports,
  and direct `print` or standard-stream writes.
- `tests/test_integrity.py` covers forged logs and `prepare` bytecode caches,
  in-training tamper, new shadow modules, `.opencode` rewrites, trainer output,
  direct held-out access, isolated regression loading, baseline failure, and an
  intended candidate pass.

These checks provide a practical boundary for direct, plainly written Python and
all child-process output. Static analysis cannot prove that arbitrary obfuscated
Python does not compute a metric or access a file, and these checks do not
provide an operating-system sandbox for hostile training code.

The candidate artifact has a fixed feature basis: `x0`, `x1`, `x2`, and
`x0*x1`. The checked-in trainer deliberately fits only the first three features.
This leaves one small optimization lever without letting the trainer define the
evaluator or submit a score.

## Optimization Rule

KEEP an intermediate `train.py` candidate only when its three-seed median
improves by at least `0.005` over the current kept median. Otherwise REVERT that
candidate and continue within the twelve-experiment and four-revert budgets.
SUCCESS requires both a median of at least `0.85` and improvement of at least
`0.005` over the recorded `0.7125` baseline; either condition alone is not
success. Stop after a second inconsistent repeat result with unchanged source.

## Package Layout

- `.opencode/agents/improve-classifier.md` defines the generated primary agent.
- `.opencode/tasks/improve-classifier.md` is the durable task brief.
- `.opencode/tasks/improve-classifier.json` is the optimization manifest.
- `.opencode/generated-agents.json` registers the generated identity.
- `artifacts/candidate.json` is the checked-in baseline artifact.
- `logs/latest_score.txt` is standalone evaluator output and is not final proof.

All runtime paths resolve from each script's location. Manifest paths and
commands are relative to this package root. The nested directory is a checked-in
fixture; a copied standalone package becomes an OpenCode project after restart.

## Validate In Place

From the Cuddly Winner repository root:

```bash
node --input-type=module -e 'import { validateTaskPackage } from "./tools/validate_scaffold.ts"; const result = await validateTaskPackage("./examples/ml-loop", "improve-classifier"); console.log(JSON.stringify(result, null, 2)); process.exit(result.valid ? 0 : 1);'
```

## Baseline Negative

Use the repository interpreter. This command is expected to exit nonzero because
the checked-in median is `0.7125`, below `0.85`, with no improvement over itself:

```bash
PYTHON="$(bash scripts/ensure-venv.sh)"
PYTHONDONTWRITEBYTECODE=1 "$PYTHON" -I -B examples/ml-loop/tools/final_verify.py --root examples/ml-loop --checker-sha256 1d7af10a6679b83bf896b362c1c9ddd3737e8b47accd88ee7b563e2d913846d1
```

The verifier uses temporary artifacts, so this check does not alter the
checked-in candidate or score log.

## Regression Checks

From the package root with `PYTHON` set to the repository interpreter:

```bash
PYTHONDONTWRITEBYTECODE=1 "$PYTHON" -I -B tools/regression_check.py
```

The positive regression changes `ACTIVE_FEATURES` only in a temporary package
copy. The runner requires `-I -B` and proves that exactly 16 tests ran. No
optimized `train.py` or artifact remains in this directory.

## Exact Verification

The manifest contains four exact commands. They run an integrity pre-check, the
regression suite, the immutable final verifier, and a final integrity check. On
the checked-in baseline, the first two and last commands pass while the final
success verifier fails as intended. After an accepted optimization, all four
must pass in order.

## Use As A Target Package

Copy every entry, including `.opencode`, into a standalone target directory,
start OpenCode there, and select `improve-classifier`. Quit and restart OpenCode
if it was already running so it loads the copied generated-agent definition.
Set `PYTHON` to the target project's interpreter when it is not named `python3`.
