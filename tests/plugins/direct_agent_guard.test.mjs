import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { ImmutabilityGuard } from "../../plugins/immutability.ts";
import { publishDirectAgentFile } from "../../tools/publish_direct_agent.ts";

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "direct-guard-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function client(agents = {}, parents = {}) {
  return { session: {
    get: async ({ path: value }) => ({ data: parents[value.id]
      ? { id: value.id, agent: agents[value.id], parentID: parents[value.id] }
      : { id: value.id, agent: agents[value.id] } }),
  } };
}

async function publish(root, overrides = {}) {
  return publishDirectAgentFile(root, {
    name: "retry-fix",
    description: "Fix retry scheduling.",
    outcome: "Retry scheduling follows the requested policy.",
    acceptance_criteria: ["Focused coverage passes."],
    durable_context: ["docs/REQUIREMENTS.md"],
    edit_paths: ["src/retry.ts"],
    bash: true,
    verification_commands: ["node --test tests/retry.test.mjs"],
    stop_conditions: ["Scope expands."],
    escalation_triggers: ["The outcome is ambiguous."],
    instructions: "Implement the smallest correct change.",
    ...overrides,
  });
}

async function guard(root, agents, parents = {}) {
  return ImmutabilityGuard({ directory: root, worktree: root, client: client(agents, parents) });
}

function mutate(instance, sessionID, filePath) {
  return instance["tool.execute.before"](
    { tool: "edit", sessionID, callID: "call" },
    { args: { filePath, cwd: path.dirname(filePath) } },
  );
}

test("Direct agents use the policy in their one generated file", async () => fixture(async root => {
  await publish(root);
  const instance = await guard(root, { direct: "retry-fix" });
  await mutate(instance, "direct", path.join(root, "src", "retry.ts"));
  await assert.rejects(mutate(instance, "direct", path.join(root, "README.md")), /outside its declared edit paths/);
  await instance["tool.execute.before"](
    { tool: "bash", sessionID: "direct", callID: "shell" },
    { args: { command: "node --test", cwd: root } },
  );
}));

test("Direct agents cannot rewrite generated definitions", async () => fixture(async root => {
  const published = await publish(root);
  const instance = await guard(root, { direct: "retry-fix" });
  await assert.rejects(
    mutate(instance, "direct", path.join(root, published.path)),
    /published Direct agent/,
  );
  await assert.rejects(
    mutate(instance, "direct", path.join(root, ".OPENCODE", "agents", "generated", "retry-fix.md")),
    /published Direct agent/,
  );
}));

test("browser file writers obey Direct edit paths", async () => fixture(async root => {
  await publish(root);
  const instance = await guard(root, { direct: "retry-fix" });
  await instance["tool.execute.before"](
    { tool: "cuddly-winner-browser_browser_screenshot", sessionID: "direct", callID: "allowed" },
    { args: { path: path.join(root, "src", "retry.ts") } },
  );
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "cuddly-winner-browser_browser_download", sessionID: "direct", callID: "blocked" },
      { args: { path: path.join(root, "README.md") } },
    ),
    /outside its declared edit paths/,
  );
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "browser_save_media", sessionID: "direct", callID: "generated" },
      { args: { path: path.join(root, ".opencode", "agents", "generated", "retry-fix.md") } },
    ),
    /published Direct agent/,
  );
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "cuddly-winner-browser_browser_download", sessionID: "direct", callID: "aliases" },
      { args: {
        filePath: path.join(root, "src", "retry.ts"),
        path: path.join(root, "README.md"),
      } },
    ),
    /unsupported target arguments/,
  );
}));

test("publisher rejects case-variant protected edit paths", async () => fixture(async root => {
  await assert.rejects(
    publish(root, { edit_paths: [".OPENCODE/agents/generated/retry-fix.md"] }),
    /protected control-plane path/,
  );
  await assert.rejects(
    publish(root, { edit_paths: ["TOOLS/publish_direct_agent.ts"] }),
    /protected control-plane path/,
  );
  for (const protectedPath of [
    "agents/prometheus.md",
    "scripts/deploy-opencode-agents.sh",
    "scripts/opencode-playwright-mcp.mjs",
    "rules/resource-selection.md",
  ]) {
    await assert.rejects(
      publish(root, { edit_paths: [protectedPath] }),
      /protected control-plane path/,
      protectedPath,
    );
  }
}));

test("a malformed generated policy fails closed", async () => fixture(async root => {
  const file = path.join(root, ".opencode", "agents", "generated", "retry-fix.md");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "---\nname: retry-fix\nmode: primary\n---\nmissing policy\n");
  const instance = await guard(root, { direct: "retry-fix" });
  await assert.rejects(mutate(instance, "direct", path.join(root, "src", "retry.ts")), /invalid Direct agent definition/);
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "bash", sessionID: "direct", callID: "shell" },
      { args: { command: "true", cwd: root } },
    ),
    /invalid Direct agent definition/,
  );
}));

test("Direct policy boundaries inherit through descendants", async () => fixture(async root => {
  await publish(root, { bash: false });
  const instance = await guard(root, { parent: "retry-fix", child: "build" }, { child: "parent" });
  await mutate(instance, "child", path.join(root, "src", "retry.ts"));
  await assert.rejects(mutate(instance, "child", path.join(root, "README.md")), /outside its declared edit paths/);
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "bash", sessionID: "child", callID: "shell" },
      { args: { command: "true", cwd: root } },
    ),
    /may not execute shell/,
  );
}));

test("nested Direct agents combine their Bash restrictions", async () => fixture(async root => {
  await publish(root, { bash: true });
  await publish(root, { name: "nested-fix", bash: false });
  const instance = await guard(root, { parent: "retry-fix", child: "nested-fix" }, { child: "parent" });
  await mutate(instance, "child", path.join(root, "src", "retry.ts"));
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "bash", sessionID: "child", callID: "shell" },
      { args: { command: "true", cwd: root } },
    ),
    /may not execute shell/,
  );
}));

test("Prometheus may publish Direct agents but cannot edit or use Bash", async () => fixture(async root => {
  const instance = await guard(root, { planner: "prometheus" });
  await instance["tool.execute.before"](
    { tool: "publish_direct_agent", sessionID: "planner", callID: "publish" },
    { args: {} },
  );
  await assert.rejects(mutate(instance, "planner", path.join(root, "README.md")), /may not edit project files/);
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "bash", sessionID: "planner", callID: "shell" },
      { args: { command: "true", cwd: root } },
    ),
    /may not execute shell/,
  );
}));

test("only Prometheus may publish Direct agents", async () => fixture(async root => {
  const instance = await guard(root, { build: "build" });
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "publish_direct_agent", sessionID: "build", callID: "publish" },
      { args: {} },
    ),
    /only @prometheus/,
  );
}));

test("children keep their own role limits and cannot inherit publication", async () => fixture(async root => {
  await publish(root);
  const instance = await guard(root, {
    planner: "prometheus",
    researcher: "grounder",
    worker: "build",
    native: "build",
    nestedPlanner: "prometheus",
    direct: "retry-fix",
    directResearcher: "grounder",
  }, {
    researcher: "planner",
    worker: "planner",
    nestedPlanner: "native",
    directResearcher: "direct",
  });

  for (const sessionID of ["researcher", "worker", "nestedPlanner"]) {
    await assert.rejects(
      instance["tool.execute.before"](
        { tool: "publish_direct_agent", sessionID, callID: "publish" },
        { args: {} },
      ),
      /only @prometheus/,
    );
  }
  await assert.rejects(
    mutate(instance, "directResearcher", path.join(root, "src", "retry.ts")),
    /read-only/,
  );
}));

test("managed children cannot exceed managed parent restrictions", async () => fixture(async root => {
  await publish(root);
  const instance = await guard(root, {
    researcher: "grounder",
    directUnderResearch: "retry-fix",
    planner: "prometheus",
    directUnderPlanner: "retry-fix",
  }, {
    directUnderResearch: "researcher",
    directUnderPlanner: "planner",
  });

  await assert.rejects(
    mutate(instance, "directUnderResearch", path.join(root, "src", "retry.ts")),
    /read-only/,
  );
  await assert.rejects(
    mutate(instance, "directUnderPlanner", path.join(root, "src", "retry.ts")),
    /@prometheus may not edit/,
  );
}));

test("retired generated task packages fail closed until republished", async () => fixture(async root => {
  const agents = path.join(root, ".opencode", "agents");
  const tasks = path.join(root, ".opencode", "tasks");
  await mkdir(agents, { recursive: true });
  await mkdir(tasks, { recursive: true });
  await writeFile(path.join(agents, "legacy-fix.md"), "---\nname: legacy-fix\nmode: primary\n---\nlegacy\n");
  await writeFile(path.join(tasks, "legacy-fix.md"), "# Legacy task\n");
  await writeFile(path.join(tasks, "legacy-fix.json"), "{}\n");
  await writeFile(path.join(root, ".opencode", "generated-agents.json"), "{}\n");

  const instance = await guard(root, { legacy: "legacy-fix" });
  await assert.rejects(
    mutate(instance, "legacy", path.join(root, "src", "retry.ts")),
    /retired generated-agent package/,
  );
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "bash", sessionID: "legacy", callID: "shell" },
      { args: { command: "true", cwd: root } },
    ),
    /retired generated-agent package/,
  );
}));

test("read-only roles and browser-state exports stay protected while native Build stays native", async () => fixture(async root => {
  const instance = await guard(root, { ask: "ask", build: "build" });
  await assert.rejects(mutate(instance, "ask", path.join(root, "README.md")), /read-only/);
  await mutate(instance, "build", path.join(root, "README.md"));
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "playwright_browser_storage_state", sessionID: "build", callID: "state" },
      { args: {} },
    ),
    /saved browser authentication state/,
  );
  await instance["tool.execute.before"](
    { tool: "playwright_browser_navigate", sessionID: "build", callID: "browse" },
    { args: { url: "https://example.com" } },
  );
}));
