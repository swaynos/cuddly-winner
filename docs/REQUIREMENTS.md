# Project Requirements

This document is the stable requirements record for the cuddly-winner OpenCode
agent suite. It captures the behavior the project must preserve regardless of
the current contents of `SPEC.md`.

## Purpose

The project provides a multi-agent autonomous workflow for OpenCode that can
plan, execute, measure, review, and audit work while keeping one accountable
owner for completion claims.

The system must make autonomous work safer by forcing ambiguity into explicit
contracts:

- Planning is separated from implementation.
- Implementation is separated from final verification.
- Research and review are read-only unless a specific agent contract says
  otherwise.
- Loop strategies are bounded and auditable.
- Runtime behavior is validated with evidence, not inferred from intent.

## Durable Source Of Truth

`docs/` is the durable source of truth for project requirements and design.
`SPEC.md`, when present, is a volatile implementation brief for the current
iteration. The repository must remain understandable and rebuildable when
`SPEC.md` is absent.

Agents and maintainers must update `docs/` when changing any stable behavior,
including:

- agent roles, permissions, or routing;
- subagent delegation semantics;
- strategy admission, registry, or execution rules;
- plugin enforcement or persisted state;
- validation commands, expected failures, or audit criteria;
- deployment, install, or restart behavior;
- project invariants or operating principles.

If a change is implemented but the durable docs still describe the old system,
the change is incomplete.

## Core Invariants

### One Accountable Owner

Every workflow must have one agent that owns contract completion. For
SPEC-driven implementation, that owner is `@autonomous`.

Subagents may provide evidence, analysis, perception, implementation, or review,
but they do not own final completion unless their own contract explicitly makes
them the owner of a bounded sub-loop.

### Prometheus Plans, Autonomous Executes

`@prometheus` is the read-only front door for planning. It interviews, gathers
evidence, compares approaches, and returns payloads. It does not write project
files.

`@autonomous` materializes a visible Prometheus `<spec filename="SPEC.md">` payload
verbatim before executing it. If the current session contains an immediately
preceding visible Prometheus payload, using a stale on-disk `SPEC.md` instead is
invalid.

When runtime context switching prevents `@autonomous` from seeing the preceding
Prometheus response, the autonomous gate must recover the handoff by re-injecting
the latest observed Prometheus payload. Autonomous then treats that corrective as
the authoritative handoff and materializes it before execution.

### Karpathy First

The default strategy preference is to force nondeterminism into a deterministic
check. If a task has, or can be given, a scalar metric and a stable frozen
evaluator, the Karpathy loop is mandatory.

An exotic strategy is only valid after the instrument-first step fails. Selecting
an exotic strategy means the task resisted a deterministic check, and the reason
must be recorded in `progress.txt`.

### Direct Strategy Is Allowed For Bounded Implementation

Ordinary one-shot implementation work with clear acceptance criteria and normal
verification should use `strategy: direct`, not pretend to be a Karpathy loop.

`Selected: karpathy` is a commitment to actually invoke `@karpathy` and produce
Karpathy artifacts or equivalent child-session evidence. A Karpathy label without
Karpathy execution is invalid.

### Bounded Strategies Only

Loop strategies must have finite stop criteria. Open-ended strategies, forever
loops, and methods that redefine success instead of stopping are forbidden.

### Reviewer Gate

Before `@autonomous` claims completion, it must call `@reviewer` with the spec,
change summary, and verification evidence. If `@reviewer` returns
`REQUEST_CHANGES`, `@autonomous` continues. Completion requires reviewer approval
unless the gate plugin is explicitly configured otherwise.

### Evidence Before Completion

Completion claims require fresh evidence. At minimum, `@autonomous` must provide
a strict fenced JSON evidence block with the verification command, exit code, and
excerpt expected by the autonomous gate plugin.

### Test Rigor (Mutation Gate)

An agent that both writes the code and authors the tests that verify it can write
weak or tautological tests to force `exit_code 0` without proving correct behavior.
This "self-graded paper" failure is not caught by the adversarial review pipeline,
which evaluates source-code defects rather than test quality.

When a project opts in by providing `.opencode/mutation.json` with `enabled: true`,
`@autonomous` must also satisfy a mutation-rigor precondition before `COMPLETE` is
accepted:

- Tests must be authored in a red-first (TDD) phase before implementation.
- Tests must be reviewed before being frozen.
- Once frozen (via `.opencode/immutable.json` readonly), tests may not be weakened
  by the implementer.
- The mutation runner must be executed diff-scoped on changed files, produce a
  committed result artifact, and the kill score must meet the configured threshold.
- The mutation config itself must be frozen as a readonly immutable judge so the
  implementer cannot lower the threshold or exclude files to game the score.
- The gate reads the committed artifact; a transcript claim does not suffice.

### Progress Is Durable

`@autonomous` must maintain `progress.txt` during execution. Strategy selection
must be recorded before the first edit. Pivots, blockers, attempted strategies,
and stuck states must be recorded as they happen.

### Runtime Evidence Beats Design Intent

Configuration proves capability. Logs, OpenCode database rows, child sessions,
tool calls, and runtime artifacts prove execution. If design documents and
runtime evidence disagree, runtime evidence is authoritative for audits.

## Required Components

### Agents

The core agent suite must include:

- `@ask` for quick contextual answers.
- `@prometheus` for read-only planning and spec payload generation.
- `@autonomous` for materializing specs, executing work, selecting strategies,
  maintaining progress, invoking reviewer, and owning completion.
- `@karpathy` as the reference deterministic metric loop strategy.
- `@ralph-wiggum` as a bounded brute-force fallback strategy for tasks that
  resist instrumentation.
- `@octopus` as a coordinator-class strategy brain.
- `@octopus-arm` as a read-only perception arm dispatched by `@octopus`.
- `@data-scientist` as NotebookLM-grounded research when valid notebook context
  exists.
- `@grounder` as the read-only grounding fallback.
- `@reviewer` as a strict read-only critic returning `APPROVE` or
  `REQUEST_CHANGES`.

`@builder` is a hidden worker subagent callable by `@autonomous` for
component-scoped implementation units. It is not a strategy and must not be
listed in `.opencode/strategies.json`.

`@builder` may edit and write within its scoped brief, run local checks, and
report evidence. It must not update `progress.txt`, call `@reviewer`, delegate to
other subagents, select strategies, emit promise tokens, or claim overall
completion.

### Skills

Core skills under `.opencode/skills/` are reusable process handbooks. They must
remain distinct from agents: agents are team members; skills are loaded methods.

Required skills include project-agent scaffolding, verification before
completion, systematic debugging, test-driven development, subagent-driven
development, writing skills, and Playwright image generation.

### Plugins

The project must provide plugins for:

- file immutability and identity-sensitive write restrictions;
- autonomous promise-gate enforcement;
- autonomous loop state persistence and runtime tracking.

Plugins must enforce or observe behavior without pretending to be the agent.
Where plugins cannot prevent an action, they must provide corrective pressure and
durable evidence.

### Strategy Registry

`.opencode/strategies.json` is the declarative registry for loop strategies. It
must include `karpathy` and `ralph-wiggum`, and may include other active,
reference, or planned strategies. Planned strategies are documentation slots and
do not require agent files yet.

Worker subagents, research subagents, reviewers, and perception arms are not
strategy entries unless they independently satisfy the strategy contract.

### Validation

The validator must prove that the project is configured as intended. It must
check required files, agent modes, permissions, strategy registry conformance,
key contract markers, plugin load behavior, and optional end-to-end plugin
execution when model credentials are available.

The project must also provide a deterministic agent-value benchmark under
`evals/agent_value/`. The benchmark must compare baseline OpenCode-style behavior
with the enhanced project workflow on frozen adversarial tasks. It must run in a
local no-LLM mock/replay mode by default, emit `agent_value_score`, enforce golden
expectations, and fail when the enhanced workflow has hard safety failures.

The benchmark must validate Prometheus as a read-only diverge-converge planner,
not as an ant-style traversal agent. Prometheus benchmark cases must penalize
single-approach planning theater, fake alternatives for trivial requests,
mutation attempts, invalid payload shape, invalid strategy directives, and
ant-sprawl attempts.

Runtime audits must separately prove that real OpenCode sessions executed the
architecture as designed.

## Non-Requirements

- The project does not require all work to use a strategy subagent. Direct
  execution is valid for bounded, testable implementation work.
- The project does not require Prometheus to write files. Prometheus returns
  payloads; Autonomous materializes them.
- The project does not require every subagent to be a strategy.
- The project does not require `SPEC.md` to be stable across iterations.
- The project does not auto-commit changes. Git commits require explicit user
  instruction.

## Rebuild Bar

The docs are sufficient only if a maintainer can rebuild these from the docs
alone:

- the agent roster and permission posture;
- the Prometheus-to-Autonomous handoff;
- the Karpathy-first strategy selection model;
- strategy registry and strategy-subagent contract;
- reviewer and evidence gates;
- autonomous loop persistence model;
- plugin responsibilities and limitations;
- validation and runtime audit commands;
- documentation maintenance obligations.
