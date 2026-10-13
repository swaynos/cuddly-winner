# Architecture

## Scope

Cuddly Winner is an optional OpenCode profile. Native Plan and Build remain
available without altered behavior; root Build additionally exposes
`publish_goal_agent`. The profile adds planning, a persistent root worker and
fresh independent evaluation within one generated Goal-Agent format. It is not
a command sandbox, virtual machine or protected evidence store.

The loaded plugin reports `runtime_contract: 'persistent-worker-v1'`. Inspection
of running code establishes the loaded contract; source hashes and installer
status describe disk contents, not the runtime loaded by an existing process.
Restart OpenCode, including the server used by `opencode attach`, after deployment.

## Managed Profile

The installer deploys three agents, two server plugins, three nested Goal helpers,
a nested two-file TUI surface, one tool, one shared rule and the existing five-file
Playwright runtime. Only flat server-plugin entries are auto-loaded. Nested
helpers are imported by `plugins/goal.ts`; TUI registration is separate.

| Component | Purpose |
| --- | --- |
| Ask | Read-only short answers and narrow evidence gathering. |
| Grounder | Hidden, read-only evidence researcher. |
| Prometheus | Planning-only Goal Agent publisher. |
| `plugins/immutability.ts` | Exact mutation paths, managed ancestry and checkpoint boundaries. |
| `plugins/goal.ts` | `goal_run`, `goal_evaluate`, evaluator-only `goal_verdict` and same-session continuation. |
| `plugins/goal/state.ts` | Pure checkpoint validation and state transitions; the adapter supplies clock values. |
| `plugins/goal/evidence.ts` | Read-only filesystem hashes and initial Git baseline, separate from state logic. |
| `plugins/goal/evaluation.ts` | Fresh evaluator dispatch, report correction and candidate-bound results. |
| `tools/publish_goal_agent.ts` | No-clobber creation, inspection and fingerprint-checked revision. |
| `plugins/tui/goal-progress.tsx`, `progress.ts` | Best-effort read-only checkpoint presentation. |
| `rules/resource-selection.md` | Browser and source-selection policy. |

The browser runtime remains Playwright-only. Task work uses configured
`headless` or Linux `virtual-display` mode. A separate headed window exists only
for a person to log in. Browser state stays outside the repository.

## Goal Definition And Publication

A root Prometheus or Build session publishes one self-contained file:

```text
.opencode/agents/generated/<task-derived-name>.md
```

The directory is an internal boundary, not a visible agent-name prefix. The
frontmatter declares the task-derived name, primary mode and
`options.goal.runtime: persistent-worker-v1`, fixed `criteria` and optional
`validator_model`. The file carries outcome, durable context, instructions,
verification, genuine stop conditions and escalation triggers. The schema-v1
policy remains exactly:

```json
{
  "schema_version": 1,
  "name": "task-derived-name",
  "edit_paths": ["src/exact-file.ts", "scripts/task-runner.mjs"],
  "bash": true
}
```

Root editing is enabled and checked against this policy. Enabled Bash is `ask`.
The worker uses its selected root model; the `builder_model` parameter is removed.
An evaluator inherits that model unless `validator_model` supplies a verified
provider/model identifier. Arbitrary task delegation is denied.

The publisher rejects unsafe names/paths, policy-marker injection and symlinked
agent paths. It scans nested local definitions by file name and frontmatter name
to detect collisions. Creation synchronizes a temporary regular file and hard
links it for no-clobber publication. Inspect returns the exact-byte SHA-256.
Update requires `expected_sha256` and a complete replacement definition, preserves
identity and rechecks the fingerprint before atomic rename. A transient per-name
lock serializes cooperating publishers, not arbitrary external writers.
Interrupted locks require inspection. No registry or second agent format exists.

After publication/revision, restart and select the agent in a fresh conversation.
Prior authority or acceptance cannot validate a changed definition. Old absent/
different runtime markers fail closed. Explicit republication does not reset
historical stops or user budgets; old evidence is retained without a migration or
compatibility execution path. Historical coordinator tool records cannot seed
a new persistent run in the old conversation.

Prometheus's publication process turns a short request into executable work:
finish line/authority, gap/first productive action, reachable prerequisites,
sufficient exact implementation/verification/delivery paths, and reconciled history.
Technical uncertainty does not require a planning-session implementation or proof
of feasibility. The renderer supplies persistence and experiment-learning mechanics
once; task prose supplies domain constraints and evidence. No second package or
readiness manifest is introduced.

`assertPublicationPaths` examines local filesystem facts before publication writes.
It rejects directory/symlink edit targets and missing literal Node entry points
without implementation authority; pure validation rejects file/descendant conflicts.
Recognizable literal shell commands need Boolean Bash access. Complex shell/prose
and quality/feasibility remain planning/evaluation obligations, not a static sandbox
or keyword classifier. Existing read-only verification files need no edit grant.

## Native Checkpoint

`session.metadata.cuddly_winner_goal` stores the run. The supported V2 client for
`session.update` reuses the same authenticated transport as the plugin client;
it does not create an unauthenticated client or write a database/file directly. Updates
preserve unrelated metadata and check that the server returns the stored value.
Per-session serialization prevents competing plugin updates. In-memory locks,
active-tool tracking and evaluator registrations are not durable authority.

The checkpoint contains:

- `runtime_contract: 'persistent-worker-v1'`, `agent`, `definition_sha256`.
- `state`: `working`, `evaluating`, `paused` or `accepted`.
- Original `completion_target`, `authorized_actions` and `initial_worktree`.
- `pending_actions` and `continuation` dispatch evidence.
- `evaluation` assignment, child identity, artifacts and candidate hashes.
- Latest `feedback`, final `validation`, unresolved `findings`, timestamps/reason.
- `resumed_after_user` prevents reuse of a handled human stop after explicit resume.
- `accepted_candidate` when final evaluation accepts the stable candidate.

Compaction text is a context summary, not authority. The compaction hook reminds
the worker to retain findings/uncertainty and inspect metadata. The Goal idle
dispatcher owns continuation, so native compaction auto-continuation is disabled
for an admitted Goal to avoid duplicate dispatch. UI/part-update failure cannot
lose control state or clear a pause.

## Persistent Worker And State Transitions

`goal_run(operation="start", completion_target=..., authorized_actions=...)`
records admission and baseline once before root mutation. This interpretation
does not grant additional permissions. Repeated start inspects the existing run;
it cannot replace authority/baseline. The root worker prepares, explores,
implements, experiments and repairs in its original conversation, without a
builder child, handoff or build/validation cycle.

Optional `predecessor_session_id` on `goal_run(inspect)` uses native get/children/
status APIs with bounded reads and same-task/project/worktree checks. It bypasses
`reconcile` entirely, including for the caller, so it cannot pause or otherwise
rewrite a different worker. Output contains only checkpoint/activity facts and a
`can_continue` snapshot; no prompts, private metadata, artifacts or baselines.
An unadmitted caller uses its selected validated Goal definition for scoping;
inspection grants no admission. `include_baseline` is harmless here and never
exposes predecessor baseline data.
Busy/retry/working predecessors, unresolved actions/evaluation/continuation,
unmarked children and inaccessible/malformed status remain blockers. Children
whose permanent evaluator marker matches the predecessor's identity are read-only
and need not be idle for this handoff check. Existing same-session evaluation and
resume guards still check their own active evaluator to protect candidate stability.

When an admitted working root returns partial work, idle continuation submits a
synthetic prompt to that same agent/session using its selected model. Dispatch
intent and message identity are persisted before submission to diagnose unknown
outcomes. Working state and matching definition are required. No arbitrary
default time/token/attempt/cycle/stall quota terminates creative exploration.
Incorrect calls, stale status reasoning, model-declared blockers and impossible
outcomes feed this loop instead of terminating it. The dispatcher supplies fresh-state
and correction guidance; it keeps the selected model and the original authority.
User-explicit resource ceilings live in task-owned records, with amendments and
historical consumption preserved in existing intent/receipt evidence. Definitions
and admission reference that authority without freezing numerical ceilings. An
explicit amendment within existing permissions and unchanged acceptance uses the
same worker and normal resume flow; it needs no runtime budget tool or counter.
Expanding exact output permissions still requires publication. Tool permission approval
does not enforce a shell sandbox or resource hard limit.

Limit origin remains task evidence, not a new runtime budget manager or policy
field. Planning, rendered worker guidance, continuation, compaction and independent
evaluation explicitly distinguish actual user/service ceilings from agent-authored
defaults. Inherited records, batch sizes, estimates and acceptance counts do not
establish a cumulative limit, and absence of a ceiling requires no budget question.
Task-owned append-only containers and hash-bound fixed inspection views can retain
uncapped experiments under exact-file permissions. They are task implementation,
not an alternate Goal package. Supporting repairs lead back to the live experiment;
maintenance activity cannot substitute for requested output or quality acceptance.

Mutating tools reserve `pending_actions` before dispatch. Successful after hooks
clear their own action durably. Native `apply_patch` errors starting with
`apply_patch verification failed:` and its exact empty-patch/missing-text errors
are emitted during preflight, before any patch-file writes. A matching active call
and pending tool identity allow these no-effect failures, like confirmed guard
rejections, to clear only that action without pausing the worker. Active ownership
is retained until checkpoint cleanup is acknowledged; failed persistence does not
grant further work. Duplicate/late receipts cannot erase another action.

This narrow classification follows the native tool's
[1.18.31](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/src/tool/apply_patch.ts)
and [1.18.35](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/tool/apply_patch.ts)
preflight/write separation, corroborated by real CLI regression tests. It does
not classify arbitrary shell/browser error output or non-preflight patch errors
as no-effect. Those retain their unknown pending receipts and pause. A completed
UI part alone is not the after-hook checkpoint acknowledgment. No-effect cleanup
also never resumes a separately cancelled, denied or already paused run; old
paused sessions still require normal explicit reconciliation/resumption.

`goal_run(operation="pause")` persists a pause only for a corroborated real user
stop request. An unsupported model pause returns current state and correction guidance.
Idle continuation also observes the user stop; explicit resume records the latest
handled human ID in `resumed_after_user`, preventing reuse of an old stop after a
native Question answer. Cancellation, real permission
denial, unknown transport interruption or unknown actions also
pause. Mutation is frozen during evaluating, paused and accepted states.
`goal_run(operation="inspect")` reads current/historical Goal state in the same
conversation, including after switching to native Build/Plan. It starts no work
and never clears a pause, but reconciliation can persist a pause for interrupted
activity. Invalid inputs remain correctable without inventing a new admission.

Recovery inspects receipts and evaluator evidence before explicit user-authorized
`goal_run(operation="resume", reconciled=true)`. Require unchanged definition and
old evaluator inactivity through native session APIs. Status questions, synthetic
messages and summaries do not authorize resumption. Preserve original authority,
baseline, feedback, final validation and unresolved findings. Reload recognizes
pending actions or orphaned evaluation as unknown and pauses; restarting does not
automatically replay external actions or unknown continuation dispatches.
Tool errors distinguish observed working/evaluating/paused/not-started state and
give the appropriate next operation, rather than treating every invalid resume as
missing human authorization. Snapshot rejection restores the actual current state
before reporting unavailable file paths and correction guidance. Descriptions on
context/artifact parameters require paths only, avoiding prose-as-filename baselines.
Terminal context/structured-output errors and API errors with known non-auth HTTP
status can retry when no pending task effect or continuation is uncertain. Error
continuation waits one second to avoid a hot retry loop; this is not a time limit.
Unknown errors, HTTP 401/403 and effects/evaluation uncertainty remain paused.
Recognized read-only evaluator model failures discard the unfinished assignment and
return working error feedback; they cannot accept a candidate or erase a real pause.

## Initial Worktree Attribution

Before mutation, collect NUL-delimited native `git status --porcelain=v1 -z
--untracked-files=all` through fixed runtime `execFile`, with optional locks and
filesystem-monitor hooks disabled. This read-only provenance collection does not
use worker Bash access and never stages, commits, restores or cleans. A rename
records both path names. Hash exact policy paths, durable context and observed
dirty paths; retain explicit absent/unavailable states instead of raw file bytes.

The current capture has a ten-second Git request timeout, one MiB status output
limit and 512 status-path cap. These are provenance/transport safeguards, not
worker resource ceilings or domain-attempt limits. Capture limitations remain
explicit. Preserve intentional deletions and pre-existing untracked inputs;
current dirty status alone cannot prove task ownership or concurrent authorship.
Later snapshots cannot reconstruct unavailable historical evidence.

## Independent Evaluation

Publisher, guard and runtime resolve policy paths against an enclosing worktree
when the caller starts in a subdirectory. OpenCode's global/non-Git `/` sentinel
falls back to the caller directory; it is never the editable task root.

`goal_evaluate` accepts `mode: "feedback"` with a concrete `focus` and `artifacts`,
or `mode: "final"` with `artifacts`. Every request creates a fresh native General
evaluator child. It receives the definition, baseline, artifact references,
candidate hashes and relevant unresolved final findings, never the root chat.
Before dispatch, persist the child's read-only evaluator marker in native metadata.
That restriction survives feedback, acceptance and later agent selection. Recovery
marks idle orphan evaluators before releasing the parent to working.
Inspection permissions are explicit; edit, publication, delegation and task side
effects are denied. Enabled Bash is approval-gated verification only and must not
modify product. Approval is not a command allowlist or shell sandbox.
Managed browser inspection uses explicitly read-only operations, not clicks,
uploads, arbitrary page JavaScript or file downloads. Workers retain the managed
browser capability under the existing resource-selection and privacy rules;
file outputs obey exact paths and effectful calls are journaled before dispatch.

Freeze worker mutation before capturing hashes for all policy-editable files and
explicit artifacts. Final evaluation also includes baseline-present inputs/user
work, supplying preservation evidence without a builder-created checksum manifest.
Persist assignment/child identity and recheck
candidate bytes and definition fingerprint before committing the result. Explicit
absence differs from unavailable/symlink evidence. Candidate changes invalidate
the report and require fresh evaluation. Acceptance is bound to the exact stable
candidate; inspection reports whether current bytes still match historical acceptance.

Only the active assigned evaluator can call `goal_verdict`. Checked reports cover
exactly the assigned `cN` keys with boolean `passed` and concrete `evidence`;
passing prior failed final checks needs evidence-backed `resolution`. Actual
inspection/check tools must corroborate evidence collection. Bookkeeping and prose
are not evidence. The protocol cannot guarantee the truth of model judgments or
make synthetic checks establish a required live outcome.

| Result | Next state |
| --- | --- |
| Feedback pass or ordinary failed feedback | `working`, latest feedback retained. |
| Final check failure | `working`, final validation and unresolved findings retained for repair. |
| Model-declared evaluator blocker | `working`, blocker evidence retained for diagnosis; no acceptance or self-declared stop. |
| Stable final pass of every fixed criterion | Terminal `accepted`, accepted candidate retained. |
| Actual user stop, cancellation, denial or unknown effect/dispatch outcome | Durable `paused`; explicit reconciled resumption required. |
| Incomplete evaluator report after protocol correction | `working` with error feedback; no domain stop. |

Report errors are corrected in the same child. The three-report protocol watchdog
returns working/error feedback if correction remains incomplete; it is not a
domain attempt budget and never restarts implementation. Each subsequent evaluation
request gets a fresh independent child. Unresolved final findings survive feedback
passes, reload and repair until explicitly resolved. Accepted state is terminal;
free-text claims and worker-authored artifacts cannot establish or override it.

## Mutation And Control Boundary

`ImmutabilityGuard` combines managed ancestor restrictions and validates the Goal
checkpoint/fingerprint. Root Goal mutations require working state and exact
`edit_paths`; browser screenshot/download/media saves use the same path checks.
The active evaluator may inspect during evaluation but cannot edit. Malformed,
unmarked or changed definitions fail closed.

Protected control paths are `.opencode/`, root `opencode.json`/`opencode.jsonc`,
root `AGENTS.md`, and the actually loaded runtime source directories under its
own source root (`agents/`, `plugins/`, `tools/`, `rules/`, `scripts/`). These names
are not a blanket ban on ordinary task directories elsewhere. Authorized task
scripts/tools remain editable unless they are actual loaded control sources.
Generated workers cannot rewrite their definition. Only selected root Prometheus
or Build may publish. Native and unrelated local agents retain native behavior.
The guard intercepts tool calls, not host filesystem effects of shell commands.

## Goal Activity In The Terminal UI

The separate `plugins/tui/goal-progress.tsx` imports `progress.ts` and reads the
current root's native checkpoint. It displays working/evaluating/paused/accepted
state, evaluation focus and independent feedback/validation as best-effort,
read-only presentation. It carries no authority and cannot resume/accept work.
It uses `app_bottom` without replacing prompts or depending on sidebar width.
Raw commands, credentials, reasoning and tool payloads are not presentation data.
Terminal tests must observe actual rendered state, not only metadata values.

The installer copies both TUI files and merges registration into `tui.json` or
`tui.jsonc`, preserving comments, plugin tuples/settings and disable preferences.
Ambiguous dual configs and symlinked configs fail safely. Removal preserves
customized TUI assets and registration together. `jsonc-parser` remains pinned;
the existing five-file Playwright runtime remains unchanged.

## Installation And Retirement

`scripts/deploy-opencode-agents.sh` supports copy and symlink modes. Plugins and
browser runtime files always install as copies. `install`, `status`, and `remove`
operate under one configuration root. `install` accepts an optional `--backup`
flag; by default without `--backup`, replaced entries are overwritten in place
without creating backup copies under `backups/`.

`PLUGIN_SOURCES` retains only the two flat server plugins. A separate
`GOAL_HELPER_SOURCES` group inventories `plugins/goal/state.ts`, `plugins/goal/evidence.ts` and
`plugins/goal/evaluation.ts` against the nested destination `plugins/goal/`.
The existing basename-based group operation preserves paths through that source
base/destination pairing. Install, status and remove inspect each exact helper;
they never copy/remove the whole directory as an owned asset or flatten helpers
into auto-loaded server entries. Missing/modified helpers make status drift.
Removal preserves modified helpers and unrelated siblings, removing the directory
only if empty. Nested backups follow existing `--backup` behavior. Runtime packages
retain clean staging, pinned versions and integrity checks without altering user
backup policy.

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
