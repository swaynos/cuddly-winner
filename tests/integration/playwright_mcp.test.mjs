// End-to-end test for the headless Playwright MCP server. It launches real
// headless Chromium and drives the server over newline-delimited JSON-RPC
// against a loopback HTTP fixture. No network access and no headed window.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const repo = path.resolve(import.meta.dirname, "../..");
const server = path.join(repo, "scripts", "opencode-playwright-mcp.mjs");

function fixtureServer() {
  const httpServer = http.createServer((req, res) => {
    if (req.url === "/denied") {
      res.writeHead(403, { "content-type": "text/html" });
      res.end("<!doctype html><title>Denied</title><h1>Access denied</h1>");
      return;
    }
    if (req.url === "/second") {
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><html><body><h1>Second Page</h1><p id="msg">pending</p>
        <script>setTimeout(() => { document.getElementById("msg").textContent = "ready-now"; }, 150);</script>
      </body></html>`);
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><body>
      <h1>Fixture Home</h1>
      <input id="name" type="text">
      <button id="go" onclick="document.getElementById('out').textContent='clicked!'">Go</button>
      <textarea id="fallback" aria-label="Message" style="display:none"></textarea>
      <div id="editor" contenteditable="true" role="textbox" aria-label="Message"></div>
      <div id="plain-editor" contenteditable="plaintext-only" aria-label="Plain message"></div>
      <button id="blocked" aria-disabled="true" onclick="document.getElementById('out').textContent='should-not-run'">Blocked</button>
      <div id="out"></div>
      <a href="/second">Second</a>
    </body></html>`);
  });
  return new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const { port } = httpServer.address();
      resolve({ httpServer, base: `http://127.0.0.1:${port}` });
    });
  });
}

// Minimal JSON-RPC-over-stdio client for the spawned server.
function client(env = {}) {
  const child = spawn("node", [server], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, ...env } });
  const pending = new Map();
  let nextId = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  function rpc(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`rpc timeout: ${method}`)), 60000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  async function call(name, args = {}) {
    const message = await rpc("tools/call", { name, arguments: args });
    return message.result;
  }
  function textOf(result) {
    return result?.content?.map((c) => c.text).join("") ?? "";
  }
  return { child, rpc, call, textOf, close: () => child.stdin.end() };
}

test("Playwright MCP server drives a headless page over JSON-RPC", async () => {
  const { httpServer, base } = await fixtureServer();
  const c = client();
  try {
    const init = await c.rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
    assert.equal(init.result.serverInfo.name, "cuddly-winner-browser");

    const list = await c.rpc("tools/list", {});
    const names = new Set(list.result.tools.map((t) => t.name));
    assert.ok(names.has("browser_navigate"), "exposes browser_navigate");
    assert.ok(names.has("browser_fill"), "exposes browser_fill");
    assert.ok(names.has("browser_status"), "exposes browser_status");
    // Security: no cookie/storage export tools are exposed.
    for (const leaky of ["browser_get_cookies", "browser_storage_state", "browser_network_requests", "browser_set_cookie", "browser_set_storage_state"]) {
      assert.ok(!names.has(leaky), `must not expose ${leaky}`);
    }

    const nav = c.textOf(await c.call("browser_navigate", { url: `${base}/` }));
    assert.match(nav, /status 200/);

    const snap = c.textOf(await c.call("browser_snapshot", {}));
    assert.match(snap, /Fixture Home/);

    await c.call("browser_fill", { selector: "#name", value: "hello" });
    const filled = c.textOf(await c.call("browser_evaluate", { expression: "document.querySelector('#name').value" }));
    assert.equal(filled, "hello");

    await c.call("browser_click", { selector: "#go" });
    const clicked = c.textOf(await c.call("browser_evaluate", { expression: "document.querySelector('#out').textContent" }));
    assert.equal(clicked, "clicked!");

    const els = c.textOf(await c.call("browser_interactive_elements", {}));
    assert.match(els, /<button>/);
    assert.match(els, /<div> Message/, "visible contenteditable editor is discoverable");
    assert.match(els, /<div> Plain message/, "plaintext-only contenteditable editor is discoverable");
    assert.doesNotMatch(els, /<textarea> Message/, "hidden fallback control is omitted");
    assert.match(els, /Blocked \[disabled\]/, "semantic disabled state is visible");

    const richFill = await c.call("browser_fill", { selector: "#editor", value: "rich text" });
    assert.equal(richFill.isError, undefined, c.textOf(richFill));
    const richValue = c.textOf(await c.call("browser_evaluate", { expression: "document.querySelector('#editor').textContent" }));
    assert.equal(richValue, "rich text");

    const blocked = await c.call("browser_click", { selector: "#blocked" });
    assert.equal(blocked.isError, true);
    assert.match(c.textOf(blocked), /disabled/);
    const blockedOutput = c.textOf(await c.call("browser_evaluate", { expression: "document.querySelector('#out').textContent" }));
    assert.equal(blockedOutput, "clicked!", "disabled action was not dispatched");

    const status = JSON.parse(c.textOf(await c.call("browser_status", {})));
    assert.equal(status.mode, "headless");
    assert.equal(status.pageOpen, true);
    assert.equal(status.url, `${base}/`);

    // Navigate to the second page and wait for delayed text.
    await c.call("browser_navigate", { url: `${base}/second` });
    const waited = c.textOf(await c.call("browser_wait_for_text", { text: "ready-now", timeout: 5 }));
    assert.match(waited, /ready-now/);

    const closed = c.textOf(await c.call("browser_close", {}));
    assert.match(closed, /browser closed/);
  } finally {
    c.close();
    httpServer.close();
  }
});

test("an oversized wait is bounded and leaves the page usable", async () => {
  const { httpServer, base } = await fixtureServer();
  const c = client({ CUDDLY_WINNER_BROWSER_MAX_WAIT_MS: "5000", CUDDLY_WINNER_BROWSER_TRANSPORT_TIMEOUT_MS: "100" });
  try {
    await c.call("browser_navigate", { url: `${base}/second` });
    const waited = await c.call("browser_wait_for_text", { text: "ready-now", timeout: 5 });
    assert.equal(waited.isError, true);
    assert.match(c.textOf(waited), /bounded wait expired after 80ms/);

    const snap = c.textOf(await c.call("browser_snapshot", {}));
    assert.match(snap, /Second Page/);
    assert.match(snap, /pending/);

    await new Promise((resolve) => setTimeout(resolve, 200));
    const recovered = c.textOf(await c.call("browser_snapshot", {}));
    assert.match(recovered, /ready-now/, "the browser context survived the wait timeout");
  } finally {
    c.close();
    httpServer.close();
  }
});

test("explicit navigation recovers a closed page and classifies access denial", async () => {
  const { httpServer, base } = await fixtureServer();
  const c = client();
  try {
    await c.call("browser_navigate", { url: `${base}/` });
    await c.call("browser_tab_close", { index: 0 });
    const closed = JSON.parse(c.textOf(await c.call("browser_status", {})));
    assert.equal(closed.pageOpen, false);

    const recovered = await c.call("browser_navigate", { url: `${base}/` });
    assert.equal(recovered.isError, undefined, c.textOf(recovered));
    assert.match(c.textOf(recovered), /status 200/);

    const denied = c.textOf(await c.call("browser_navigate", { url: `${base}/denied` }));
    assert.match(denied, /status 403/);
    assert.match(denied, /access denied/);
  } finally {
    c.close();
    httpServer.close();
  }
});

test("unknown tool and bad args return isError, not a crash", async () => {
  const { httpServer, base } = await fixtureServer();
  const c = client();
  try {
    await c.rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
    const unknown = await c.call("browser_frobnicate", {});
    assert.equal(unknown.isError, true);
    assert.match(c.textOf(unknown), /unknown tool/);

    // With no page open, a browser action reports the missing page rather than crashing.
    const noPage = await c.call("browser_fill", { value: "x" });
    assert.equal(noPage.isError, true);
    assert.match(c.textOf(noPage), /no active page/);

    // After navigation, a fill with neither ref nor selector fails validation.
    await c.call("browser_navigate", { url: `${base}/` });
    const badFill = await c.call("browser_fill", { value: "x" });
    assert.equal(badFill.isError, true);
    assert.match(c.textOf(badFill), /ref or selector/);

    await c.call("browser_close", {});
  } finally {
    c.close();
    httpServer.close();
  }
});
