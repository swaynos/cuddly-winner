# Agent Architecture

This document is the canonical taxonomy and ethos for agents and subagents in
the project.

## Core Ethos

The agent suite is built around accountable delegation. Delegation is useful only
when authority boundaries are clear.

The project follows these principles:

- One agent owns completion for a workflow.
- Planning, implementation, research, review, and strategy loops are separate
  roles.
- Subagents provide bounded work products, not vague progress claims.
- Workers may provide evidence; orchestrators decide whether evidence satisfies
  the contract.
- Strategies are bounded and selected only when their admission criteria apply.
- Runtime evidence is required to prove that a subagent actually ran.

## Agent Classes

### Primary Agents

Primary agents are user-facing modes. Users can select them directly.

Primary agents in this project:

- `@ask`
- `@prometheus`
- `@autonomous` because it has `mode: all`

Primary agents must be clear about when they should route work elsewhere.

### Ordinary Subagents

Ordinary subagents are hidden helpers invoked by another agent through the task
tool. They are not selected directly by users during normal workflows.

Examples:

- `@data-scientist`
- `@grounder`
- `@reviewer`

Ordinary subagents usually return analysis, evidence, or review output. They do
not own final workflow completion.

### Strategy Subagents

Strategy subagents implement bounded loop strategies selected by `@autonomous`.
They must conform to `STRATEGY-CONTRACT.md` and be listed in
`.opencode/strategies.json` when active or reference status.

Examples:

- `@karpathy`

Strategy subagents are not generic helpers. They are selected because their loop
shape fits the task.

### Worker Subagents

Worker subagents perform bounded implementation units inside another agent's
ownership. `@builder` is the core worker subagent.

A worker subagent is not a strategy, reviewer, researcher, or independent owner.
It receives a scoped brief, implements the local unit, reports changes and local
evidence, and returns control to the orchestrator.

## Current Roster

| Agent | Class | Responsibility |
|---|---|---|
| `@ask` | primary | Answer quick contextual questions without planning or implementation ceremony. |
| `@prometheus` | primary | Plan read-only, compare approaches, and return complete payloads for execution. |
| `@autonomous` | primary/subagent | Execute specs, own strategy selection, maintain progress, verify, review, and completion. |
| `@karpathy` | strategy subagent | Run deterministic metric loops when scalar metric and frozen evaluator exist. |
| `@data-scientist` | ordinary subagent | Query NotebookLM-backed project knowledge when valid context exists. |
| `@grounder` | ordinary subagent | Gather cited local or external evidence when NotebookLM is absent or unsuitable. |
| `@reviewer` | ordinary subagent | Review against caller-provided rubric and return `APPROVE` or `REQUEST_CHANGES`. |
| `@builder` | worker subagent | Implement scoped local units for `@autonomous`; never own completion. |

## Authority Boundaries

### `@prometheus`

`@prometheus` owns planning quality. It must be read-only. It may ask questions,
inspect evidence, call research subagents, compare approaches, and produce
payloads. It does not write files or claim implementation completion.

### `@autonomous`

`@autonomous` owns SPEC execution. It materializes Prometheus payloads, records
strategy selection, performs or delegates implementation, verifies, calls
reviewer, and emits completion or stuck status.

`@autonomous` must not outsource final completion authority.

### Research Subagents

`@data-scientist` and `@grounder` provide evidence and recommendations. They do
not build, review final diffs, or decide completion.

### `@reviewer`

`@reviewer` is a critic. It evaluates against the rubric provided by the caller.
It does not edit files. `APPROVE` is required for autonomous completion unless
the gate plugin is explicitly configured otherwise.

### Strategy Subagents

Strategy subagents own bounded strategy execution while active, but they do not
erase `@autonomous` as the overall workflow owner. `@karpathy` delegates
implementation to `@builder`; its contract defines this explicitly.

### `@builder`

`@builder` is a worker for `@autonomous`. It receives briefs that define
ownership boundaries, not line-by-line patches.

Good `@builder` boundary:

```text
Implement validation support for @builder in tests/verify_opencode.py.
Expected behavior: builder is expected, mode is subagent, builder cannot delegate,
and autonomous can call builder. Run python3 tests/verify_opencode.py --skip-llm.
Touch tests/verify_opencode.py unless the change requires re-scoping.
```

Bad over-specific boundary:

```text
Insert these exact seven lines after line 43.
```

Bad too-broad boundary:

```text
Implement the entire builder feature across the repo.
```

The sweet spot is component-scoped delegation: enough scope for local judgment,
not enough scope to reinterpret the whole project.

## Built-In Build Mode Vs Repo `@builder`

OpenCode's built-in Build mode is an independent primary implementation agent.
It receives the user's task, general Build instructions, and whatever repo
context it chooses to gather. It is useful for ordinary projects, but it is not
repo-owned and does not automatically carry this project's accountability model.

OpenCode documentation defines Build and Plan as built-in primary agents, not as
an extra execution phase layered over all agents. Custom agents such as
`@autonomous` are also agents. Switching to a custom primary agent changes the
prompt/persona and effective permission set for that agent; it does not mean the
built-in Build agent is active.

Repo `@builder` is a hidden worker subagent inside `@autonomous` ownership. It
receives a curated brief from `@autonomous` after `@autonomous` has interpreted
the spec. Its context is narrower and its authority is lower.

The distinction is not raw capability. The distinction is context selection and
completion authority:

- Built-in Build interprets and implements.
- `@builder` implements a scoped unit selected by `@autonomous`.
- Built-in Build can become the de facto owner of the task.
- `@builder` never owns completion, promises, progress, or reviewer approval.

## Delegation Context Rules

Delegation briefs should include:

- objective;
- expected or allowed file set;
- relevant constraints;
- verification command or signal;
- stop condition and escalation rule;
- expected return format.

The file set is a boundary for safety and parallelism, not a demand for
line-level obedience. If the worker discovers the change requires files outside
the boundary, it should report the need and return control for re-scoping.

Parallel worker delegation is allowed only when file sets are declared up front
and disjoint.

## Verification Ownership

Workers and strategies may provide evidence. `@autonomous` decides whether the
evidence satisfies the project contract.

The required sequence for worker delegation is:

1. `@autonomous` interprets the spec.
2. `@autonomous` scopes the unit and verification signal.
3. Worker implements and reports local evidence.
4. `@autonomous` inspects the diff.
5. `@autonomous` runs final verification.
6. `@autonomous` updates progress and checklist state.
7. `@autonomous` calls reviewer when the whole change is ready.
8. `@autonomous` emits completion only when the full contract is satisfied.

## Adding Or Changing Agents

When adding or changing an agent:

- update the agent file under `agents/`;
- update `README.md` if the visible roster or common workflow changes;
- update this document if taxonomy, authority, or ethos changes;
- update `WORKFLOWS.md` if user or inter-agent flow changes;
- update `REQUIREMENTS.md` if a stable invariant changes;
- update `STRATEGY-CONTRACT.md` and `.opencode/strategies.json` only for loop
  strategies;
- update `tests/verify_opencode.py` for expected files, modes, permissions, and
  static markers;
- restart OpenCode after deployment.
