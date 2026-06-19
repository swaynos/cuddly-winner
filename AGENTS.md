# Agent Rules

## Python environment — MANDATORY

**NEVER run against the system Python. NEVER use pixi, poetry, pipenv, conda, or pdm.**

This project uses **pyenv + virtualenv** exclusively.

Before running any `python3` command:
1. Confirm a virtualenv is active: `python3 -c "import sys; assert sys.prefix != sys.base_prefix, 'NOT IN A VENV'"`.
2. If no venv is active, stop and tell the user to activate one.
3. Never fall back to system Python. Never create a venv with a package manager other than pyenv.

Violating this rule corrupts the user's system Python and poisons test results.

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
