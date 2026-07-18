# Requirements

## Product Goal

This project is an optional extension to OpenCode. It adds specialist agents and
evidence-backed autonomous profiles for work that benefits from stronger
planning, durable state, bounded execution, or scalar-metric optimization.

It is not a replacement for OpenCode's built-in Plan and Build modes.

## Native Compatibility Invariant

Built-in `plan` and `build` are outside this project's enforcement boundary.
Installation must not alter their prompts, routing, permissions, Bash access,
mutation tools, or completion behavior. They must continue to work without a `SPEC.md`, a
custom runner, a supervisor, an immutability policy, or any specialist agent.

The project must not install repository-specific `AGENTS.md` instructions into
the global OpenCode configuration. Documentation and tests must not direct
ordinary planning to Prometheus or ordinary implementation to Autonomous.

Unknown, future built-in, and third-party agent identities are also outside the
managed-agent enforcement boundary.

## Managed Agents

The project introduces three top-level specialist agents and three hidden subagents. Each serves a distinct role in planning, implementation, verification, or research:

**Top-Level Agents (User-Facing):**
- **`ask`**: A quick-question agent that answers concisely from session context before code context. It does not perform planning or code changes.
- **`prometheus`**: A planning agent that explores unknowns, validates assumptions with measured spikes, determines the appropriate looping strategy, and outputs that strategy within `SPEC.md`.
- **`autonomous`**: A general-purpose looping implementation agent. Its goal is to execute a loop rather than basic tasks off a checklist. If it picks up a `SPEC.md` without clear looping instructions, it hands off to the built-in `Build` mode. It manages its own trusted runner and supervisor.

**Hidden Subagents (Automatically Invoked):**
- **`karpathy`**: A hidden optimization subagent designed exclusively for a formal Karpathy loop. It is invoked automatically by `autonomous` when a clear deterministic pattern is detected in the plan.
- **`reviewer`**: A hidden advisory subagent that compares the implementation diff against the plan's rubric and reports gaps.
- **`grounder`**: A hidden read-only research subagent that gathers cited project and external evidence to reduce hallucination risk before planning or implementation.

Fixed immutability defaults restrict the files these identities (and their descendants) can mutate:

- `prometheus` may mutate the root `SPEC.md` and `.spike/**` only.
- `autonomous` and `karpathy` may mutate ordinary project files, but not trusted runner, supervisor, or evidence paths.
- `ask`, `reviewer`, and `grounder` are read-only.

A descendant inherits the managed identity and restrictions of its highest managed ancestor. Unresolved or unmanaged identities bypass the plugin rather than restricting native functionality.



## Optional Autonomous Profile

Long-running autonomous loops are prone to context loss, getting stuck in infinite loops, or hallucinating successful test results. To solve this, the Autonomous profile relies on two specialized components to enforce rigor:

1. **A Trusted Runner (`tools/run.ts`)**: Provides sandboxed, verifiable execution. By forcing all evaluation commands through this runner, the system guarantees that execution evidence is real and cannot be forged by the agent. It also enforces timeouts and bounds output.
2. **A Supervisor Plugin (`plugins/opencode-autonomous-supervisor/`)**: Maintains the durable state of the execution loop outside of the agent's context window. This ensures the loop can track progress, evaluate completion evidence, and recover from errors without losing its place.

These components are installed only through an explicit deployment option and activate only for top-level Autonomous sessions.

Native Plan and Build sessions never initialize supervisor state and never need
trusted runner evidence. `SPEC.md` provides the looping instructions and strategy; exact,
fresh verification evidence defines Autonomous completion. If a plan is simply a
linear set of tasks without a loop, Autonomous delegates to native Build to preserve
its specialized role. The supervisor owns durable run state, so agents are not asked to mutate protected progress files.

The trusted runner binds evidence to the active Autonomous run, enforces finite
timeouts and budgets, redacts likely credentials, bounds output, persists state
atomically, and uses Linux Bubblewrap for sandboxed commands. Unsupported runner
platforms do not reduce native Plan/Build functionality.

Reviewer output remains advisory. Free-form message text is not control-plane
input. A structured event may affect state only after a real producer and an
end-to-end test exist.

## Optional Karpathy Profile

Karpathy is a hidden optimization subagent designed to run a formal Karpathy loop. It is invoked automatically by Autonomous when a clear deterministic pattern and frozen evaluator are detected in `SPEC.md`. Instead of executing a linear feature plan, it drives iterative, metric-driven improvement against a measurable scalar objective.

It requires `program.md` (the open-ended optimization loop definition) and root `opencode-karpathy.json`. Karpathy directly mutates target files by pulling exactly one lever at a time, evaluates the resulting change against a strict noise floor, and keeps or reverts the change based on the performance delta. It pivots its strategy automatically when improvements stall. This profile is optional and does not govern normal Plan/Build work.

## Deployment

Default deployment uses copy mode, installs optional agent definitions and the
managed-agent immutability hook, and leaves native Plan/Build unchanged.

The Autonomous supervisor and runner require `--with-autonomous`. Non-core skills
require `--with-skills`. Deployment tracks managed entries, removes obsolete
managed links, and never installs this repository's `AGENTS.md` globally.

## Validation

Release validation must separately prove:

1. Native Plan/Build compatibility and unmanaged-agent bypass.
2. Managed-agent role defaults and descendant inheritance.
3. Optional Autonomous runner/supervisor behavior.
4. Optional evaluator behavior.
5. Deployment isolation and stale-entry cleanup.
6. Documentation consistency with this product goal.

Core validation must not require a six-agent workflow, a literal handoff footer,
or use of Prometheus/Autonomous for ordinary work.
