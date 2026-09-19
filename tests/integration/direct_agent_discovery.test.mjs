import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { publishDirectAgentFile } from "../../tools/publish_direct_agent.ts";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const deploy = path.join(repo, "scripts", "deploy-opencode-agents.sh");
const opencode = path.join(repo, "node_modules", ".bin", "opencode");
const hasOpenCode = spawnSync(opencode, ["--version"], { stdio: "ignore" }).status === 0;

function request() {
  return {
    name: "retry-fix",
    description: "Fix retry scheduling.",
    outcome: "Retry scheduling follows the requested policy.",
    acceptance_criteria: ["The retry policy has focused coverage."],
    durable_context: ["docs/REQUIREMENTS.md"],
    edit_paths: ["src/retry.ts", "tests/retry.test.mjs"],
    bash: true,
    verification_commands: ["node --test tests/retry.test.mjs"],
    stop_conditions: ["The requested outcome becomes ambiguous."],
    escalation_triggers: ["Required work exceeds the declared paths."],
    instructions: "Make the smallest correct change and run the declared verification.",
  };
}

test("installed profile leaves a generated Direct agent discoverable by its task name", {
  skip: !hasOpenCode && "install OpenCode to verify agent discovery",
  timeout: 180_000,
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "direct-discovery-"));
  const project = path.join(root, "project");
  const xdgConfig = path.join(root, "config");
  const config = path.join(xdgConfig, "opencode");
  const env = { ...process.env, XDG_CONFIG_HOME: xdgConfig, OPENCODE_CONFIG_DIR: config };
  try {
    await mkdir(project, { recursive: true });
    await publishDirectAgentFile(project, request());
    await run("bash", [deploy, "install", "--config-dir", config], { cwd: repo, env });

    const { stdout } = await run(opencode, ["debug", "agent", "retry-fix"], { cwd: project, env });
    const agent = JSON.parse(stdout);
    assert.equal(agent.name, "retry-fix");
    assert.match(agent.prompt, /Direct implementation agent/);
  } finally {
    await run("bash", [deploy, "remove", "--config-dir", config], { cwd: repo, env }).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("the pinned OpenCode CLI resolves from the public npm registry", async () => {
  const lock = JSON.parse(await readFile(path.join(repo, "package-lock.json"), "utf8"));
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (name === "node_modules/opencode-ai" || name.startsWith("node_modules/opencode-")) {
      assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//);
    }
  }
});
