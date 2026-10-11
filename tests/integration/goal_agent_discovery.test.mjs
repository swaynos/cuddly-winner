import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { publishGoalAgentFile } from "../../tools/publish_goal_agent.ts";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const deploy = path.join(repo, "scripts", "deploy-opencode-agents.sh");
const opencode = process.env.OPENCODE_GOAL_TEST_CLI ?? path.join(repo, "node_modules", ".bin", "opencode");
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

test("isolated installed profile discovers the persistent primary Goal worker by its task name", {
  skip: !hasOpenCode && "install OpenCode to verify agent discovery",
  timeout: 180_000,
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "goal-agent-discovery-"));
  const project = path.join(root, "project");
  const xdgConfig = path.join(root, "config");
  const config = path.join(xdgConfig, "opencode");
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: xdgConfig, XDG_DATA_HOME: path.join(root, "data"), XDG_CACHE_HOME: path.join(root, "cache"), OPENCODE_CONFIG_DIR: config, OPENCODE_DISABLE_DEFAULT_PLUGINS: "1" };
  for (const key of ["OPENCODE_CONFIG", "OPENCODE_CONFIG_CONTENT", "OPENCODE_PURE", "OPENCODE_DISABLE_PROJECT_CONFIG"]) delete env[key];
  try {
    await mkdir(project, { recursive: true });
    await publishGoalAgentFile(project, request());
    await run("bash", [deploy, "install", "--config-dir", config], { cwd: repo, env });

    const { stdout } = await run(opencode, ["debug", "agent", "retry-fix"], { cwd: project, env });
    const agent = JSON.parse(stdout);
    assert.equal(agent.name, "retry-fix");
    assert.equal(agent.mode, "primary");
    assert.equal(agent.options.goal.runtime, "persistent-worker-v1");
    assert.deepEqual(agent.options.goal.criteria, request().acceptance_criteria);
    assert.match(agent.prompt, /persistent named Goal worker/);
    assert.match(agent.prompt, /goal_run\(operation=start\) once before mutation/);
    assert.match(agent.prompt, /goal_evaluate\(mode=feedback/);
    assert.match(agent.prompt, /goal_evaluate\(mode=final/);
    assert.doesNotMatch(agent.prompt, /goal_cycle|goal_handoff|goal_progress/);
    const permission = name => agent.permission.filter(rule => rule.permission === name || rule.permission === "*").at(-1)?.action;
    for (const name of ["read", "write", "edit", "goal_run", "goal_evaluate"]) assert.equal(permission(name), "allow", `${name} is available to the primary worker`);
    assert.equal(permission("bash"), "ask");
    for (const name of ["task", "goal_verdict", "goal_cycle", "goal_handoff", "goal_progress"]) assert.equal(permission(name), "deny", `${name} is unavailable to the primary worker`);
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
