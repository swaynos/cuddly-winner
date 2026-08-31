import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const script = path.join(repo, "scripts", "opencode-session-fetch-sites.mjs");

test("site profile helper writes named allowlisted profiles outside a project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "session-fetch-sites-"));
  try {
    await run("node", [script, "set", "--config-dir", root, "--name", "owned", "--origin", "https://owned.example", "--login-url", "https://owned.example/login", "--complete-url", "https://owned.example/app", "--token-header", "x-csrf-token=csrf"]);
    const file = path.join(root, "session-fetch-sites.json");
    const config = JSON.parse(await readFile(file, "utf8"));
    assert.equal(config.schema_version, 1);
    assert.deepEqual(config.sites.owned.origins, ["https://owned.example"]);
    assert.deepEqual(config.sites.owned.token_headers, { "x-csrf-token": "csrf" });
    const status = await run("node", [script, "status", "--config-dir", root]);
    assert.match(status.stdout, /owned/);
    await run("node", [script, "remove", "--config-dir", root, "--name", "owned"]);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")).sites, {});
  } finally { await rm(root, { recursive: true, force: true }); }
});
