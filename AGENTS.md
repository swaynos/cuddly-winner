# Agent Rules

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

## Autonomous Strategy
strategy: karpathy
rationale: Default — prefer forcing nondeterminism into a deterministic check wherever a scalar metric and frozen evaluator exist or can be constructed; reach for exotic strategies only when instrumentation is genuinely impossible.
