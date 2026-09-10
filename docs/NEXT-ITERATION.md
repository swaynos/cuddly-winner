# Generated Execution Agent Workflow

## Status

This document defines the current publication and handoff workflow. The managed
profile ships `ask`, `grounder`, `prometheus`, and `reviewer`, then recognizes
task-specific project-local agents through the generated-agent registry.

The exact registry and manifest field contract is defined once in
[`docs/ARCHITECTURE.md` under Canonical Task Package Schema](ARCHITECTURE.md#canonical-task-package-schema).
This document does not define a second schema. Rejection and version policy lives
in [`docs/REQUIREMENTS.md`](REQUIREMENTS.md#rejected-contracts).

## Prometheus Publication

Prometheus is the explicit planning entry point. After it establishes planning
readiness, it publishes one package for lowercase hyphenated task id `<id>`:

```text
.opencode/agents/<id>.md
.opencode/tasks/<id>.md
.opencode/tasks/<id>.json
.opencode/generated-agents.json
```

The generated definition is a primary OpenCode agent. It must read the matching
manifest and brief before work. Its frontmatter permissions must not exceed the
manifest's exact edit paths and Bash capability.

The durable brief states:

- the requested outcome and acceptance criteria;
- implementation scope and durable context files;
- the strategy procedure and work-selection rule;
- exact final checks, success evidence, freshness, and failure conditions;
- limits, stop conditions, and the route back to Prometheus.

A new generated-agent session must be able to act from the worktree and package
without access to the planning transcript.

Prometheus preserves unrelated local definitions and registry entries. Before
writing, it inspects `.opencode/agents/` and `.opencode/tasks/`. If the chosen
agent path contains a user-owned or materially different definition, Prometheus
asks before replacing it.

When installed, `scaffold_gitignore` manages the generated-artifact exclusion
block and `validate_scaffold` performs registry-wide structural validation plus
full schema-v1 validation of the named package. Prometheus passes the selected
task id as the optional `agent_name`; the argument may be omitted only for a
one-entry registry. The shipped Prometheus prompt carries the exact schema, so an
installed copy does not need this repository's docs. Static validation does not
run final checks or establish that the requested outcome is feasible.

## Strategy Selection

Prometheus selects one of three strategies from task evidence.

### Direct

Use `direct` by default for ordinary features, defects, and technical debt. The
work-selection rule identifies the next bounded in-scope item. One generated
session may complete the task when scope and verification fit that session.

### Ralph

Use `ralph` only when each pass can show independent progress. The package must
name the pass budget, durable state paths, before-and-after progress evidence,
per-pass failure treatment, run-wide stop conditions, and who starts later
passes.

A useful pass is not completion. The generated agent reports final delivery only
after the whole requested outcome and all final evidence are complete.

### Optimization

Use `optimization` only when the package can state a scalar objective, direction,
evaluator, supported score extraction rule, noise policy, mutable and immutable
targets, experiment budget, keep-or-revert rule, and stop conditions.

The generated agent changes one bounded lever per experiment, runs the declared
measurement, and records the hypothesis, score, and keep-or-revert decision. It
does not mutate the evaluator or another immutable target.

The checked-in `examples/ml-loop` package keeps score ownership outside editable
training code. The evaluator derives each score from the candidate artifact and
separate held-out data, immutable hashes are verified, and the regression check
proves that a forged score log is ignored.

## Fresh-Context Handoff

After publication, Prometheus stops before implementation. Its final response
names the generated agent, durable brief, and manifest and tells the user to:

1. Quit OpenCode.
2. Restart OpenCode in the target project.
3. Start a new conversation.
4. Select the named generated agent.

Restarting loads the project-local definition. Starting a new conversation
creates the fresh-context boundary. Resuming the planning conversation does not
satisfy this requirement.

## Generated Execution

The generated agent implements only the published task. The immutability plugin
allows only exact manifest-listed edit paths and applies the manifest's Bash
boolean to the agent and its descendants. Published package files and trusted
control-plane sources remain immutable to it.

The agent applies the brief's work-selection rule after each bounded change or
focused check. It continues while useful in-scope work remains. A focused,
fixture, synthetic, phase-local, or batch check is only an intermediate gate
when required work remains.

The agent stops successfully only after every requested outcome and acceptance
criterion is complete and all declared final evidence is fresh. It reports an
incomplete or blocked result when a declared escalation trigger, failed core
prerequisite, exhausted safe path, or required scope expansion prevents that
state.

## Validation Outcomes

The brief must say what observation or artifact proves success, how fresh the
evidence must be, and what makes the work failed or incomplete. Command exit
status and agent prose do not alone prove delivery.

Independent review is optional and task-specific. Prometheus may name human
review, the shipped advisory Reviewer, or a generated project-local read-only
reviewer. Reviewer remains advisory unless the brief explicitly makes its report
an acceptance condition.

## Optional Run KPIs

A schema-v1 package may omit `run_kpis` or set `enabled: false`. An enabled policy
requires explicit positive duration, target token-rate, and hard-token-budget
values under the canonical schema.

The KPI plugin observes the generated root session and descendants, uses
completed-message active time to calculate and report token rate, and caps a new
response to remaining hard-budget tokens. These values never override
completion, verification, scope, permissions, safety, or strategy stops. The
agent must not create no-op work or delay valid completion to improve a KPI.

## Optional Generated Task Loop

`scripts/task-loop.mjs` is an external developer script, not a deployed managed
component. For each configured pass, it starts a fresh
`opencode run --agent <id> --dir <project>` session with no message. The
published package remains the sole task input.

An optional project command supplies JSON counters before and after each pass.
The wrapper records per-key deltas and one append-only JSONL record per pass. It
may stop on pass budget, a measured idle streak, or a non-zero exit when
configured to do so. It checks a wall budget after a pass completes and before
starting the next pass. It does not predict a future pass's duration or prevent
the completed pass from crossing the limit.

The loop does not provide cross-session memory. Continuity comes from the target
worktree and durable project state. Its log is evidence, not protected run state
or acceptance of the final result.

## Runtime Recognition

The runtime recognizes a generated identity only when
`.opencode/generated-agents.json` passes registry-wide schema-v1 structural
validation and that identity's named package passes full schema-v1 validation.
Malformed entries, duplicate names, and names reserved for native or shipped
agents prevent recognition and KPI activation from the registry. An incomplete
named package prevents activation for that identity; unselected package files
are not loaded. Other project-local definitions remain unmanaged.

The immutability plugin caches a generated policy by agent name. Publication
therefore requires the restart and new-session handoff rather than continued
execution in the planning session.
