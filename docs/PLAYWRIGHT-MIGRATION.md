# Playwright Browser Migration

## Purpose

This migration is complete in source, tests, runtime prompts, and the managed
profile. The durable requirements describe the resulting behavior.

The system has one browser backend: Playwright. Task execution uses the configured
headless or virtual-display mode. Virtual-display mode runs headed Chrome/Chromium
under Xvfb. A separate visible window lets a person complete a required login.

This migration also removes the provider-specific browser image experiment.
Replacement browser features and tests must use generic sites, fixtures, names,
prompts, paths, and evidence.

## Required Result

After the migration:

- the project installs and configures only Playwright for browser work;
- normal browser tools use headless or isolated virtual-display execution;
- a visible login window opens only after login is proved necessary and the user
  approves it;
- the login window closes before task work continues;
- saved login state is loaded privately into a new task context;
- downloads and generated files are checked locally before success is reported;
- interrupted non-idempotent actions are inspected before any retry;
- no runner, validator, prompt, selector, output path, generated task package,
  test, or private run artifact from that browser image experiment remains;
- client-owned legacy browser files are outside the managed profile and remain
  untouched by deployment.

There is no compatibility layer. Remove the old path rather than keeping aliases
or dual behavior.

## Build Order

### 1. Protect Existing Work

Inspect `git status` and the current diff before editing. The worktree contains
documentation changes that define the target contract. Do not discard unrelated
user work.

### 2. Replace Runtime And Configuration

- Make the managed browser MCP entry launch the pinned Playwright service in
  the explicitly configured task mode.
- Remove the separate browser-engine downloader, binary manifest, checksums,
  worker handling, restart logic, and transport wrapper.
- Remove the environment switch that treats Playwright as a fallback.
- Update the immutability guard so it permits the managed Playwright tools while
  still protecting authentication state and the human-login boundary.
- Keep configuration changes namespaced. Preserve unrelated user MCP entries.
- Make installer `install`, `status`, and `remove` agree on the new managed files
  and entries. Keep MCP configuration diagnosis consistent with them.
- Do not inspect, report on, or remove legacy browser files in a client
  configuration directory. Clients own cleanup of their own environments.

### 3. Build The Login Handoff

- Use Playwright itself for task execution and human login.
- Start with an access check in the configured task browser.
- Open a dedicated headed context only after the user approves a required login.
- Return control after opening it. Ask the user to log in and reply when done;
  capture only after that reply, without login polling or a human deadline.
- Save Playwright storage state outside all repositories with owner-only access.
- Scope each state record to approved HTTPS origins and a clear site or account
  name.
- Capture and restore session storage explicitly when a site needs it.
- Close the login window before creating the authenticated task context.
- Confirm access in that context before reporting login success or doing task work.
- Never expose cookies, storage values, tokens, or passwords through tool output,
  logs, screenshots, errors, or model context.
- Support bounded status and removal operations that reveal metadata only.

### 4. Consolidate Browser Work

- Use normal Playwright locators and actions for navigation, text entry, clicks,
  uploads, downloads, and page inspection.
- Remove browser-specific DOM workarounds and direct internal editor traversal.
- Keep the visible human-login context unavailable to ordinary task steps.
- Bound browser operations and provide process cleanup. Human login has no deadline.
- Record the page address and intent before any action that may create, publish,
  purchase, send, or generate something.
- Persist confirmation before beginning a long wait, download, or validation.
- After a disconnect, inspect the original page in a new task context. Do
  not automatically repeat an action with an unknown outcome.

### 5. Make File Delivery Reliable

- Treat a page result and a local file as separate outcomes.
- Prefer Playwright's download event when the site offers a download.
- When retrieval is required, use the same authenticated task context and
  tie the result to the current request.
- Place the final file without silently replacing unrelated data.
- Verify type, size, signature, hash, and any task-specific content requirement.
- Apply the same transfer timeout and byte limit to event downloads and URL
  retrieval. Read event downloads as bounded streams and obtain their content
  type from the matching Playwright response.
- Do not count a preview, stale page item, filename, or successful click as a
  delivered file.

### 6. Remove Retired Browser Experiment Material

Search source, tests, skills, rules, agents, generated packages, examples,
fixtures, ignore rules, and runtime artifacts for the retired browser image
experiment. Remove its runners, validators, prompts, selectors, output paths,
tests, generated agent registration, reference pages, and private run output.

Treat `<config_dir>/skills/playwright-image-generation/` as a retired managed
path. Remove it only when ownership is proved; report a modified copy as a
conflict. After installation, confirm that OpenCode no longer discovers that
skill.

Replace any useful general lesson with a provider-neutral test or short rule.
Do not retain historical provider details in durable documentation.

### 7. Update Runtime Guidance

Bring the executable Markdown under `rules/`, `skills/`, and `agents/` into line
with `docs/RESOURCE-SELECTION.md`. In particular:

- remove the fallback decision tree;
- state that Playwright is the only backend;
- select headless or virtual-display mode explicitly for task work;
- reserve the visible login window for approved human login;
- require a fresh task context after login;
- keep download verification and unknown-action safeguards;
- remove provider names and reference files that belong to the retired browser
  image experiment;
- remove the browser image-generation skill package; browser policy belongs in
  the shared rule and durable resource-selection documentation.

These files affect agent behavior. OpenCode must be restarted after deployment
before their new instructions take effect.

## Test Requirements

Add or update deterministic tests for:

1. Playwright-only MCP installation, status, diagnosis, and removal.
2. Preservation of unrelated configuration and modified user files.
3. Headless and virtual-display access checks that do not open a physical window.
4. Approval-gated headed login followed by browser closure.
5. Cookies and origin storage moving into a new task context.
6. Explicit session-storage capture and restoration.
7. Missing GUI, startup or capture timeout, launch failure, early exit, and cleanup.
8. Secret redaction and origin checks.
9. Download events, authenticated retrieval, exclusive file placement, and file
   validation.
10. Unknown submissions and reconnects that never cause an automatic replay.
11. Complete removal of project-managed browser-stack cleanup and browser image
    experiment material.

The build must remove obsolete skill expectations from
`tests/test_skill_pressure.py`, `tests/test_skill_coverage.py`,
`tests/integration/deploy_opencode_agents.test.mjs`, and
`tests/integration/browser_workflow.test.mjs`. Replace useful browser assertions
with provider-neutral Playwright coverage rather than retaining a deleted skill
fixture.

Use local fixtures for deterministic coverage. Live account tests are optional
and must not replace the local suite. A live check must use a harmless generic
task, name the exact profile and browser mode, and retain no credentials in the
repository.

## Acceptance Checks

Before completion:

1. Run the full Node test suite.
2. Provision the required pyenv environment with `scripts/ensure-venv.sh`, then
   run the Python verification and skill coverage suites.
3. Run installer fixture tests for clean install, repeat install, drift, conflict,
   status, and removal.
4. Install into a temporary OpenCode configuration root and inspect the exact
   managed tree and MCP configuration.
5. Search the whole repository, including hidden project files, for removed
   browser-engine implementation and provider-specific experiment material. The
   search must return no maintained source, prompt, test, configuration, or
   documentation matches.
6. Confirm task mode, viewport, missing-Xvfb errors, stdio, and display cleanup.
7. Confirm that a headed login closes and the resulting state works in a new
   task context.
8. Confirm that a browser-created file exists locally and passes independent
   validation before reporting success.

## Completion Evidence

## Completed Work And Outstanding Precondition

The project-managed browser stack and browser image experiment have been
removed. The managed profile installs the configurable Playwright service, secure
state store, and separate headed login helper. Deployment leaves client-owned
legacy browser files untouched. Deterministic tests cover login state,
downloads, collision-safe local placement, validation, non-replay, and retired
skill cleanup.

The virtual-display extension adds `opencode-browser-service.mjs` and the shared
`executionMode` setting. Its fixtures cover real concurrent Xvfb displays,
headed rendering, MCP transport, missing dependencies, EOF, and signal cleanup.
The real-Xvfb fixture requires host packages `xvfb` and `xauth`; a skipped fixture
does not count as virtual-display acceptance. No challenge clearance is promised.

`plugins/immutability.ts` permits the managed Playwright browser tools. It still
blocks browser state-export tools and must not permit another path that returns
hydrated credentials to the model. The managed MCP entry is named
`cuddly-winner-browser`; installation preserves unrelated user entries.

The final report should list changed files, removed components, exact test
commands and exit codes, deployment-fixture results, repository search results,
and any platform not exercised. It must say whether the live installed profile
was updated. If it was, instruct the user to quit and restart OpenCode.
