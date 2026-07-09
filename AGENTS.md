# Agent Rules

## Environment Assumptions

This project assumes the following tools are available on the machine:

- **Python** — `python` or `python3` is assumed working. The user may have already activated a virtualenv via pyenv before invoking OpenCode; if so, that environment is used. If not activated, the agent will verify and request activation.
- **pyenv** — Python version manager available on PATH for venv creation and isolation when needed.
- **Node.js** — required by OpenCode; available on PATH as `node` or `npm`.

If any of these are missing, operations will fail. Do not attempt to work around these assumptions (e.g., using system Python, conda, or a different JS runtime).

## Python environment — MANDATORY

**NEVER run against the system Python. NEVER use pixi, poetry, pipenv, conda, or pdm.**

This project uses **pyenv + virtualenv** exclusively.

Before running any `python3` command:
1. Run `scripts/ensure-venv.sh` to provision the virtualenv if it does not exist:
   ```bash
   PYTHON="$(bash scripts/ensure-venv.sh)"
   ```
2. Use the returned interpreter path for all subsequent Python calls:
   ```bash
   "$PYTHON" tests/verify_opencode.py --skip-llm
   ```
3. `ensure-venv.sh` reads the venv name from `.python-version`, creates it via pyenv if absent, and prints the interpreter path. It never requires manual activation.
4. Stop only if `ensure-venv.sh` exits non-zero — meaning pyenv itself is absent. That is the only unrecoverable failure.

Violating this rule corrupts the user's system Python and poisons test results.

**Preflight ordering — MANDATORY:** If your task plan includes running Python at any point (validation, tests, evals), run `scripts/ensure-venv.sh` **before making any edits**. Do not defer it to the verification step. Completing edits and then discovering the environment is broken produces an unverified completion claim — which is a worse outcome than refusing to start.

## Git commits

Do NOT commit to Git unless the user explicitly asks you to.
"Commit this", "save this to git", or "git commit" are required before any commit is made.
Finishing a task, fixing a bug, or completing a workflow step does not mean committing it.
Never auto-commit as part of any workflow.

## Workaround dumps

When a tool is unavailable or a task is out of your role:
- Say so in **one sentence** and stop.
- Do NOT produce manual command lists, "run this yourself" blocks, or handoff prompts.
- Do NOT reclassify the blocked work as something you can partially do.
- The gate plugin enforces this for `@autonomous` — it will inject a corrective and demand `<promise>BLOCKED</promise>` if you produce a workaround dump without bash available.

## Agent routing

When a task is out of your lane, name the right agent in one sentence:
- Implementation / code changes → `@autonomous` (needs `SPEC.md` first from `@prometheus`)
- Planning / spec writing → `@prometheus`
- Evidence gathering / research → `@grounder`
- Code review → `@reviewer`

## Project requirements documentation

The durable source of truth for this project lives in `docs/`, not `SPEC.md`.
`SPEC.md` is the current implementation brief and may change frequently during
iteration.

When changing agent behavior, permissions, workflows, plugins, validation,
strategy selection, deployment behavior, project invariants, or documentation
architecture, update the corresponding document in `docs/` in the same change.

Before claiming completion, verify that `docs/` still describes the resulting
system. If behavior changed and the durable docs were not updated, the task is
incomplete.

## Autonomous Strategy
strategy: karpathy
rationale: Default — prefer forcing nondeterminism into a deterministic check wherever a scalar metric and frozen evaluator exist or can be constructed; reach for exotic strategies only when instrumentation is genuinely impossible.
