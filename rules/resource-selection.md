# Research Resource Selection

## Browser Actions

Project instructions override this rule when they require another browser tool
or approach. Otherwise, use `cuddly-winner-browser` for an action that requires
a browser.

1. Open the target with `cuddly-winner-browser` and check whether login is
   required for the requested action. A visible login link is not proof that
   login is required.
2. If the action works without login, or Obscura is already signed in, complete
   it in `cuddly-winner-browser`.
3. Only after confirming that login is required, check whether the user's browser
   and a GUI are available. Explain why a visible login window is needed and get
   approval before opening it.
4. Run the installed capture helper at
   `<config-dir>/cuddly-winner-browser-session.mjs`. The user's browser is for
   login only. After capture and the required OpenCode restart, return to
   `cuddly-winner-browser`, confirm that it is signed in, and complete the action.
5. If there is no GUI, no supported browser, or the login cannot be reused, state
   the blocker. Use an allowed alternative when the user or project permits one;
   otherwise stop.

Do not complete the requested action in the user's browser unless project
instructions explicitly require it. Do not claim success merely because login
succeeded; verify the requested result in the browser that performs the action.

## Last-resort fallback gate

A single timeout or disconnect is not grounds to switch to Playwright/CDP.
Unless a project override selects another browser, apply this gate first:

1. Identify the failed layer from the tool error and available diagnostics. For
   an invalid selector or unsupported argument, correct the call in Obscura.
2. Attempt bounded recovery appropriate to the failure: a fresh snapshot or
   read-only probe, then a supported reconnect or restart if needed. If recovery
   requires the user to restart OpenCode, request that restart. An unavailable
   tool in this session alone does not prove that Obscura cannot proceed.
3. Check whether the submitted action completed before submitting it again.
   A lost connection leaves the outcome unknown; it does not prove failure.
4. Pivot only when concrete errors, recovery results, or a documented capability
   limit show that no supported Obscura path remains. Repeated identical calls,
   impatience, and an available Playwright tool do not meet this test. If a
   plausible recovery remains untested, pursue it or report the blocker.
5. Before switching, state the evidence, recovery attempts, remaining blocker,
   and selected fallback. Check its configured mode and credential scope; retain
   all visible-browser and profile approval rules. An Obscura-only project rule
   still forbids fallback. Do not describe Playwright as a reconnected Obscura
   session, and verify the result in the browser that actually performs it.

## Evidence Sources

Use the least disruptive evidence source that can answer the question:

1. Session context and local project files.
2. Direct `webfetch`, raw documentation URLs, or public APIs.
3. Text-only search when the exact URL is unknown.
4. Headless browser automation when rendering is necessary.
5. Visible browser automation only after explaining the target, failed lower-impact
   alternatives, and expected disruption, then receiving explicit user approval.

Do not treat a browser as visible or headless unless its configured mode is
known. A visible browser is a user-space disruption, not an ordinary fallback.

For browser-based image generation, use Obscura's ephemeral headless state by
default. Do not retain credentials, open a visible browser, or reuse a personal
browser profile unless login is required and the user approves the managed
capture flow, or project instructions require another approach.
