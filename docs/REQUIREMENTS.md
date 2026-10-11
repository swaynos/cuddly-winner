# Requirements

## Product Goal

Provide a lightweight optional OpenCode profile for evidence-backed planning and
a persistent named Goal worker. Native Plan and Build remain fully usable without
a specialist handoff or altered behavior. Build additionally exposes
`publish_goal_agent`. Profile behavior stays within its intended surfaces and
does not claim command sandboxing.

## Definition And Publication

The managed profile ships exactly `ask`, `grounder`, and `prometheus`. Ask and
hidden Grounder are read-only. Prometheus is planning-only: it may research,
clarify decision-changing uncertainty and invoke `publish_goal_agent`, but may
not implement, edit project files or use Bash. Root Build may also publish.

There is exactly one Goal Agent format:
`.opencode/agents/generated/<task-derived-name>.md`. Its schema-v1 embedded policy
declares exact canonical worktree-relative `edit_paths` and boolean `bash`.
Frontmatter `options.goal.runtime` must equal `persistent-worker-v1`, and
`options.goal.criteria` supplies fixed acceptance criteria. The worker uses its
selected root model; optional `validator_model` selects a verified evaluator
model. The `builder_model` parameter is removed.

Creation is no-clobber. Inspect existing definitions before publishing; revisions
require a complete definition and the inspected `expected_sha256`. Reject stale,
concurrent, colliding, malformed and symlinked updates. Restart OpenCode and use
a fresh conversation after publication or revision. Changed definitions cannot
reuse prior authority, permissions or acceptance.

Published instructions lead with the actual finish line, existing authority,
starting evidence and current gap, first productive obligation, minimum
prerequisites and direct continuation. Criteria require implementation/artifacts
and independent evidence, not merely inspection. Distinguish preparation-only,
executable behavior verified offline and an authorized live outcome. Label missing
verification commands as implementation obligations. Reconcile stale instructions
without manufacturing unavailable historical evidence.

Preparation belongs to the worker: prepare missing/stale prerequisites, verify
readiness and proceed into authorized work. Reuse verified preparation; refresh
affected inputs and invalidate dependent evidence while preserving unaffected
work and history. Optional dependencies must remain optional. Scaffolding-only
scope verifies the transition without unauthorized live execution.

## Persistent Root Worker

The selected Goal Agent implements directly in its root conversation. Creative
exploration, experiments, diagnosis and repair continue in that same session.
Partial returns, failed experiments and failed checks automatically continue
while the run is working. There are no fresh builder sessions, build/validation
cycles, stall quotas or arbitrary default time, token or attempt limits.

`goal_run` provides `start`, `inspect`, `pause`, and `resume`. Call
`goal_run(operation="start", completion_target=..., authorized_actions=...)`
once before mutation. These record the interpretation of existing user authority,
not new permissions. Repeated
start cannot replace the original authority or baseline. Changed target or
authority requires fingerprint-checked publication and a fresh loaded conversation.

Only explicit user resource ceilings belong in task instructions. Task-owned
domain intent/receipt evidence must account for authorized actions, consumption
and uncertain outcomes, preserving historical budgets rather than resetting them.
The runtime does not claim shell sandboxing or hard enforcement of these ceilings.
Transport/protocol safeguards are not domain progress or resource quotas.

Recoverable tool failures with a verified no-effect outcome do not require a new
`Resume Goal` authorization. Native `apply_patch` parsing/verification failures,
empty patches and missing patch text occur before its file-write phase; clear only
the matching tracked action after persisting that outcome, and allow correction
in the same working session. Confirmed immutability-guard rejections also remain
no-effect failures. This classification is scoped to the actual tool and pending
call identity, not arbitrary error text or a worker's assertion. Other tool errors
may follow partial local or external effects and must retain unknown-action
reconciliation. A no-effect receipt never clears an independent cancellation,
denial or existing pause, and a failed checkpoint update cannot authorize work.

## Durable State And Recovery

Native `session.metadata.cuddly_winner_goal` is the authoritative checkpoint,
persisted through the supported V2 API using the same authenticated client.
It records `runtime_contract: 'persistent-worker-v1'`, agent,
`definition_sha256`, state (`working`, `evaluating`, `paused`, `accepted`),
original `completion_target`/`authorized_actions`, `initial_worktree` baseline,
`pending_actions`, `continuation`, `evaluation`, `feedback`, `validation` and
unresolved `findings`. Accepted state additionally binds the accepted candidate.
Preserve unrelated session metadata. Persistence failure cannot authorize work.
No task registry, manifest, alternate checkpoint file or compatibility layer exists.

Before mutation, capture a baseline with native read-only Git status and hashes
of policy paths, durable context and observed dirty paths. Never stage, commit,
restore, clean or require a clean worktree. Preserve user changes and intentional
deletions. Untracked does not imply created by the run. Missing baseline bytes,
capture limitations, prior history and concurrent authorship remain explicit
uncertainties; a later snapshot cannot invent them.

Compaction summaries preserve useful context but are not authority. Metadata
retains admission, baseline, findings and uncertainty through compaction/reload.
Best-effort UI or tool-part updates are presentation only; control persistence
must not depend on them. The single same-session continuation dispatcher must
not duplicate native compaction continuation or expand authorized actions.

Cancellation, actual permission denial, genuine blockers, interrupted evaluation
and unknown side effects persist as paused. Restart must not automatically replay
actions. Inspect actual receipts and child evidence before resumption. An unknown
continuation dispatch is not safe to resubmit blindly. Resume requires explicit
user resumption, `goal_run(operation="resume", reconciled=true)`, an unchanged
definition and verified inactivity of old evaluators. Status questions, synthetic
continuation and compaction summaries never implicitly resume a pause.
Fresh native Question confirmation also works without a new chat message: require
the explicit `Resume Goal` header/offered option, a single structured `Resume Goal`
answer and completion after the fixed `paused_at` boundary. A newer negative answer
overrides older chat authorization. Native compaction may finish handling a fresh
human request, but task mutation remains paused until explicit reconciled resume.
Original pre-pause authorization cannot be reused. Inspection can return the original
baseline with `include_baseline=true`; normal status does not repeat that payload.

Inspection reports the loaded runtime contract, selected/historical identity,
definition match, state, authority, pending activity, feedback, validation and
findings. The same conversation remains inspectable after switching to Build/Plan
without changing native execution. Inspection starts no work and clears no pause;
it may record a pause upon detecting interrupted/unknown activity. An unstarted
Goal has no inferred admission. Accepted-candidate inspection distinguishes
historical acceptance from whether current bytes still match.

## Independent Feedback And Final Evaluation

Worktree-relative policy lookup must not be bypassed by starting OpenCode in a
subdirectory. Use its enclosing worktree; for the global/non-Git filesystem-root
sentinel use the active directory instead.

`goal_evaluate(mode="feedback", focus=..., artifacts=[...])` obtains a fresh
independent evaluation of the stated focus. `goal_evaluate(mode="final",
artifacts=[...])` checks every fixed acceptance criterion. Each request creates
a fresh evaluator; it receives the definition, baseline, candidate hashes,
artifact references and relevant unresolved findings, never the root chat.
Evaluators inherit the selected worker model unless `validator_model` overrides it.

Only the active evaluator may call `goal_verdict`. It must obtain actual
inspection/check evidence and supply exactly the assigned `cN` checks, boolean
results and concrete evidence. Passing a previously failed final criterion
requires an evidence-backed `resolution` of its unresolved findings. Unrelated
passing tests cannot resolve them. Synthetic/offline checks cannot establish
required live quality or execution. Missing required historical evidence is a
genuine blocker, not evidence that repetition can manufacture.

Evaluation freezes worker mutation and binds the candidate to hashes of all
policy-editable files and explicit artifacts. Final evaluation also includes
baseline-present inputs/user work. The evaluator receives current hashes without requiring a worker-created
checksum manifest. Freeze mutation before snapshot capture. Recheck the definition fingerprint
and candidate bytes before accepting a report. Missing files are explicit absence;
unavailable/symlink evidence cannot silently establish acceptance. A changed
candidate needs fresh evaluation. A final pass transitions to terminal `accepted`;
a feedback pass remains `working`. Ordinary failed checks return findings to the
same worker for diagnosis and repair; only observed genuine stops pause work.

Report errors are corrected in the same evaluator child. A three-report protocol
watchdog returns to `working` with error feedback if reporting remains incomplete;
it is not a domain-attempt, cycle or stagnation stop. Transport interruption,
cancellation, denial and unknown outcomes retain the pause/reconciliation rules.
Free-text completion and worker-owned artifacts cannot override final validation.

## Permissions And Control Boundary

Root editing is allowed only at exact policy paths while working with the matching
checkpoint. Boolean Bash access is `ask` when enabled and denied otherwise.
Approval-gated shell access is neither a command allowlist nor a shell sandbox;
the guard intercepts tools, not arbitrary host filesystem effects of shell commands.
Browser tools that save screenshots, downloads, or media locally obey the same
exact edit-path policy as edit tools.

Protect actual control files: `.opencode/`, root `opencode.json`/`opencode.jsonc`,
root `AGENTS.md`, generated definitions and the loaded runtime's own source
directories. Ordinary task directories named `scripts/`, `tools/`, `agents/`,
`plugins/` or `rules/` are not protected merely by name. Exact authorized task
paths in them remain editable unless they are the actually loaded runtime sources.
Managed ancestor restrictions cannot be loosened by descendants. Evaluators are
read-only, cannot delegate/publish or submit task side effects; permitted shell
verification must not mutate product. Only root Prometheus or Build may publish.
Native and unrelated agents remain outside Goal policy.

## Legacy Retirement

Old packages and old Goal definitions with an absent or different runtime marker
fail closed until explicitly republished. Restart and use a fresh conversation;
there is no migration, alias or compatibility execution path. Historical stops,
limits and task budgets remain preserved evidence, never automatically reset.
The retired registry, manifest, brief, task-loop, Ralph, optimization, KPI,
Reviewer, spike, skill, feedback, session-fetch and announce-hygiene systems must
not be reintroduced. This does not prohibit user-requested automation elsewhere.

## Goal Progress Visibility

The separate TUI surface reads native checkpoint state and independent feedback/
validation as best-effort presentation. It cannot authorize continuation, clear
pauses or establish acceptance. Preserve native prompts, session isolation, user
themes/keybindings, JSONC comments, plugin options and disable preferences.
Verify actual terminal rendering separately from metadata persistence. UI failure
must not become control-state loss. Restart OpenCode after deployment.

## Browser Runtime

`rules/resource-selection.md` owns workflow precedence and shared safeguards.
Managed runtime procedures live in the on-demand `docs/RESOURCE-SELECTION.md`,
deployed beside the rule without inclusion in always-loaded instructions.

## Installation Safety

Deploy two server plugins and the individually inventoried nested helpers
`plugins/goal/state.ts`, `plugins/goal/evidence.ts` and `plugins/goal/evaluation.ts`
as copies in both modes. State transitions remain pure; filesystem/Git evidence
collection is a separate read-only module.
The helpers are imports, not auto-loaded plugins. Status detects missing/modified
helpers; removal removes only exact copies or repository-target links, preserving
modified helpers and unrelated siblings. Never recursively own the whole nested
directory. Existing runtime clean-staging and integrity checks remain required.

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
