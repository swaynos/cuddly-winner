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

## Session Bridge

A login that needs MFA, SSO, or a CAPTCHA cannot be driven headlessly. For those,
capture the session once in a visible browser and reuse it headlessly.
`scripts/opencode-browser-session.mjs` opens the browser you already have
(Chrome, Edge, or Brave — no Playwright, no downloaded engine), lets a human log
in in that window, then reads the resulting cookies over the Chrome DevTools
Protocol using Node's built-in `WebSocket`. It writes an Obscura-shaped storage
state plus the browser User-Agent to a mode-`0600` file at
`<config-root>/cuddly-winner-sessions/<name>.json`. Capture with `node
scripts/opencode-browser-session.mjs capture --config-dir <config-root> --name A
--url <https login page> --origin https://example.com [--origin ...]
(--cookie <name> | --complete-url <https-prefix>) [--browser chrome|edge|brave]`.
Inspect with `status` and drop with `remove --name A`; no cookie value is ever
printed.

The credential wrapper hydrates a captured session into Obscura the first time
the agent navigates to one of its origins, through a filtered-out
`browser_set_storage_state` call, so the model never sees the cookies and never
learns a session was injected. Import only: the export tools stay denied, so a
session flows in but never back out. A probe confirmed Obscura restores cookies
this way and they survive navigation, but it discards `localStorage` on
navigation — so a login that lives in `localStorage` or `IndexedDB` cannot be
bridged and is out of scope. Only cookie sessions are supported. One Obscura
process serves every site, so it carries a single User-Agent taken from the
captured sessions; if two captures disagree, none is injected.

Use the normal installer for the managed profile. To inspect configuration without
starting a browser, run `node scripts/opencode-mcp-config.mjs diagnose --config
<config-root>/opencode.json`. To inspect the engine binary, run `node
scripts/opencode-browser-engine.mjs status --root <config-root>`. To inspect one
image provider, run `node scripts/opencode-browser-credentials.mjs status
--config <config-root>/opencode.json --provider chatgpt`.

## Image Credentials

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
