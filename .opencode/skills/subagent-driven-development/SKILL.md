---
name: subagent-driven-development
description: Use when executing an implementation plan with independent tasks that can be delegated, reviewed, or run in parallel.
compatibility: opencode
---

# Subagent-Driven Development

Delegate focused work to fresh context. Do not hand a subagent the whole session
when a precise job brief will do.

## Dispatch Brief

Every delegated task needs:
- objective
- exact files or search scope
- constraints and non-goals
- expected output
- verification command or review criteria
- escalation rules

## Statuses

- `DONE`: task complete with evidence.
- `DONE_WITH_CONCERNS`: task complete but risk remains.
- `NEEDS_CONTEXT`: caller omitted necessary facts.
- `BLOCKED`: task cannot proceed safely.

Never ignore escalation. Change the brief, add context, split the task, or use a
more capable agent.

## Review Loop

After delegated work:
1. Verify the actual diff or evidence independently.
2. Review against the spec or task brief first.
3. Review code quality second.
4. Re-dispatch only with a changed, clearer brief.

Keep subagents narrow, composable, and least-privilege.
