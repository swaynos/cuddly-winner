# Agent Rules

## Environment Assumptions

This project assumes the following tools are available on the machine:

- **Python**: `python` or `python3` is assumed working. The user may have already activated a virtualenv via pyenv before invoking OpenCode; if so, that environment is used. If not activated, the agent will verify and request activation.
- **pyenv**: Python version manager available on PATH for venv creation and isolation when needed.
- **Node.js**: required by OpenCode; available on PATH as `node` or `npm`.

If any of these are missing, operations will fail. Do not attempt to work around these assumptions by using system Python, conda, or a different JavaScript runtime.

## Python Environment: Mandatory

**NEVER run against the system Python. NEVER use pixi, poetry, pipenv, conda, or pdm.**

This project uses **pyenv + virtualenv** exclusively.

Before running any `python3` command:

1. Run `scripts/ensure-venv.sh` to provision the virtualenv if it does not exist:

   ```bash
   PYTHON="$(bash scripts/ensure-venv.sh)"
   ```

2. Use the returned interpreter path for all later Python calls:

   ```bash
   "$PYTHON" tests/verify_opencode.py --skip-llm
   ```

3. `ensure-venv.sh` reads the venv name from `.python-version`, creates it via pyenv if absent, and prints the interpreter path. It never requires manual activation.
4. Stop only if `ensure-venv.sh` exits non-zero, which means pyenv itself is absent. That is the only unrecoverable failure.

Violating this rule corrupts the user's system Python and poisons test results.

**Preflight ordering is mandatory:** If your task plan includes running Python at any point for validation, tests, or evals, run `scripts/ensure-venv.sh` before making any edits. Do not defer it to verification. Completing edits before discovering a broken environment creates an unverified completion claim, which is worse than refusing to start.

## Git Commits

Agents do not stage, commit, stash, reset, switch branches, or initialize Git.
Pending worktree changes are the human-owned review artifact across Prometheus
and generated-agent sessions. Only an explicit user request may authorize a
final commit after human review.

## Agent Compatibility

OpenCode's built-in Plan and Build modes are the default workflow and must work
without custom routing, a generated task package, specialist agents, or workflow
tools. Do not redirect ordinary planning to Prometheus or ordinary
implementation to a generated agent.

The installed shared rules and globally loaded plugin hooks still apply to
native sessions. They may enforce cross-cutting governance or prompt and session
hygiene. "Native" here means that Plan and Build remain usable without
specialist routing or a generated package, not that installation leaves every
native prompt or session byte-for-byte unchanged.

Ask, Grounder, Prometheus, and Reviewer are the four shipped specialist agents.
Apply their role-specific contracts only when the user explicitly selects or
invokes one. Task-specific generated agents are project-local output from
Prometheus, not shipped profiles.

## Project Requirements Documentation

The durable source of truth for this project lives in `docs/`. Generated task
briefs under `.opencode/tasks/<task-id>.md` describe one implementation and may
change frequently.

When changing agent behavior, permissions, workflows, plugins, validation,
strategy selection, deployment behavior, project invariants, or documentation
architecture, update the corresponding document in `docs/` in the same change.

Before claiming completion, verify that `docs/` still describes the resulting
system. If behavior changed and the durable docs were not updated, the task is
incomplete.

## No Legacy Support

This project accepts only schema version 1 for generated-agent registries and
task manifests, the current `direct`, `ralph`, and `optimization` strategy
vocabulary, and the current feedback-report schema. Do not add a migration path,
an alias, or acceptance of a second version. Reject an out-of-date generated
package and have Prometheus republish it. Treat any request for multi-version
support as a change to `docs/REQUIREMENTS.md` under No Legacy Support, not as an
ordinary implementation step.

## Generated-Agent Execution

Prometheus publishes `.opencode/agents/<task-id>.md`, the matching Markdown task
brief and schema version 1 JSON manifest under `.opencode/tasks/`, and
`.opencode/generated-agents.json`. Prometheus stops before implementation.
Its shipped prompt contains the exact package schema and does not depend on this
repository's docs being present in the installed profile. Prometheus passes the
selected task id as `agent_name` to `validate_scaffold`; omitting that optional
argument is valid only for a one-entry registry.

`validate_scaffold`, the immutability plugin, and the KPI plugin require
registry-wide structural validation plus full schema-v1 validation of the named
package. Malformed or duplicate registry entries, names reserved for native or
shipped agents, and an incomplete named manifest fail recognition. Package files
for unselected entries are not loaded.

The handoff names the generated agent, brief, and manifest. After publication,
the user quits and restarts OpenCode, starts a new conversation, and selects the
named generated agent. That agent reads its task brief and manifest, owns
implementation and fresh final verification, and stays within the manifest's
edit and Bash permissions. Reviewer may assess the task contract, diff, and
verification evidence, but its verdict remains advisory.

Use `direct` as the default strategy. Use `ralph` only when each pass has
independent progress evidence and clear pass and run stop rules. Use
`optimization` only when the metric, evaluator, mutable targets, immutable
targets, budget, noise policy, and keep-or-revert rule are complete.
