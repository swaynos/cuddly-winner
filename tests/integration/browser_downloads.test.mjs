// Download coverage uses a local authenticated fixture and real headless Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const repo = path.resolve(import.meta.dirname, "../..");
const server = path.join(repo, "scripts", "opencode-playwright-mcp.mjs");
const payload = Buffer.from("CW-FILE\nAuthenticated download\n");

function fixtureServer() {
  let retrievals = 0;
  let browserDownloads = 0;
  let submissions = 0;
  const pendingResponses = new Set();
  const httpServer = http.createServer((req, res) => {
    if (req.url === "/download") {
      retrievals += 1;
      if (!req.headers.cookie?.includes("fixture-auth=approved")) {
        res.writeHead(403).end("missing authentication");
        return;
      }
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(payload);
      return;
    }
    if (req.url === "/actual-download") {
      browserDownloads += 1;
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment; filename=fixture.bin",
      });
      res.end(payload);
      return;
    }
    if (req.url === "/submit" && req.method === "POST") {
      submissions += 1;
      // Keep the request unresolved so a transport loss happens after the
      // non-idempotent action reaches the fixture but before a result returns.
      pendingResponses.add(res);
      res.on("close", () => pendingResponses.delete(res));
      return;
    }
    res.setHeader("set-cookie", "fixture-auth=approved; Path=/");
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><title>Download fixture</title>
      <a id="download-link" href="/actual-download">download</a>`);
  });
  return new Promise((resolve) => httpServer.listen(0, "127.0.0.1", () => {
    resolve({
      httpServer,
      base: `http://127.0.0.1:${httpServer.address().port}`,
      retrievals: () => retrievals,
      browserDownloads: () => browserDownloads,
      submissions: () => submissions,
      close: () => {
        for (const response of pendingResponses) response.destroy();
        httpServer.closeAllConnections();
        httpServer.close();
      },
    });
  }));
}

function client() {
  const child = spawn("node", [server], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env } });
  const pending = new Map();
  let nextId = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); request.resolve(message); }
  });
  child.once("exit", () => {
    for (const request of pending.values()) request.reject(new Error("MCP transport closed"));
    pending.clear();
  });
  function rpc(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`rpc timeout: ${method}`)), 60000);
      pending.set(id, {
        resolve: (message) => { clearTimeout(timer); resolve(message); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  return {
    call: async (name, args = {}) => (await rpc("tools/call", { name, arguments: args })).result,
    close: () => child.stdin.end(),
    disconnect: () => child.kill("SIGKILL"),
    textOf: (result) => result?.content?.map((entry) => entry.text).join("") ?? "",
  };
}

test("Playwright download events create validated collision-safe local files", async () => {
  const { base, browserDownloads, close } = await fixtureServer();
  const destinationDir = await mkdtemp(path.join(os.tmpdir(), "cw-download-"));
  const destination = path.join(destinationDir, "result.bin");
  const c = client();
  try {
    await c.call("browser_navigate", { url: `${base}/` });
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const result = await c.call("browser_download", { selector: "#download-link", path: destination, min_bytes: payload.length, signature_hex: "43572d46494c45", expected_sha256: sha256 });
    assert.equal(result.isError, undefined, c.textOf(result));
    assert.deepEqual(await readFile(destination), payload, "validated local bytes were saved");
    assert.equal(browserDownloads(), 1, "the file came from one Playwright download event");

    const collision = await c.call("browser_download", { selector: "#download-link", path: destination });
    assert.equal(collision.isError, true);
    assert.match(c.textOf(collision), /destination already exists/);
    assert.equal(browserDownloads(), 1, "a collision never replaces or starts a second download");

    const invalid = path.join(destinationDir, "invalid.bin");
    const badSignature = await c.call("browser_download", { selector: "#download-link", path: invalid, signature_hex: "0000" });
    assert.equal(badSignature.isError, true);
    await assert.rejects(readFile(invalid), { code: "ENOENT" });
  } finally {
    c.close();
    close();
    await rm(destinationDir, { recursive: true, force: true });
  }
});

test("authenticated retrieval uses the active headless context and validates bytes", async () => {
  const { base, retrievals, close } = await fixtureServer();
  const destinationDir = await mkdtemp(path.join(os.tmpdir(), "cw-retrieval-"));
  const destination = path.join(destinationDir, "result.bin");
  const c = client();
  try {
    await c.call("browser_navigate", { url: `${base}/` });
    const result = await c.call("browser_download", {
      url: `${base}/download`, path: destination, min_bytes: payload.length,
      expected_content_type: "application/octet-stream", signature_hex: "43572d46494c45",
      expected_sha256: createHash("sha256").update(payload).digest("hex"),
    });
    assert.equal(result.isError, undefined, c.textOf(result));
    assert.deepEqual(await readFile(destination), payload);
    assert.equal(retrievals(), 1, "retrieval sent the current headless context cookie once");
  } finally {
    c.close();
    close();
    await rm(destinationDir, { recursive: true, force: true });
  }
});

test("a reconnect after an unknown non-idempotent submission never replays it", async () => {
  const { base, submissions, close } = await fixtureServer();
  const interrupted = client();
  try {
    await interrupted.call("browser_navigate", { url: `${base}/` });
    const pendingSubmission = interrupted.call("browser_evaluate", {
      expression: "(() => { fetch('/submit', { method: 'POST' }); return new Promise(() => {}); })()",
    });
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("fixture did not receive submission")), 5000);
      const poll = () => submissions() === 1 ? (clearTimeout(deadline), resolve()) : setTimeout(poll, 10);
      poll();
    });
    interrupted.disconnect();
    await assert.rejects(pendingSubmission, /MCP transport closed/);

    const reconnected = client();
    try {
      await reconnected.call("browser_navigate", { url: `${base}/` });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(submissions(), 1, "restart did not replay the unknown submission");
    } finally {
      reconnected.close();
    }
  } finally {
    close();
  }
});
