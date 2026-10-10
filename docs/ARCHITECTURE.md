# Architecture

## Scope

Cuddly Winner is an optional OpenCode profile designed to work seamlessly with
default OpenCode Plan and Build. The only addition to native Build is access to
publish_goal_agent, so a Build session can publish a Goal Agent without
switching to Prometheus. It does not change their native behavior, and any new
behaviors introduced by the profile work strictly within their intended surfaces.
Native Plan and Build remain the default path for ordinary work. The profile adds a small
planning path without a command sandbox, virtual machine, or protected evidence store.
Its goal runtime is scoped to the single generated Goal-Agent format on OpenCode V1.

## Managed Profile

The installer deploys three agents, two server plugins, a nested two-file TUI
activity surface, one tool file, one shared rule, and the existing five-file
Playwright browser runtime. TUI registration uses the separate `tui.json` or
`tui.jsonc` configuration, preserving user settings and disabled preferences.

| Component | Purpose |
| --- | --- |
| Ask | Read-only short answers and narrow evidence gathering. |
| Grounder | Hidden, read-only evidence researcher. |
| Prometheus | Planning-only publisher for Goal Agents. |
| `plugins/immutability.ts` | Enforces managed mutation and Bash boundaries. |
| `plugins/goal.ts` | Supplies goal_cycle and resumes premature goal stops. |
| `tools/publish_goal_agent.ts` | Creates, inspects or explicitly revises one Goal Agent. |
| `plugins/tui/goal-progress.tsx`, `progress.ts` | Displays bounded parent-session Goal activity. |
| `rules/resource-selection.md` | Browser and source-selection policy. |

The browser runtime remains Playwright-only. Task work uses configured
`headless` or Linux `virtual-display` mode. A separate headed window exists only
for a person to log in. Browser state stays outside the repository.

## Goal Agents

A root Prometheus or Build session publishes exactly one self-contained file:

```text
.opencode/agents/generated/<task-derived-name>.md
```

The nested directory is an internal boundary, not a visible agent-name prefix.
The file's frontmatter supplies the plain task-derived OpenCode name. It contains
the requested outcome, criteria, durable context, instructions, verification,
stop conditions, escalation triggers, and one embedded schema-v1 policy block.
Goal definitions additionally carry acceptance criteria in frontmatter
`options.goal.criteria` for machine checking. Optional `options.goal.builder_model`
and `options.goal.validator_model` values select separate verified models. When
an override is omitted, that child inherits the model currently selected in the
Goal Agent session (normally the user's configured default). These are in the
same agent file; the permission policy schema remains unchanged.

The policy contains only:

```json
{
  "schema_version": 1,
  "name": "task-derived-name",
  "edit_paths": ["src/exact-file.ts"],
  "bash": true
}
```

The publisher rejects unsafe names and paths, symlinked agent directories,
policy-marker injection, and (for creation) any existing project-local agent name. It scans
nested local agent definitions by file name and frontmatter name. It writes
through a temporary regular file and hard link for no-clobber creation.

### Updating or removing a Goal Agent

Inspect existing definitions before creating another. Prefer revising the same
identity when the user changes the same task. A new run-data namespace does not
require a new agent. Separate work or an explicit request for both definitions
can justify another identity. Existing obsolete files are not automatically deleted.

Call `publish_goal_agent` with `operation: "inspect"` and `name` to obtain the
definition and SHA-256 of its exact bytes. Then call it with `operation: "update"`,
`expected_sha256` and the complete replacement definition. Updates validate both
the existing target and new request, preserve identity/path, reject other local
name collisions and symlinks, and reject stale fingerprints. An exclusive transient
per-name lock serializes cooperating publishers; an interrupted lock requires
inspection before removal. A synchronized temporary file is atomically renamed
after a final fingerprint check. This is not a filesystem-wide compare-and-swap
against arbitrary external writers. No registry or additional agent format exists.

Creation remains the default no-clobber operation. After revision, quit and restart
OpenCode and select the same agent in a fresh conversation. Prior validation does
not establish success for a revised goal. To remove an agent, delete its file and
restart OpenCode.

`ImmutabilityGuard` reads this file only for the selected Goal Agent identity. It
allows exact `edit_paths`, applies the boolean Bash decision, blocks generated
definition rewrites and trusted profile sources, and carries the same boundary to
descendants. All managed ancestor restrictions combine, so a child cannot loosen
a read-only, Prometheus, or Goal-Agent policy boundary. Only the selected root
Prometheus or Build session may publish. Native and unrelated project-local agents remain
outside the Goal-Agent policy. Browser screenshot, download, and media-save tools use
the same path checks as edit tools. Profile sources under `agents/`, `plugins/`,
`tools/`, `rules/`, and `scripts/` are trusted control paths and cannot appear in
a Goal-Agent policy.

Classic generated packages are not migrated or accepted. When the old registry,
agent, brief, and manifest layout identifies the selected agent, the guard denies
mutation and Bash and tells the user to republish it as a Goal Agent.

### Goal Execution

Admission uses arguments on the existing `goal_cycle` tool, not another agent
format or a task registry. The first call supplies `alignment: confirmed`,
`completion_target`, `authorized_actions`, `max_cycles` and
`max_stalled_cycles`. Both bounds are positive integers, at most 100, and the
stalled bound cannot exceed the overall bound. Prometheus specifies task-specific
bounds and stop procedures in existing outcome, instruction and stop-condition
fields. Admission records the coordinator's alignment judgment. The runtime
enforces the decision protocol, not semantic interpretation of arbitrary user
instructions. Missing admission or `alignment: clarification_required` returns
blocked before child creation. A clarification needs a real user decision before
confirmed resumption. A changed definition still needs a fresh loaded session.

Repair calls supply `finding`, `repair` and `expected_evidence`. A current failed
criterion must match an exact criterion key in `finding`. The short repair
summary also appears in parent activity. Admission and retry hypotheses persist
in cycle results. Later arguments cannot replace the admitted limits or authority.
At the overall bound, or the admitted number of consecutive identical failed
criterion/evidence reports, the runtime returns blocked with the latest failed
validation intact. Protocol failures use their failure reason for comparison.
Valid unfinished builder checkpoints continue within the overall bound, not the
stalled bound. Missing/malformed or evidence-free readiness/blocker handoffs are
protocol failures and repeated identical failures remain bounded. Every builder-only
attempt with a child consumes the overall bound. There is no progress classifier
based on prose, changed-file counts or passing tests.
Different evidence under the same key is not automatically stagnation. The
overall bound still limits alternation. Explicit handback after diagnosis can
resume within remaining bounds, but cannot discard unresolved findings.
The same stalled bound limits continuation prompts when the coordinator never
starts the required repair. The stop persists in completed tool metadata without
rewriting the independent verdict. Hydrated activity displays that stop. Prompt
history also preserves the limit across runtime reload.
Explicit calls consult that persisted nudge history when completed-part updates
are unavailable, and cannot bypass a recorded stop without real user handback.

Before creating children, the runtime records `initial_worktree` in tool metadata
and completed cycle output. It obtains read-only NUL-delimited Git status through
`execFile`, with optional locks and filesystem-monitor hooks disabled. This is
fixed runtime provenance collection, not root Bash access. It never stages,
commits, restores or cleans the worktree. Capture limits are a ten-second status
timeout, one MiB of status output, 512 paths and 16 MiB of file bytes. Hashes cover
exact edit paths, publisher-rendered durable-context paths and initial dirty
paths. Raw file bytes are not stored. Symlinks, directories, unavailable files and
files beyond the byte budget do not receive hashes. Missing status and capture
limits are explicit limitations. A rename records both path names.

Both children receive the same initial evidence. Validators compare current
evidence with that baseline and must not infer task ownership from dirty status
alone. The snapshot does not establish pre-run history or concurrent authorship.
Initial evidence and admission survive interrupted attempts through existing tool
metadata. A shared history reader counts each child-bearing attempt once, including
stale `running` records, and ignores inspection and `invalid_request` outputs when
selecting execution checkpoints and user handback. A prior run without admission/provenance cannot acquire a new historical
baseline by resuming. It requires a fresh session and honest evidence limitations.

`goal_cycle` accepts `operation: "inspect"` (read-only) or `"execute"` (default).
Inspection exposes the current conversation's checkpoint, definition match,
admission/remaining allowance, child IDs/status and latest verdict through existing
session APIs; it never clears stops, changes files or creates a child. It omits
the full initial baseline and raw child tool output. Interrupted/stopped children
are checked with bounded status/get/messages requests. The V1 status map omits idle
sessions, so existence and parent ancestry must be confirmed before treating an
absent map entry as idle. Failed reads or unknown status fail closed.
An independently recorded child verdict is exposed even when the parent result
was interrupted. Its unresolved findings enter later validators in chronological
order; recovery itself never establishes acceptance.

Recover an unchanged definition in the same conversation after process restart,
with explicit user handback and confirmed admission. Before another writer, verify
old-child inactivity and supply reconciliation evidence to the fresh builder; never
repost external actions as part of runtime recovery. Definition revision still
requires a fresh loaded conversation. No cross-session migration or new registry
exists. Input/repair-diagnosis errors return `invalid_request` without mutating
stop state or consuming attempts; corrected requests retain the prior checkpoint.

Publishing does not start goal execution. Selecting the generated root agent starts
its workflow; it coordinates through goal_cycle and cannot edit project files, run Bash,
or spawn arbitrary tasks. The tool creates a new native General child for each
build and, after a ready builder handoff, another new child for validation. It
passes the goal definition, initial baseline and unresolved findings once to
both, the immediate unfinished checkpoint only to the next builder, and never passes the
builder conversation to the validator. Unresolved independent criterion findings
are passed to both roles, including the fresh validator. Child parentID preserves the existing
Goal-Agent policy inheritance. Both builder and validator children explicitly receive
read, glob, grep, and list inspection permissions. Children cannot delegate or
publish agents. Validator edit tools are denied; shell verification remains
permission-controlled and must not change product code. An approval-gated Bash
permission is not a command allowlist or shell sandbox.

The active builder alone may call `goal_handoff`, an internal tool protocol stored
in existing child/cycle records. It records ready, unfinished or blocked status,
concrete evidence and at most eight remaining actions. Ready requires an empty
remaining list and completed inspection/check tool use; it permits validation but
cannot establish acceptance. Unfinished or malformed/missing handoffs return a
failed builder checkpoint with no validator. The next bounded attempt uses a
fresh builder and the persisted actions without needing an invented independent
criterion failure. A blocked handoff with no attempted evidence is unfinished;
observed external stops, denial, cancellation and unknown outcomes remain terminal.
The runtime does not inspect natural-language final text to infer readiness or
guarantee that model evidence claims are true. Independent validation remains
essential. No new phase, agent-file schema or project registry is introduced.

Preparation runs inside the existing builder phase, not a separate handoff or
runtime phase. Prometheus may use read-only Grounder research to specify inputs,
dependencies, preparation procedures and readiness checks, retaining sufficient
exploration to resolve material feasibility uncertainty. The publisher's existing
instructions field carries this contract and applicable tool/skill usage; exact
edit paths include preparation outputs. The rendered coordinator and runtime child
prompts assign preparation through execution to the same Goal run. Builders inspect,
prepare, verify readiness and continue into authorized work; validators independently
check current readiness and the preparation-to-work transition. Task evidence in
authorized project artifacts records dependencies and readiness for fresh children.
When inputs change, builders refresh affected preparation and invalidate dependent
evidence, preserving unaffected work and history. This is instruction-level behavior,
not an automatic dependency scheduler or a new machine-enforced readiness schema.
Explicit preparation-only and scaffolding-only limits still apply, as do permission,
cancellation and unknown-outcome stops. A repairable missing prerequisite is normal
unfinished work, not a reason to end the run or require manual reconciliation.

When a Goal Agent policy enables Bash, the generated root exposes it as `ask` so a
child can inherit the approval-gated capability. `ImmutabilityGuard` still denies
root shell calls; only a child session may use the inherited capability.

Each child inherits the model currently selected in the Goal Agent session
(normally the user's configured default) unless its corresponding
`builder_model` or `validator_model` override is present.

The validator records structured evidence for every fixed criterion through
goal_verdict, which accepts calls only from the active validator session. This
avoids the pinned V1 structured-output API's session serialization failure. A
missing verdict or evidence is incomplete, not success. Premature validator
completion and malformed completed reports repeat the cycle; interrupted execution
or an API failure blocks it. A validator blocker without any attempted inspection
or check is repairable protocol failure, not an external stop. Child prompts end
with their role boundary: coordinator-only tools are intentionally unavailable.
Blocker evidence requires a completed or errored read, glob, grep, list, Bash,
webfetch, websearch, LSP, or managed browser tool attempt. Bookkeeping and
unavailable-tool calls do not count as inspection. An attempted inspection that
fails on an external dependency can still support a terminal blocker.
Failed criteria cause another diagnosed build/validate cycle within admitted bounds. Validation success requires
actual completed evidence-gathering tool use as well as the structured verdict;
the runtime enforces the protocol, not the truthfulness of model judgments.
If a previously failed criterion passes, its check must include a nonempty
`resolution` identifying new evidence resolving that exact finding, or an
evidence-backed correction of the earlier finding. Without it, goal_verdict rejects
the report with the offending keys so the active validator can correct it. A
malformed completed report is a protocol failure, not a silent rewrite of the
independent checks. Unresolved findings are reconstructed from cycle
records rather than stored in a second file. Unavailable required historical
evidence is an observed evidence blocker, not something repetition can manufacture.

Cycle results include `definition_sha256`. Changed or unbound previous cycle
records block reuse in the old conversation. Definition changes during execution
block success. The mutation guard freezes a cached changed definition and checks
ancestor cycle fingerprints after reload, so changed permissions cannot silently
authorize an old child. Fresh-session execution follows the revised definition.

Before orchestration, confirm that the published outcome matches the requested
deliverable and side-effect constraints. Implementing an executable loop, testing
it offline and authorizing real execution are different objectives. A generation
prohibition does not justify a preparation-only controller. Reports separate
implemented behavior, offline verification, unverified behavior and actual goal
achievement. Offline profile fixtures prove continuation and evidence continuity;
they do not prove a separate product's hybrid image-generation implementation.

The goal plugin listens for root session idle events and submits a continuation
only after a completed failed cycle. It does not restart a pre-admission stop.
Cycle tool results and child sessions are
the durable checkpoints; no registry or task-state file is created. In-memory
sets only prevent concurrent cycles/continuations and track cancellation. Abort
propagates to the active child. Session/API errors, actual rejected permissions, and interrupted
cycle records are never automatically replayed. Explicit user input can resume
after inspection. Restarting OpenCode does not launch background work by itself.
Native agents and Goal Agent files without goal metadata do not enter this runtime.
Ordinary tool errors containing words such as "rejected" or "cancelled" do not
establish user denial. Permission events and explicit interruption signatures
remain terminal; unknown non-idempotent outcomes are never automatically replayed.

### Live parent activity

The active child reports concise public milestones through `goal_progress`; tool
events supply generic activity categories. No reasoning or raw tool output is
relayed. The existing `goal_cycle` part stores bounded activity metadata (cycle,
phase, status, milestone and three recent entries). Child reports are labeled
`Reported` and never count as independent validation evidence. Failure summaries
identify failed criterion keys; the coordinator explains substantive retry findings.

The pinned V1 custom-tool bridge leaves the metadata callback as a lazy Effect.
The runtime therefore reuses its authenticated SDK transport to update the running
part through the pinned V2 part API, serializing updates and awaiting completion.
The TUI panel uses `app_bottom`, stays visible in narrow terminals and permission
waits, hydrates on reattach, and hides on native sessions. Native Plan and Build
behavior and prompt entry remain unchanged. Terminal integration observes actual
in-flight builder/validator rendering, repair, completion and cancellation.

### Decision Record

The previous registry, JSON manifest, Markdown brief, strategy vocabulary, task
loop, KPI policy, and Reviewer created multiple files for one bounded task. The
profile now uses one file because one task needs one durable instruction and one
small machine-enforced policy. Revisit this decision only when a concrete task
cannot carry its required context and exact policy in one file. Do not restore a
second format or compatibility layer without changing this document and
`REQUIREMENTS.md`.

## Goal Activity In The Terminal UI

The server Goal runtime stores a bounded `goal_activity` snapshot on its existing
`goal_cycle` tool part: session/agent identity, cycle, builder or validator phase,
status, current tool category, last public milestone, timestamps and at most
three recent summaries. Session records remain the checkpoint; no registry or
second Goal-Agent format is added. `goal_progress` is callable only by the active
child. Progress is child-reported activity, never independent validation evidence.
Both success and blocker evidence gates exclude progress/bookkeeping tools.

The pinned V1 registry passes custom-tool metadata as an unexecuted Effect.
The runtime therefore reuses the plugin client's authenticated transport with the
pinned V2 part-update API, serializing updates to the current running tool part.
Final progress is also included in the completed tool result's metadata. Native
tool inputs/output/error payloads and reasoning are not relayed; tool events map
to public categories, and explicit milestones reject URLs/credential forms.
Inactive/unrelated/finished child events do not update the parent.

`plugins/tui/goal-progress.tsx` is a separate TUI-only module. It appends a compact
four-line panel in the supported `app_bottom` slot, avoiding prompt replacement
and sidebar-width dependence. It hydrates from synchronized parent message/part
metadata on attachment and follows the current root Goal session and selected
agent. Native Build/Plan, unrelated sessions and children have no panel. It shows
phase, elapsed time, current activity, a labelled child milestone and recent
transition; validated completion is labelled independently validated. Elapsed
time is a clock, not evidence of progress or a guessed completion percentage.

The installer copies both nested TUI assets and merges their registration into
`tui.json` or `tui.jsonc`. The nested directory is outside flat server-plugin
discovery. JSONC comments, other plugin tuples/settings and user disable choices
are preserved. Ambiguous dual configs and symlinked configs fail safely. Removal
preserves customized TUI assets/registration together. `jsonc-parser` is a pinned
runtime dependency for this configuration lifecycle; the existing five-file
Playwright runtime remains unchanged.

The visibility journey is tested with the actual pinned CLI in Linux PTYs at
80x24 and 60x24, rendering ANSI frames with a headless terminal emulator. Tests
hold child execution open to observe live builder/validator milestones, actual
permission waiting, failed-validation repair, completion, cancellation and
re-attachment; they also check native prompt usability and session isolation.
Metadata or final transcript tests alone do not establish visibility.

## Installation And Retirement

`scripts/deploy-opencode-agents.sh` supports copy and symlink modes. Plugins and
browser runtime files always install as copies. `install`, `status`, and `remove`
operate under one configuration root.

The installer records managed agents and safely retires removed assets. It deletes
only an exact known copy or a link to the repository source, except that install
and remove forcibly delete a file or symlink at the retired
`tools/publish_direct_agent.ts` path. `status` reports that retired file if it
still exists.
Modified, unrelated, and user-owned files at other retired paths survive and make
`status` report drift. An unexpected directory at the retired publisher path is
preserved. The installer preserves browser
settings, saved sessions, and feedback data. Retired user configuration is never
treated as profile-owned merely because its path matches an old feature. It rejects
symlinked retirement parents rather than following them outside the configuration
root.
Retired MCP entries are removed only when their full historical configuration
matches. A modified retired rule file keeps its instruction registration so an
upgrade does not silently disable user-owned behavior.

Restart OpenCode after installing or changing agents, plugins, tools, rules, or
browser runtime files. OpenCode loads these at startup.
