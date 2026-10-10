import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const deploy = path.join(repo, "scripts", "deploy-opencode-agents.sh");
const retireAssets = path.join(repo, "scripts", "opencode-retired-assets.mjs");
const BROWSER_CONTROL_FILES = [
  "opencode-playwright-mcp.mjs",
  "opencode-browser-state.mjs",
  "opencode-browser-login.mjs",
  "opencode-browser-runtime.mjs",
  "opencode-browser-service.mjs",
];

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "profile-deploy-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function deployFixture(root, action = "install", extraArgs = []) {
  const bin = path.join(root, "bin");
  const config = path.join(root, "config");
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, "opencode"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  return run("bash", [deploy, action, "--config-dir", config, ...extraArgs], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
}

async function exists(file) {
  try { await lstat(file); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

test("installer deploys the Cuddly Winner profile and purges the retired publisher", async () => fixture(async root => {
  const config = path.join(root, "config");
  const legacy = [
    "agents/reviewer.md",
    "plugins/autonomous-kpis.ts",
    "plugins/announce-hygiene.ts",
    "tools/publish_direct_agent.ts",
    "tools/validate_scaffold.ts",
    "tools/scaffold_gitignore.ts",
    "tools/spike.ts",
    "tools/session_fetch.ts",
    "rules/writing-and-output.md",
    "skills/systematic-debugging",
  ];
  for (const relative of legacy) {
    const target = path.join(repo, relative);
    const destination = path.join(config, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await symlink(target, destination);
  }

  await deployFixture(root);

  assert.deepEqual(
    (await readdir(path.join(config, "agents"))).filter((name) => name.endsWith(".md")).sort(),
    ["ask.md", "grounder.md", "prometheus.md"],
  );
  assert.deepEqual((await readdir(path.join(config, "plugins"))).sort(), ["goal.ts", "immutability.ts", "tui"]);
  assert.deepEqual((await readdir(path.join(config, "plugins/tui"))).sort(), ["goal-progress.tsx", "progress.ts"]);
  assert.deepEqual(JSON.parse(await readFile(path.join(config, "tui.json"), "utf8")).plugin, ["./plugins/tui/goal-progress.tsx"]);
  assert.deepEqual((await readdir(path.join(config, "tools"))).sort(), ["publish_goal_agent.ts"]);
  assert.deepEqual((await readdir(path.join(config, "rules"))).sort(), ["resource-selection.md"]);
  const reference = path.join(config, "docs", "RESOURCE-SELECTION.md");
  assert.equal(await readFile(reference, "utf8"), await readFile(path.join(repo, "docs", "RESOURCE-SELECTION.md"), "utf8"));
  const instructions = JSON.parse(await readFile(path.join(config, "opencode.json"), "utf8")).instructions;
  assert.ok(!instructions.includes(reference), "managed reference must be loaded on demand only");
  assert.equal(await exists(path.join(config, "skills")), false);
  for (const relative of legacy) assert.equal(await exists(path.join(config, relative)), false, relative);
  for (const name of BROWSER_CONTROL_FILES) await stat(path.join(config, name));
}));

test("deployment status distinguishes current, stale, linked, foreign and missing entries", async () => fixture(async root => {
  await deployFixture(root);
  const config = path.join(root, "config");
  await writeFile(path.join(config, "agents/ask.md"), "stale copy");
  await rm(path.join(config, "agents/grounder.md"));
  await symlink(path.join(repo, "agents/grounder.md"), path.join(config, "agents/grounder.md"));
  await rm(path.join(config, "agents/prometheus.md"));
  await symlink(path.join(repo, "agents/ask.md"), path.join(config, "agents/prometheus.md"));
  await rm(path.join(config, "plugins/goal.ts"));
  await assert.rejects(deployFixture(root, "status"), error => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /\[stale or modified copy\].*agents\/ask.md/);
    assert.match(error.stdout, /\[current link\].*agents\/grounder.md/);
    assert.match(error.stdout, /\[foreign link\].*agents\/prometheus.md/);
    assert.match(error.stdout, /\[missing\].*plugins\/goal.ts/);
    assert.match(error.stdout, /\[current copy\].*plugins\/immutability.ts/);
    return true;
  });
}));

test("installer purges a customized retired publisher but preserves unrelated retired assets", async () => fixture(async root => {
  const config = path.join(root, "config");
  const retired = path.join(config, "tools", "spike.ts");
  const priorPublisher = path.join(config, "tools", "publish_direct_agent.ts");
  await mkdir(path.dirname(retired), { recursive: true });
  await writeFile(retired, "user-owned tool\n");
  await writeFile(priorPublisher, "user-owned publisher\n");

  await deployFixture(root);
  assert.equal(await exists(retired), true);
  assert.equal(await exists(priorPublisher), false);
  await assert.rejects(deployFixture(root, "status"), error => error.code === 1);
}));

test("retired publisher purge does not recursively remove an unexpected directory", async () => fixture(async root => {
  const config = path.join(root, "config");
  const retiredDirectory = path.join(config, "tools", "publish_direct_agent.ts");
  const preserved = path.join(retiredDirectory, "user-data.txt");
  await mkdir(retiredDirectory, { recursive: true });
  await writeFile(preserved, "keep directory contents\n");

  await deployFixture(root);
  assert.equal(await readFile(preserved, "utf8"), "keep directory contents\n");
}));

test("installer keeps the instruction for a user-owned retired rule", async () => fixture(async root => {
  const config = path.join(root, "config");
  await mkdir(path.join(config, "rules"), { recursive: true });
  const canonicalConfig = await realpath(config);
  const retired = path.join(canonicalConfig, "rules", "writing-and-output.md");
  const current = path.join(canonicalConfig, "rules", "resource-selection.md");
  const opencodeConfig = path.join(canonicalConfig, "opencode.json");
  await writeFile(retired, "user-owned rule\n");
  await writeFile(opencodeConfig, `${JSON.stringify({ instructions: [retired] })}\n`);

  await deployFixture(root);

  const value = JSON.parse(await readFile(opencodeConfig, "utf8"));
  assert.equal(await exists(retired), true);
  assert.deepEqual(value.instructions.sort(), [current, retired].sort());
}));

test("installer accepts a prior managed state that includes Reviewer", async () => fixture(async root => {
  const config = path.join(root, "config");
  const agents = path.join(config, "agents");
  const reviewer = path.join(agents, "reviewer.md");
  await mkdir(agents, { recursive: true });
  await symlink(path.join(repo, "agents", "reviewer.md"), reviewer);
  await writeFile(path.join(agents, "cuddly-winner-managed.json"), `${JSON.stringify({
    schema_version: 1,
    agents: {
      "reviewer.md": {
        source: path.join(repo, "agents", "reviewer.md"),
        mode: "copy",
        sha256: "669911a5d42184ef4a78fdb8b3693cc6382b5809e038ae5585569b513eb8065d",
      },
    },
  })}\n`, { mode: 0o600 });

  await deployFixture(root);
  assert.equal(await exists(reviewer), false);
}));

test("retirement refuses a symlinked asset parent", async () => fixture(async root => {
  const config = path.join(root, "config");
  const outside = path.join(root, "outside");
  const preserved = path.join(outside, "spike.ts");
  await mkdir(outside, { recursive: true });
  await mkdir(config, { recursive: true });
  await symlink(outside, path.join(config, "tools"), "dir");
  await symlink(path.join(repo, "tools", "spike.ts"), preserved);

  await assert.rejects(
    run(process.execPath, [retireAssets, "install", "--root", config, "--repo", repo]),
    /symlinked retired asset parent/,
  );
  assert.equal(await exists(preserved), true);
}));

test("Goal TUI installs and removes without rewriting unrelated JSONC configuration", async () => fixture(async root => {
  const config = path.join(root, "config");
  await mkdir(config);
  await writeFile(path.join(config, "tui.jsonc"), '{\n // keep my settings\n "theme":"mine", "plugin":[["user-plugin",{"value":1}]],\n}\n');
  await deployFixture(root);
  assert.match(await readFile(path.join(config, "tui.jsonc"), "utf8"), /keep my settings/);
  await deployFixture(root, "status");
  await deployFixture(root, "remove");
  assert.equal(await exists(path.join(config, "plugins/tui/goal-progress.tsx")), false);
  assert.equal(await exists(path.join(config, "plugins/tui/progress.ts")), false);
  const remaining = await readFile(path.join(config, "tui.jsonc"), "utf8");
  assert.match(remaining, /keep my settings/);
  assert.match(remaining, /user-plugin/);
  assert.doesNotMatch(remaining, /goal-progress\.tsx/);
}));

test("removing the profile preserves modified TUI assets and their registration", async () => fixture(async root => {
  const config = path.join(root, "config");
  await deployFixture(root);
  const file = path.join(config, "plugins/tui/goal-progress.tsx");
  await writeFile(file, "user-owned customization\n");
  await deployFixture(root, "remove");
  assert.equal(await readFile(file, "utf8"), "user-owned customization\n");
  assert.equal(await exists(path.join(config, "plugins/tui/progress.ts")), true);
  assert.match(await readFile(path.join(config, "tui.json"), "utf8"), /goal-progress\.tsx/);
}));

test("installer replaces entries without backups by default and preserves backups when --backup is passed", async () => fixture(async root => {
  const config = path.join(root, "config");
  await deployFixture(root);

  const targetAgent = path.join(config, "agents", "ask.md");
  await writeFile(targetAgent, "locally modified ask\n");

  await deployFixture(root, "install");
  assert.equal(await exists(path.join(config, "backups")), false);
  assert.notEqual(await readFile(targetAgent, "utf8"), "locally modified ask\n");

  await writeFile(targetAgent, "locally modified again\n");
  await deployFixture(root, "install", ["--backup"]);
  assert.equal(await exists(path.join(config, "backups")), true);
  const backupFiles = await readdir(path.join(config, "backups", "agents"));
  assert.equal(backupFiles.length, 1);
  assert.match(backupFiles[0], /^ask\.md\.bak\./);
  assert.equal(await readFile(path.join(config, "backups", "agents", backupFiles[0]), "utf8"), "locally modified again\n");
}));

test("durable docs describe the enforced Goal Agent boundaries", async () => {
  const requirements = await readFile(path.join(repo, "docs", "REQUIREMENTS.md"), "utf8");
  const architecture = await readFile(path.join(repo, "docs", "ARCHITECTURE.md"), "utf8");
  assert.match(requirements, /Browser tools that save screenshots,[\s\S]*exact edit-path policy/);
  assert.match(requirements, /Customized retired MCP entries/);
  assert.match(architecture, /scans[\s\S]*frontmatter name/);
  assert.match(architecture, /`agents\/`, `plugins\/`,[\s\S]*`scripts\/`/);
});
