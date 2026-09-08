# Next Iteration: Generated Execution Agents

## Status

This document defines the current generated-execution-agent runtime. It replaces
the former fixed Autonomous workflow.

The runtime removes those three shipped agent definitions. It retains Prometheus
and the read-only Ask, Grounder, and Reviewer agents. It does not ship a fixed
Validator role.

## Prometheus Publication

Prometheus remains the explicit planning entry point. After it establishes
readiness, it publishes a task-specific execution agent in the target project
at `.opencode/agents/<task-name>.md`. The file is an OpenCode agent definition,
not an instruction fragment or an undocumented convention.

The generated definition must state:

- the requested outcome, implementation scope, and durable context files;
- the permissions it needs and the paths it may edit;
- the selected execution strategy and work-selection rule;
- exact verification commands, required evidence, and completion conditions;
- limits, stop conditions, and the route back to Prometheus for material
  ambiguity or a proven blocker.

Prometheus must also write the durable task brief that the generated agent
needs. A new agent session must be able to act from the worktree and published
files without access to the Prometheus transcript.

Prometheus creates a local agent only when the active request authorizes its
planning workflow. It must preserve unrelated local definitions. If the chosen
path already contains a user-owned or materially different definition,
Prometheus asks before replacing it. Generated agents use narrow permissions;
Prometheus does not grant broad access merely because a strategy could use it.

## Strategy Selection

Prometheus selects an execution design from the task's evidence rather than
handing every task to one fixed executor. The selected definition may use:

- a bounded direct implementation session for ordinary feature, defect, or
  technical-debt work;
- a Ralph-style loop for incremental work where each pass has independently
  measurable progress; or
- scalar optimization when a metric, direction, evaluator, mutable targets,
  noise policy, limits, and stop conditions are complete.

A Ralph-style loop must state its pass budget, state it reads, independent
before-and-after progress evidence, per-pass failure treatment, run-wide stop
conditions, and who starts later passes. A useful pass is not completion of the
requested outcome. The generated agent must not present loop progress as final
delivery without the declared final evidence.

Scalar optimization does not depend on a shipped Karpathy agent. Prometheus may
put proposal, measurement, and KEEP/REVERT rules directly in the generated
definition or publish a separate project-local read-only adviser when the task
benefits from one.

## Fresh-Context Handoff

After publication, Prometheus stops before implementation. Its handoff names
the generated agent and durable brief, tells the user to quit and restart
OpenCode so it loads the project-local definition, and tells the user to start
a new conversation rather than resume the planning session.

Restarting OpenCode loads agent definitions; it does not by itself clear a
resumed conversation's history. Starting a new session is the deliberate
fresh-context boundary. The generated agent reads published project evidence
instead of relying on in-memory planning context.

## Validation Outcomes

Prometheus defines the validation required for each task. The generated agent
may run deterministic checks itself, but command exit status and agent prose do
not alone prove delivery. The task brief must say what outcome, observation, or
artifact proves success; what evidence must be fresh; and what results mean
failed or incomplete work.

When the task needs independent judgment, Prometheus specifies a feasible
method, such as human review or a generated read-only project-local reviewer.
Reviewer remains advisory unless the task explicitly makes its report an
acceptance condition. No fixed Implementation Validator handoff is required.

## Required Runtime Work

The runtime recognizes a generated identity only when its name appears in
`.opencode/generated-agents.json` and its schema-v1 task manifest validates.
The immutability plugin applies the manifest's edit-path and Bash boundaries to
that identity and its descendants. Other project-local definitions remain
unmanaged. Published task packages are immutable to generated executors.

`validate_scaffold` rejects retired schema-v3 manifests and the former
`karpathy` strategy. It validates the registered schema-v1 package without
running project commands. The optional `scripts/task-loop.mjs` starts each Ralph
pass as a new session for the named generated agent; it records progress but
does not accept the final outcome.

This is a replacement contract. The project does not accept old and new manifest
or strategy formats as a compatibility layer.
