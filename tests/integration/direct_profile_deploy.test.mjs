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
  const root = await mkdtemp(path.join(os.tmpdir(), "direct-profile-deploy-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function deployFixture(root, action = "install") {
  const bin = path.join(root, "bin");
  const config = path.join(root, "config");
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, "opencode"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  return run("bash", [deploy, action, "--config-dir", config], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
}

async function exists(file) {
  try { await lstat(file); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

test("installer deploys only the Direct profile and retires proven legacy links", async () => fixture(async root => {
  const config = path.join(root, "config");
  const legacy = [
    "agents/reviewer.md",
    "plugins/autonomous-kpis.ts",
    "plugins/announce-hygiene.ts",
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
  assert.deepEqual((await readdir(path.join(config, "plugins"))).sort(), ["immutability.ts"]);
  assert.deepEqual((await readdir(path.join(config, "tools"))).sort(), ["publish_direct_agent.ts"]);
  assert.deepEqual((await readdir(path.join(config, "rules"))).sort(), ["resource-selection.md"]);
  assert.equal(await exists(path.join(config, "skills")), false);
  for (const relative of legacy) assert.equal(await exists(path.join(config, relative)), false, relative);
  for (const name of BROWSER_CONTROL_FILES) await stat(path.join(config, name));
}));

test("installer preserves a user-owned retired asset", async () => fixture(async root => {
  const config = path.join(root, "config");
  const retired = path.join(config, "tools", "spike.ts");
  await mkdir(path.dirname(retired), { recursive: true });
  await writeFile(retired, "user-owned tool\n");

  await deployFixture(root);
  assert.equal(await exists(retired), true);
  await assert.rejects(deployFixture(root, "status"), error => error.code === 1);
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

test("durable docs describe the enforced Direct boundaries", async () => {
  const requirements = await readFile(path.join(repo, "docs", "REQUIREMENTS.md"), "utf8");
  const architecture = await readFile(path.join(repo, "docs", "ARCHITECTURE.md"), "utf8");
  assert.match(requirements, /Browser tools that save screenshots,[\s\S]*exact edit-path policy/);
  assert.match(requirements, /Customized retired MCP entries/);
  assert.match(architecture, /scans[\s\S]*frontmatter name/);
  assert.match(architecture, /`agents\/`, `plugins\/`,[\s\S]*`scripts\/`/);
});
