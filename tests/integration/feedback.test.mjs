import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmod, lstat, mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const deploy = path.join(repo, "scripts/deploy-opencode-agents.sh");
const sourceSkill = path.join(repo, "skills", "cuddly-winner-feedback");
const recorder = path.join(sourceSkill, "record-feedback.mjs");

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "feedback-test-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function runRecorder(script, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `recorder exited ${code}`));
    });
    child.stdin.end(input);
  });
}

test("recorder stores a bounded private report with local metadata", async () => fixture(async root => {
  const config = path.join(root, "config");
  const clone = path.join(root, "clone");
  const deployed = path.join(config, "skills", "cuddly-winner-feedback");
  await mkdir(path.join(clone, "feedback"), { recursive: true });
  await mkdir(path.dirname(deployed), { recursive: true });
  await mkdir(path.join(config, "feedback"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(config, "feedback", "cuddly-winner-feedback-root"), `${path.join(clone, "feedback")}\n`, { mode: 0o600 });
  await symlink(sourceSkill, deployed);

  const result = await runRecorder(path.join(deployed, "record-feedback.mjs"), "# Summary\nPrometheus handoff missed verification.\n");
  const report = result.stdout.trim();
  const expectedInbox = path.join(await realpath(path.join(clone, "feedback")), "inbox");
  assert.match(report, new RegExp(`^${expectedInbox.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/.+\\.md$`));
  assert.match(await readFile(report, "utf8"), /schema_version: 1\nstatus: new\ncaptured_at: .+Z/);
  assert.match(await readFile(report, "utf8"), /Prometheus handoff missed verification/);
  assert.equal((await stat(report)).mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(report))).mode & 0o777, 0o700);
}));

test("recorder rejects empty, oversized, and stale-locator input without writes", async () => fixture(async root => {
  const config = path.join(root, "config");
  const deployed = path.join(config, "skills", "cuddly-winner-feedback");
  await mkdir(path.dirname(deployed), { recursive: true });
  await mkdir(path.join(config, "feedback"), { recursive: true });
  await writeFile(path.join(config, "feedback", "cuddly-winner-feedback-root"), `${path.join(root, "missing", "feedback")}\n`);
  await symlink(sourceSkill, deployed);

  await assert.rejects(runRecorder(path.join(deployed, "record-feedback.mjs"), ""), /empty/i);
  await assert.rejects(runRecorder(path.join(deployed, "record-feedback.mjs"), "x".repeat(1024 * 1024 + 1)), /reinstall|1 MiB/i);
}));

test("recorder uses the lexical deployed package path in copy and symlink modes", async () => fixture(async root => {
  for (const mode of ["copy", "symlink"]) {
    const config = path.join(root, mode, "config");
    const clone = path.join(root, mode, "clone");
    const deployed = path.join(config, "skills", "cuddly-winner-feedback");
    await mkdir(path.join(clone, "feedback"), { recursive: true });
    await mkdir(path.join(config, "feedback"), { recursive: true });
    await writeFile(path.join(config, "feedback", "cuddly-winner-feedback-root"), `${path.join(clone, "feedback")}\n`);
    await mkdir(path.dirname(deployed), { recursive: true });
    if (mode === "symlink") await symlink(sourceSkill, deployed);
    else {
      await mkdir(deployed);
      await writeFile(path.join(deployed, "record-feedback.mjs"), await readFile(recorder));
    }
    const result = await runRecorder(path.join(deployed, "record-feedback.mjs"), "# Summary\nMixed result\n");
    assert.ok(result.stdout.trim().startsWith(path.join(await realpath(path.join(clone, "feedback")), "inbox")));
  }
}));

test("installer manages only the current feedback locator and preserves feedback files", async () => fixture(async root => {
  const config = path.join(root, "config");
  const bin = path.join(root, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, "opencode"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  await run("bash", [deploy, "install", "--config-dir", config], { env });
  const locator = path.join(config, "feedback", "cuddly-winner-feedback-root");
  assert.equal((await stat(locator)).mode & 0o777, 0o600);
  assert.match(await readFile(locator, "utf8"), /\/feedback\n$/);
  const second = await run("bash", [deploy, "install", "--config-dir", config], { env });
  assert.match(second.stdout, /Feedback locator: current/);
  assert.match((await run("bash", [deploy, "status", "--config-dir", config], { env })).stdout, /Feedback locator: current/);

  await writeFile(locator, `${path.join(root, "removed-clone", "feedback")}\n`, { mode: 0o600 });
  assert.match((await run("bash", [deploy, "status", "--config-dir", config], { env })).stdout, /Feedback locator: stale/);
  const replacement = await run("bash", [deploy, "install", "--config-dir", config], { env });
  assert.match(replacement.stdout, /Backed up existing entry/);
  assert.match(replacement.stdout, /Feedback locator: installed/);

  await writeFile(path.join(config, "feedback", "private-note.md"), "retain\n");
  await writeFile(locator, "/modified/feedback\n", { mode: 0o600 });
  const removed = await run("bash", [deploy, "remove", "--config-dir", config], { env });
  assert.match(removed.stdout, /Feedback locator: modified; preserved/);
  assert.equal(await readFile(path.join(config, "feedback", "private-note.md"), "utf8"), "retain\n");
}));

test("feedback tree is ignored while force-add remains a documented Git override", async () => fixture(async root => {
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(path.join(root, ".gitignore"), "/feedback/\n");
  await mkdir(path.join(root, "feedback", "inbox"), { recursive: true });
  await writeFile(path.join(root, "feedback", "inbox", "mixed.md"), "session: private\nsource: /private/project\n");
  const status = await run("git", ["status", "--short"], { cwd: root });
  assert.equal(status.stdout, "?? .gitignore\n");
  await run("git", ["add", "."], { cwd: root });
  assert.equal((await run("git", ["diff", "--cached", "--name-only"], { cwd: root })).stdout, ".gitignore\n");
  const check = await run("git", ["check-ignore", "-v", "feedback/inbox/mixed.md"], { cwd: root });
  assert.match(check.stdout, /\/feedback\//);
}));

test("recorder has no network dependency and rejects malformed locators", async () => fixture(async root => {
  const source = await readFile(recorder, "utf8");
  assert.doesNotMatch(source, /node:(?:http|https|net|tls|dgram)/);
  const config = path.join(root, "config");
  const deployed = path.join(config, "skills", "cuddly-winner-feedback");
  await mkdir(path.dirname(deployed), { recursive: true });
  await mkdir(path.join(config, "feedback"), { recursive: true });
  await writeFile(path.join(config, "feedback", "cuddly-winner-feedback-root"), "relative/path\n");
  await symlink(sourceSkill, deployed);
  await assert.rejects(runRecorder(path.join(deployed, "record-feedback.mjs"), "# Summary\nBroken\n"), /malformed.*reinstall/i);
}));
