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
  let downloads = 0;
  const httpServer = http.createServer((req, res) => {
    if (req.url === "/download") {
      downloads += 1;
      if (!req.headers.cookie?.includes("fixture-auth=approved")) {
        res.writeHead(403).end("missing authentication");
        return;
      }
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(payload);
      return;
    }
    if (req.url === "/empty") {
      res.writeHead(204).end();
      return;
    }
    res.setHeader("set-cookie", "fixture-auth=approved; Path=/");
    res.setHeader("content-type", "text/html");
    res.end("<!doctype html><title>Download fixture</title>");
  });
  return new Promise((resolve) => httpServer.listen(0, "127.0.0.1", () => {
    resolve({ httpServer, base: `http://127.0.0.1:${httpServer.address().port}`, downloads: () => downloads });
  }));
}

function client() {
  const child = spawn("node", [server], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env } });
  const pending = new Map();
  let nextId = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    const resolve = pending.get(message.id);
    if (resolve) { pending.delete(message.id); resolve(message); }
  });
  function rpc(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`rpc timeout: ${method}`)), 60000);
      pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  return {
    call: async (name, args = {}) => (await rpc("tools/call", { name, arguments: args })).result,
    close: () => child.stdin.end(),
    textOf: (result) => result?.content?.map((entry) => entry.text).join("") ?? "",
  };
}

test("authenticated headless downloads validate bytes and never replace an existing file", async () => {
  const { httpServer, base, downloads } = await fixtureServer();
  const destinationDir = await mkdtemp(path.join(os.tmpdir(), "cw-download-"));
  const destination = path.join(destinationDir, "result.bin");
  const c = client();
  try {
    await c.call("browser_navigate", { url: `${base}/` });
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const result = await c.call("browser_download", {
      url: `${base}/download`, path: destination, min_bytes: payload.length,
      expected_content_type: "application/octet-stream", signature_hex: "43572d46494c45",
      expected_sha256: sha256,
    });
    assert.equal(result.isError, undefined, c.textOf(result));
    assert.deepEqual(await readFile(destination), payload, "validated local bytes were saved");
    assert.equal(downloads(), 1, "retrieval used the authenticated headless context once");

    const collision = await c.call("browser_download", { url: `${base}/download`, path: destination });
    assert.equal(collision.isError, true);
    assert.match(c.textOf(collision), /destination already exists/);
    assert.equal(downloads(), 1, "an unknown or collided delivery is never replayed automatically");

    const invalid = path.join(destinationDir, "invalid.bin");
    const badSignature = await c.call("browser_download", { url: `${base}/download`, path: invalid, signature_hex: "0000" });
    assert.equal(badSignature.isError, true);
    await assert.rejects(readFile(invalid), { code: "ENOENT" });

    const empty = path.join(destinationDir, "empty.bin");
    const emptyResult = await c.call("browser_download", { url: `${base}/empty`, path: empty });
    assert.equal(emptyResult.isError, true);
    assert.match(c.textOf(emptyResult), /empty/);
    await assert.rejects(readFile(empty), { code: "ENOENT" });
  } finally {
    c.close();
    httpServer.close();
    await rm(destinationDir, { recursive: true, force: true });
  }
});
