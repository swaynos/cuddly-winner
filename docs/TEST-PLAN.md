# Test Plan

## Required Evidence

| Area | Evidence |
| --- | --- |
| Goal Agent publisher | Unit tests cover one-file rendering, invalid input, recursive local-name collisions, no-clobber behavior, and symlink rejection. |
| Goal Agent guard | Unit tests cover exact paths, trusted profile sources, browser file writers, Bash, managed-ancestor restrictions, root Prometheus/Build publication, malformed policies, legacy-package denial, and browser-state export blocking. |
| Goal runtime | Tests cover fresh builder/validator sessions, child inspection permissions (read, glob, grep, list), validator edit denial, approval-gated shell verification, independent evidence, failed-validation repair, premature-stop continuation, current-session and separate builder/validator model selection, cancellation, permission denial, unknown outcomes, and inherited policy boundaries. A deterministic provider fixture exercises the pinned OpenCode V1 runtime without paid inference. |
| Installation | Integration tests cover the three-agent inventory, exact-match retirement, unconditional retired-publisher purge, customized MCP and rule preservation, prior state, and browser control files. |
| OpenCode discovery | A pinned OpenCode CLI discovers an installed-profile Goal Agent by its task-derived name. |
| Browser runtime | Existing Playwright integration tests cover headless, virtual-display, login handoff, state handling, uploads, downloads, and runtime configuration. |
| Documentation | Tests require the durable browser policy and Goal-Agent contract to agree. |

Goal regression coverage includes six consecutive evidence-free blocker cycles,
malformed completed reports, rejected-input error text, and a real three-cycle
journey (unsupported child orchestration blocker, failed criterion, validation).
Cancellation, actual permission rejection and unknown API outcomes must still
stop without replay.
Regression cases also require bookkeeping and unavailable-tool calls to return
unsupported blockers to repair, failed external-resource inspection to preserve
a terminal blocker, and invalid JSON in completed validator reports to retry.

Run the repository checks with:

```sh
npm test
bash scripts/ci.sh
```

The browser integration suite is deterministic infrastructure coverage. It does
not prove access to a live third-party site or a human's physical login session.
Treat a failed virtual-display fixture as test evidence to investigate, not proof
that the browser runtime is broken.
