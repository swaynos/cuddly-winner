import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { cp, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const deploy = path.join(repo, "scripts/deploy-opencode-agents.sh");

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "deploy-opencode-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function deployFixture(root, action, options = []) {
  const bin = path.join(root, "bin");
  const config = path.join(root, "config");
  const source = path.join(root, "agents-source");
  await mkdir(bin, { recursive: true });
  await mkdir(source);
  await writeFile(path.join(source, "agent.md"), "---\nname: agent\n---\n");
  await writeFile(path.join(bin, "opencode"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  return run("bash", [deploy, action, "--config-dir", config, "--source-dir", source, ...options], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
}

test("tools profile installs only supported tools and its SDK dependency", async () => fixture(async (root) => {
  const bin = path.join(root, "bin");
  const log = path.join(root, "npm.log");
  await mkdir(bin);
  await writeFile(path.join(bin, "npm"), "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" > \"$NPM_LOG\"\n", { mode: 0o755 });
  const config = path.join(root, "config");
  const source = path.join(root, "agents-source");
  await mkdir(source);
  await writeFile(path.join(source, "agent.md"), "---\nname: agent\n---\n");
  await writeFile(path.join(bin, "opencode"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });

  await run("bash", [deploy, "install", "--config-dir", config, "--source-dir", source, "--with-tools"], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NPM_LOG: log },
  });

  await stat(path.join(config, "tools", "run.ts"));
  await stat(path.join(config, "tools", "scaffold_gitignore.ts"));
  await assert.rejects(stat(path.join(config, "tools", "manifest.ts")));
  try {
    assert.match(await readFile(log, "utf8"), /@opencode-ai\/plugin@1\.17\.15/);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await stat(path.join(config, "node_modules", "@opencode-ai", "plugin"));
  }
}));

test("autonomous profile deploys the supervisor validator dependency", async () => fixture(async (root) => {
  await deployFixture(root, "install", ["--with-autonomous"]);
  const validator = path.join(root, "config", "tools", "manifest.ts");
  await stat(validator);
  const loaded = await import(`${path.join(root, "config", "plugins", "opencode-autonomous-supervisor", "index.js")}?test=deployment`);
  assert.equal(typeof loaded.default, "function");
}));

test("remove preserves unrelated names and reconciles Autonomous artifacts", async () => fixture(async (root) => {
  const config = path.join(root, "config");
  const plugins = path.join(config, "plugins");
  const tools = path.join(config, "tools");
  const agents = path.join(config, "agents");
  await mkdir(plugins, { recursive: true });
  await mkdir(tools);
  await mkdir(agents);
  await writeFile(path.join(agents, "builder.md"), "user agent\n");
  await writeFile(path.join(root, "user-plugin"), "user plugin\n");
  await symlink(path.join(root, "user-plugin"), path.join(plugins, "shared"));
  await cp(path.join(repo, "plugins", "opencode-autonomous-supervisor"), path.join(plugins, "opencode-autonomous-supervisor"), { recursive: true });
  await cp(path.join(repo, "tools", "run.ts"), path.join(tools, "run.ts"));
  await cp(path.join(repo, "tools", "scaffold_gitignore.ts"), path.join(tools, "scaffold_gitignore.ts"));

  await deployFixture(root, "remove");

  assert.equal(await readFile(path.join(agents, "builder.md"), "utf8"), "user agent\n");
  assert.equal(await readFile(path.join(plugins, "shared"), "utf8"), "user plugin\n");
  await assert.rejects(stat(path.join(plugins, "opencode-autonomous-supervisor")));
  await assert.rejects(stat(path.join(tools, "run.ts")));
  await assert.rejects(stat(path.join(tools, "scaffold_gitignore.ts")));
}));
