# Project Requirements

This document is the stable requirements record for the cuddly-winner OpenCode
agent suite. It describes the behavior the project must preserve regardless of
the current contents of `SPEC.md`.

## Implementation Status

Some invariants below are **in-flight** — designed but not yet fully
implemented. This table marks each one. Delete the table when all are complete.

| Invariant | Status |
|---|---|
| Prometheus spike sandbox at `<project-root>/.spike/` | in-flight |
| Prometheus writes `SPEC.md` directly (no payload grammar) | in-flight |
| Deterministic gate: disk-only check against `## Verification` commands | in-flight |
| Transcript evidence blocks and workaround-dump detection removed from gate | in-flight |
| Reviewer advisory only (not gating) | in-flight |
| Gate and loop plugins merged into single supervisor | in-flight |
| Supervisor enforces corrective caps and durable state | in-flight |
| `@builder` and `@data-scientist` removed | in-flight |
| Runner tool installed by deploy script | in-flight |

## Purpose

The project provides two autonomous agents — a planner (`@prometheus`) and an
executor (`@autonomous`) — for OpenCode. They exist to make long-running
agentic loops viable where stock Plan/Build falls short, by solving exactly
four failure modes:

1. **Completion lying** — the agent claims done when it isn't.
2. **Restart fragility** — progress and verdicts lost when a session dies.
3. **Unbounded spend** — loops with no iteration or spend ceiling.
4. **Plan drift** — execution diverging from what was planned and validated.

Every component in this project must justify itself against one of these four.
Components that address none of them are candidates for deletion.

## Durable Source Of Truth

`docs/` is the durable source of truth. `SPEC.md`, when present, is a volatile
implementation brief for the current iteration and may be absent between
iterations.

Agents and maintainers must update `docs/` when changing any stable behavior,
including: agent roles, permissions, or routing; subagent delegation semantics;
spike protocol; plugin enforcement or persisted state; validation commands;
deployment or runner installation behavior; or project invariants.

**A change implemented without updating the durable docs is incomplete.**

## Trusted Computing Base

Enforcement lives only in deterministic machinery the agents cannot author or
subvert:

- **Runner tool** (`.opencode/tool/run.ts`) — sole writer of evidence artifacts
  in `.opencode/runs/`. Agents request command execution through it; it records
  structured result files. The gate reads these files, not agent-authored text.

- **Immutability hook** (`plugins/immutability.ts`) — path-scoped write
  enforcement at the plugin hook layer. Fires even when an agent has
  `edit: allow`. Used to confine Prometheus to its permitted write surface
  (`SPEC.md` and `.spike/**`) and to protect frozen evaluator files.

- **Supervisor plugin** (`plugins/opencode-autonomous-supervisor/`) — stateless
  completion gate (a pure function of disk state), corrective injection with
  hard caps, and durable run state persistence. Merged from the former gate and
  loop plugins.

Prompt text is guidance, never enforcement. Any invariant described here that
isn't traceable to one of these three components is aspirational, not enforced.

## Core Invariants

### Prometheus Is a Spiking SDE

`@prometheus` plans by diverge-converge and validates front-runners empirically
via spikes, not by reasoning alone. It is the engineering counterpart to an SDE
running a spike before committing to an approach: it can run code, measure
outcomes, and kill candidate approaches on evidence rather than argument.

**Permitted write surface:** exactly `SPEC.md` and `.spike/**` at the project
root. Enforced by the immutability hook — Prometheus cannot touch any project
source file, test, or config outside these paths.

**Spike protocol:**
1. Before running any command in spike context, Prometheus creates
   `.spike/<spike-id>/QUESTION.md` containing a falsifiable question and its
   kill-criterion. The runner tool refuses to execute in spike context until
   this file exists.
2. The spike ends when the question is answered — evidence confirms or refutes
   the hypothesis. There is no command-count limit; the kill-criterion is the
   stop condition.
3. Spike findings are recorded in `SPEC.md`'s `## Grounding` and
   `## Approaches Considered` sections, citing the spike-id and measured result.
   Kill-reasons backed by measurements are preferred over kill-reasons backed
   by argument alone.
4. **Spike code is never deliverable.** The SPEC checklist re-implements the
   spike's finding properly. `@autonomous` builds from the spec, not from
   `.spike/`.
5. `.spike/` is gitignored per project. Prometheus confirms the gitignore entry
   exists before the first spike write in any project.

**What Prometheus produces:** a complete, written `SPEC.md` containing
evidence-backed approaches considered, acceptance criteria, verification
commands, and an implementation checklist. It ends with exactly one handoff
sentence: `Invoke @autonomous to execute SPEC.md.`

There is no `<spec filename="SPEC.md">` payload grammar, no gate-side payload
re-injection, and no `@autonomous` materialization step. Prometheus writes the
file; `@autonomous` reads it.

### Autonomous Owns Execution and Completion

`@autonomous` is the only agent that reads `SPEC.md` from disk and executes its
`## Implementation Checklist`. It owns `progress.txt`, selects and invokes loop
strategies, runs verification commands through the runner tool, invokes the
reviewer (advisory), and emits promise tokens.

`@autonomous` does not materialize payloads. It reads the file Prometheus wrote.

### One Accountable Completion Owner

Every workflow has one agent that owns contract completion. For SPEC-driven
work, that owner is `@autonomous`. For Karpathy loops, `@autonomous` owns
completion and delegates the loop to `@karpathy`. Subagents may provide
analysis, implementation, or review, but they do not own final completion.

### Deterministic Completion Gate

A run is complete when every command in `SPEC.md`'s `## Verification` block has
a **fresh, passing runner artifact** in `.opencode/runs/`:

- *Passing* means `exit_code: 0` for the exact command string declared in the
  spec. Running a different command that also exits 0 does not satisfy the gate.
- *Fresh* means the artifact's `started_at` timestamp is newer than the last
  modification to any tracked file. A green artifact from before the last code
  change is stale and does not satisfy the gate.

The gate reads disk state only. Transcript claims — fenced JSON evidence blocks,
promise token wording, reviewer verdict text — do not gate completion.

The gate enforcement has a hard cap on correctives: after N failed checks for
the same failure class (default 3), the supervisor marks the run `blocked` and
stops injecting corrective messages. The session then goes quiet until the user
inspects state.

### Evidence Segregation

Spike artifacts and execution artifacts never mix:

- Spike-context runner executions write to `.spike/<spike-id>/runs/`.
- Execution-context runner executions write to `.opencode/runs/`.

The completion gate reads only `.opencode/runs/`. Prometheus cannot satisfy
the execution completion gate by running commands in spike context, even if
those commands happen to match the SPEC's `## Verification` commands.

### Bounded and Durable Runs

The supervisor plugin enforces:

- A global cap on corrective injections per failure class per run (default 3).
  On breach: run marked `blocked` in `status.json`, corrective injection stops,
  session goes quiet. The user must inspect and decide.
- All run state persisted to `.opencode/autonomous-loop/` so OpenCode restarts
  do not lose progress, corrective counts, or failure state.
- No in-memory-only verdicts. Session restarts do not reset state the agent
  already satisfied.

An autonomous loop without a spend ceiling is a liability. The corrective cap
is not advisory.

### Karpathy Loop

When `SPEC.md` declares `strategy: karpathy` and the required harness exists
(`program.md`, `.opencode/karpathy.json`, a frozen evaluator), `@autonomous`
delegates the optimization loop to `@karpathy`. The loop:

- Establishes a baseline measurement.
- Measures the noise floor (>=3 runs with varied seeds or conditions).
- Proposes exactly one change per iteration with a stated hypothesis.
- Keeps the change if improvement > 2x noise floor; reverts otherwise.
- Invokes `@reviewer` after each run (advisory).
- Stops when `program.md`'s stop criteria are met, or after 3 distinct strategy
  pivots have each failed to produce a KEEP decision.

The Karpathy gate check reads disk artifacts (runner artifacts in
`.opencode/runs/`), not transcript claims about scores or measurements.

`strategy: karpathy` is a commitment to actually invoke `@karpathy` and produce
harness artifacts. A Karpathy label without Karpathy execution is invalid.

Direct execution (no strategy subagent) is valid for bounded, one-shot
implementation work with clear acceptance criteria. A test suite is required
verification for `@autonomous`; it is not by itself a Karpathy harness.

### Reviewer Is Advisory

`@autonomous` and `@karpathy` invoke `@reviewer` before claiming completion.
`APPROVE` is logged and informational. `REQUEST_CHANGES` triggers one bounded
iteration (subject to the supervisor's corrective cap). The completion gate does
not require a reviewer verdict — the deterministic artifact check is the only
gate.

### Test Rigor (Mutation Gate, Opt-In)

When a project provides `.opencode/mutation.json` with `enabled: true`,
`@autonomous` must satisfy an additional precondition before `COMPLETE`:

- Tests authored in a red-first phase before implementation.
- Tests reviewed and then frozen via `.opencode/immutable.json` readonly.
- Frozen tests may not be weakened by the implementer.
- Mutation runner executed diff-scoped, producing a committed result artifact
  at `result_path`.
- Kill score must meet `score_threshold`.
- The mutation config itself is frozen so the implementer cannot game it.
- The gate reads the committed artifact; a transcript claim does not suffice.

### Progress Is Durable

`@autonomous` maintains `progress.txt` during execution. Strategy selection is
recorded before the first edit. Pivots, blockers, attempted strategies, and
stuck states are recorded as they happen, not summarized afterward.

### Docs-Current Rule

If behavior changed and the durable docs still describe the old system, the
change is incomplete. Agents must update `docs/` in the same change where they
alter behavior.

### No Auto-Commit

Git commits require explicit user instruction.

## Required Components

### Agents

Six agents:

- **`@prometheus`** — spiking SDE planner. Runs spikes in `.spike/<id>/`,
  writes `SPEC.md` directly, hands off to `@autonomous`. Write surface is
  `SPEC.md` and `.spike/**` — immutability hook enforced.
- **`@autonomous`** — execution owner. Reads and executes `SPEC.md`, maintains
  `progress.txt`, selects strategies, invokes reviewer, emits promise tokens.
- **`@karpathy`** — metric-loop strategy subagent. Invoked by `@autonomous`
  when the spec declares `strategy: karpathy` and the harness exists.
- **`@reviewer`** — advisory critic. Returns `APPROVE` or `REQUEST_CHANGES`.
  Never gates completion.
- **`@grounder`** — research subagent. Gathers cited local and external
  evidence. Handles NotebookLM when valid context exists. Never edits project
  files.
- **`@ask`** — convenience agent for quick contextual questions outside the
  plan-execute loop.

### Plugins

- **`plugins/immutability.ts`** — enforces per-project file rules and per-agent
  write scoping. A no-op without `.opencode/immutable.json`.
- **`plugins/opencode-autonomous-supervisor/`** — stateless completion gate
  (deterministic disk check), corrective injection with hard caps, and durable
  run state persistence.

### Runner Tool

`.opencode/tool/run.ts` is required for `@autonomous` to produce evidence
satisfying the completion gate. The deploy script installs it into target
projects by default. `@autonomous` hard-requires it — it emits
`<promise>BLOCKED</promise>` if it is absent.

### Validation

The test suite must verify:
- Required agent files with expected frontmatter and key body markers.
- `@prometheus` write surface is `SPEC.md` and `.spike/**` only (hook enforced).
- Completion gate correctly passes/fails based on runner artifact presence,
  exit code, and freshness.
- Spike runner refuses to execute without `QUESTION.md` present.
- Spike artifacts do not appear in `.opencode/runs/`.
- Supervisor plugin loads, corrective caps work, run state persists across
  simulated restarts.
- `@reviewer` and `@grounder` have `edit: deny`.

## Non-Requirements

- The project does not require a `<spec filename="SPEC.md">` payload grammar.
- The project does not require a strategy registry, strategy contract document,
  or strategy template.
- The project does not require a reviewer verdict to gate completion.
- The project does not require `SPEC.md` to be stable across iterations.
- The project does not require all work to use a strategy subagent. Direct
  execution is valid for bounded, testable implementation work.
- The project does not auto-commit changes.

## Rebuild Bar

The docs are sufficient only if a maintainer can rebuild from them alone:

- the agent roster, permission posture, and delegation rules;
- Prometheus's spike protocol and write surface;
- the Prometheus to SPEC.md to Autonomous handoff (no payload grammar);
- the deterministic completion gate (disk artifacts, freshness, exact commands);
- the Karpathy loop harness, delegation, and stop criteria;
- the supervisor plugin's corrective cap and durability model;
- the mutation gate lifecycle;
- validation and audit commands;
- deployment and runner tool installation.
