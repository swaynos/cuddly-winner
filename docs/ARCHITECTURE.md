# Architecture

## Boundary

Native OpenCode Plan and Build sit outside this project's run coordinator. Their
requests flow directly through OpenCode with their original permissions and
tools. The plugin returns before inspecting their commands or mutation paths.

Only explicitly invoked managed agents enter this project's enforcement boundary:

```text
Native Plan / Build / third-party agents -> OpenCode unchanged

Prometheus / Autonomous / Karpathy / Reviewer / Grounder / Ask
    -> managed identity resolution
    -> fixed role defaults
    -> optional scaffold, protected execution, and orchestration when selected
```

## Identity Enforcement

The immutability hook uses the current selected agent for a top-level session.
Switching that session from a managed agent to native Build or Plan preserves
the conversation context but immediately leaves the enforcement boundary; prior
managed-agent messages do not determine current permissions. If the selected
top-level identity is not one of the six managed agents, processing stops
immediately. No project marker is required and no policy file is parsed.

Managed descendants inherit their originating managed identity. This prevents a
restricted agent from escaping its default through delegation while preserving
the user's explicit top-level mode switches.

Prometheus is confined to the fixed planning and scaffold paths described below.
It cannot edit production code or `.gitignore` directly. Autonomous can edit
source but cannot edit the published scaffold, trusted run-coordinator code, or
runtime evidence. Ask, Karpathy, Reviewer, and Grounder are read-only.

## Complexity Boundary

The safety model is explicitly constrained to a thin run coordinator, not a
general orchestration platform. The system operates as a deterministic state
machine with the following non-goals and constraints:

- One active mutating worker per run.
- One active item per mutating worker.
- One worktree.
- One active coordinator instance per run.
- One durable run-state document.
- No distributed execution.
- No parallel mutation scheduling.
- No DAG workflow engine.
- No worker-to-worker messaging.
- No general checkpoint system.
- No cross-machine recovery.
- No dynamic permission-policy language.
- No general event-sourcing framework.

These constraints bound mutation and coordination only. Verification commands
may create child processes, and read-only research and review delegates may run
concurrently, but they cannot mutate project files or update run state directly.

## Prometheus Flow

Prometheus moves through three planning states. It first interviews the user
only when repository and request context leave material unknown unknowns. It
then records known unknowns and resolves them through repository inspection,
Grounder, or contracted spikes. It may publish only after every load-bearing
unknown has been resolved. An unresolved blocker ends planning without
publishing an Autonomous-ready scaffold.

Prometheus writes a fixed scaffold that is excluded from version control (see
Git Exclusion Tool below):

| Path | Purpose |
| --- | --- |
| `SPEC.md` | Human-readable task, decisions, acceptance criteria, work items, verification, and handoff contract. |
| `opencode-autonomous.json` | Machine-readable scaffold manifest and selected strategy. |
| `.prometheus/evaluator/**` | Generated evaluator code, fixtures, reference data, and supporting assets. |
| `.spike/**` | Disposable questions, kill criteria, measurements, and validation evidence. |

The immutability hook permits Prometheus to mutate only these paths. The sole
exception is the `scaffold_gitignore` tool, which owns one constrained block in
the project-root `.gitignore`. Prometheus cannot supply arbitrary paths to that
tool and never receives general `.gitignore` mutation permission.

`opencode-autonomous.json` has a versioned schema. Every manifest declares the
strategy, invariants, `implementation_scope`, material escalation triggers, and
the complete inventory of evaluator files. `implementation_scope` is an
execution contract checked against iteration diffs; it does not change tool
permissions or the immutability hook. A Ralph manifest may have an empty
evaluator inventory when existing project checks are sufficient. A Karpathy
manifest must declare a custom scalar evaluator and additionally declares its
entry point, baseline, score format and direction, noise probe, mutable and
immutable targets, experiment limits, and stop criteria. Paths must be
worktree-relative, canonical, free of escaping symlinks, and consistent with
`SPEC.md`.

### Manifest Schema (v1)

`opencode-autonomous.json` is validated against this fixed v1 schema. The parser
fails closed: an unknown `schema_version`, a missing required field, an unknown
enum value, or an unknown top-level key is a hard validation error. There is no
migration path before 1.0; a mismatched version blocks rather than upgrades.

Common required fields (both strategies):

| Field | Type | Rule |
| --- | --- | --- |
| `schema_version` | integer | Must equal `1`. |
| `strategy` | enum | `"ralph"` or `"karpathy"`. |
| `invariants` | string[] | May be empty; each is a human-checkable constraint. |
| `implementation_scope` | string[] | Non-empty; canonical worktree-relative path globs checked against iteration diffs. |
| `escalation_triggers` | string[] | May be empty; conditions that force replanning. |
| `evaluator_inventory` | string[] | Every declared evaluator file under `.prometheus/evaluator/`. Empty allowed only for Ralph. |
| `verification` | object | `{commands: string[], baseline: string}`; the exact deterministic checks and their recorded baseline behavior. |

Karpathy adds a required `optimization` object; it is rejected if `strategy` is
`"ralph"`, and a `"karpathy"` strategy is rejected without it:

| Field | Type | Rule |
| --- | --- | --- |
| `optimization.objective` | string | Scalar metric name. |
| `optimization.direction` | enum | `"minimize"` or `"maximize"`. |
| `optimization.baseline` | number | Starting score from the frozen evaluator. |
| `optimization.score_extraction` | string | How the scalar is parsed from evaluator output. |
| `optimization.noise_probe` | object | `{runs: integer>=2, threshold: number>=0}`. |
| `optimization.mutable_targets` | string[] | Non-empty; the only paths an experiment may change. |
| `optimization.immutable_targets` | string[] | Paths that must never change; must include the evaluator. |
| `optimization.limits` | object | `{experiments: integer>0, failure_pivot: integer>0}`. |
| `optimization.stop` | object | `{target?: number, exhaustion: "experiments"}`. |

An optional `limits` object may override the coordinator defaults documented in
`docs/REQUIREMENTS.md`; any omitted key takes the default. Unknown keys inside
`limits` are rejected.

Prometheus publishes in this order:

1. Resolve uncertainty and choose the strategy.
2. Validate the exact verification commands and record their baseline behavior.
3. If the manifest declares a custom evaluator, create or replace
   `.prometheus/evaluator/**` and validate it with representative positive,
   negative, and malformed cases through contracted spike execution.
4. Invoke `scaffold_gitignore` and retain any tracked-artifact warnings.
5. Write and validate `opencode-autonomous.json`.
6. Write `SPEC.md` last as the publication marker.

Publication fails if the manifest is malformed, an inventoried file is missing,
an unlisted evaluator file remains, a declared custom evaluator lacks validation,
paths escape their boundary, or the selected strategy is incomplete. An empty
Ralph evaluator inventory does not require custom evaluator files or custom
evaluator validation. Karpathy publication fails without a validated custom
scalar evaluator. Writing `SPEC.md` last prevents a partially replaced scaffold
from appearing ready.

## Git Exclusion Tool

`tools/scaffold_gitignore.ts` exposes the `scaffold_gitignore` custom tool. It
accepts no path arguments and manages this exact root-anchored block:

```gitignore
# BEGIN OpenCode Autonomous artifacts
/SPEC.md
/opencode-autonomous.json
/.prometheus/evaluator/
/.spike/
/.opencode/runs/
/.opencode/supervisor/
/.opencode/progress/
/.opencode/quarantine/
# END OpenCode Autonomous artifacts
```

The tool creates `.gitignore` when absent, preserves all unrelated content,
replaces only its unique managed block, and is byte-idempotent on repeated
calls. It rejects duplicate or malformed markers, non-regular targets,
symlinks, and worktree escapes. Writes are atomic and preserve existing file
permissions.

After updating the file, the tool performs a read-only tracked-file query. It
returns structured fields for whether the file changed, the managed paths,
already tracked generated artifacts, and warnings. Tracked artifacts produce a
warning and do not block publication. The tool never stages, unstages, removes,
or otherwise changes the Git index.

Only Prometheus may invoke `scaffold_gitignore`; other managed agents are denied.
Prometheus itself remains unable to edit `.gitignore` by any other path.

## Scaffold Handoff

At top-level Autonomous startup, the run coordinator requires a published
`SPEC.md` and `opencode-autonomous.json`. It validates the manifest and evaluator
inventory, computes one combined fingerprint over the SPEC, manifest, and every
inventoried evaluator file, and records that fingerprint in protected run state.

While that run is active, managed-agent enforcement denies Prometheus mutation
of the published scaffold. The run coordinator rechecks the combined fingerprint
before every state-changing evaluation and before completion. A mismatch blocks
the run and requires revalidation and a new run. This lock-and-revalidate model
freezes the evaluator without a general snapshot store, content-addressing, or
garbage-collection subsystem.

## Protected Execution Threat Model

The threat model is an **honest-but-confused worker**, not a malicious host or a
worker attempting kernel escape. The worker may hallucinate results, replay
stale evidence, edit a checklist to claim success, or emit prose asserting
completion. It may not fabricate protected evidence or mutate run state, because
those live outside its reach and only the runner and coordinator write them.

Protected paths (worker-denied; coordinator/runner-owned):

| Path | Owner | Contents |
| --- | --- | --- |
| `.opencode/runs/` | coordinator | durable run-state documents |
| `.opencode/supervisor/` | coordinator | supervisor bookkeeping |
| `.opencode/progress/` | coordinator | item state and handoff records |
| `.opencode/quarantine/` | coordinator | stale/failed run remnants |
| published scaffold (`SPEC.md`, `opencode-autonomous.json`, `.prometheus/evaluator/`) | Prometheus, then frozen | task and evaluator definition |

The runner enforces four guarantees within this model: execution is confined to
the active worktree; every artifact is bound to the run identifier and combined
scaffold fingerprint (foreign or stale provenance is rejected); captured output
is bounded and written atomically so a crash cannot leave partial evidence; and
likely credentials are redacted before persistence. Redaction is pattern-based
over common secret shapes — `AWS`-style keys, bearer/JWT tokens,
`password=`/`token=` assignments, and PEM private-key blocks — and is
best-effort: it reduces accidental leakage, it is not a guarantee against a
determined exfiltrator (outside the threat model).

## Platform and Recovery

Protected execution is supported on **Linux with Bubblewrap (`bwrap`) only**. On
macOS, Windows, or Linux without Bubblewrap, the specialist agents and native
Plan/Build remain fully available; only top-level Autonomous execution is
unavailable, and the supervisor reports a concrete unmet prerequisite rather
than degrading silently. `scripts/ci.sh` already hard-guards Node version and
Bubblewrap presence on Linux.

Recovery is same-machine only. The durable run-state document under
`.opencode/runs/` is the sole source of truth for resuming an interrupted run;
the worktree carries implementation state. A run whose last heartbeat exceeds
the wall-clock bound is considered stale: the coordinator moves it to
`.opencode/quarantine/` and does not auto-resume it, so a crashed or abandoned
run can never silently continue mutating. There is no cross-machine recovery,
distributed lock, or shared-state service; a run is bound to the host that
started it.

## Shared Run Coordinator

The run coordinator is the conceptual orchestration role. The Autonomous
supervisor plugin implements that role. The protected runner is a separate
execution boundary used by the coordinator; it does not schedule workers or own
strategy decisions.

This document uses one canonical name per component. The **immutability hook**
is the identity-scoped plugin that applies managed-agent defaults (README refers
to it as the immutability plugin; they are the same component). The **protected
runner** is the sandboxed command-execution boundary (also called the protected
execution boundary; "trusted runner" is deprecated). The **supervisor** is the
plugin that realizes the run coordinator. The **run coordinator** is the
orchestration role those components serve.

Ralph and Karpathy do not use separate coordinators. They share this lifecycle:

1. Load the frozen scaffold and durable run state.
2. Select one strategy-specific work unit.
3. Start an iteration with one active mutating worker.
4. Receive a structured handoff.
5. Validate scope and evidence.
6. Apply the strategy-specific transition.
7. Persist run state.
8. Stop or repeat.

The lifecycle and state persistence are shared, but preparation, evidence, and
transition rules differ by strategy. The supervisor implements those differences
as branches in one deterministic reducer rather than separate orchestrators or a
general plugin framework.

## Autonomous Flow

When the user explicitly invokes Autonomous, the optional supervisor fingerprints
the complete scaffold, tracks durable strategy and iteration state, and evaluates
exact runner artifacts. The runner provides bounded, redacted, atomic evidence
bound to the scaffold fingerprint. Checklist marks and message text are not
completion state, and Autonomous cannot rewrite the scaffold.

The supervisor initializes only for a top-level `autonomous` identity. Idle or
error events from native Plan/Build sessions are ignored. The protected runner is
not a replacement for Build's Bash tool.

### Fast Path

Simple Autonomous work takes the one-iteration fast path: initialize minimal
state, run one worker, validate final evidence, and complete. Successful evidence
must not start a second worker. Repair scheduling and no-progress handling are
used only when the first iteration does not complete the task.

### Ralph Transition

For each Ralph iteration, the supervisor:

1. Selects the highest-priority pending item.
2. Starts one fresh worker context with the frozen scaffold, current worktree,
   previous handoff, and protected item state.
3. Allows the worker to edit within `implementation_scope` and the fixed
   managed-agent permissions.
4. Receives the handoff and validates the resulting diff against the scope.
5. Runs focused verification for the selected item.
6. Marks the item passed, starts bounded repair, or records an evidence-backed
   blocker.
7. Increments the consecutive no-progress count when no new result was proven.
8. Runs full verification when all items appear complete, then completes or
   selects the next item.

The worktree is the durable implementation state. Ralph does not require
automatic checkpoint restoration.

The manifest's discretion envelope separates local implementation judgment from
material replanning. Autonomous may repair and choose implementation details
inside declared invariants and `implementation_scope`. It emits a planning
blocker only when proceeding would change outcomes, acceptance criteria,
evaluator integrity, immutable targets, material scope, a trust boundary, or a
product or policy decision.

## Karpathy Flow

For each Karpathy iteration, the supervisor:

1. Validates the scalar objective, frozen evaluator, baseline, and noise floor.
2. Delegates experiment selection to the read-only Karpathy strategist.
3. Accepts exactly one bounded proposed change.
4. Preserves a bounded copy of the manifest's declared mutable targets.
5. Starts one Autonomous mutating worker to apply that change.
6. Revalidates the scaffold fingerprint and measures with the frozen evaluator.
7. Compares the result with the best score and required noise threshold.
8. On KEEP, retains the change, updates the best score, and discards the saved
   targets; on REVERT, restores the saved targets.
9. Pivots after the declared failure threshold, or stops when the objective or
   experiment limit is reached.

The coordinator persists the experiment record after each transition. This
target-scoped mechanism supports metric-driven optimization without introducing
a general worktree checkpoint engine or imposing it on normal development.

## Deployment

Default installation copies managed agent definitions and the identity-scoped
immutability hook into OpenCode's global configuration. It deliberately omits
repository `AGENTS.md`, the supervisor, runner, and non-core skills.

`--with-autonomous` adds the supervisor and the protected `run` and
`scaffold_gitignore` tools. `--with-tools` installs those two tools without the
supervisor; either tool profile installs `@opencode-ai/plugin` `1.17.15`. The
installer copies the vendored dependency closure only after confirming that
package version, and otherwise installs the exact pin from npm. `--with-skills`
adds optional skills. Reconciliation removes only managed byte-identical copies
or links to repository sources, preserving same-named user configuration.

Because the default profile omits the supervisor, runner, and
`scaffold_gitignore` tool, the Prometheus and Autonomous agent definitions can be
present without their supporting infrastructure. Both fail closed in that state.
Prometheus lacks the `scaffold_gitignore` tool and protected spike execution, so
it can triage and draft but cannot validate an evaluator or write the publication
marker; it reports that `--with-autonomous` is required. Autonomous finds no
supervisor to initialize run-coordinator state and no protected runner for
evidence, so it reports the same prerequisite instead of editing files
unsupervised. Neither degradation touches native Plan/Build.
