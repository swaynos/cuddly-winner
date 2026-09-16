# Research Resource Selection

Use the least disruptive source that can answer the question or complete the
task. Prefer sources in this order:

1. Current conversation context and local project files.
2. Direct web pages, public APIs, and raw documentation URLs.
3. Text-only search when the exact page is unknown.
4. Headless Playwright when the task needs a rendered page or a browser action.
5. Headed Playwright only when a person must log in.

## Browser policy

Playwright is the project's only browser backend. It has two modes with a clear
division of responsibility:

- Headless Playwright performs all normal work: access checks, browsing, form
  entry, uploads, generation, downloads, and verification. It needs no approval
  and no graphical session.
- Headed Playwright opens only for a person to complete a required login. It
  saves the approved login state and closes. It must not complete the task.

There is no fallback decision tree and no browser-selection override. Use the
managed `cuddly-winner-browser` tools for every browser action. Do not open a
login window merely because a page shows a sign-in link; first try the requested
action in a fresh or saved headless context.

## Browser actions and login

1. Check whether local files, direct retrieval, or an API can do the work.
2. Open the target in headless Playwright when a browser is needed.
3. Try the requested action far enough to establish whether login is required.
   A login link alone is not proof.
4. If login is required, explain which site will open and ask for approval.
5. Run the headed login helper at `<config-dir>/opencode-browser-login.mjs`. Let
   the user log in, save the approved state under
   `<config-dir>/cuddly-winner-sessions/`, then close the headed window.
6. Open a new headless context with that state and confirm it is signed in.
7. Complete and verify the requested action headlessly.

If there is no graphical session, or the login cannot be reused headlessly,
report the blocker. Do not finish the task in the headed login window, and do
not claim success merely because login succeeded.

## Login state

Saved login state belongs outside project repositories and must be readable and
writable only by the user (mode 0600). Use a separate state record for each site
or account, scoped to its approved HTTPS origins. Never use a personal everyday
browser profile. State values must not appear in model context, logs, command
output, screenshots, or error messages. Load state only when the requested
origin matches the record. Removing one saved session must not affect another.
The login helper records a state baseline after loading the login page. It saves
only after approved-origin state changes and every supplied completion condition
matches; a redirect by itself is not proof of login.

## Browser controls

Use visible, actionable controls. Hidden fallback fields are not valid targets.
Treat native, ARIA, visually disabled, and inert controls as disabled. Verify
text entry by reading the visible value back, and do not describe a click as a
completed submission without page evidence.

## Downloads and generated files

A website action and a local delivery are separate results. A task is not
complete merely because the page shows an output. For a download or generated
file, wait for Playwright's download event or retrieve the file through the same
authenticated headless context, save it without replacing an unrelated file, and
verify its type, nonzero size, and any task-specific signature, hash, or content
requirement before reporting success. A page preview is not a delivered file.

If visible media has no download control, use the managed media-save action for
the image or canvas. Keep its source URL private, reject a prior source
fingerprint when proving that an output is new, and validate the saved bytes like
any other download.

For image generation, confirm the final prompt before submission, preserve the
page or conversation address, and associate the new output image with that
submission. An existing page image is not success.

## Interrupted actions

Record intent before a non-idempotent action such as sending a message,
publishing, purchasing, or starting a generation. If Playwright disconnects or
times out after an action may have run, mark the outcome unknown. Reopen the
saved page in a new headless context and inspect it before deciding whether a
retry is safe. Never repeat an unknown non-idempotent action automatically.

Use short bounded polls rather than one transport-length wait. A wait timeout
must leave the browser usable. Explicit navigation may recreate a closed page.
Treat HTTP 401 or 403 as access denial and do not attempt to evade it.
