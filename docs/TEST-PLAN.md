# Test Plan

## Required Evidence

| Area | Evidence |
| --- | --- |
| Direct publisher | Unit tests cover one-file rendering, invalid input, recursive local-name collisions, no-clobber behavior, and symlink rejection. |
| Direct guard | Unit tests cover exact paths, trusted profile sources, browser file writers, Bash, managed-ancestor restrictions, root Prometheus/Build publication, malformed policies, legacy-package denial, and browser-state export blocking. |
| Direct goal | Tests cover fresh builder/validator sessions, child inspection permissions (read, glob, grep, list), validator edit denial, approval-gated shell verification, independent evidence, failed-validation repair, premature-stop continuation, model selection, cancellation, permission denial, unknown outcomes, and inherited policy boundaries. A deterministic provider fixture exercises the pinned OpenCode V1 runtime without paid inference. |
| Installation | Integration tests cover the three-agent inventory, exact-match retirement, customized MCP and rule preservation, prior state, and browser control files. |
| OpenCode discovery | A pinned OpenCode CLI discovers an installed-profile Direct agent by its task-derived name. |
| Browser runtime | Existing Playwright integration tests cover headless, virtual-display, login handoff, state handling, uploads, downloads, and runtime configuration. |
| Documentation | Tests require the durable browser policy and Direct-only contract to agree. |

Run the repository checks with:

```sh
npm test
bash scripts/ci.sh
```

The browser integration suite is deterministic infrastructure coverage. It does
not prove access to a live third-party site or a human's physical login session.
Treat a failed virtual-display fixture as test evidence to investigate, not proof
that the browser runtime is broken.
