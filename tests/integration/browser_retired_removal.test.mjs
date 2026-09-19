import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const deploy = path.join(repo, "scripts", "deploy-opencode-agents.sh");

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "retired-browser-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function deployFixture(root, action) {
  const bin = path.join(root, "bin");
  const config = path.join(root, "config");
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, "opencode"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  return run("bash", [deploy, action, "--config-dir", config], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
}

test("installer leaves client-owned legacy browser files untouched", async () => fixture(async (root) => {
  const config = path.join(root, "config");
  const wrapper = path.join(config, "cuddly-winner-browser-mcp.mjs");
  const session = path.join(config, "cuddly-winner-browser-session.mjs");
  const engine = path.join(config, "cuddly-winner-browser");
  await mkdir(engine, { recursive: true });
  await writeFile(wrapper, "client-owned wrapper\n");
  await writeFile(session, "client-owned session helper\n");
  await writeFile(path.join(engine, "browser"), "client-owned engine\n");

  const installed = await deployFixture(root, "install");
  assert.doesNotMatch(installed.stdout, /Retired browser/);
  assert.equal(await readFile(wrapper, "utf8"), "client-owned wrapper\n");
  assert.equal(await readFile(session, "utf8"), "client-owned session helper\n");
  assert.equal(await readFile(path.join(engine, "browser"), "utf8"), "client-owned engine\n");
}));

test("installer removes only a proved retired browser artifact and preserves a conflict", async () => fixture(async (root) => {
  const skill = path.join(root, "config", "skills", "playwright-image-generation");
  await mkdir(path.dirname(skill), { recursive: true });
  await symlink(path.join(repo, "skills", "playwright-image-generation"), skill);

  await assert.rejects(deployFixture(root, "status"), (error) => error.code === 1 && /retired managed artifact/.test(error.stdout));
  const installed = await deployFixture(root, "install");
  assert.match(installed.stdout, /Removed retired managed artifact/);
  await assert.rejects(stat(skill), { code: "ENOENT" });

  await mkdir(skill, { recursive: true });
  await writeFile(path.join(skill, "SKILL.md"), "user-owned skill\n");
  await assert.rejects(deployFixture(root, "status"), (error) => error.code === 1 && /Retired artifact conflict/.test(error.stdout));
  const retry = await deployFixture(root, "install");
  assert.match(retry.stdout, /Retired artifact conflict/);
  assert.equal((await stat(path.join(skill, "SKILL.md"))).isFile(), true);
}));
