# Test Plan

To qualify the installed runtime copies in a fresh isolated process after deployment:

```sh
OPENCODE_GOAL_RUNTIME_ROOT="$HOME/.config/opencode" OPENCODE_GOAL_TEST_CLI="$(command -v opencode)" node --test --test-name-pattern="persistent primary Goal" tests/integration/goal_runtime.test.mjs
```

This verifies loaded installed code without restarting another active conversation.

## Persistent-Worker Contract

The current contract is `persistent-worker-v1`: a persistent root Goal implements
directly, continues partial work in the same conversation and requests fresh
independent feedback/final evaluation. Test this deliberate replacement of the
retired coordinator/fresh-builder contract. Do not weaken substantive permission,
evidence, attribution, recovery, installer or native-compatibility assertions to
accommodate a runtime failure.

| Area | Required evidence |
| --- | --- |
| Publisher | One-file schema-v1 policy and runtime marker, root editing, boolean Bash `ask`/deny, optional `validator_model`, no `builder_model`, recursive name collisions, no-clobber creation, exact-byte inspection, fingerprint-bound revision, stale/concurrent update and symlink rejection. |
| Persistent root | Root writes directly with the chosen model; preparation and partial returns automatically continue in the same session with zero builder children. Failed experiments/checks, repeated impossible claims and unsupported model pauses keep looping without cycles or stall/time/token/attempt quotas. A genuinely contradictory Goal remains working until actual user cancellation. |
| Native checkpoint transport | Real pinned CLI supported V2 `session.update` preserves `metadata.cuddly_winner_goal` and unrelated metadata through real compaction, SIGKILL and restart. Same authenticated transport must work; fake metadata/part updates alone are insufficient. |
| Admission | Start precedes mutation, preserves the original completion target/authorized actions/baseline on repeated calls and reload, and cannot expand permissions. Missing/invalid admission fails closed. |
| Authority and compaction | Summaries retain findings/context but cannot replace metadata, implicitly resume a pause or establish acceptance. A single dispatcher prevents duplicate continuation after compaction. UI errors cannot determine control persistence. |
| Independent feedback | Each request creates a fresh evaluator with focus/artifacts and no root chat. Feedback pass remains working and does not clear unresolved final findings. Failed feedback reaches the same worker for repair. |
| Final evaluation | Exact fixed criterion evidence, actual inspection tools, explicit resolutions for prior failures, all-policy-file plus explicit-artifact hash binding, definition recheck, candidate change rejection, terminal final acceptance and current-byte inspection after acceptance. |
| Evaluator protocol | Only the active evaluator can submit `goal_verdict`; no worker self-verdict, edit, delegation or publication. Correct invalid reports in the same child. Three-report protocol watchdog returns working/error feedback rather than a domain stop or fresh implementation attempt. |
| Recovery | Actual user stop, cancellation, denial, unknown pending side effects, unknown evaluator interruption and uncertain continuation dispatch persist paused. Safe known model/protocol errors return to the same working loop. Restart and status questions do not replay/resume. Explicit user resume with `reconciled=true`, unchanged definition and old-evaluator inactivity preserves original authority, baseline and findings; handled user stops cannot re-pause a resumed worker. |
| Predecessor inspection | Existing inspect operation reads native status only for the same task/project/worktree, before or after admission. Verify no metadata writes, baseline/chat/private-data exposure (including include_baseline=true), foreign access, inherited authority or predecessor resumption. Busy/retry/working roots, uncertainty, unverified children and API failures block; marked historical read-only evaluators do not. Real CLI fixture reproduces the originally failed pre-start baseline request and reaches scoped implementation/independent acceptance without database access. |
| Prometheus execution journey | Load the real Prometheus agent, publish through the native tool, restart, select the new scaffold, fail independent evaluation, make an invalid resume call, repeatedly declare the outcome impossible and request unsupported pauses. The root automatically continues without human rescue, repairs and obtains fresh independent final acceptance. No product writes during planning. |
| Tool failure outcomes | Native patch preflight/empty/missing-text errors clear only the matching active action after acknowledged persistence, permit same-worker correction and automatic partial-return continuation without a Question/resume. Reproduce malformed patches, mismatched context and a multi-file patch with a valid early hunk and invalid later hunk using the real native tool. Verify no files changed, stable original authority/baseline, a successful corrected patch and fresh final acceptance. Other-tool lookalike errors, non-preflight/partial effects, failed cleanup acknowledgment, cancellation and denial remain fail-closed. |
| Resource intent/receipts | User-authorized ceilings are task-owned, not copied into immutable definitions/admission. Existing domain evidence records amendments and retains consumption and uncertainty. Amendments within permissions and unchanged acceptance use the same worker/resume; widened output paths require republication. No runtime budget tool, automatic reset, default quota or shell-hard-limit claim. |
| Initial attribution | Read-only native Git status, exact file hashes, intentional deletions, pre-existing untracked inputs and newly caused out-of-scope changes. Missing evidence remains unavailable; never restore user work or infer authorship from dirty status alone. |
| Guard | Root exact edit paths, working checkpoint/fingerprint, managed ancestry, browser file writers, Bash approval, evaluator read-only boundary, root Prometheus/Build publication and fail-closed malformed/old markers. Protect actual control paths and loaded sources while permitting ordinary authorized task scripts/tools. |
| Legacy | Old marker absent/different and historical coordinator records fail closed, requiring explicit republication/restart/fresh conversation without resetting historical stops or budgets. No migration/compatibility runtime. |
| Installation | Three agents, two flat server plugins, three individually copied nested Goal helpers, two TUI assets, publisher/rule/reference and five browser files. Copy/symlink modes, helper drift, exact removal ownership, modified/unrelated sibling preservation, nested backups and unsafe-parent rejection. Preserve clean runtime staging/integrity and existing retirement behavior. |
| OpenCode discovery | Pinned CLI discovers the task-derived Goal name and exposes `goal_run`/`goal_evaluate` to the worker, evaluator-only `goal_verdict`, and no retired cycle/handoff tools. |
| Native compatibility | Native Build/Plan prompts and execution remain unchanged; same-conversation historical Goal inspection is available without authorizing Goal mutation. Unrelated agents remain native. |
| Documentation | Durable docs assert the persistent root, supported metadata API, independent candidate-bound acceptance, explicit recovery and narrow control boundary; replaced old contract assertions remain substantively enforced. |

## Goal Visibility

`tests/integration/goal_tui.test.mjs` uses the actual pinned CLI, isolated
deterministic provider and Linux PTYs at 80x24 and 60x24. Observe terminal state
while work/evaluation remains in flight, independent feedback, final acceptance,
pause/cancellation and reconnect hydration. Preserve prompt usability, narrow
terminal visibility and session isolation. Metadata-only/final transcript checks
do not prove rendering, and rendering does not prove control persistence.

The TUI reads native checkpoint state as best-effort presentation. Installer tests
cover JSONC registration/removal, disabled preferences and modified asset
preservation. `@xterm/headless` is test-only, not a browser backend.

To qualify the same journey against an installed CLI as well as the pinned fixture:

```sh
OPENCODE_TUI_TEST_CLI="$(command -v opencode)" node --test tests/integration/goal_tui.test.mjs
OPENCODE_GOAL_TEST_CLI="$(command -v opencode)" node --test tests/integration/goal_runtime.test.mjs
```

## Verification Entry Points And Qualification

Focused installer/documentation verification after the persistent runtime and
nested helpers are present:

```sh
node --test tests/integration/profile_deploy.test.mjs
```

Runtime changes require their own focused plugin and real CLI/TUI qualification.
The profile-deploy suite verifies inventory, lifecycle and durable documentation;
it does not independently prove persistent runtime execution, authenticated
metadata transport, compaction, model judgment or live domain success.

Focused tool-failure verification and installed-copy qualification:

```sh
node --test tests/plugins/goal.test.mjs
node --test --test-name-pattern="persistent Goal recovers from native patch verification failures" tests/integration/goal_runtime.test.mjs
OPENCODE_GOAL_RUNTIME_ROOT="$HOME/.config/opencode" OPENCODE_GOAL_TEST_CLI="$(command -v opencode)" node --test --test-name-pattern="persistent Goal recovers from native patch verification failures" tests/integration/goal_runtime.test.mjs
```

The CLI fixture uses an isolated deterministic localhost provider with a
`gpt-fixture` model ID to expose OpenCode's native `apply_patch`; it does not
replace the tool or call a paid model. This verifies real tool/error/checkpoint
and continuation behavior in a fresh process without resuming an active task.
Source/installed tests do not activate a fix in already running OpenCode servers;
restart those servers after deployment. Historical paused runs are not silently
resumed by the fix.

Focused persistent-recovery and full publication journey:

```sh
node --test tests/plugins/goal.test.mjs tests/plugins/publish_goal_agent.test.mjs
node --test --test-name-pattern="Prometheus publishes a fresh scaffold|genuinely impossible Goal|native predecessor inspection" tests/integration/goal_runtime.test.mjs
OPENCODE_GOAL_RUNTIME_ROOT="$HOME/.config/opencode" OPENCODE_GOAL_TEST_CLI="$(command -v opencode)" node --test --test-name-pattern="Prometheus publishes a fresh scaffold|genuinely impossible Goal|native predecessor inspection" tests/integration/goal_runtime.test.mjs
```

These use the real CLI/tools and an isolated deterministic, deliberately mistaken
model provider. They verify executable persistence and native cancellation, not
the quality or eventual success of an arbitrary model or live domain task. Twelve
failed contradictory evaluations and eight rejected self-pauses are test observations,
not runtime limits. Prometheus publishes only; its worker starts once and loops.
The mistaken worker also tries to open an unnecessary `Resume Goal` Question;
verify rejection without a human popup or pause, while real paused handback remains
fully covered by native Question/compaction tests.

Qualification (2026-10-12): focused Goal/publisher tests passed 129 checks;
`npm test` passed 265 tests with one existing authenticated-provenance skip.
All three publication/impossible-outcome/predecessor journeys also passed against
the installed runtime using OpenCode 1.18.35. Deployment used `install --backup`;
the installer reported the managed profile current. Already running servers still
need restarting before they load these changes.

Repository-wide verification, when authorized for the full implementation:

```sh
npm test
bash scripts/ci.sh
```

`scripts/ci.sh` checks Node, installs into an isolated temporary config, runs the
suite, checks status and removes the isolated profile. Report actual commands and
results; documentation of an entry point is not a claim it was run or passed.

## Browser Runtime

Existing Playwright integration tests cover headless, virtual-display, login
handoff, state handling, uploads, downloads and runtime configuration. The browser
integration suite is deterministic infrastructure coverage. It does not prove
access to a live third-party site or a human's physical login session. Treat a
failed virtual-display fixture as test evidence to investigate, not proof that
the browser runtime is broken. The existing five-file runtime is unchanged.

## Evidence Limits And Historical Results

Scripted-provider CLI/TUI journeys verify real orchestration/display mechanics,
not sustained real-model judgment. A real-model smoke run, if authorized, uses a
disposable local task and independent final evaluation; any resource ceiling must
be explicit user authority. Review transcripts and actual artifacts separately.
Offline tests cannot substitute for a requested external live outcome or visual
quality in fresh native-coordinate image evidence.

The 2026-10-10 OpenCode 1.18.35 `openai/gpt-6.1-sol` smoke for the retired
coordinator contract implemented a disposable counter and obtained a separate
builder handoff/validator verdict within its original three-cycle allowance.
Its recorded builder `ses_edbaa8e64ffene9N044YY2mi23`, validator
`ses_edbaa1533ffeeGXp1WY1TkucDL` and temporary evidence path
`/tmp/opencode/goal-real-smoke-tANWCk/` are historical references only. They do not
qualify `persistent-worker-v1`, authorize resetting historical stops/budgets or
prove a separate live domain outcome. Unavailable historical evidence cannot be
recreated as current acceptance.

### 2026-10-11 UTC: Authenticated Persistent-Worker Trials

Two fresh disposable trials passed with installed OpenCode **1.18.35** and actual
`openai/gpt-6.1-sol` for both workers and independent evaluators. Commands run:

```sh
node --check /tmp/opencode/goal-persistent-real-trials.mjs
node /tmp/opencode/goal-persistent-real-trials.mjs
node /tmp/opencode/goal-persistent-real-trials.mjs --inspect /tmp/opencode/goal-persistent-real-trials-eNcA1d
```

Evidence root: `/tmp/opencode/goal-persistent-real-trials-eNcA1d/`; both
`summary.json` and post-run `inspection-summary.json` record `passed: true`.

| Task | Root | Feedback child (`c0: false`) | Fresh final child (`c0`, `c1`: true) | Executed cases / elapsed |
| --- | --- | --- | --- | --- |
| Tag normalization | `ses_ed71d82afffepJDv03zLqQdbdJ` | `ses_ed71d5819ffeLWep9jw5RFsDgc` | `ses_ed71c925affefff47hviEOG5mN` | 12/12; 94.516 s |
| Pagination/selection | `ses_ed71c13ecffeab0O4tYkca53Mo` | `ses_ed71bd7d6ffezW2BPkdeVq2b7m` | `ses_ed71b0defffew5VhZoRoqY6wJy` | 9/9; 100.309 s |

Each trial records failed real-source feedback, a partial return, synthetic native
continuation in the same worker, root-attributed repair, and fresh final source
reads/localhost execution with nonempty criterion evidence. The deterministic
service executes current JavaScript in `vm.Script` with a 100 ms timeout; results
are not scripted by turn count. Session checkpoints record terminal `accepted`.
Full artifact bytes match accepted hashes; `README.md` and the pre-existing binary
file retain their initial bytes. Only the two policy-editable task files changed.
Pre-prompt bootstrap attribution permits only known CLI-generated dependency,
manifest, ignore and schema-only config paths; worker mutation receipts are checked
separately without those exclusions. Transcripts, tool receipts, executions,
checkpoints and artifact inspections reside in each task's `evidence/` directory.

The prior normalization root `ses_ed725b644ffevQpURGox6bZqey` remains an unresumed
historical pause, recorded under `/tmp/opencode/goal-persistent-real-trials-HQFL8v/`.
Its final evaluator `ses_ed7248822ffeHIz7S2EgSWa7Bk` passed behavior but failed
preservation evidence. Checkpoint reason excerpt: "current README.md full-byte
size/SHA-256 is unavailable through permitted tools." The diagnosis was missing
current input-hash binding, not incorrect executable behavior. The updated runtime
captures initially present baseline files alongside policy-editable and explicit
artifacts for final checking; these fresh trials also explicitly declare
`README.md`, retaining preservation criteria without a builder checksum manifest.

Each trial used isolated XDG config and existing authentication outside the
repository, with default auth plugins enabled. Disposable configs were mode 0600
and copied provider configuration was stripped after execution. Loaded runtime
sources remained hash-identical. The user-authorized five-minute deadline applied
only to each experiment; neither timed out. No `npm test` was run. These two
observed journeys prove the recorded real-model behavior and hash-bound outcomes,
not universal model compliance, baseline-only fallback inclusion, compaction,
restart recovery, TUI rendering or unrelated live-domain success.

### 2026-10-11 UTC: Final Installed-Copy Real-Model Qualification

Ran each of the two fresh trials once using installed OpenCode **1.18.35** and
actual **`openai/gpt-6.1-sol`** for both roots and all evaluators. Runtime source
root was **`/home/bendy/.config/opencode`**: disposable task symlinks resolved to
installed copies of the Goal, guard, publisher and all three nested helpers,
not repository runtime sources. Installed publisher bytes matched the repository
publisher hash. Exact installed SHA-256 values, unchanged before/after both runs:

| Installed relative path | SHA-256 |
| --- | --- |
| `plugins/goal.ts` | `a802c3ed0593b804c60a8a411e68fc1dfb97e9079265b0e5286d8e8186980d9c` |
| `plugins/immutability.ts` | `5170b6c576672474f97c1a2d1c6c028cfc96c5fbb75eb4b05a195a64823db232` |
| `plugins/goal/state.ts` | `c8ce071f931ac4a8efc8c0ac0cddbe0e8a2737cee0e5190c2ebc0da878e76071` |
| `plugins/goal/evidence.ts` | `4f3268bd290d8b70c66dcbc9c10b37ac1f005db1f690a86332cd4d63ee888da0` |
| `plugins/goal/evaluation.ts` | `28473ecc8f8c5499bd20b45477352e6cb10e68cadc0e1520a407956370453237` |
| `tools/publish_goal_agent.ts` | `28fc2eda67833aa8be4fb18df36973d0f4a28991a85df6944e71eb57fd24eac8` |

Evidence: `/tmp/opencode/goal-persistent-real-trials-vMrYPM/`. Live `summary.json`
and offline `inspection-summary.json` both record `passed: true`; the latter
records two complete independent final verdicts. Commands actually run:

```sh
node --check /tmp/opencode/goal-persistent-real-trials.mjs
node /tmp/opencode/goal-persistent-real-trials.mjs
node /tmp/opencode/goal-persistent-real-trials.mjs --inspect /tmp/opencode/goal-persistent-real-trials-vMrYPM
```

| Task | Root | Failed-feedback child | Accepted-final child | Executed cases / elapsed |
| --- | --- | --- | --- | --- |
| Tag normalization | `ses_ed6857b45ffetWHGKy5MacJ6hr` | `ses_ed6854e62ffeFpsNOJPpneOrCm` | `ses_ed68497faffeAoSoweju7suS1U` | 12/12; 92.545 s |
| Pagination/selection | `ses_ed6841450ffeFStbIsSZ4zyxzQ` | `ses_ed683dc20ffekVWTI4tkZYssgR` | `ses_ed682e3dcffejX1IHClnitCLcO` | 9/9; 122.404 s |

Both seeded sources genuinely failed executable cases. Independent feedback
reported `c0: false` (seven normalization failures; six pagination failures), then
each root returned partial progress and automatically continued in the same
conversation. Root-attributed repairs passed actual `vm.Script` execution before
fresh independent final source reads/execution accepted `c0` and `c1` with nonempty
evidence. Each terminal checkpoint is `accepted`; all artifact sizes/hashes match
current full bytes, and `README.md` plus unrelated binary work preserve initial
bytes. Final artifacts explicitly include `README.md`; preservation criteria and
initial-present-file binding remain intact without a builder checksum manifest.

Each task's `evidence/` contains native transcripts/events, tool receipts,
checkpoints, executions, artifact validation and `evaluator-role-audit.json`.
All four child `cuddly_winner_evaluator` parent/definition-hash markers were
persisted before their prompt events and retained after evaluation. Recorded child
permissions were read-only; no evaluator edits or builder children occurred.
Bootstrap attribution admitted only known CLI-generated paths before dispatch;
worker mutations were independently confined to the exact two policy edit paths.

Temporary roots/config directories were 0700; disposable configs were 0600 and
copied provider configuration was stripped after execution. Standard auth plugins
used existing authentication outside repositories. No normal-profile configuration
or runtime edits, old paused-session resumption, or `npm test` run occurred.
Neither trial reached its experiment-only five-minute deadline. These results
qualify the two recorded installed-copy real-model journeys, not universal model
compliance, restart persistence of evaluator roles, native Question confirmation,
baseline-only fallback inclusion, compaction, TUI behavior or unrelated live goals.
