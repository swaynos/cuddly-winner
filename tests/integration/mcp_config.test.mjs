import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const mcp = path.join(repo, "scripts", "opencode-mcp-config.mjs");
const credentials = path.join(repo, "scripts", "opencode-browser-credentials.mjs");

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cuddly-mcp-"));
  try { await fn(root, path.join(root, "opencode.json")); } finally { await rm(root, { recursive: true, force: true }); }
}
async function invoke(script, args) { return run("node", [script, ...args]); }
async function config(file) { return JSON.parse(await readFile(file, "utf8")); }

test("managed MCP install preserves user entries and installs headless defaults", async () => fixture(async (root, file) => {
  await writeFile(file, JSON.stringify({ mcp: { "user-browser": { type: "local", command: ["example"] } }, keep: true }));
  await invoke(mcp, ["install", "--config", file]);
  const result = await config(file);
  assert.equal(result.keep, true);
  assert.deepEqual(result.mcp["user-browser"], { type: "local", command: ["example"] });
  assert.deepEqual(result.mcp["cuddly-winner-research-browser"].command.slice(-2), ["--headless", "--isolated"]);
  assert.equal(result.mcp["cuddly-winner-notebooklm"].environment.HEADLESS, "true");
  assert.equal(result.mcp["cuddly-winner-notebooklm"].environment.NOTEBOOKLM_PROFILE, "minimal");
  const second = await invoke(mcp, ["install", "--config", file]);
  assert.match(second.stdout, /Unchanged/);
  const diagnosis = await invoke(mcp, ["diagnose", "--config", file]);
  assert.match(diagnosis.stdout, /managed cuddly-winner-research-browser mode=headless/);
  assert.match(diagnosis.stdout, /unmanaged user-browser mode=unknown/);
  await stat(root);
}));

test("managed MCP removal preserves modified entries", async () => fixture(async (_root, file) => {
  await invoke(mcp, ["install", "--config", file]);
  const value = await config(file);
  value.mcp["cuddly-winner-research-browser"].command.push("--custom");
  await writeFile(file, JSON.stringify(value));
  const result = await invoke(mcp, ["remove", "--config", file]);
  assert.match(result.stdout, /Skipped modified managed entry/);
  const after = await config(file);
  assert.ok(after.mcp["cuddly-winner-research-browser"]);
  assert.equal(after.mcp["cuddly-winner-notebooklm"], undefined);
}));

test("credential modes require confirmation and flush only the selected managed profile", async () => fixture(async (root, file) => {
  await mkdir(path.dirname(file), { recursive: true });
  await assert.rejects(invoke(credentials, ["set", "--config", file, "--provider", "chatgpt", "--mode", "auth"]), /--confirm/);
  await invoke(credentials, ["set", "--config", file, "--provider", "chatgpt", "--mode", "auth", "--confirm"]);
  let value = await config(file);
  assert.equal(value.mcp["cuddly-winner-image-chatgpt"].command.includes("--headless"), false);
  await invoke(credentials, ["set", "--config", file, "--provider", "chatgpt", "--mode", "persistent-headless"]);
  value = await config(file);
  assert.ok(value.mcp["cuddly-winner-image-chatgpt"].command.includes("--headless"));
  const profile = path.join(root, "cuddly-winner-profiles", "chatgpt");
  await writeFile(path.join(profile, "cookie-canary"), "not-a-real-cookie");
  await assert.rejects(invoke(credentials, ["flush", "--config", file, "--provider", "chatgpt"]), /--confirm/);
  await invoke(credentials, ["flush", "--config", file, "--provider", "chatgpt", "--confirm"]);
  value = await config(file);
  assert.deepEqual(value.mcp["cuddly-winner-image-chatgpt"].command.slice(-2), ["--headless", "--isolated"]);
  await assert.rejects(stat(profile));
  const status = await invoke(credentials, ["status", "--config", file, "--provider", "chatgpt"]);
  assert.match(status.stdout, /mode=ephemeral profile=absent/);
}));
