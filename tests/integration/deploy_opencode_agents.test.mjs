import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
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

test("default copy install is idempotent and includes the complete managed profile", async () => fixture(async root => {
  const config = path.join(root, "config");
  await deployFixture(root);
  assert.equal((await readdir(path.join(config, "agents"))).filter(name => name.endsWith(".md")).length, 7);
  for (const name of ["immutability.ts", "autonomous-kpis.ts"]) {
    await stat(path.join(config, "plugins", name));
  }
  for (const name of ["session_fetch.ts", "spike.ts", "scaffold_gitignore.ts", "validate_scaffold.ts"]) {
    await stat(path.join(config, "tools", name));
  }
  await stat(path.join(config, "node_modules", "@opencode-ai", "plugin", "package.json"));
  await stat(path.join(config, "node_modules", "playwright", "package.json"));
  await stat(path.join(config, "skills", "systematic-debugging", "SKILL.md"));

  const second = await deployFixture(root);
  assert.match(second.stdout, /Unchanged:/);
}));

test("default installation provides a self-contained workflow tool runtime", async () => fixture(async root => {
  const bin = path.join(root, "bin");
  const config = path.join(root, "config");
  const log = path.join(root, "npm.log");
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, "npm"), "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" > \"$NPM_LOG\"\n", { mode: 0o755 });

  await deployFixture(root, "install", [], { NPM_LOG: log });
  for (const name of ["session_fetch.ts", "spike.ts", "scaffold_gitignore.ts", "validate_scaffold.ts"]) {
    await stat(path.join(config, "tools", name));
  }
  await stat(path.join(config, "skills", "systematic-debugging", "SKILL.md"));
  try {
    assert.match(await readFile(log, "utf8"), /@opencode-ai\/plugin@1\.17\.15/);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const installed = JSON.parse(await readFile(path.join(config, "node_modules", "@opencode-ai", "plugin", "package.json"), "utf8"));
    assert.equal(installed.version, "1.17.15");
  }

  await deployFixture(root, "install", [], { NPM_LOG: log });
  await stat(path.join(config, "tools", "session_fetch.ts"));
}));

test("symlink install and mode-independent remove cover all managed groups", async () => fixture(async root => {
  const config = path.join(root, "config");
  await deployFixture(root, "install", ["--mode", "symlink"]);
  assert.equal((await lstat(path.join(config, "agents", "prometheus.md"))).isSymbolicLink(), true);
  assert.equal((await lstat(path.join(config, "plugins", "immutability.ts"))).isSymbolicLink(), false);
  assert.equal((await lstat(path.join(config, "plugins", "autonomous-kpis.ts"))).isSymbolicLink(), false);
  assert.equal((await lstat(path.join(config, "tools", "session_fetch.ts"))).isSymbolicLink(), false);
  assert.equal((await lstat(path.join(config, "tools", "spike.ts"))).isSymbolicLink(), true);
  assert.equal((await lstat(path.join(config, "skills", "playwright-image-generation"))).isSymbolicLink(), true);

  await deployFixture(root);
  assert.equal(await exists(path.join(config, "skills", "playwright-image-generation")), true);

  await deployFixture(root, "remove");
  for (const relative of [
    "agents/prometheus.md",
    "plugins/immutability.ts",
    "plugins/autonomous-kpis.ts",
    "tools/session_fetch.ts",
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

test("install reconciles retired agents from its prior managed inventory", async () => fixture(async root => {
  const config = path.join(root, "config");
  const agents = path.join(config, "agents");
  await deployFixture(root);
  const stateFile = path.join(agents, "cuddly-winner-managed.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  const source = path.join(repo, "agents", "retired-agent.md");
  const retired = path.join(agents, "retired-agent.md");
  const retiredContent = "previous managed agent\n";
  state.agents["retired-agent.md"] = {
    source,
    mode: "copy",
    sha256: createHash("sha256").update(retiredContent).digest("hex"),
  };
  await writeFile(stateFile, `${JSON.stringify(state)}\n`);
  await writeFile(retired, retiredContent);

  const removed = await deployFixture(root);
  assert.match(removed.stdout, /Removed retired agent: .*retired-agent\.md/);
  assert.equal(await exists(retired), false);

  const retainedState = JSON.parse(await readFile(stateFile, "utf8"));
  retainedState.agents["retired-agent.md"] = state.agents["retired-agent.md"];
  await writeFile(stateFile, `${JSON.stringify(retainedState)}\n`);
  await writeFile(retired, "user modification\n");
  const preserved = await deployFixture(root);
  assert.match(preserved.stdout, /Skipped modified or unrelated retired agent: .*retired-agent\.md/);
  assert.equal(await readFile(retired, "utf8"), "user modification\n");

  await rm(retired);
  await symlink(source, retired);
  const linked = await deployFixture(root);
  assert.match(linked.stdout, /Removed retired agent: .*retired-agent\.md/);
  assert.equal(await exists(retired), false);
}));

test("status reports every managed group without profile flags", async () => fixture(async root => {
  const result = await deployFixture(root, "status");
  for (const label of ["Agents", "Plugins", "Workflow tools", "Skills"]) assert.match(result.stdout, new RegExp(`${label} dir:`));
  assert.match(result.stdout, /\[none\].*spike\.ts/);
}));

test("retired and per-category configuration flags are rejected", async () => fixture(async root => {
  for (const args of [["--with-autonomous"], ["--with-tools"], ["--with-workflow-tools"], ["--with-skills"], ["--agents-dir", path.join(root, "agents")], ["--source-dir", path.join(root, "source")]]) {
    await assert.rejects(deployFixture(root, "install", args), /Unknown argument/);
  }
}));

test("Node policy covers the locked plugin dependency engine", async () => {
  const manifest = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8"));
  const ci = await readFile(path.join(repo, "scripts", "ci.sh"), "utf8");
  const workflow = await readFile(path.join(repo, ".github", "workflows", "ci.yml"), "utf8");

  assert.equal(manifest.engines.node, ">=22.22.2 <25");
  assert.match(ci, /NODE_MINOR/);
  assert.match(ci, /NODE_PATCH/);
  assert.match(workflow, /node-version: 24\.15\.0/);
});
