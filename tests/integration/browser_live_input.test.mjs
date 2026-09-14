import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { once } from "node:events";
import path from "node:path";

// Opt-in: runs the real installed engine against a local page, with no provider
// requests. Unlike the fake-engine recovery tests, this exercises DOM behavior.
const binary = process.env.CUDDLY_WINNER_TEST_BROWSER;
const wrapper = path.resolve(import.meta.dirname, "../../scripts/opencode-browser-mcp.mjs");

test("real engine: wrapper rejects unsupported text targets before filling or submitting", {
  skip: !binary, timeout: 45000,
}, async (t) => {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><textarea id="plain"></textarea>
      <textarea id="hidden" style="display:none"></textarea>
      <div id="rich" contenteditable="true">original</div>
      <input id="disabled" disabled><button id="send" onclick="window.sent=true">Send</button>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const child = spawn(process.execPath, [wrapper, binary, "--allow-private-network", "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());
  let seq = 0;
  const pending = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
  });
  child.stderr.resume();
  function rpc(method, params) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout: ${method}`)); }, 10000);
      pending.set(id, (message) => { clearTimeout(timer); pending.delete(id); resolve(message); });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  const call = (name, args) => rpc("tools/call", { name, arguments: args });
  const text = (message) => message.result?.content?.[0]?.text;
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "live-input-test", version: "1" } });
  const navigation = await call("browser_navigate", { url: `http://127.0.0.1:${server.address().port}` });
  assert.ok(!navigation.result?.isError, text(navigation));
  for (const [selector, reason] of [["#rich", /contenteditable/], ["#hidden", /hidden/], ["#disabled", /disabled/]]) {
    const result = await call("browser_fill", { selector, value: "replacement" });
    assert.equal(result.result?.isError, true, `${selector} must not report Filled`);
    assert.match(text(result), reason);
  }
  const typed = await call("browser_type", { selector: "#rich", text: "appended" });
  assert.equal(typed.result?.isError, true);
  const batch = await call("browser_fill_form", {
    fields: [{ selector: "#plain", value: "must not change" }, { selector: "#rich", value: "bad" }],
    submit_selector: "#send",
  });
  assert.equal(batch.result?.isError, true);
  const untouched = await call("browser_evaluate", { expression: "JSON.stringify({plain:document.querySelector('#plain').value,rich:document.querySelector('#rich').textContent,sent:!!window.sent})" });
  assert.deepEqual(JSON.parse(text(untouched)), { plain: "", rich: "original", sent: false });
  const filled = await call("browser_fill", { selector: "#plain", value: "valid input" });
  assert.ok(!filled.result?.isError);
  assert.equal(text(await call("browser_evaluate", { expression: "document.querySelector('#plain').value" })), "valid input");
  // Record the separate engine limitation rather than treating {} as a resolved
  // image fetch. This does not claim asynchronous evaluation is repaired.
  const asyncValue = text(await call("browser_evaluate", { expression: "Promise.resolve('resolved-value')" }));
  t.diagnostic(`engine Promise.resolve result: ${asyncValue}`);
});
