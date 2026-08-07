# Resource Selection

This project favors evidence sources that do not interrupt the user or retain
browser state. The order is local and session evidence, direct fetches and public
APIs, text-only search, authenticated headless NotebookLM, headless browser
automation, then a user-approved visible browser.

## Incident Record

A Grounder session first tried direct Proton documentation URLs. After some
fetches failed, it used Google and Bing through a Playwright MCP server. That
server had no `--headless` argument, so its default headed browser interrupted
the desktop. This was not caused by NotebookLM.

NotebookLM responded to health checks but was unauthenticated, so it could not
answer notebook questions. Its normal runtime can stay headless. Its one-time
Google login is interactive and must be explicitly requested.

## Browser Rules

Before browser automation, state why lower-impact sources failed and name the
target. Before a visible browser, tell the user it will open, why headless mode
will not work, and wait for approval. A browser that has unknown configured mode
counts as potentially visible.

Managed deployment adds namespaced MCP entries only. It preserves user entries.
`status` and `diagnose` report configured modes without starting a browser.
Restart OpenCode after install, removal, or a credential-mode change.

Use the normal installer for the managed profile. To inspect configuration without
starting a browser, run `node scripts/opencode-mcp-config.mjs diagnose --config
<config-root>/opencode.json`. To inspect one image provider, run `node
scripts/opencode-browser-credentials.mjs status --config
<config-root>/opencode.json --provider chatgpt`.

## NotebookLM

The managed NotebookLM entry runs `notebooklm-py`'s MCP server against your
personal Google account, launched from this project's one shared Python
virtualenv (see `docs/ARCHITECTURE.md#notebooklm-runtime`). It answers normal
source queries only after you separately run `notebooklm login` (or
`--browser-cookies chrome`) once, out-of-band. The server exposes no
setup/re-auth/cleanup tool at all — unlike the prior client, there is no
disabled-tool list to maintain, because the capability does not exist in this
server's tool surface. When `server_info` reports no usable session, fall back
to local and web evidence; no agent session can start or repair authentication.

The server never opens a browser as part of its own process, so a `status`
"unknown" mode on this entry does not carry the "potentially visible" risk the
Browser Rules above describe for the research-browser entry. The tradeoff is
that its full read/write tool surface is always present in the process; the
per-call `confirm=true` gate on destructive and sharing-widening tools, plus
this project's own agent permission lists (see `agents/grounder.md`), are what
keep an agent from mutating or deleting your notebooks — not a server-side
tool cutout.

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
