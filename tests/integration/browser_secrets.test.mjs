import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, readFile, writeFile, stat, symlink } from "node:fs/promises";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const secrets = path.join(repo, "scripts", "opencode-browser-secrets.mjs");

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cuddly-secrets-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function invoke(args) { return run("node", [secrets, ...args]); }
function registryFile(root) { return path.join(root, "cuddly-winner-secrets.json"); }
async function registry(root) { return JSON.parse(await readFile(registryFile(root), "utf8")); }

async function secretsFile(root, contents = "USERNAME=alice\nPASSWORD=hunter2\n") {
  const file = path.join(root, "creds.env");
  await writeFile(file, contents);
  return file;
}

test("add writes a 0600 schema-v1 registry that stores only the path and origins", async () => fixture(async (root) => {
  const file = await secretsFile(root);
  const result = await invoke(["add", "--config-dir", root, "--name", "A", "--path", file, "--origin", "https://example.com"]);
  assert.match(result.stdout, /Added secrets entry "A" \(1 origin\)/);

  const value = await registry(root);
  assert.equal(value.schema_version, 1);
  assert.deepEqual(value.entries.A, { path: file, origins: ["https://example.com"] });
  // The registry never stores a secret value.
  const raw = await readFile(registryFile(root), "utf8");
  assert.doesNotMatch(raw, /hunter2/);
  assert.doesNotMatch(raw, /alice/);
  assert.equal((await stat(registryFile(root))).mode & 0o777, 0o600);
}));

test("add dedupes origins, updates in place, and reports the plural", async () => fixture(async (root) => {
  const file = await secretsFile(root);
  const added = await invoke(["add", "--config-dir", root, "--name", "A", "--path", file,
    "--origin", "https://example.com", "--origin", "https://auth.example.com", "--origin", "https://example.com"]);
  assert.match(added.stdout, /Added secrets entry "A" \(2 origins\)/);
  assert.deepEqual((await registry(root)).entries.A.origins, ["https://example.com", "https://auth.example.com"]);

  const updated = await invoke(["add", "--config-dir", root, "--name", "A", "--path", file, "--origin", "https://only.example.com"]);
  assert.match(updated.stdout, /Updated secrets entry "A"/);
  assert.deepEqual((await registry(root)).entries.A.origins, ["https://only.example.com"]);
}));

test("add rejects a non-https origin, a pathful origin, and a missing file", async () => fixture(async (root) => {
  const file = await secretsFile(root);
  await assert.rejects(
    invoke(["add", "--config-dir", root, "--name", "A", "--path", file, "--origin", "http://example.com"]),
    (error) => error.code === 1 && /--origin must be https/.test(error.stderr),
  );
  await assert.rejects(
    invoke(["add", "--config-dir", root, "--name", "A", "--path", file, "--origin", "https://example.com/login"]),
    (error) => error.code === 1 && /--origin must be a bare origin/.test(error.stderr),
  );
  await assert.rejects(
    invoke(["add", "--config-dir", root, "--name", "A", "--path", path.join(root, "nope.env"), "--origin", "https://example.com"]),
    (error) => error.code === 1 && /secrets file not found/.test(error.stderr),
  );
}));

test("add rejects a relative path, a bad name, and a symlinked secrets file", async () => fixture(async (root) => {
  const file = await secretsFile(root);
  await assert.rejects(
    invoke(["add", "--config-dir", root, "--name", "A", "--path", "creds.env", "--origin", "https://example.com"]),
    (error) => error.code === 1 && /--path must be absolute/.test(error.stderr),
  );
  await assert.rejects(
    invoke(["add", "--config-dir", root, "--name", "bad name", "--path", file, "--origin", "https://example.com"]),
    (error) => error.code === 1 && /--name of letters/.test(error.stderr),
  );
  const link = path.join(root, "link.env");
  await symlink(file, link);
  await assert.rejects(
    invoke(["add", "--config-dir", root, "--name", "A", "--path", link, "--origin", "https://example.com"]),
    (error) => error.code === 1 && /secrets file is a symlink/.test(error.stderr),
  );
}));

test("status lists entries with present/absent file state and never prints a value", async () => fixture(async (root) => {
  const empty = await invoke(["status", "--config-dir", root]);
  assert.match(empty.stdout, /No secrets registry at/);

  const file = await secretsFile(root);
  await invoke(["add", "--config-dir", root, "--name", "A", "--path", file, "--origin", "https://example.com"]);
  const present = await invoke(["status", "--config-dir", root]);
  assert.match(present.stdout, /\[A\] file=.*creds\.env \(present\) origins=https:\/\/example\.com/);
  assert.doesNotMatch(present.stdout, /hunter2/);

  await rm(file);
  const absent = await invoke(["status", "--config-dir", root]);
  assert.match(absent.stdout, /\(absent\)/);
}));

test("remove drops a named entry and is a no-op for an unknown name", async () => fixture(async (root) => {
  const file = await secretsFile(root);
  await invoke(["add", "--config-dir", root, "--name", "A", "--path", file, "--origin", "https://example.com"]);
  const removed = await invoke(["remove", "--config-dir", root, "--name", "A"]);
  assert.match(removed.stdout, /Removed secrets entry "A"/);
  assert.deepEqual((await registry(root)).entries, {});

  const again = await invoke(["remove", "--config-dir", root, "--name", "A"]);
  assert.match(again.stdout, /No secrets entry "A"/);
}));

test("an unknown action and a missing --config-dir are rejected", async () => fixture(async (root) => {
  await assert.rejects(invoke(["frobnicate", "--config-dir", root]), (error) => error.code === 1 && /unknown action/.test(error.stderr));
  await assert.rejects(invoke(["status"]), (error) => error.code === 1 && /--config-dir is required/.test(error.stderr));
}));
