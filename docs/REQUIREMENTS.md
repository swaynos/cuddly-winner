# Requirements

## Product Goal

Provide a lightweight optional OpenCode profile for evidence-backed planning and
one bounded, goal-oriented work handoff. It works seamlessly with default
OpenCode Plan and Build, never changes their native behavior, and keeps any new
behaviors scoped strictly to their intended surfaces without claiming command sandboxing.

## Current Contract

The managed profile ships exactly `ask`, `grounder`, and `prometheus`.
Grounder is hidden and read-only. Ask is read-only and can delegate research to
Grounder. Prometheus is planning-only: it can invoke `publish_goal_agent`, but
cannot edit project files or use Bash.
It interviews the user after inspecting the conversation and project evidence,
asks only decision-changing questions, and establishes observable acceptance
criteria and independent verification before publication.

Prometheus publishes one local Goal Agent under
`.opencode/agents/generated/<name>.md`. `<name>` is task-derived, lowercase,
hyphenated, and cannot collide with a native or managed identity. The Goal Agent
file must contain the schema-v1 embedded policy described in `ARCHITECTURE.md`.
Its policy grants only exact worktree-relative edit paths and a boolean Bash
capability.

Inspect existing definitions before publication. Same-task revisions should keep
the name and path stable. The publisher supports explicit inspect/update operations;
updates require a complete validated definition and the inspected byte SHA-256.
Stale, concurrent, colliding, malformed or symlinked updates fail safely. Default
creation remains no-clobber. Restart OpenCode and use a fresh conversation after
revision; prior success cannot validate a changed definition.

Goal Agents coordinate the published task in a fresh OpenCode session. Each
goal_cycle starts a fresh builder. A ready `goal_handoff` permits a separate fresh
independent validator; unfinished builder work must continue before validation.
Failed validation
feeds findings to the next fresh builder within the admitted bounds. Only criterion-by-criterion validation
with tool evidence establishes completion. After an admitted failed cycle, a premature coordinator stop resumes
automatically; cancellation, denied permissions, unknown API outcomes, and genuine
blockers remain incomplete and require explicit user input before resuming.
Unresolved independent findings persist across cycles and are supplied to fresh
validators without the builder conversation. A previous failure becoming passed
requires an explicit evidence-backed `resolution`; unrelated passing tests do
not resolve it. `goal_verdict` rejects missing resolutions with the exact keys so
the active validator can correct its report before finishing; the runtime must not
silently rewrite a passed check to an older failure. Required unavailable historical evidence remains a blocker.
Cycle records are bound to the exact definition fingerprint. Changed or unbound
records cannot authorize continuation or descendant mutation in the old session.
Outcome and side-effect constraints must distinguish executable implementation,
offline verification and live execution. Completion reports must distinguish
these evidence classes and actual goal achievement.

Before starting children, `goal_cycle` requires an explicit admission decision.
The coordinator records the aligned `completion_target`, `authorized_actions`,
`max_cycles` and `max_stalled_cycles`. Publication instructions must derive these
bounds from task-specific stop conditions. `alignment: clarification_required`
stops before children. Missing or malformed admission returns a correctable input
error without starting children or creating a terminal stop. Idle continuation must not
restart an outcome or authority clarification before the first cycle. Admission
records the coordinator's judgment. It does not grant permissions or automatically
interpret natural-language authorization. A changed target or authority must use
the existing fingerprint-bound revision and fresh-session procedure.

Each repair cycle requires `finding`, `repair` and `expected_evidence`. A criterion
failure requires its exact criterion key in `finding`. The coordinator must state
the concrete repair and the new evidence that can resolve it. The runtime stops
incomplete at the admitted overall cycle bound or consecutive identical-finding
bound. It compares failed criterion keys and exact evidence, not keys alone or
semantic similarity. Valid unfinished checkpoints are not stalled attempts;
repeated handoff protocol failures remain bounded. All attempts that create a child count
against the overall bound, including builder-only and interrupted attempts. Changed
independent findings can continue within the overall bound. Contradictions, inaccessible
repairs and unavailable historical evidence require focused diagnosis. Later
arguments cannot increase admitted bounds. Failed findings remain unresolved
after a non-progress stop. Explicit user handback does not waive them.

Builders record `goal_handoff` with `status` (ready, unfinished or blocked),
concrete `evidence`, and `remaining` actions. Ready requires no remaining work
before independent checking and completed inspection/check tool evidence; it is
not a success verdict. Ready also requires exactly one `checks.cN.evidence` entry
per acceptance criterion, with actual artifact/check references and observed
results. Missing, empty, excessive or unexpected criterion evidence is rejected
in the active builder, which can correct the report before returning. Coverage
does not establish truth or live quality; independent validation still checks
the actual outputs. Passing tests and preparation are milestones, not reasons to
stop the next authorized action. Unfinished requires concrete next actions, permits honest
zero progress, and returns an incomplete checkpoint without starting a validator.
Missing/malformed handoffs are unfinished protocol work, not readiness. Fresh
builder continuation uses that checkpoint without fabricating a failed criterion.
Blocked handoffs require an attempted inspection of an observed genuine stop;
missing authorized implementation and unavailable coordinator tools are not
external blockers. Cancellation, denial and unknown action outcomes retain their
terminal rules. Handoffs live in existing session tool records, not a second Goal
format or project registry. The runtime enforces handoff structure and evidence
use, not the truthfulness of the builder's judgments.

Runtime stops are authoritative for idle nudges and explicit calls across reload.
The coordinator-nudge bound persists even when the bridge cannot update completed
metadata. Without explicit real user handback, later calls cannot bypass it.

Before the first builder mutation, the runtime records bounded initial Git status
and hashes for exact edit paths, durable-context files and dirty paths. Session
records retain this evidence across fresh children and interrupted attempts.
Validators must attribute scope against this snapshot, preserve pre-existing user
changes and intentional deletions, and reject newly caused out-of-scope edits.
Untracked does not mean created by this run. Missing or excluded byte evidence
remains explicitly unavailable. A current snapshot cannot prove earlier history
or concurrent authorship. No clean-worktree requirement or user-work restoration
is permitted.

`goal_cycle(operation="inspect")` is a read-only operation scoped to the root
conversation and its recorded Goal children. It can resolve the historical Goal
after switching that same conversation to native Build/Plan; ambiguous identities,
missing definitions and inaccessible history report unknown without execution.
Execution still requires the selected root Goal. It reports the definition match,
checkpoint, admission, attempts used/remaining, child activity and latest independent
verdict without starting children, clearing stops or consuming allowance. Inspection
also reports the selected versus historical agent, authoritative run state and a
`runtime_contract` identifier emitted by the loaded plugin. Installed/source files
do not prove which runtime a running session has loaded.
Inspection and rejected requests cannot hide the latest execution checkpoint or alter user
handback detection. Invalid argument and repair-diagnosis requests are correctable;
scope mismatches, cancellation, denial and unresolved action outcomes remain stops.

With an unchanged definition, recover after a process restart in the same Goal
conversation. Count every child-bearing record once, including stale `running`
records; retain the original admission and baseline. Before a new writer, confirm
recorded interrupted/stopped children are idle through the session API. Busy,
retrying, inaccessible or unknown child activity prevents continuation. Explicit
user handback and confirmed resumption are required after a stop. The next fresh
builder must reconcile actual task actions before new side effects; orchestration
interruption proves neither absence nor completion of an external action. Do not
export/migrate run state to another session or invent historical evidence.

Prerequisite preparation is owned by the published run. Prometheus resolves
material feasibility uncertainty through permitted exploration and specifies
required inputs, dependencies, procedures, tool/skill usage, readiness checks and
durable evidence locations in the existing goal fields. It does not implement
preparation artifacts. Exact edit paths and capabilities must cover preparation
as well as subsequent work. The builder prepares missing or stale prerequisites,
verifies readiness and proceeds directly into authorized iteration. Fresh children
reuse verified preparation from durable evidence; changed inputs refresh affected
preparation and invalidate dependent evidence without discarding unaffected work
or history. The independent validator checks readiness and the transition against
the requested outcome. Repairable preparation failures continue through the normal
build/validation cycle. Preparation-only scope may end at readiness; scaffolding-only
scope must implement and test the transition without unauthorized execution.
Genuine missing authority/dependencies and unknown side effects retain their
existing stop rules. No new agent format, phase, registry or policy capability is needed.

Published instructions lead with a short execution spine: finish line, authority,
dated starting evidence and implementation gap, first productive obligation, minimum required
prerequisites and direct continuation. Criteria are implementation/artifact
obligations with evidence, not only inspection questions. Optional dependencies
must not become mandatory handoff gates. Reconcile superseded historical workflow
instructions explicitly and assign permitted documentation updates to the builder.
Commands that do not exist yet are labeled requirements to implement. Child
prompts carry the current definition, baseline, relevant unresolved findings and
immediate checkpoint once, not a duplicate full previous-cycle serialization.
Starting observations are reconciled at execution, not permanent facts. Publication
is not a claim of implementation readiness. Builders may make bounded partial
advances; ready means work is ready for independent checking, not that the builder
has already obtained an independent verdict. Runtime mechanics belong in the
publisher template rather than duplicated task-specific operating manuals.

Goal execution displays bounded, event-derived parent activity while child phases
run, including cycle, phase, public milestone, waiting, failure, completion and
cancellation. Child-reported progress is not validation evidence. Preserve native
session behavior, user TUI settings and modified assets during installation/removal.
Show the latest independent verdict and failed keys while a repair runs, alongside
the retry reason. Builder-maintained task artifacts cannot override session
verdicts. Report observed permission denial, cancellation, child failure and
unknown action outcomes distinctly. Unknown outcomes require inspection before
explicit resumption. No interruption permits automatic action replay.
An idle selected Goal with no execution record displays `not_started`: no execution
or validation evidence, no implicit admission and no automatic child. Admission
stops are visible even without a builder. A conversation switched to Build/Plan
retains its recorded Goal panel without changing native execution. Free-text
completion/readiness claims cannot replace the recorded checkpoint/verdict. The
panel displays remaining attempts when admission evidence is available.
An unsupported blocker with no attempted inspection, or a malformed completed
validator report, is repairable failed validation. Missing coordinator-only tools
in a child is intentional, not a dependency failure. Ordinary rejected-input tool
errors must not be mistaken for user permission rejection.
Bookkeeping and unavailable-tool calls do not establish blocker evidence. Failed
inspection attempts can establish evidence of an unavailable external dependency.
Both builder and validator child sessions explicitly receive read, glob, grep, and
list inspection permissions. The validator cannot use edit tools or delegate; when
Bash is enabled, it receives an approval-gated verification channel and must not
modify product code through shell commands. Approval is not a command allowlist;
this is not a shell sandbox.
Optional verified `builder_model` and `validator_model` values in
`options.goal` choose separate execution models. When a value is omitted, that
child inherits the model currently selected in the Goal Agent session (normally
the user's configured default).
Goal Agents cannot rewrite their generated definition or trusted profile sources. Their
descendants inherit the Goal-Agent boundary and cannot loosen any managed ancestor's
restriction. Only the selected root Prometheus or Build session may publish a Goal Agent.
A malformed Goal-Agent policy fails closed. Browser tools that save screenshots,
downloads, or media locally obey the same exact edit-path policy as edit tools.

## Goal Progress Visibility

While `goal_cycle` runs, the terminal TUI must show a persistent, bounded Goal-only
activity panel identifying cycle, builder/independent validator, current actual
tool activity and concise child-reported milestones. It must remain visible in
narrow terminals with the sidebar hidden and during approval waits. Progress
reports are not evidence or success; show failed validation/retry, independent
completion, interruption and cancellation honestly. Preserve native Build/Plan
prompts, session isolation, cancellation and unknown-action safeguards.

The installer manages the separate TUI module and registration without replacing
user themes, keybindings, plugin options, JSONC comments or disable preferences.
Verification must observe terminal-rendered updates before the child finishes,
not just completed output or metadata values. Restart OpenCode after deployment.

## No Legacy Support

The old generated-agent registry, manifest, brief, task-loop, Ralph,
optimization, KPI, Reviewer, spike, skill, feedback, session-fetch, and announce
hygiene systems are removed. They have no alias, migration, or alternate runtime
path. A recognized old package fails closed until Prometheus republishes it as a
Goal Agent.
This retirement does not prohibit the current single-file Goal Agent runtime or
user-requested automation in other projects. Older Goal Agent definitions without
goal metadata do not silently acquire autonomous continuation; explicitly revise
a valid single-file definition through the publisher, then restart in a fresh session.

## Native Compatibility

Build, Plan, unknown identities, and unrelated local agents remain completely native
and usable without a Goal Agent definition. The only addition to native Build is access to
publish_goal_agent, so a Build session can publish a Goal Agent without
switching to Prometheus. The profile works seamlessly with default Plan and Build
and does not alter their behavior. The immutability plugin applies only to
Ask, Grounder, Prometheus, Goal Agents, and a detected legacy package, while allowing
root Build sessions to publish Goal Agents if chosen. It intercepts OpenCode
edit and Bash tool calls, not host filesystem effects produced by a command.

## Browser Runtime

`rules/resource-selection.md` owns workflow precedence and shared safeguards.
Managed runtime procedures live in the on-demand `docs/RESOURCE-SELECTION.md`,
deployed beside the rule without inclusion in always-loaded instructions.

## Installation Safety

The installer must deploy the current profile without overwriting user changes.
By default, overwritten managed entries are replaced in place without creating
backup files; passing `--backup` to `install` preserves replaced entries in `backups/`.
It may retire old managed assets only when an exact hash or repository-link target
proves ownership, except that install and remove forcibly delete a file or symlink
at the retired `tools/publish_direct_agent.ts` path. `status` reports that retired
file if it still exists. An unexpected directory at that path remains untouched.
Conflicting other old paths remain untouched and make status drift.
Customized retired MCP entries and the instructions for preserved retired rules
also remain untouched. Browser settings and saved sessions are user data and are
never reset.
