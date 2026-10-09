# Test Plan

## Required Evidence

Goal visibility requires `tests/integration/goal_tui.test.mjs`: the pinned CLI,
an isolated deterministic provider, real Linux PTYs at80x24 and60x24, and observed
screen updates while `goal_cycle` remains running. Cover both child phases,
permission waits, repair cycles, completion, cancellation, reconnect hydration,
native Build/Plan prompt usability and no raw child-output leakage. Unit tests
also cover bounded metadata, deduplication, active-child authorization, late
events and exclusion of `goal_progress` from validation evidence. Installer
tests cover TUI JSONC registration/removal, disabled preferences and modified
asset preservation. `@xterm/headless` is a test-only screen emulator; it is not
a browser backend or a replacement for running the actual TUI.

To check the same journey against an already-installed CLI as well as the pinned
default fixture:

```sh
OPENCODE_TUI_TEST_CLI="$(command -v opencode)" node --test tests/integration/goal_tui.test.mjs
OPENCODE_GOAL_TEST_CLI="$(command -v opencode)" node --test tests/integration/goal_runtime.test.mjs
```

The visibility implementation passed this journey on OpenCode1.18.31 and the
user's1.18.35 installation. Each run isolates HOME/XDG configuration and model
traffic to deterministic localhost fixtures; it does not execute an image loop.

| Area | Evidence |
| --- | --- |
| Goal Agent publisher | Unit tests cover one-file rendering, invalid input, recursive local-name collisions, no-clobber creation, inspection, same-name fingerprint-bound revision, stale/concurrent updates, and symlink rejection. |
| In-run prerequisites | Publisher and runtime prompt-contract tests cover builder ownership of preparation, direct authorized continuation, durable reuse/invalidation guidance, independent readiness checks on fresh cycles, and preparation-only/scaffolding-only limits. These verify instructions delivered to agents, not autonomous task execution or a dependency scheduler. |
| Builder handoff | Metadata-only, honest zero-progress, missing/malformed readiness, role isolation, observed blockers, fresh continuation and mixed-attempt/reload bounds. The real CLI provider deliberately returns after metadata-only work without a handoff; no validator starts until a fresh builder implements, inspects and records readiness. This is deterministic orchestration evidence, not a guarantee of autonomous model compliance. |
| Admission and convergence | Runtime tests cover pre-child mismatch/missing-admission stops, user handback, criterion-specific repair hypotheses, immutable task bounds, identical findings, changing evidence under the same key, and failed-finding continuity after non-progress. The real CLI fixture covers mismatch with zero children and a two-cycle non-progress stop. |
| Initial attribution | A tiny local Git fixture covers an initial intentional deletion, untracked input hashes, byte preservation and a newly caused out-of-scope mutation. Interrupted metadata retains the original baseline and admission after reload. Missing historical evidence remains terminal. |
| Executable service contract | A temporary implemented runner exercises injected synthetic submission with zero live calls, then authorized localhost HTTP submissions, preparation readiness, failed review, targeted repair and accepted-byte preservation. This verifies a deterministic service contract, not GPU generation, actual model judgment or live visual quality. |
| Goal Agent guard | Unit tests cover exact paths, trusted profile sources, browser file writers, Bash, managed-ancestor restrictions, root Prometheus/Build publication, malformed policies, legacy-package denial, and browser-state export blocking. |
| Goal runtime | Tests cover fresh builder/validator sessions, child inspection permissions (read, glob, grep, list), validator edit denial, approval-gated shell verification, independent evidence, failed-validation repair, premature-stop continuation, current-session and separate builder/validator model selection, cancellation, permission denial, unknown outcomes, and inherited policy boundaries. A deterministic provider fixture exercises the pinned OpenCode V1 runtime without paid inference. |
| Installation | Integration tests cover the three-agent inventory, exact-match retirement, unconditional retired-publisher purge, customized MCP and rule preservation, prior state, and browser control files. |
| OpenCode discovery | A pinned OpenCode CLI discovers an installed-profile Goal Agent by its task-derived name. |
| Browser runtime | Existing Playwright integration tests cover headless, virtual-display, login handoff, state handling, uploads, downloads, and runtime configuration. |
| Documentation | Tests require the durable browser policy and Goal-Agent contract to agree. |
| Live Goal activity | A real pinned OpenCode TUI renders builder and validator milestones before completion at 80 and 60 columns, permission waiting, failed repair, validated completion, reattach, native prompt entry and cancellation. Installer tests preserve TUI settings and modified assets. |

Goal regression coverage includes six consecutive evidence-free blocker cycles,
malformed completed reports, rejected-input error text, and a real three-cycle
journey (unsupported child orchestration blocker, failed criterion, validation).
The repeated-blocker fixture explicitly admits a larger bound to verify ordinary
protocol repair. Separate fixtures verify automatic stopping at smaller
task-specific bounds. Before initial admission, idle does not create a cycle.
Repeated coordinator completion attempts without a repair also reach the stalled
bound. History prevents unbounded continuation prompts after runtime reload.
Cancellation, actual permission rejection and unknown API outcomes must still
stop without replay.
Regression cases also require bookkeeping and unavailable-tool calls to return
unsupported blockers to repair, failed external-resource inspection to preserve
a terminal blocker, and invalid JSON in completed validator reports to retry.
Finding-continuity tests reject unrelated passing evidence until the exact prior
failure has an explicit resolution. Submission-time rejection lets the active
validator correct the resolution without a silent rewrite or another builder
cycle. Child prompt checks ensure the baseline and previous results are not
duplicated, and executor tests enforce advertised bounds even without schema
validation by the bridge. Changed definitions invalidate previous success
and guard permissions across reload. Offline executable-continuation fixtures use
simulated outcomes and byte comparisons to prove targeted repair preserves an
accepted region, premature completion resumes, and actual acceptance stops. They
perform no uploads or generation and do not prove an external product's live loop.
The terminal journey retains the latest failed verdict and repair reason during
the next independent check. An artifact saying `pending` cannot override that
verdict. Interruption tests distinguish observed permission denial, child abort
and unknown transport outcomes. Visual acceptance still needs fresh live output
bytes, native-coordinate inspection and independent per-dimension evidence.

Run the repository checks with:

```sh
npm test
bash scripts/ci.sh
```

The browser integration suite is deterministic infrastructure coverage. It does
not prove access to a live third-party site or a human's physical login session.
Treat a failed virtual-display fixture as test evidence to investigate, not proof
that the browser runtime is broken.
