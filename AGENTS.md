# Agent Rules

## Core Behavioral Invariants

- **Git Immutability**:
  - **NEVER** run `git add`, `git commit`, `git push`, `git stash`, `git reset`, `git checkout`, `git branch`, or `git init`.
  - Staging, committing, stashing, and branch manipulation are strictly prohibited unless the user gives an explicit, verbatim instruction to commit after reviewing the work.
- **Minimal Diffs & Scope Bounding**:
  - Modify only the exact files required to accomplish the assigned task.
  - Do not refactor unrelated code, reformat untouched lines, or introduce unnecessary whitespace modifications.

## Environment & Tooling

- **Node.js**: The repository requires Node.js `>=22.22.2 <25`. The browser runtime depends directly on Node and npm.
- **Python**: **NEVER** invoke system `python` or `python3` directly. If a task or check requires Python, ALWAYS obtain the virtual environment interpreter:
  ```sh
  PYTHON="$(bash scripts/ensure-venv.sh)"
  ```
  Execute all python commands using `"$PYTHON"`.

## Product Contract & Architecture

- **Durable Source of Truth**: The durable source of truth is `docs/`. Update the corresponding documentation in `docs/` in the same change whenever agent behavior, permissions, installer behavior, browser behavior, or the Goal Agent workflow changes.
- **Goal-Agent Format**: The profile supports exactly one Goal Agent file format:
  ```text
  .opencode/agents/generated/<task-derived-name>.md
  ```
  - Embeds schema version 1 policy declaring exact worktree-relative `edit_paths` and boolean `bash` access.
  - **NEVER** introduce or re-add a registry, manifest, task brief, migration, alias, strategy vocabulary, KPI policy, or compatibility layer.
  - Any legacy package must fail closed and be republished as a Goal Agent.
- **Role & Agent Boundaries**:
  - `Ask` and `Grounder`: Read-only. Never modify files or execute mutating commands.
  - `Prometheus`: Planning-only publisher. Can invoke `publish_goal_agent`, but **MUST NOT** implement tasks, edit files, or run Bash.
  - Generated Goal Agents are persistent root workers: implement and explore creatively in the same conversation, with automatic continuation of partial work and failed experiments. Fresh independent evaluator children provide feedback and final evaluation without receiving the root chat. The worker uses its selected root model; evaluators inherit it unless `validator_model` is set. There is no `builder_model`, fresh-builder cycle, stall quota, or arbitrary default time/token/attempt limit.
  - Start once with `goal_run(operation="start", completion_target=..., authorized_actions=...)` before mutation. Native `session.metadata.cuddly_winner_goal` records `persistent-worker-v1` authority, baseline, pending actions, findings and working/evaluating/paused/accepted state. Compaction summaries and best-effort UI are not authority. Only an active independent evaluator may call `goal_verdict`; feedback cannot accept the task, and final acceptance is terminal and bound to candidate hashes.
  - Request `goal_evaluate(mode="feedback", focus=..., artifacts=[...])` for independent feedback and `goal_evaluate(mode="final", artifacts=[...])` for full acceptance bound to all policy-editable files plus explicit artifacts. Evaluator report errors are corrected in the same child; the three-report protocol watchdog returns working/error feedback, not a domain stop.
  - Cancellation, denied permissions, genuine blockers and unknown side effects pause the run durably. Inspect before explicit user-authorized `goal_run(operation="resume", reconciled=true)`; status questions never resume work. Restart must not replay uncertain actions. Changed or unmarked old Goal definitions fail closed: explicitly republish, restart, and use a fresh conversation while preserving historical stops and user budgets.
  - Goal workers may edit only exact policy paths; boolean Bash access is approval-gated (`ask`) when enabled, not a shell sandbox. Protect `.opencode/`, root OpenCode config, root `AGENTS.md` and the actually loaded runtime's own source directories. Ordinary task `scripts/` and `tools/` remain editable within policy. Explicit user resource ceilings belong to task-owned intent/receipt evidence and are never silently reset or represented as shell hard limits.
  - Keep orchestration scoped to the single Goal-Agent format. This does not prohibit user-requested automation in other projects.
  - `Plan` and `Build`: Native OpenCode Plan and Build remain fully available without requiring a specialist handoff, and work seamlessly without altered behavior. Any new behaviors introduced by this project work strictly within their intended surfaces. Root Build sessions can also invoke `publish_goal_agent`.

## Browser Boundary

Follow `rules/resource-selection.md` for workflow selection and shared safeguards.
Follow that rule's reference-loading instructions for `docs/RESOURCE-SELECTION.md`.
Preserve the existing five-file Playwright runtime unless explicitly asked to change it.

## Autonomous Execution & Verification Workflow

Follow this execution loop for every task:

1. **Inspection**:
   - Read relevant local code, tests, and `docs/` before making edits.
   - Formulate the minimal change that satisfies the requirement.
2. **Targeted Verification (Fast Feedback)**:
   - Run focused tests first before running the entire test suite:
     ```sh
     node --test tests/path/to/specific.test.mjs
     ```
3. **Comprehensive Verification**:
   - Run the full suite before declaring completion:
     ```sh
     npm test
     ```
   - Verify changed behavior, installer inventory, and durable documentation.
   - **NEVER** alter or weaken existing test assertions just to force a failing test to pass. Diagnose and fix the implementation.
4. **Environment Reload**:
   - Restart OpenCode after adding or modifying installed agents, plugins, tools, rules, or browser files.

## Design Principles: KISS and SOLID

- **Keep It Simple (KISS)**:
  - Implement the simplest solution that directly solves the problem.
  - **Avoid Speculative Abstractions**: Do not create factory patterns, generic helper layers, or extra configuration schemas for single-use cases.
- **Modular & Maintainable (SOLID)**:
  - Keep components modular, self-contained, and easily testable.
  - Separate pure logic from I/O and environment side effects.
  - Ensure any new agent, skill, or tool has clear, unambiguous boundaries and single responsibility.
