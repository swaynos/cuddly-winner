# Improve Classifier

## Outcome

Improve the fixed-basis classifier trained by `train.py`. The mutable trainer
emits a fixed-schema artifact at the path selected by the immutable runner. Only
`train.py` is mutable source. The manifest-listed artifact and score log are
generated outputs; every other package entry is inventoried and immutable.

## Acceptance Criteria

1. `tools/final_verify.py` independently retrains `TRAIN_SEED=1`, `2`, and `3`
   and calculates their median from evaluator-owned code and held-out data.
2. Success requires both a three-seed median of at least `0.85` and improvement
   of at least `0.005` over the recorded baseline median of `0.7125`.
3. `TRAIN_SEED` remains configurable through the environment, and each run
   completes within `MAX_TRAIN_STEPS = 5000`.
4. The hash-pinned `tools/check_train_boundary.py` parses `train.py` during every
   whole-package check. It permits only Python standard-library and `prepare`
   imports and rejects direct evaluator, held-out, or score references plus
   obvious score/accuracy/evaluation identifiers and output calls.
5. `train.py` writes only a schema-v1 fixed-basis model artifact and remains
   silent. The runner rejects any non-whitespace trainer stdout or stderr.
6. `tools/run_experiment.py` checks the pinned checker digest, every immutable
   hash, exact whole-package inventory, and trainer source boundary before and
   after every trainer child. It scores only after the post-training check passes.
7. A changed immutable file, deleted baseline entry, or added file or directory
   outside the exact mutable/output set fails before scoring. This includes root
   shadows, `.opencode` rewrites, new entries under `tools/`, every `__pycache__`
   directory, and every `.pyc`, `.pyo`, or other bytecode/cache artifact.
8. Regression discovery runs exactly 16 tests under Python `-I -B`, evaluator
   loading uses explicit trusted paths, and final verification ends with a
   separate whole-package integrity check.

## Durable Context

Read `.opencode/tasks/improve-classifier.json`, `README.md`, `prepare.py`,
`tests/test_integrity.py`, and every file under `tools/` before the first
experiment. The manifest is the machine-checked scope and strategy contract.
`tools/baseline.json` records the fixed baseline evidence.

## Optimization Procedure

1. Run the first exact verification command to confirm the immutable boundary.
2. Use `tools/run_experiment.py`, never direct `train.py` or `tools/score.py`, to
   measure seeds `1`, `2`, and `3` before editing.
3. Choose one bounded lever in `train.py`: active fixed-basis features, optimizer,
   schedule, regularization, batch size, initialization, or training logic.
4. Apply only that candidate change. Do not edit an artifact, score log, test,
   evaluator, held-out input, task file, baseline, or hash expectation. Keep the
   trainer silent and within the checked source boundary.
5. Regenerate all three fixed-seed artifacts through the immutable runner and
   calculate the candidate median from its JSON score outputs.
6. KEEP an intermediate candidate only when its median improves by at least
   `0.005` over the current kept median.
7. Otherwise REVERT only the candidate change to `train.py`, then continue while
   budget remains. Do not use a broad worktree restore command.
8. Claim SUCCESS only when `tools/final_verify.py` confirms both the `0.85`
   median threshold and the `0.005` minimum improvement, followed by the final
   integrity command. Meeting one condition is not success.

Use this command shape for each exploratory seed, substituting the seed value:

```bash
PYTHONDONTWRITEBYTECODE=1 "${PYTHON:-python3}" -I -B tools/run_experiment.py --checker-sha256 1d7af10a6679b83bf896b362c1c9ddd3737e8b47accd88ee7b563e2d913846d1 --seed 1
```

Fixed-seed runs are deterministic. Repeat a run only after a command failure or
one inconsistent duplicate result. Stop after a second inconsistent repeat with
unchanged source and report the failed determinism contract.

## Limits And Escalation

Evaluate at most twelve candidates. Stop after four consecutive reverts, after a
required command fails twice without an intervening change, or before any scope,
dependency, metric, dataset, permission, or immutable-target change. Return to
Prometheus when the objective is materially ambiguous or the declared boundary
prevents further measurement.

## Exact Verification

Set `PYTHON` to the approved interpreter, or leave it unset in a standalone copy
that provides `python3`. Run these commands in order from the package root after
the final edit:

```bash
PYTHONDONTWRITEBYTECODE=1 "${PYTHON:-python3}" -I -B -c 'import logging; logging.disable(logging.CRITICAL); import hashlib, pathlib, sys; path = pathlib.Path("tools/check_immutable.py"); actual = hashlib.sha256(path.read_bytes()).hexdigest(); expected = "1d7af10a6679b83bf896b362c1c9ddd3737e8b47accd88ee7b563e2d913846d1"; print(f"checker-sha256: {actual}"); sys.exit(0 if actual == expected else 1)' && PYTHONDONTWRITEBYTECODE=1 "${PYTHON:-python3}" -I -B tools/check_immutable.py
PYTHONDONTWRITEBYTECODE=1 "${PYTHON:-python3}" -I -B tools/regression_check.py
PYTHONDONTWRITEBYTECODE=1 "${PYTHON:-python3}" -I -B tools/final_verify.py --checker-sha256 1d7af10a6679b83bf896b362c1c9ddd3737e8b47accd88ee7b563e2d913846d1
PYTHONDONTWRITEBYTECODE=1 "${PYTHON:-python3}" -I -B -c 'import logging; logging.disable(logging.CRITICAL); import hashlib, pathlib, sys; path = pathlib.Path("tools/check_immutable.py"); actual = hashlib.sha256(path.read_bytes()).hexdigest(); expected = "1d7af10a6679b83bf896b362c1c9ddd3737e8b47accd88ee7b563e2d913846d1"; print(f"post-final-checker-sha256: {actual}"); sys.exit(0 if actual == expected else 1)' && PYTHONDONTWRITEBYTECODE=1 "${PYTHON:-python3}" -I -B tools/check_immutable.py
```

The checked-in starter is expected to fail the third command because it matches
the recorded baseline. A kept optimized candidate must make all four commands
exit zero. The final verifier ignores `artifacts/candidate.json` and
`logs/latest_score.txt`; it retrains into temporary artifacts and reports fresh
scores.

## Completion Evidence

Report all three fresh scores, their median, improvement over the recorded
baseline, experiment count, kept `train.py` change, regression result, and final
integrity result. Any missing or non-finite score, failed check, threshold miss,
or improvement miss means revert or continue within budget, not success.
