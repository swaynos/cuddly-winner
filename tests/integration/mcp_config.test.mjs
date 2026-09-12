import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { copyFile, mkdtemp, readFile, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const mcp = path.join(repo, "scripts", "opencode-mcp-config.mjs");
const engine = path.join(repo, "scripts", "opencode-browser-engine.mjs");
const credentials = path.join(repo, "scripts", "opencode-browser-credentials.mjs");

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cuddly-mcp-"));
  try { await fn(root, path.join(root, "opencode.json")); } finally { await rm(root, { recursive: true, force: true }); }
}
async function invoke(script, args) { return run("node", [script, ...args]); }
async function config(file) { return JSON.parse(await readFile(file, "utf8")); }

test("managed MCP install preserves user entries and installs the headless engine entry", async () => fixture(async (root, file) => {
  await writeFile(file, JSON.stringify({ mcp: { "user-browser": { type: "local", command: ["example"] } }, keep: true }));
  await invoke(mcp, ["install", "--config", file]);
  const result = await config(file);
  assert.equal(result.keep, true);
  assert.deepEqual(result.mcp["user-browser"], { type: "local", command: ["example"] });
  const entry = result.mcp["cuddly-winner-browser"];
  assert.equal(entry.command.at(-1), "mcp");
  assert.equal(entry.command[0], path.join(root, "cuddly-winner-browser", "obscura"));
  assert.deepEqual(entry.environment, { HEADLESS: "true" });
  const second = await invoke(mcp, ["install", "--config", file]);
  assert.match(second.stdout, /Unchanged/);
  const diagnosis = await invoke(mcp, ["diagnose", "--config", file]);
  assert.match(diagnosis.stdout, /managed cuddly-winner-browser mode=headless/);
  assert.match(diagnosis.stdout, /unmanaged user-browser mode=unknown/);
  await stat(root);
}));

test("managed MCP install requires a config path", async () => fixture(async (_root, file) => {
  await assert.rejects(invoke(mcp, ["install"]), /--config is required/);
  await invoke(mcp, ["diagnose", "--config", file]);
}));

test("managed MCP status exits nonzero for missing and modified entries", async () => fixture(async (_root, file) => {
  await assert.rejects(
    invoke(mcp, ["status", "--config", file]),
    error => error.code === 1 && /\[none\] cuddly-winner-browser/.test(error.stdout),
  );

  await invoke(mcp, ["install", "--config", file]);
  await invoke(mcp, ["status", "--config", file]);
  const value = await config(file);
  value.mcp["cuddly-winner-browser"].enabled = false;
  await writeFile(file, JSON.stringify(value));
  await assert.rejects(
    invoke(mcp, ["status", "--config", file]),
    error => error.code === 1 && /\[modified\] cuddly-winner-browser/.test(error.stdout),
  );
}));

test("managed MCP install prunes the retired notebooklm and research-browser entries", async () => fixture(async (_root, file) => {
  await writeFile(file, JSON.stringify({
    mcp: {
      "cuddly-winner-notebooklm": { type: "local", command: ["/old/notebooklm-mcp"], enabled: true },
      "cuddly-winner-research-browser": { type: "local", command: ["npx", "-y", "@playwright/mcp@0.0.78", "--headless", "--isolated"], enabled: true },
      "user-x": { type: "local", command: ["x"] },
    },
  }));
  await assert.rejects(
    invoke(mcp, ["status", "--config", file]),
    error => error.code === 1
      && /\[retired\] cuddly-winner-notebooklm/.test(error.stdout)
      && /\[retired\] cuddly-winner-research-browser/.test(error.stdout),
  );
  const result = await invoke(mcp, ["install", "--config", file]);
  assert.match(result.stdout, /Removed retired managed entry: cuddly-winner-notebooklm/);
  assert.match(result.stdout, /Removed retired managed entry: cuddly-winner-research-browser/);
  const after = await config(file);
  assert.equal(after.mcp["cuddly-winner-notebooklm"], undefined);
  assert.equal(after.mcp["cuddly-winner-research-browser"], undefined);
  assert.ok(after.mcp["cuddly-winner-browser"]);
  assert.deepEqual(after.mcp["user-x"], { type: "local", command: ["x"] });
}));

test("retired MCP cleanup removes only the legacy notebooklm entry", async () => fixture(async (_root, file) => {
  await writeFile(file, JSON.stringify({
    mcp: {
      notebooklm: { type: "local", command: ["npx", "-y", "notebooklm-mcp@latest"], enabled: true },
      playwright: { type: "local", command: ["npx", "-y", "@playwright/mcp@latest"], enabled: true },
    },
  }));
  const result = await invoke(mcp, ["cleanup-retired", "--config", file]);
  assert.match(result.stdout, /Removed retired managed entry: notebooklm/);
  assert.match(result.stdout, /Removed retired MCP entries\./);
  const after = await config(file);
  assert.equal(after.mcp.notebooklm, undefined);
  assert.deepEqual(after.mcp.playwright, { type: "local", command: ["npx", "-y", "@playwright/mcp@latest"], enabled: true });
}));

test("retired MCP status and removal own only the exact legacy notebooklm entry", async () => fixture(async (_root, file) => {
  await writeFile(file, JSON.stringify({
    mcp: {
      notebooklm: { type: "local", command: ["npx", "-y", "notebooklm-mcp@latest"], enabled: true },
      keep: { type: "local", command: ["keep"] },
    },
  }));

  await assert.rejects(
    invoke(mcp, ["status-retired", "--config", file]),
    error => error.code === 1 && /\[retired\] notebooklm/.test(error.stdout),
  );
  const removed = await invoke(mcp, ["remove-retired", "--config", file]);
  assert.match(removed.stdout, /Removed retired managed entry: notebooklm/);
  const after = await config(file);
  assert.equal(after.mcp.notebooklm, undefined);
  assert.deepEqual(after.mcp.keep, { type: "local", command: ["keep"] });
}));

test("retired MCP cleanup preserves a user-owned notebooklm entry", async () => fixture(async (_root, file) => {
  const userOwned = { type: "remote", url: "https://example.test/notebooklm", enabled: true };
  await writeFile(file, JSON.stringify({ mcp: { notebooklm: userOwned } }));

  await assert.rejects(
    invoke(mcp, ["cleanup-retired", "--config", file]),
    error => error.code === 1 && /ownership not proven; preserved/.test(error.stdout),
  );
  assert.deepEqual((await config(file)).mcp.notebooklm, userOwned);

  const removed = await invoke(mcp, ["remove-retired", "--config", file]);
  assert.match(removed.stdout, /ownership not proven; preserved/);
  assert.deepEqual((await config(file)).mcp.notebooklm, userOwned);
}));

test("MCP helper runs directly from a path containing spaces", async () => fixture(async (root, file) => {
  const spacedDirectory = path.join(root, "helper with spaces");
  const spacedHelper = path.join(spacedDirectory, "opencode mcp config.mjs");
  await mkdir(spacedDirectory);
  await copyFile(mcp, spacedHelper);
  await copyFile(engine, path.join(spacedDirectory, "opencode-browser-engine.mjs"));

  await invoke(spacedHelper, ["install", "--config", file]);
  assert.ok((await config(file)).mcp["cuddly-winner-browser"]);
}));

test("managed MCP removal preserves modified entries", async () => fixture(async (_root, file) => {
  await invoke(mcp, ["install", "--config", file]);
  const value = await config(file);
  value.mcp["cuddly-winner-browser"].command.push("--custom");
  await writeFile(file, JSON.stringify(value));
  const result = await invoke(mcp, ["remove", "--config", file]);
  assert.match(result.stdout, /Skipped modified managed entry/);
  const after = await config(file);
  assert.ok(after.mcp["cuddly-winner-browser"]);
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
