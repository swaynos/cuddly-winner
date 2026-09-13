# Resource Selection

This project favors evidence sources that do not interrupt the user or retain
browser state. The order is local and session evidence, direct fetches and public
APIs, text-only search, headless browser automation, then a user-approved visible
browser.

## Incident Record

A Grounder session first tried direct Proton documentation URLs. After some
fetches failed, it used Google and Bing through a Playwright MCP server. That
server had no `--headless` argument, so its default headed browser interrupted
the desktop.

## Browser Rules

Use `cuddly-winner-browser` for actions that require a browser, unless the
project's specifications require another tool or approach. Check for a project
override first. In Obscura, check whether the action needs login before opening
a browser for the user.

Before browser automation, state why lower-impact sources failed and name the
target. Before a visible browser, tell the user it will open, why headless mode
will not work, and wait for approval. A browser that has unknown configured mode
counts as potentially visible.

Managed deployment adds namespaced MCP entries only. It preserves user entries.
`status` and `diagnose` report configured modes without starting a browser.
Restart OpenCode after install, removal, or a credential-mode change.

The managed `cuddly-winner-browser` entry runs the Obscura headless browser
engine. Obscura has no visible-window mode, so the entry is always headless; it
carries a `HEADLESS` environment marker so `diagnose` reports it as headless
without engine-specific knowledge. The installer bootstraps the engine binary
through `scripts/opencode-browser-engine.mjs`, which downloads the pinned
Obscura release and verifies it against a checksum before installing it under
the configuration root. That helper is standalone: another project can install,
locate, or remove the same engine under its own root and point its own MCP entry
at the binary. The engine runs without `--stealth` for transparent internal
research.

The entry does not launch Obscura directly. It runs the engine through
`scripts/opencode-browser-mcp.mjs`, a stdio proxy installed as a copy at the
configuration root. The proxy lets the agent log into a site with Obscura's own
tools without a password ever entering the model's context. In a fixed set of
argument slots (`browser_fill.value`, `browser_type.text`,
`browser_fill_form.fields[].value`, `browser_set_cookie.value`) an argument that
is exactly `${name:KEY}` is replaced with a value read from a local `KEY=VALUE`
file before the call reaches Obscura. A placeholder in any other slot (a URL, a
selector, a `browser_evaluate` expression) is rejected outright, so a
prompt-injected page cannot smuggle a secret out. Before releasing a secret the
proxy checks the current page origin, through its own filtered-out probe,
against the origins registered for that name. It removes `browser_get_cookies`,
`browser_storage_state`, and `browser_network_requests` from the tool list and
rejects them on call, and it blocks `browser_evaluate`, `browser_get_attribute`,
and `browser_extract` from just after a substitution until the next navigation,
so a filled secret cannot be read back out of the DOM. Driving a login form
headlessly this way cannot clear MFA, SSO, or a CAPTCHA; the session bridge below
covers those.

A short name maps to a secrets file and its allowed https origins through
`scripts/opencode-browser-secrets.mjs`, which writes a mode-`0600`
schema-version-1 registry at `<config-root>/cuddly-winner-secrets.json`. Any key
in a registered file may be released. Register one with `node
scripts/opencode-browser-secrets.mjs add --config-dir <config-root> --name A
--path <abs KEY=VALUE file> --origin https://example.com`. Inspect entries with
`status` and drop one with `remove --name A`; neither the registry nor this CLI
ever prints a secret value.

## Browser Actions and Login

Start with the requested action, not a login window. For example, if the user
asks for an image from ChatGPT, first open ChatGPT in `cuddly-winner-browser`
and check whether image generation requires login. The user may already be
signed in. A public task on another site may not need an account at all.

1. Check the project's specifications for a browser-tool override. Follow it if
   present; otherwise use `cuddly-winner-browser`.
2. Open the target in Obscura and check whether the requested action needs login.
   If it works without login or the session is already signed in, perform the
   action and verify the result.
3. If login is needed, check whether a browser and GUI are available. Explain why
   a login window is needed and obtain the user's approval. Run the installed
   `<config-root>/cuddly-winner-browser-session.mjs capture` helper and ask the
   user to log in in the window it opens.
4. Wait for capture to succeed. Ask the user to restart OpenCode so the wrapper
   loads the saved session. Reopen the site through Obscura and confirm that it
   is signed in.
5. Complete the task through Obscura and check the result. For an image, save the
   generated file and verify its signature before reporting success.

If login is required but the user's browser cannot open, including on a machine
with no GUI, report the blocker. Follow the user or project instructions for
what comes next: try an allowed alternative tool or approach, or stop if
directed. Use the same rule when login, capture, or session reuse fails.

In this workflow, the visible browser is for login only. Do not use it to finish
the task unless a project override requires that approach. The helper cannot
capture an existing Playwright login; if the wrong browser was used, explain the
mistake before asking for another login.

### Capture Command

Use the active configuration directory for `<config-root>` and choose a session
name for `<name>`. The name determines the filename:
`<config-root>/cuddly-winner-sessions/<name>.json`. `chatgpt.json` is an example,
not a required filename.

```sh
node <config-root>/cuddly-winner-browser-session.mjs capture \
  --config-dir <config-root> \
  --name <name> \
  --url <https-login-url> \
  --origin <https-origin> \
  --cookie <login-cookie-name>
```

Repeat `--origin` for each required origin. Instead of `--cookie`, use
`--complete-url <https-prefix>` when a distinct post-login URL proves completion.
Do not use a URL that also matches the signed-out page. The optional `--browser`
accepts `chrome`, `edge`, or `brave`.

On Linux, `DISPLAY` or `WAYLAND_DISPLAY` must identify a graphical session. The
helper rejects directories and non-executable files during browser discovery. It
also reports a launch error or an early browser exit without waiting for the
full login timeout. It checks the session destination before launch and stops the
browser before deleting its temporary profile, including when capture fails.
DevTools HTTP and WebSocket calls share the capture deadline. `capture`,
`status`, and `remove` reject a symlinked sessions directory rather than follow
it outside the configuration root.

Use `status --config-dir <config-root> --name <name>` to check capture metadata
without reading cookie values. Use `remove` with the same arguments to delete a
saved session when the user requests it.

### Limits

The helper captures cookies from the browser it opens, through the Chrome
DevTools Protocol. It does not export an existing browser session. Only
cookie-based logins work: imported `localStorage` does not survive navigation in
Obscura, and the helper does not capture `IndexedDB`.

The wrapper reads session files when it starts. It restores cookies on the first
navigation to a saved origin through an internal `browser_set_storage_state`
call. Cookie values never enter the model's context. One Obscura process has one
User-Agent; if saved sessions disagree, the wrapper does not set a captured
User-Agent.

Use the normal installer for the managed profile. To inspect configuration without
starting a browser, run `node scripts/opencode-mcp-config.mjs diagnose --config
<config-root>/opencode.json`. To inspect the engine binary, run `node
scripts/opencode-browser-engine.mjs status --root <config-root>`. To inspect one
image provider, run `node scripts/opencode-browser-credentials.mjs status
--config <config-root>/opencode.json --provider chatgpt`.

## Image Credentials

The provider-profile settings below do not change the browser-selection rule.
Use Obscura by default and check whether login is needed first. A project
specification may require another tool or approach.

`ephemeral` is the default: a headless isolated context retains no credentials
after it closes. `persistent` is opt-in and uses a dedicated provider profile
outside every project repository. Entering `auth` requires `--confirm` and may
open a browser for one-time login. Switch to `persistent-headless` only after
that login. Use `flush --confirm` to remove only the selected managed profile.

Set an explicit mode with `node scripts/opencode-browser-credentials.mjs set
--config <config-root>/opencode.json --provider chatgpt --mode
persistent-headless`. Use `--mode auth --confirm` only after warning the user
that a browser may appear. These commands change configuration but never launch
a browser themselves.

ChatGPT and Gemini profiles remain separate. If either provider cannot reuse a
managed profile headlessly, report that limit. Do not silently switch to headed
CDP or a personal browser profile.

## Session Fetch

Use `session_fetch` only for a configured owned site after direct retrieval is
insufficient. Before `bootstrap`, state the site and why a visible browser is
needed, then obtain user approval. Configure a site outside project repositories
with `node scripts/opencode-session-fetch-sites.mjs set --config-dir
<config-root> --name <site> --origin <https-origin> --login-url <https-url>
--complete-url <https-url>`. Call `complete` after login, use `request` for
`GET` or `HEAD`, and call `close` when finished. The tool promises authenticated
session continuity.
