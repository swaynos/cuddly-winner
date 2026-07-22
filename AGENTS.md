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

## Agent compatibility

OpenCode's built-in Plan and Build modes are the default workflow and must work
without custom routing, a `SPEC.md`, specialist agents, or workflow tools. Do
not redirect ordinary planning to Prometheus or ordinary implementation to
Autonomous.

Prometheus, Autonomous, Karpathy, Reviewer, Grounder, and Ask are optional
specialist agents. Apply their role-specific contracts only when the user
explicitly invokes one of them.

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

## Optional Autonomous Strategy

The following default applies only after the user explicitly invokes
`@autonomous`; it does not govern built-in Plan or Build.
strategy: ralph
rationale: Default — use bounded ordinary implementation unless the task explicitly requires scalar-metric optimization against a frozen evaluator.
