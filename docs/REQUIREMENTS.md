# Requirements

## Product Goal

This project is an optional extension to OpenCode. It adds specialist agents and
evidence-backed autonomous profiles for work that benefits from stronger
planning, durable state, bounded execution, or scalar-metric optimization.

It is not a replacement for OpenCode's built-in Plan and Build modes.

## Document Roles

`docs/REQUIREMENTS.md` and `docs/ARCHITECTURE.md` are the durable, canonical
description of this project. When system behavior and these documents disagree,
the divergence is a defect: either the change is wrong or these documents must
be updated in the same change.

Root `SPEC.md` is a transient implementation brief for the change currently in
flight. It may be rewritten or replaced at any time — by Prometheus in the
optional profile or by ordinary iteration — and it carries no durable
authority. Nothing in `SPEC.md` amends this document; durable decisions land
here.

## Native Compatibility Invariant

Built-in `plan` and `build` are outside this project's enforcement boundary.
Installation must not alter their prompts, routing, permissions, Bash access,
mutation tools, or completion behavior. They must continue to work without a
`SPEC.md`, a custom runner, a supervisor, an immutability policy, or any
specialist agent.

The project must not install repository-specific `AGENTS.md` instructions into
the global OpenCode configuration. Documentation and tests must not direct
ordinary planning to Prometheus or ordinary implementation to Autonomous.

Unknown, future built-in, and third-party agent identities are also outside the
managed-agent enforcement boundary.

## Managed Agents

The agents introduced by this project are `ask`, `prometheus`, `autonomous`,
`karpathy`, `reviewer`, and `grounder`. They are optional and selected
explicitly. Scope is enforced in two layers: each installed agent definition
sets tool availability and delegation allowlists, and the immutability hook
applies fixed mutation and execution defaults to these identities and their
descendants.

### Ask

Answers focused questions, preferring session context over repository
inspection. Read-only: no file mutation and no shell or trusted-runner
access. Escalates evidence gathering only as far as the question requires and
may delegate only to Grounder. Must not start planning or implementation
workflows and must not work around its boundary by dictating manual changes.

### Prometheus

Plans. Produces the canonical root `SPEC.md` and validates load-bearing
assumptions with measured spikes. Its mutation surface is exactly root
`SPEC.md` and `.spike/**`. Direct shell is denied; it may execute commands
only through the trusted runner in contracted spike context — a declared
spike id whose `.spike/<id>/QUESTION.md` states the question and kill
criterion. May delegate only to Grounder.

### Autonomous

Owns implementation. Executes a canonical `SPEC.md` and is the only managed
agent permitted to edit ordinary project files. Mutations must stay inside
the active worktree and must not touch trusted control-plane paths: the
runner and immutability-hook sources, the supervisor plugin, and the run,
supervisor, progress, and quarantine state under `.opencode/`. Direct shell
is denied by its definition; commands execute through the trusted runner. May
delegate to Grounder, Reviewer, and Karpathy.

### Karpathy

Read-only optimization strategist for tasks with a scalar metric and a frozen
evaluator. Proposes one bounded change at a time and never edits; Autonomous
applies changes. Invoked directly it has no shell or runner access. When
delegated by Autonomous, its measurements execute through the trusted runner
under the inherited Autonomous identity while its own definition continues to
deny mutation tools. May delegate to Reviewer and Grounder.

### Reviewer

Read-only advisory reviewer. Maps a change against a rubric and returns a
structured report ending in an APPROVE or REQUEST_CHANGES verdict. The
verdict is advisory and never changes deterministic completion eligibility.
No mutation, shell, runner, or delegation.

### Grounder

Read-only research agent that reduces hallucination risk by gathering cited
local and external evidence, including web fetches and read-only NotebookLM
queries. Surfaces facts and conflicts; makes no product decisions. No
mutation, shell, runner, or delegation.

### Identity Resolution

A delegated session inherits the identity of its topmost resolvable ancestor,
so work a managed agent delegates cannot escape the delegating agent's
boundary. Unresolved or unmanaged identity bypasses this plugin rather than
restricting native functionality.

## Optional Autonomous Profile

Long-running autonomous loops are prone to context loss, getting stuck in
infinite loops, or hallucinating successful test results. To solve this, the
Autonomous profile relies on two specialized components to enforce rigor:

1. **A Trusted Runner (`tools/run.ts`)**: Provides sandboxed, verifiable
   execution. By forcing all evaluation commands through this runner, the
   system guarantees that execution evidence is real and cannot be forged by
   the agent. It also enforces timeouts and bounds output.
2. **A Supervisor Plugin (`plugins/opencode-autonomous-supervisor/`)**:
   Maintains the durable state of the execution loop outside of the agent's
   context window. This ensures the loop can track progress, evaluate
   completion evidence, and recover from errors without losing its place.

These components are installed only through an explicit deployment option and
activate only for top-level Autonomous sessions.

Native Plan and Build sessions never initialize supervisor state and never need
trusted runner evidence. `SPEC.md` provides the looping instructions and
strategy; exact, fresh verification evidence defines Autonomous completion. If
a plan is simply a linear set of tasks without a loop, Autonomous delegates to
native Build to preserve its specialized role. The supervisor owns durable run
state, so agents are not asked to mutate protected progress files.

The trusted runner binds evidence to the active Autonomous run, enforces finite
timeouts and budgets, redacts likely credentials, bounds output, persists state
atomically, and uses Linux Bubblewrap for sandboxed commands. Unsupported runner
platforms do not reduce native Plan/Build functionality.

Reviewer output remains advisory. Free-form message text is not control-plane
input. A structured event may affect state only after a real producer and an
end-to-end test exist.

## Optional Karpathy Profile

Karpathy is a read-only optimization strategist for a formal Karpathy loop.
Instead of executing a linear feature plan, it drives iterative, metric-driven
improvement against a measurable scalar objective.

It requires `program.md` (the optimization loop definition), root
`opencode-karpathy.json`, and a frozen evaluator. Karpathy proposes exactly one
bounded change at a time, evaluated against a strict noise floor; Autonomous
owns edits and keeps or reverts each change based on the measured delta. It
pivots its strategy when improvements stall. This profile is optional and does
not govern normal Plan/Build work.

## Deployment

Default deployment uses copy mode, installs optional agent definitions and the
managed-agent immutability hook, and leaves native Plan/Build unchanged.

The Autonomous supervisor and runner require `--with-autonomous`. Non-core
skills require `--with-skills`. Deployment tracks managed entries, removes
obsolete managed links, and never installs this repository's `AGENTS.md`
globally.

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
