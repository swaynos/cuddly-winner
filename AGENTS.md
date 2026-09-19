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

- **Durable Source of Truth**: The durable source of truth is `docs/`. Update the corresponding documentation in `docs/` in the same change whenever agent behavior, permissions, installer behavior, browser behavior, or the Direct workflow changes.
- **Direct-Agent Format**: The profile supports exactly one Direct-agent file format:
  ```text
  .opencode/agents/generated/<task-derived-name>.md
  ```
  - Embeds schema version 1 policy declaring exact worktree-relative `edit_paths` and boolean `bash` access.
  - **NEVER** introduce or re-add a registry, manifest, task brief, migration, alias, strategy vocabulary, KPI policy, or compatibility layer.
  - Any legacy package must fail closed and be republished as a Direct agent.
- **Role & Agent Boundaries**:
  - `Ask` and `Grounder`: Read-only. Never modify files or execute mutating commands.
  - `Prometheus`: Planning-only publisher. Can invoke `publish_direct_agent`, but **MUST NOT** implement tasks, edit files, or run Bash.
  - `Plan` and `Build`: Native OpenCode Plan and Build must remain fully available without requiring a specialist handoff.

## Browser Boundary

- **Backend**: Playwright is the only supported browser backend. Preserve the existing five-file Playwright runtime unless the user explicitly requests browser runtime changes.
- **Rules Reference**: Strictly adhere to `docs/RESOURCE-SELECTION.md` and `rules/resource-selection.md`.
- **Execution Modes**:
  - Task execution MUST use configured `headless` or Linux `virtual-display` (Xvfb) mode.
  - A visible (headed) browser window is strictly for human login via the login helper script; never use headed browser for autonomous task execution.
- **Login & State Safety**:
  - Never busy-wait, poll in a loop, or guess credentials for login.
  - Saved authentication state is origin-scoped and stored outside the repository (mode 0600).
- **Result Validation**:
  - Downloads and generated assets require local byte and checksum validation.
  - Never automatically replay a non-idempotent action whose outcome is unknown.

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
