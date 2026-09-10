import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { cp, lstat, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
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

async function expectStatusDrift(root) {
  try {
    await deployFixture(root, "status");
  } catch (error) {
    assert.equal(error.code, 1);
    return error;
  }
  assert.fail("status unexpectedly accepted managed-entry drift");
}

async function exists(file) {
  try { await stat(file); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

test("default copy install is idempotent and includes the complete managed profile", async () => fixture(async root => {
  const config = path.join(root, "config");
  await deployFixture(root);
  assert.equal((await readdir(path.join(config, "agents"))).filter(name => name.endsWith(".md")).length, 4);
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
  const backupDir = path.join(config, "backups", "agents");
  const backups = (await readdir(backupDir)).filter(name => name.startsWith("prometheus.md.bak."));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(path.join(backupDir, backups[0]), "utf8"), "user collision\n");

  await writeFile(path.join(agents, "prometheus.md"), "user modification\n");
  await writeFile(path.join(agents, "unrelated.md"), "keep\n");
  await deployFixture(root, "remove");
  assert.equal(await readFile(path.join(agents, "prometheus.md"), "utf8"), "user modification\n");
  assert.equal(await readFile(path.join(agents, "unrelated.md"), "utf8"), "keep\n");
  assert.equal(await exists(path.join(agents, "ask.md")), false);
}));

test("install and remove preserve user-owned entries at retired artifact names", async () => fixture(async root => {
  const config = path.join(root, "config");
  const retiredFile = path.join(config, "plugins", "opencode-autonomous-supervisor.js");
  const retiredDir = path.join(config, "plugins", "opencode-autonomous-supervisor");
  const retiredTool = path.join(config, "tools", "run.ts");
  await mkdir(retiredDir, { recursive: true });
  await mkdir(path.dirname(retiredTool), { recursive: true });
  await writeFile(retiredFile, "user-owned plugin\n");
  await writeFile(path.join(retiredDir, "notes.txt"), "user-owned directory\n");
  await writeFile(retiredTool, "user-owned tool\n");

  const installed = await deployFixture(root);
  assert.match(installed.stdout, /Retired artifact conflict: .*opencode-autonomous-supervisor\.js/);
  assert.equal(await readFile(retiredFile, "utf8"), "user-owned plugin\n");
  assert.equal(await readFile(path.join(retiredDir, "notes.txt"), "utf8"), "user-owned directory\n");
  assert.equal(await readFile(retiredTool, "utf8"), "user-owned tool\n");

  const status = await expectStatusDrift(root);
  assert.match(status.stdout, /Retired artifact conflict: .*opencode-autonomous-supervisor/);
  assert.match(status.stdout, /Managed profile: drifted; run install, then restart OpenCode\./);

  const removed = await deployFixture(root, "remove");
  assert.match(removed.stdout, /Retired artifact conflict: .*tools\/run\.ts/);
  assert.equal(await readFile(retiredFile, "utf8"), "user-owned plugin\n");
  assert.equal(await readFile(path.join(retiredDir, "notes.txt"), "utf8"), "user-owned directory\n");
  assert.equal(await readFile(retiredTool, "utf8"), "user-owned tool\n");
}));

test("install and remove delete only exact known retired artifacts", async () => fixture(async root => {
  const retired = path.join(root, "config", "plugins", "opencode-autonomous-supervisor.js");
  const legacyContent = 'export { default } from "./opencode-autonomous-supervisor/index.js";\n';
  await mkdir(path.dirname(retired), { recursive: true });
  await writeFile(retired, legacyContent);
  await deployFixture(root);
  assert.equal(await exists(retired), false);

  await writeFile(retired, legacyContent);
  await deployFixture(root, "remove");
  assert.equal(await exists(retired), false);
}));

test("install reconciles retired agents from its prior managed inventory", async () => fixture(async root => {
  const config = path.join(root, "config");
  const agents = path.join(config, "agents");
  await deployFixture(root);
  const stateFile = path.join(agents, "cuddly-winner-managed.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  const source = path.join(repo, "agents", "autonomous.md");
  const retired = path.join(agents, "autonomous.md");
  const retiredContent = "previous managed agent\n";
  state.agents["autonomous.md"] = {
    source,
    mode: "copy",
    sha256: createHash("sha256").update(retiredContent).digest("hex"),
  };
  await writeFile(stateFile, `${JSON.stringify(state)}\n`);
  await writeFile(retired, retiredContent);

  const status = await expectStatusDrift(root);
  assert.match(status.stdout, /\[retired copy\].*autonomous\.md/);

  const removed = await deployFixture(root);
  assert.match(removed.stdout, /Removed retired agent: .*autonomous\.md/);
  assert.equal(await exists(retired), false);

  const retainedState = JSON.parse(await readFile(stateFile, "utf8"));
  retainedState.agents["autonomous.md"] = state.agents["autonomous.md"];
  await writeFile(stateFile, `${JSON.stringify(retainedState)}\n`);
  await writeFile(retired, "user modification\n");
  const preserved = await deployFixture(root);
  assert.match(preserved.stdout, /Skipped modified or unrelated retired agent: .*autonomous\.md/);
  assert.equal(await readFile(retired, "utf8"), "user modification\n");

  await rm(retired);
  await symlink(source, retired);
  const linked = await deployFixture(root);
  assert.match(linked.stdout, /Removed retired agent: .*autonomous\.md/);
  assert.equal(await exists(retired), false);
}));

test("malformed managed-agent state cannot escape the agents directory", async () => fixture(async root => {
  for (const action of ["install", "status", "remove"]) {
    const actionRoot = path.join(root, action);
    const agents = path.join(actionRoot, "config", "agents");
    const victim = path.join(actionRoot, "victim.md");
    const content = "must survive\n";
    await mkdir(agents, { recursive: true });
    await writeFile(victim, content);
    await writeFile(path.join(agents, "cuddly-winner-managed.json"), JSON.stringify({
      schema_version: 1,
      agents: {
        "../../victim.md": {
          source: path.join(repo, "agents", "autonomous.md"),
          mode: "copy",
          sha256: createHash("sha256").update(content).digest("hex"),
        },
      },
    }), { mode: 0o600 });

    await assert.rejects(
      deployFixture(actionRoot, action),
      error => error.code === 1 && /invalid managed agent name/.test(error.stderr),
    );
    assert.equal(await readFile(victim, "utf8"), content);
  }
}));

test("managed child directory symlinks are rejected for every action", async () => fixture(async root => {
  for (const action of ["install", "status", "remove"]) {
    const actionRoot = path.join(root, action);
    const config = path.join(actionRoot, "config");
    const outside = path.join(actionRoot, "outside-agents");
    await mkdir(config, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "marker.txt"), "outside\n");
    await cp(path.join(repo, "agents", "prometheus.md"), path.join(outside, "prometheus.md"));
    await symlink(outside, path.join(config, "agents"));
    const before = await readdir(outside);

    await assert.rejects(
      deployFixture(actionRoot, action),
      error => error.code === 1 && /symlinked managed parent/.test(error.stderr),
    );
    assert.deepEqual(await readdir(outside), before);
  }
}));

test("config file symlink leaves are rejected without changing their targets", async () => fixture(async root => {
  for (const name of ["opencode.json", "config.json"]) {
    for (const action of ["install", "status", "remove"]) {
      const actionRoot = path.join(root, name, action);
      const config = path.join(actionRoot, "config");
      const outside = path.join(actionRoot, "outside.json");
      const content = `${JSON.stringify({ sentinel: `${name}-${action}`, mcp: { notebooklm: { type: "local", command: ["npx", "-y", "notebooklm-mcp@latest"], enabled: true } } }, null, 2)}\n`;
      await mkdir(config, { recursive: true });
      await writeFile(outside, content);
      await symlink(outside, path.join(config, name));

      await assert.rejects(
        deployFixture(actionRoot, action),
        error => error.code === 1 && /symlinked managed destination leaf/.test(error.stderr),
      );
      assert.equal(await readFile(outside, "utf8"), content);
      assert.equal((await lstat(path.join(config, name))).isSymbolicLink(), true);
    }
  }
}));

test("legacy config notebooklm participates in deploy status and remove", async () => fixture(async root => {
  const config = path.join(root, "config");
  const legacyConfig = path.join(config, "config.json");
  await deployFixture(root);
  await writeFile(legacyConfig, `${JSON.stringify({
    mcp: { notebooklm: { type: "local", command: ["npx", "-y", "notebooklm-mcp@latest"], enabled: true } },
  }, null, 2)}\n`);

  const status = await expectStatusDrift(root);
  assert.match(status.stdout, /\[retired\] notebooklm/);
  await deployFixture(root, "remove");
  assert.equal(JSON.parse(await readFile(legacyConfig, "utf8")).mcp, undefined);
}));

test("legacy config removal preserves a user-owned notebooklm variation", async () => fixture(async root => {
  const config = path.join(root, "config");
  const legacyConfig = path.join(config, "config.json");
  const userOwned = { type: "remote", url: "https://example.test/notebooklm", enabled: true };
  await deployFixture(root);
  await writeFile(legacyConfig, `${JSON.stringify({ mcp: { notebooklm: userOwned } }, null, 2)}\n`);

  const removed = await deployFixture(root, "remove");
  assert.match(removed.stdout, /ownership not proven; preserved/);
  assert.deepEqual(JSON.parse(await readFile(legacyConfig, "utf8")).mcp.notebooklm, userOwned);
}));

test("a symlink supplied as the config root resolves once", async () => fixture(async root => {
  const target = path.join(root, "real config");
  const alias = path.join(root, "config");
  await mkdir(target);
  await symlink(target, alias);

  await deployFixture(root);
  await deployFixture(root, "status");
  await deployFixture(root, "remove");
  assert.equal(await exists(path.join(target, "agents", "prometheus.md")), false);
}));

test("status classifies current and drifted managed entries without changing them", async () => fixture(async root => {
  const config = path.join(root, "config");
  await deployFixture(root);

  const current = await deployFixture(root, "status");
  for (const label of ["Agents", "Plugins", "Workflow tools", "Skills"]) assert.match(current.stdout, new RegExp(`${label} dir:`));
  assert.match(current.stdout, /\[current copy\].*prometheus\.md/);
  assert.match(current.stdout, /\[current copy\].*systematic-debugging/);
  assert.match(current.stdout, /Managed entries: current/);
  assert.match(current.stdout, /\[current: 1\.17\.15\] runtime package: @opencode-ai\/plugin/);
  assert.match(current.stdout, /\[current: 1\.58\.2\] runtime package: playwright/);
  assert.match(current.stdout, /Managed profile: current/);

  const agents = path.join(config, "agents");
  const prometheus = path.join(agents, "prometheus.md");
  const ask = path.join(agents, "ask.md");
  const reviewer = path.join(agents, "reviewer.md");
  const grounder = path.join(agents, "grounder.md");

  await writeFile(prometheus, "stale or locally modified\n");
  await rm(ask);
  await symlink(path.join(repo, "agents", "ask.md"), ask);
  await rm(reviewer);
  await symlink(path.join(repo, "agents", "ask.md"), reviewer);
  await rm(grounder);
  await symlink(path.join(root, "missing-agent.md"), grounder);
  await writeFile(path.join(config, "skills", "systematic-debugging", "SKILL.md"), "changed skill\n");

  const before = {
    prometheus: await readFile(prometheus, "utf8"),
    ask: await lstat(ask).then(() => path.join(repo, "agents", "ask.md")),
    reviewer: await lstat(reviewer).then(() => path.join(repo, "agents", "ask.md")),
  };
  const result = await expectStatusDrift(root);

  assert.match(result.stdout, /\[stale or modified copy\].*prometheus\.md/);
  assert.match(result.stdout, /\[current link\].*ask\.md/);
  assert.match(result.stdout, /\[foreign link\].*reviewer\.md/);
  assert.match(result.stdout, /\[foreign link\].*grounder\.md/);
  assert.match(result.stdout, /\[stale or modified copy\].*systematic-debugging/);
  assert.match(result.stdout, /Managed entries: drifted; run install, then restart OpenCode\./);

  assert.equal(await readFile(prometheus, "utf8"), before.prometheus);
  assert.equal((await lstat(ask)).isSymbolicLink(), true);
  assert.equal((await lstat(reviewer)).isSymbolicLink(), true);
}));

test("status exits nonzero when a managed entry drifts", async () => fixture(async root => {
  const config = path.join(root, "config");
  await deployFixture(root);
  await writeFile(path.join(config, "agents", "prometheus.md"), "drifted\n");

  const result = await expectStatusDrift(root);
  assert.match(result.stdout, /Managed entries: drifted; run install, then restart OpenCode\./);
}));

test("status exits nonzero when rule instruction wiring drifts", async () => fixture(async root => {
  const config = path.join(root, "config");
  await deployFixture(root);
  const configFile = path.join(config, "opencode.json");
  const value = JSON.parse(await readFile(configFile, "utf8"));
  value.instructions = [];
  await writeFile(configFile, `${JSON.stringify(value, null, 2)}\n`);

  const result = await expectStatusDrift(root);
  assert.match(result.stdout, /\[absent\] instructions:/);
  assert.match(result.stdout, /Managed profile: drifted; run install, then restart OpenCode\./);
}));

test("status includes runtime version drift and state-helper errors in its exit", async () => fixture(async root => {
  const config = path.join(root, "config");
  await deployFixture(root);
  const packageFile = path.join(config, "node_modules", "playwright", "package.json");
  const packageValue = JSON.parse(await readFile(packageFile, "utf8"));
  packageValue.version = "0.0.0";
  await writeFile(packageFile, `${JSON.stringify(packageValue)}\n`);

  const runtimeStatus = await expectStatusDrift(root);
  assert.match(runtimeStatus.stdout, /\[version mismatch: 0\.0\.0\] runtime package: playwright \(expected 1\.58\.2\)/);
  assert.match(runtimeStatus.stdout, /Managed profile: drifted/);

  await deployFixture(root);
  const configValue = JSON.parse(await readFile(path.join(config, "opencode.json"), "utf8"));
  configValue.mcp["cuddly-winner-research-browser"].enabled = false;
  await writeFile(path.join(config, "opencode.json"), `${JSON.stringify(configValue, null, 2)}\n`);
  const mcpStatus = await expectStatusDrift(root);
  assert.match(mcpStatus.stdout, /\[modified\] cuddly-winner-research-browser/);
  assert.match(mcpStatus.stdout, /Managed profile: drifted/);

  await deployFixture(root);
  await rm(path.join(config, "agents", "cuddly-winner-managed.json"));
  const missingStateStatus = await expectStatusDrift(root);
  assert.match(missingStateStatus.stdout, /Managed agent state: missing/);
  assert.match(missingStateStatus.stdout, /Managed profile: drifted/);

  await deployFixture(root);
  await writeFile(path.join(config, "agents", "cuddly-winner-managed.json"), "not json\n");
  const stateStatus = await expectStatusDrift(root);
  assert.match(stateStatus.stderr, /managed agent state is invalid/);
  assert.match(stateStatus.stdout, /Managed agent state: error/);
  assert.match(stateStatus.stdout, /Plugins dir:/);
  assert.match(stateStatus.stdout, /Managed profile: drifted/);
}));

test("runtime integrity detects changed and missing code while removal preserves user data", async () => fixture(async root => {
  const config = path.join(root, "config");
  const integrityState = path.join(config, "node_modules", ".cuddly-winner-runtime-integrity.json");
  await deployFixture(root);
  await stat(integrityState);

  const pluginEntrypoint = path.join(config, "node_modules", "@opencode-ai", "plugin", "dist", "index.js");
  await writeFile(pluginEntrypoint, "modified runtime\n");
  const modified = await expectStatusDrift(root);
  assert.match(modified.stdout, /\[modified\] runtime content: node_modules/);

  await deployFixture(root);
  const playwrightEntrypoint = path.join(config, "node_modules", "playwright", "cli.js");
  await rm(playwrightEntrypoint);
  const missing = await expectStatusDrift(root);
  assert.match(missing.stdout, /\[modified\] runtime content: node_modules/);

  await deployFixture(root);
  const userData = path.join(config, "node_modules", "user-data.txt");
  await writeFile(userData, "keep\n");
  await deployFixture(root, "remove");
  assert.equal(await readFile(userData, "utf8"), "keep\n");
  assert.equal(await exists(integrityState), false);

  await deployFixture(root);
  await writeFile(integrityState, "user-owned state\n");
  const removed = await deployFixture(root, "remove");
  assert.match(removed.stdout, /Runtime integrity state: modified; preserved/);
  assert.equal(await readFile(integrityState, "utf8"), "user-owned state\n");
}));

test("runtime integrity detects transitive package modification, deletion, and addition", async () => fixture(async root => {
  const config = path.join(root, "config");
  await deployFixture(root);

  await writeFile(path.join(config, "node_modules", "playwright-core", "index.js"), "modified transitive runtime\n");
  const modified = await expectStatusDrift(root);
  assert.match(modified.stdout, /\[modified\] runtime content: node_modules/);

  await deployFixture(root);
  await rm(path.join(config, "node_modules", "@opencode-ai", "sdk", "dist", "index.js"));
  const deleted = await expectStatusDrift(root);
  assert.match(deleted.stdout, /\[modified\] runtime content: node_modules/);

  await deployFixture(root);
  await writeFile(path.join(config, "node_modules", "zod", "injected-runtime.js"), "unexpected runtime\n");
  const added = await expectStatusDrift(root);
  assert.match(added.stdout, /\[modified\] runtime content: node_modules/);
}));

test("runtime reinstall replaces a drifted tree and backs up injected data", async () => fixture(async root => {
  const config = path.join(root, "config");
  const injectedRelative = path.join("zod", "injected-runtime.js");
  const injected = path.join(config, "node_modules", injectedRelative);
  await deployFixture(root);
  await writeFile(injected, "unexpected runtime\n");
  await expectStatusDrift(root);

  await deployFixture(root);
  assert.equal(await exists(injected), false);
  const backupRoot = path.join(config, "backups");
  const runtimeBackups = (await readdir(backupRoot)).filter(name => name.startsWith("node_modules.bak."));
  assert.equal(runtimeBackups.length, 1);
  assert.equal(await readFile(path.join(backupRoot, runtimeBackups[0], injectedRelative), "utf8"), "unexpected runtime\n");
  const status = await deployFixture(root, "status");
  assert.match(status.stdout, /\[current\] runtime content: node_modules/);
  assert.match(status.stdout, /Managed profile: current/);
}));

test("status scans a newly added retired agent absent from managed state", async () => fixture(async root => {
  const retired = path.join(root, "config", "agents", "autonomous.md");
  await deployFixture(root);
  const state = JSON.parse(await readFile(path.join(root, "config", "agents", "cuddly-winner-managed.json"), "utf8"));
  assert.equal(state.agents["autonomous.md"], undefined);
  await writeFile(retired, "user-owned retired name\n");

  const status = await expectStatusDrift(root);
  assert.match(status.stdout, /\[modified or unrelated\].*autonomous\.md/);
  assert.equal(await readFile(retired, "utf8"), "user-owned retired name\n");

  await rm(path.join(root, "config", "agents", "cuddly-winner-managed.json"));
  const missingState = await expectStatusDrift(root);
  assert.match(missingState.stdout, /Managed agent state: missing/);
  assert.match(missingState.stdout, /\[modified or unrelated\].*autonomous\.md/);
  assert.equal(await readFile(retired, "utf8"), "user-owned retired name\n");
}));

test("status reports missing entries and remove accepts a relative repository link", async () => fixture(async root => {
  const config = path.join(root, "config");
  const missing = await expectStatusDrift(root);
  assert.match(missing.stdout, /\[missing\].*spike\.ts/);
  assert.match(missing.stdout, /Managed entries: drifted; run install, then restart OpenCode\./);

  await deployFixture(root);
  const agents = path.join(config, "agents");
  const ask = path.join(agents, "ask.md");
  await rm(ask);
  await symlink(path.relative(agents, path.join(repo, "agents", "ask.md")), ask);
  await deployFixture(root, "remove");
  assert.equal(await exists(ask), false);
}));

test("install relocates discoverable managed skill backups outside the skills directory", async () => fixture(async root => {
  const config = path.join(root, "config");
  await deployFixture(root);
  const skills = path.join(config, "skills");
  const legacy = path.join(skills, "cuddly-winner-feedback.bak.legacy");
  await cp(path.join(skills, "cuddly-winner-feedback"), legacy, { recursive: true });

  const status = await expectStatusDrift(root);
  assert.match(status.stdout, /\[discoverable backup\].*cuddly-winner-feedback\.bak\.legacy/);
  assert.match(status.stdout, /Managed entries: drifted/);
  assert.equal(await exists(legacy), true);

  const installed = await deployFixture(root);
  assert.match(installed.stdout, /Relocated discoverable backup:/);
  assert.equal(await exists(legacy), false);
  assert.equal(await exists(path.join(config, "backups", "skills", "cuddly-winner-feedback.bak.legacy")), true);
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
  assert.match(ci, /mktemp -d/);
  assert.match(ci, /CI_CONFIG_DIR=/);
  assert.match(ci, /OPENCODE_CLI_VERSION=.*\.opencode-cli-version/);
  assert.match(ci, /OPENCODE_CLI_PREFIX="\$\{CI_PROFILE_ROOT\}\/opencode-cli"/);
  assert.match(ci, /NPM_CONFIG_CACHE="\$\{CI_PROFILE_ROOT\}\/npm-cache" npm install/);
  assert.match(ci, /npm install --prefix "\$OPENCODE_CLI_PREFIX"[^\n]+"opencode-ai@\$\{OPENCODE_CLI_VERSION\}"/);
  assert.match(ci, /OPENCODE_CLI_BIN=.*node_modules\/\.bin\/opencode/);
  assert.match(ci, /PATH="\$OPENCODE_CLI_BIN_DIR:\$PATH"/);
  assert.match(ci, /OPENCODE_E2E_BIN="\$OPENCODE_CLI_BIN"/);
  assert.doesNotMatch(ci, /npm install -g/);
  assert.doesNotMatch(ci, /trap - EXIT/);
  assert.doesNotMatch(ci, /export OPENCODE_DEPLOY_CONFIG_DIR=/);
  assert.match(ci, /deploy-opencode-agents\.sh install --config-dir "\$CI_CONFIG_DIR"/);
  assert.match(ci, /deploy-opencode-agents\.sh status --config-dir "\$CI_CONFIG_DIR"/);
  assert.match(ci, /deploy-opencode-agents\.sh remove --config-dir "\$CI_CONFIG_DIR"/);
  assert.ok(ci.indexOf("deploy-opencode-agents.sh install") < ci.indexOf("verify_opencode.py --skip-llm"));
  assert.ok(ci.indexOf("verify_opencode.py --skip-llm") < ci.indexOf("deploy-opencode-agents.sh status"));
  assert.match(ci, /evals\/seed_build\/test_end_to_end\.py/);
  assert.doesNotMatch(workflow, /OPENCODE_DEPLOY_CONFIG_DIR/);
  assert.match(workflow, /CUDDLY_WINNER_CI_PROFILE_PARENT: \$\{\{ runner\.temp \}\}/);
  assert.match(workflow, /node-version: 24\.15\.0/);
});
