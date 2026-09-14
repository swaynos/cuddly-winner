import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

const repo = path.resolve(import.meta.dirname, "../..");
const wrapper = path.join(repo, "scripts", "opencode-browser-mcp.mjs");

// A fake Obscura MCP binary: it records its argv and every tool call it receives
// to a log file, and answers newline-delimited JSON-RPC. tools/list returns a
// small tool set (including the session-material tools the wrapper must filter);
// tools/call echoes the tool name, and browser_evaluate of location.origin
// returns whatever origin the harness last navigated to.
const FAKE_OBSCURA = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const log = process.env.FAKE_LOG;
appendFileSync(log, "ARGV " + JSON.stringify(process.argv.slice(2)) + "\\n");
let origin = "https://start.example";
function send(m) { process.stdout.write(JSON.stringify(m) + "\\n"); }
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === "tools/call") appendFileSync(log, "CALL " + msg.params.name + "\\n");
  if (msg.method === "tools/list") {
    send({ jsonrpc: "2.0", id: msg.id, result: { tools: [
      { name: "browser_navigate" }, { name: "browser_evaluate" },
      { name: "browser_set_storage_state" }, { name: "browser_get_cookies" },
      { name: "browser_storage_state" }, { name: "browser_network_requests" },
    ] } });
    return;
  }
  if (msg.method === "tools/call") {
    const name = msg.params.name;
    const args = msg.params.arguments || {};
    if (name === "browser_navigate" && typeof args.url === "string") {
      try { origin = new URL(args.url).origin; } catch { /* keep */ }
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "Navigated to " + args.url }] } });
      return;
    }
    if (name === "browser_evaluate" && args.expression === "location.origin") {
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: origin }] } });
      return;
    }
    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "ok:" + name }] } });
    return;
  }
  if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, result: {} });
});
`;

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cuddly-hydrate-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

// Lay out a config root the way the wrapper expects: the (fake) engine binary at
// <root>/cuddly-winner-browser/obscura, so dirname(dirname(binary)) === root.
async function layout(root) {
  const engineDir = path.join(root, "cuddly-winner-browser");
  await mkdir(engineDir, { recursive: true });
  const fake = path.join(engineDir, "obscura.mjs");
  await writeFile(fake, FAKE_OBSCURA);
  return { engineDir, fake };
}

async function writeSession(root, name, record) {
  const dir = path.join(root, "cuddly-winner-sessions");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(dir, `${name}.json`), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}

function sessionRecord(name, origins, userAgent) {
  return {
    schema_version: 1,
    name,
    origins,
    user_agent: userAgent,
    captured_at: "2026-01-01T00:00:00.000Z",
    state: { cookies: [{ name: "sid", value: "secret", domain: new URL(origins[0]).host, path: "/", secure: true, httpOnly: true }], origins: [] },
  };
}

// Drive the wrapper: send each request line, collect every response line until
// the process is closed, then return the parsed client-visible responses plus
// the fake engine's recorded log.
async function driveWrapper(root, fake, requests, logPath) {
  const child = spawn("node", [wrapper, fake, "mcp"], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, FAKE_LOG: logPath, NODE_OPTIONS: "" },
  });
  const responses = [];
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    try { responses.push(JSON.parse(line)); } catch { /* ignore non-JSON */ }
  });
  for (const request of requests) {
    child.stdin.write(`${JSON.stringify(request)}\n`);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  child.stdin.end();
  await once(child, "exit");
  return responses;
}

// Run the fake engine through node, since it is a .mjs script rather than a
// native binary. The wrapper spawns argv[0] directly, so wrap it in a shim.
async function shim(engineDir, fake) {
  const shimPath = path.join(engineDir, "obscura");
  await writeFile(shimPath, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fake)} "$@"\n`, { mode: 0o755 });
  return shimPath;
}

test("an unexpected engine exit identifies the last external browser tool", async () => fixture(async (root) => {
  const { engineDir } = await layout(root);
  const fake = path.join(engineDir, "exit.mjs");
  const bin = await shim(engineDir, fake);
  await writeFile(fake, `process.stdin.resume(); setTimeout(() => process.exit(23), 100);\n`);

  const child = spawn("node", [wrapper, bin, "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "browser_wait_for_text", arguments: { text: "done" } } })}\n`);
  const [code] = await once(child, "exit");

  assert.equal(code, 23);
  assert.match(stderr, /Obscura MCP exited unexpectedly \(code 23\).*browser_wait_for_text/);
}));

test("navigating to a registered origin hydrates its session and injects the captured User-Agent", async () => fixture(async (root) => {
  const { engineDir, fake } = await layout(root);
  const bin = await shim(engineDir, fake);
  const logPath = path.join(root, "engine.log");
  await writeSession(root, "eg", sessionRecord("eg", ["https://eg.example"], "Mozilla/5.0 CaptureUA"));

  const responses = await driveWrapper(root, bin, [
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "browser_navigate", arguments: { url: "https://eg.example/home" } } },
  ], logPath);

  const { readFileSync } = await import("node:fs");
  const log = readFileSync(logPath, "utf8");

  // The captured User-Agent reached the engine on spawn.
  const argvLine = log.split("\n").find((l) => l.startsWith("ARGV"));
  assert.match(argvLine, /--user-agent/);
  assert.match(argvLine, /Mozilla\/5\.0 CaptureUA/);

  // Hydration issued a browser_set_storage_state to the engine ...
  assert.match(log, /CALL browser_set_storage_state/);
  // ... but its response was filtered out: the client only saw ids 1 and 2.
  const ids = responses.map((r) => r.id).filter((id) => id !== undefined);
  assert.deepEqual(ids.sort(), [1, 2]);

  // tools/list was filtered to drop the session-material tools.
  const list = responses.find((r) => r.id === 1);
  const names = list.result.tools.map((t) => t.name);
  assert.ok(names.includes("browser_navigate"));
  assert.ok(!names.includes("browser_get_cookies"));
  assert.ok(!names.includes("browser_storage_state"));
  assert.ok(!names.includes("browser_network_requests"));
}));

test("a navigation to an unregistered origin hydrates nothing", async () => fixture(async (root) => {
  const { engineDir, fake } = await layout(root);
  const bin = await shim(engineDir, fake);
  const logPath = path.join(root, "engine.log");
  await writeSession(root, "eg", sessionRecord("eg", ["https://eg.example"], "Mozilla/5.0 CaptureUA"));

  await driveWrapper(root, bin, [
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "browser_navigate", arguments: { url: "https://elsewhere.example/x" } } },
  ], logPath);

  const { readFileSync } = await import("node:fs");
  const log = readFileSync(logPath, "utf8");
  assert.doesNotMatch(log, /CALL browser_set_storage_state/);
}));

test("two sessions with disagreeing User-Agents inject none", async () => fixture(async (root) => {
  const { engineDir, fake } = await layout(root);
  const bin = await shim(engineDir, fake);
  const logPath = path.join(root, "engine.log");
  await writeSession(root, "a", sessionRecord("a", ["https://a.example"], "UA-One"));
  await writeSession(root, "b", sessionRecord("b", ["https://b.example"], "UA-Two"));

  await driveWrapper(root, bin, [
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  ], logPath);

  const { readFileSync } = await import("node:fs");
  const argvLine = readFileSync(logPath, "utf8").split("\n").find((l) => l.startsWith("ARGV"));
  assert.doesNotMatch(argvLine, /--user-agent/);
}));
