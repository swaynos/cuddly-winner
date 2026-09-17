# Research Resource Selection

Use the least disruptive source that can answer the question or complete the
task. Prefer sources in this order:

1. Current conversation context and local project files.
2. Direct web pages, public APIs, and raw documentation URLs.
3. Text-only search when the exact page is unknown.
4. Managed Playwright when the task needs a rendered page or a browser action.
5. A visible Playwright window when a person must log in.

## Browser policy

Playwright is the project's only browser backend. Task execution and human login
have separate contexts:

- Task execution uses the configured `headless` or `virtual-display` mode for
  access checks, browsing, form entry, uploads, generation, downloads, and
  verification. Virtual-display mode runs headed Chrome/Chromium in an isolated
  Xvfb display on Linux. It needs no physical display or per-action approval.
- A visible login window opens only for a person to complete a required login.
  It saves the approved login state and closes. It must not complete the task.

Select task mode explicitly in shared browser settings; never switch modes or
repeat a denied request automatically. Xvfb does not guarantee site access. Use the
managed `cuddly-winner-browser` tools for every browser action. Do not open a
login window merely because a page shows a sign-in link; first try the requested
action in a fresh or saved task context.

## Browser actions and login

1. Check whether local files, direct retrieval, or an API can do the work.
2. Open the target in the configured task browser when a browser is needed.
   Reuse an approved saved record for the target origin before considering a new
   login. The managed browser and headed helper must use the same shared browser
   settings; do not substitute an anonymous preflight for saved-session reuse.
3. Try the requested action far enough to establish whether login is required.
   A login link alone is not proof.
4. If login is required, explain which site will open and ask for approval.
5. Run `node <config-dir>/opencode-browser-login.mjs start --config-dir
   <config-dir> --name <site> --url <https-url> --origin <https-origin>`.
   It opens a detached login window and returns. Tell the user the window is open,
   ask them to log in, leave it open, and reply when done. End the turn. Do not
   busy-wait, poll for login, impose a login countdown, or guess account selectors.
   Only after the user's reply, run the helper's `complete` action with the same
   `--config-dir` and `--name`. It saves approved state privately and closes the
   window. Use `cancel` to close without saving; `pending` is for recovery checks,
   not repeated login polling. A duplicate `start` must not replace an open window.
6. Open a new task context with that state and confirm it is signed in.
7. Complete and verify the requested action in that task context.

If a required human login has no visible graphical session, or saved login cannot be reused,
report the blocker. Do not finish the task in the headed login window, and do
not claim success merely because login succeeded.

## Login state

Saved login state belongs outside project repositories and must be readable and
writable only by the user (mode 0600). Use a separate state record for each site
or account, scoped to its approved HTTPS origins. Never use a personal everyday
browser profile. State values must not appear in model context, logs, command
output, screenshots, or error messages. Load state only when the requested
origin matches the record. Removing one saved session must not affect another.
The user's reply triggers capture, not a selector, URL change, cookie predicate,
or timer. The helper reads cookies and storage from existing approved-origin tabs,
including popups. It never calls `context.storageState()` in the headed context,
since that can open temporary tabs. It does not create tabs or navigate to collect
state. Only startup and state-read operations have short timeouts; the person has
no login deadline. A closed window cannot be captured and must not overwrite state.

User-confirmed capture is not proof of authenticated access. Load the saved state
in a fresh task context, inspect the actual account UI or requested task access,
and establish success from that evidence. Do not require a guessed site-specific
selector before saving. A redirect or composer alone is not proof of login. Report
failed task-browser reuse accurately and do not automatically repeat the login.

## Browser controls

Use visible, actionable controls. Hidden fallback fields are not valid targets.
Treat native, ARIA, visually disabled, and inert controls as disabled. Verify
text entry by reading the visible value back, and do not describe a click as a
completed submission without page evidence.

## Image uploads

Use `browser_upload_image` with the user's requested absolute image path and an
observed visible attachment control (`ref` or `selector`). Open an attachment
menu first if needed. The tool supports a visible file input or a button that
opens a file chooser; never target a hidden fallback input directly. It accepts
PNG, JPEG, WebP, and GIF, checks file signatures and size, and returns attachment
metadata without file contents. Files inside the private browser configuration
directory are not upload sources.

Record intent before attaching because selection can start an upload. Inspect
the page for the attachment preview or filename and any site error before sending
the prompt. Verified selection is not proof that the site accepted the upload.
If the input resets, capture times out, or the connection drops, inspect the page
before retrying. The upload tool does not send the prompt.

## Downloads and generated files

A website action and a local delivery are separate results. A task is not
complete merely because the page shows an output. For a download or generated
file, use `browser_download` with the visible download control's `ref` or
`selector` to capture Playwright's download event, or retrieve its URL through the same
authenticated task context, save it without replacing an unrelated file, and
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
saved page in a new task context and inspect it before deciding whether a
retry is safe. Never repeat an unknown non-idempotent action automatically.

Use short bounded polls rather than one transport-length wait. A wait timeout
must leave the browser usable. Explicit navigation may recreate a closed page.
Treat HTTP 401 or 403 and Cloudflare challenges as access denial. Report the
blocker; do not automatically repeat navigation, capture login, restart browsers,
or change settings to bypass it.
