import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile, readFile, stat, lstat, symlink } from "node:fs/promises";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const session = path.join(repo, "scripts", "opencode-browser-session.mjs");

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cuddly-session-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function invoke(args) { return run("node", [session, ...args]); }

function sessionFile(root, name) {
  return path.join(root, "cuddly-winner-sessions", `${name}.json`);
}
async function writeSession(root, name, record) {
  const dir = path.join(root, "cuddly-winner-sessions");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(sessionFile(root, name), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}
function validRecord(name = "A") {
  return {
    schema_version: 1,
    name,
    origins: ["https://example.com"],
    user_agent: "Mozilla/5.0 test",
    captured_at: "2026-01-01T00:00:00.000Z",
    state: { cookies: [{ name: "sid", value: "x", domain: "example.com", path: "/", secure: true, httpOnly: true }], origins: [] },
  };
}

test("status reports no sessions, then lists a captured one without printing cookie values", async () => fixture(async (root) => {
  const empty = await invoke(["status", "--config-dir", root]);
  assert.match(empty.stdout, /No captured sessions/);

  await writeSession(root, "A", validRecord("A"));
  const listed = await invoke(["status", "--config-dir", root]);
  assert.match(listed.stdout, /\[A\] cookies=1 origins=https:\/\/example\.com/);
  assert.doesNotMatch(listed.stdout, /sid/);
  assert.doesNotMatch(listed.stdout, /"x"/);
}));

test("status of a specific missing name reports it as missing", async () => fixture(async (root) => {
  await writeSession(root, "A", validRecord("A"));
  const result = await invoke(["status", "--config-dir", root, "--name", "B"]);
  assert.match(result.stdout, /\[missing\] B/);
}));

test("remove drops a named session and is a no-op for an unknown name", async () => fixture(async (root) => {
  await writeSession(root, "A", validRecord("A"));
  const removed = await invoke(["remove", "--config-dir", root, "--name", "A"]);
  assert.match(removed.stdout, /Removed captured session "A"/);
  await assert.rejects(stat(sessionFile(root, "A")));

  const again = await invoke(["remove", "--config-dir", root, "--name", "A"]);
  assert.match(again.stdout, /No captured session "A"/);
}));

test("a malformed or symlinked session file is rejected by status", async () => fixture(async (root) => {
  const dir = path.join(root, "cuddly-winner-sessions");
  await mkdir(dir, { recursive: true });
  await writeFile(sessionFile(root, "bad"), "not json\n");
  await assert.rejects(
    invoke(["status", "--config-dir", root, "--name", "bad"]),
    (error) => error.code === 1 && /not valid JSON/.test(error.stderr),
  );

  const outside = path.join(root, "outside.json");
  await writeFile(outside, `${JSON.stringify(validRecord("link"))}\n`);
  await symlink(outside, sessionFile(root, "link"));
  await assert.rejects(
    invoke(["status", "--config-dir", root, "--name", "link"]),
    (error) => error.code === 1 && /is a symlink/.test(error.stderr),
  );
}));

test("status and remove reject a symlinked sessions directory without touching its target", async () => fixture(async (root) => {
  const outside = path.join(root, "outside");
  const sessions = path.join(root, "cuddly-winner-sessions");
  await mkdir(outside);
  await writeFile(path.join(outside, "A.json"), `${JSON.stringify(validRecord("A"))}\n`);
  await symlink(outside, sessions);

  await assert.rejects(
    invoke(["status", "--config-dir", root]),
    (error) => error.code === 1 && /sessions directory is a symlink/.test(error.stderr),
  );
  await assert.rejects(
    invoke(["remove", "--config-dir", root, "--name", "A"]),
    (error) => error.code === 1 && /sessions directory is a symlink/.test(error.stderr),
  );
  assert.equal(await readFile(path.join(outside, "A.json"), "utf8"), `${JSON.stringify(validRecord("A"))}\n`);
}));

test("capture rejects incomplete arguments before opening a browser", async () => fixture(async (root) => {
  const base = ["capture", "--config-dir", root, "--name", "A"];
  await assert.rejects(invoke(base), (error) => error.code === 1 && /requires --url/.test(error.stderr));
  await assert.rejects(
    invoke([...base, "--url", "https://example.com/login"]),
    (error) => error.code === 1 && /requires at least one --origin/.test(error.stderr),
  );
  await assert.rejects(
    invoke([...base, "--url", "http://example.com/login", "--origin", "https://example.com", "--cookie", "sid"]),
    (error) => error.code === 1 && /must be https/.test(error.stderr),
  );
  await assert.rejects(
    invoke([...base, "--url", "https://example.com/login", "--origin", "https://example.com/"]),
    (error) => error.code === 1 && /bare origin/.test(error.stderr),
  );
  await assert.rejects(
    invoke([...base, "--url", "https://other.com/login", "--origin", "https://example.com", "--cookie", "sid"]),
    (error) => error.code === 1 && /--url host must be one of the configured --origin hosts/.test(error.stderr),
  );
  await assert.rejects(
    invoke([...base, "--url", "https://example.com/login", "--origin", "https://example.com"]),
    (error) => error.code === 1 && /--cookie .* or --complete-url/.test(error.stderr),
  );
}));

test("a bad action and a missing name or config-dir are rejected", async () => fixture(async (root) => {
  await assert.rejects(invoke(["frobnicate", "--config-dir", root]), (error) => error.code === 1 && /unknown action/.test(error.stderr));
  await assert.rejects(invoke(["status"]), (error) => error.code === 1 && /--config-dir is required/.test(error.stderr));
  await assert.rejects(
    invoke(["capture", "--config-dir", root, "--name", "has space"]),
    (error) => error.code === 1 && /--name of letters/.test(error.stderr),
  );
}));
