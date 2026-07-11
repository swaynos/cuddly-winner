# Requirements

## Product Goal

This project is an optional extension to OpenCode. It adds specialist agents and
evidence-backed autonomous profiles for work that benefits from stronger
planning, durable state, bounded execution, or scalar-metric optimization.

It is not a replacement for OpenCode's built-in Plan and Build modes.

## Native Compatibility Invariant

Built-in `plan` and `build` are outside this project's enforcement boundary.
Installation must not alter their prompts, routing, permissions, Bash access,
mutation tools, or completion behavior. They must work without a `SPEC.md`, a
custom runner, a supervisor, an immutability policy, or any specialist agent.

The project must not install repository-specific `AGENTS.md` instructions into
the global OpenCode configuration. Documentation and tests must not direct
ordinary planning to Prometheus or ordinary implementation to Autonomous.

Unknown, future built-in, and third-party agent identities are also outside the
managed-agent enforcement boundary.

## Managed Agents

The agents introduced by this project are `ask`, `prometheus`, `autonomous`,
`karpathy`, `reviewer`, and `grounder`. They are optional and selected explicitly.

Fixed immutability defaults apply only to these identities and their descendants:

- Prometheus may mutate root `SPEC.md` and `.spike/**` only.
- Autonomous may mutate ordinary project files but not trusted runner,
  supervisor, or evidence paths.
- Ask, Karpathy, Reviewer, and Grounder are read-only.
- A descendant inherits the managed identity of its highest managed ancestor.

Unresolved or unmanaged identity bypasses this plugin rather than restricting
native functionality.

## Reserved Project Policy

Root `opencode-immutable.json` reserves a future project-override format. It is
not currently loaded or enforced. Its presence, absence, or contents must have
no runtime effect, and users must not be told that it currently protects files.

The placeholder documents intended explicit readonly paths and per-agent
refinements. Future project overrides may narrow managed-agent permissions. They
must not affect native Plan or Build without a deliberate revision of this
compatibility contract.

## Optional Autonomous Profile

The Autonomous profile consists of `tools/run.ts` and
`plugins/opencode-autonomous-supervisor/`. It is installed only through an
explicit deployment option and activates only for top-level Autonomous sessions.

Native Plan and Build sessions never initialize supervisor state and never need
trusted runner evidence. Checklist boxes in `SPEC.md` are planning aids; exact,
fresh verification evidence defines Autonomous completion. The supervisor owns
durable run state, so agents are not asked to mutate protected progress files.

The trusted runner binds evidence to the active Autonomous run, enforces finite
timeouts and budgets, redacts likely credentials, bounds output, persists state
atomically, and uses Linux Bubblewrap for sandboxed commands. Unsupported runner
platforms do not reduce native Plan/Build functionality.

Reviewer output remains advisory. Free-form message text is not control-plane
input. A structured event may affect state only after a real producer and an
end-to-end test exist.

## Optional Karpathy Profile

Karpathy is a read-only optimization strategist. It requires `program.md`, root
`opencode-karpathy.json`, and a frozen evaluator. It proposes one change at a
time; Autonomous owns edits. This profile is optional and does not govern normal
Plan/Build work.

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
