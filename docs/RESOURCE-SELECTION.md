# Resource Selection

Use the least disruptive source that can answer the question or complete the
task. Prefer sources in this order:

1. Current conversation context and local project files.
2. Direct web pages, public APIs, and raw documentation URLs.
3. Text-only search when the exact page is unknown.
4. Headless Playwright when the task needs a rendered page or browser action.
5. Headed Playwright only when a person must log in.

## Browser Policy

Playwright is the project's only browser backend. It has two modes with a clear
division of responsibility:

- Headless Playwright performs all normal work. This includes access checks,
  browsing, form entry, uploads, generation, downloads, and verification.
- Headed Playwright opens only for a person to complete a required login. It
  closes after saving the approved login state. It must not complete the task.

Use Playwright's default launch mode for both paths. Do not force a browser
channel unless a verified site-specific compatibility test requires it.

Do not open a login window merely because a page has a sign-in link. First try
the requested action in a fresh or saved headless context. If the action needs
login, explain which site will open and ask for approval before starting headed
Playwright.

## Browser Actions And Login

1. Check whether local files, direct retrieval, or an API can do the work.
2. Open the target in headless Playwright when a browser is needed.
3. Try the requested action far enough to establish whether login is required.
4. If login is required, ask the user before opening headed Playwright.
5. Let the user complete login in the headed window. Save the resulting state to
   `<config_dir>/cuddly-winner-sessions/` beneath the selected OpenCode
   configuration root, then close the window.
6. Start a new headless context with that state and confirm that it is signed in.
7. Complete and verify the requested action in the headless context.

If there is no graphical session, no supported browser, or the login cannot be
reused headlessly, report the blocker. Do not finish the task in the headed
login window.

## Login State

Saved login state belongs outside project repositories and must be readable and
writable only by the user. Use a separate state file for each site or account.
Never use a personal everyday browser profile.

Use an ephemeral context by default. It starts without saved credentials and
discards its state when it closes. Persistent login state is opt-in and contains
only the approved saved state; it is not a continuously running browser or a
personal profile.

The login handoff should preserve the Playwright storage state needed by the
site, including cookies and origin storage supported by Playwright. If a site
also needs session storage, the login helper must capture and restore it
explicitly. State values must not appear in model context, logs, command output,
screenshots, or error messages.

Login completion requires a change from the state recorded after the login page
loads. When both a completion URL and cookie are supplied, both must match. A
redirect alone is not proof of login.

Before loading saved state, check that the requested origin matches the state
record. Expired or rejected state returns the workflow to the approved headed
login step. Removing one saved session must not affect another.

## Downloads And Generated Files

A website action and a local delivery are separate results. A task is not
complete merely because the page shows an output.

For a download or generated file:

1. Confirm the page result belongs to the current request rather than an older
   item already on the page.
2. Wait for Playwright's download event or retrieve the file through the same
   authenticated headless context.
3. Save to the requested path without silently replacing an unrelated file.
4. Check the file type, nonzero size, and any task-specific signature, hash, or
   content requirement.
5. Report success only after both the page action and local file checks pass.

When a site shows media without a download control, save the visible image or
canvas through the managed media tool. Do not expose its source URL. Compare its
source fingerprint with any pre-submission fingerprint, then apply the same
local-byte checks as a normal download.

For image generation, confirm the final prompt before submission, preserve the
page or conversation address, and associate the new image with that submission.
An existing image is not success.

## Interrupted Actions

Record intent before a non-idempotent action such as sending a message,
publishing, purchasing, or starting a generation. Record confirmation before
starting a long download or validation step.

If Playwright disconnects or times out after an action may have run, mark the
outcome as unknown. Reopen the saved page in headless Playwright and inspect it
before deciding whether to retry. Never repeat an unknown action automatically.

## Failure Handling

Use short bounded polls for page readiness, login, downloads, and generated
results. A wait must return before the MCP transport deadline and leave the
browser usable. Explicit navigation may recreate a closed page. Treat HTTP 401
or 403 as access denial, not as proof of successful access, and do not evade it.
On failure, record the stage, page address when safe, browser mode, and whether
an action may have occurred. Do not include credentials or page secrets.

Retry only when the earlier outcome is known or the operation is safe to repeat.
Stop with a clear blocker when login state cannot be reused, the site rejects
headless operation, a download cannot be tied to the request, or required local
verification fails.

## Session Fetch

Use `session_fetch` only for a configured site when direct public retrieval is
not enough. Its interactive login must follow the same headed-login and
headless-work split. The tool returns an opaque handle, allows only `GET` and
`HEAD` to configured HTTPS origins, and clears private state on close or expiry.

## Implementation Status

The source and managed profile implement this Playwright-only design. The
remaining runtime precondition sits in the trusted immutability guard: it must
permit the managed Playwright tool prefix before those tools can run in native
Build mode. That control-plane change is owned separately. See
[PLAYWRIGHT-MIGRATION.md](PLAYWRIGHT-MIGRATION.md) for its recorded status.
