# Research Resource Selection

Use the least disruptive evidence source that can answer the question:

1. Session context and local project files.
2. Direct `webfetch`, raw documentation URLs, or public APIs.
3. Text-only search when the exact URL is unknown.
4. Authenticated headless NotebookLM when its source corpus is relevant.
5. Headless browser automation when rendering is necessary.
6. Visible browser automation only after explaining the target, failed lower-impact
   alternatives, and expected disruption, then receiving explicit user approval.

Do not treat a browser as visible or headless unless its configured mode is
known. A visible browser is a user-space disruption, not an ordinary fallback.
The managed NotebookLM MCP server exposes no login, re-auth, or cleanup tool at
all. Do not run `notebooklm login`, `auth refresh`, or `cleanup` yourself
through Bash, and do not invoke any other interactive repair action, unless
the user explicitly requests it.

For browser-based image generation, use ephemeral headless state by default. Do
not retain credentials, open a visible browser, or reuse a personal browser
profile unless the user explicitly opts into the managed persistent mode.
