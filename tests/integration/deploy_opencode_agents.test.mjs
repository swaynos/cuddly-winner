import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const deploy = path.join(repo, "scripts/deploy-opencode-agents.sh");

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "deploy-opencode-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function deployFixture(root, action = "install", options = [], extraEnv = {}) {
  const bin = path.join(root, "bin");
  const config = path.join(root, "config");
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, "opencode"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  return run("bash", [deploy, action, "--config-dir", config, ...options], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...extraEnv },
  });
}

async function exists(file) {
  try { await stat(file); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

test("default copy install is idempotent and excludes optional groups", async () => fixture(async root => {
  const config = path.join(root, "config");
  await deployFixture(root);
  assert.equal((await readdir(path.join(config, "agents"))).filter(name => name.endsWith(".md")).length, 6);
  await stat(path.join(config, "plugins", "immutability.ts"));
  assert.equal(await exists(path.join(config, "tools")), false);
  assert.equal(await exists(path.join(config, "skills")), false);

  const second = await deployFixture(root);
  assert.match(second.stdout, /Unchanged:/);
}));

test("workflow tools install additively and remain after a default install", async () => fixture(async root => {
  const bin = path.join(root, "bin");
  const config = path.join(root, "config");
  const log = path.join(root, "npm.log");
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, "npm"), "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" > \"$NPM_LOG\"\n", { mode: 0o755 });

  await deployFixture(root, "install", ["--with-workflow-tools"], { NPM_LOG: log });
  for (const name of ["spike.ts", "scaffold_gitignore.ts", "validate_scaffold.ts"]) {
    await stat(path.join(config, "tools", name));
  }
  try {
    assert.match(await readFile(log, "utf8"), /@opencode-ai\/plugin@1\.17\.15/);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const installed = JSON.parse(await readFile(path.join(config, "node_modules", "@opencode-ai", "plugin", "package.json"), "utf8"));
    assert.equal(installed.version, "1.17.15");
  }

  await deployFixture(root);
  await stat(path.join(config, "tools", "spike.ts"));
}));

test("symlink install and mode-independent remove cover all managed groups", async () => fixture(async root => {
  const config = path.join(root, "config");
  await deployFixture(root, "install", ["--mode", "symlink", "--with-workflow-tools", "--with-skills"]);
  assert.equal((await lstat(path.join(config, "agents", "prometheus.md"))).isSymbolicLink(), true);
  assert.equal((await lstat(path.join(config, "plugins", "immutability.ts"))).isSymbolicLink(), true);
  assert.equal((await lstat(path.join(config, "tools", "spike.ts"))).isSymbolicLink(), true);
  assert.equal((await lstat(path.join(config, "skills", "playwright-image-generation"))).isSymbolicLink(), true);

  await deployFixture(root);
  assert.equal((await lstat(path.join(config, "skills", "playwright-image-generation"))).isSymbolicLink(), true);

  await deployFixture(root, "remove");
  for (const relative of [
    "agents/prometheus.md",
    "plugins/immutability.ts",
    "tools/spike.ts",
    "skills/playwright-image-generation",
  ]) assert.equal(await exists(path.join(config, relative)), false, relative);
}));

test("copy collisions are backed up and modified managed files survive removal", async () => fixture(async root => {
  const config = path.join(root, "config");
  const agents = path.join(config, "agents");
  await mkdir(agents, { recursive: true });
  await writeFile(path.join(agents, "prometheus.md"), "user collision\n");

  await deployFixture(root);
  const backups = (await readdir(agents)).filter(name => name.startsWith("prometheus.md.bak."));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(path.join(agents, backups[0]), "utf8"), "user collision\n");

  await writeFile(path.join(agents, "prometheus.md"), "user modification\n");
  await writeFile(path.join(agents, "unrelated.md"), "keep\n");
  await deployFixture(root, "remove");
  assert.equal(await readFile(path.join(agents, "prometheus.md"), "utf8"), "user modification\n");
  assert.equal(await readFile(path.join(agents, "unrelated.md"), "utf8"), "keep\n");
  assert.equal(await exists(path.join(agents, "autonomous.md")), false);
}));

test("status reports every managed group without profile flags", async () => fixture(async root => {
  const result = await deployFixture(root, "status");
  for (const label of ["Agents", "Plugins", "Workflow tools", "Skills"]) assert.match(result.stdout, new RegExp(`${label} dir:`));
  assert.match(result.stdout, /\[none\].*spike\.ts/);
}));

test("retired and per-category configuration flags are rejected", async () => fixture(async root => {
  for (const args of [["--with-autonomous"], ["--with-tools"], ["--agents-dir", path.join(root, "agents")], ["--source-dir", path.join(root, "source")]]) {
    await assert.rejects(deployFixture(root, "install", args), /Unknown argument/);
  }
}));
