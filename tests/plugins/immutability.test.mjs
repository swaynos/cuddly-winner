import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { ImmutabilityGuard } from "../../plugins/immutability.ts";

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "immutability-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function client(agents = {}, parents = {}) {
  return { session: {
    get: async ({ path: value }) => ({ data: parents[value.id] ? { agent: agents[value.id], parentID: parents[value.id] } : { agent: agents[value.id] } }),
    messages: async () => ({ data: [] }),
    promptAsync: async () => {},
  } };
}

async function publish(root, name = "fix-widget", editPaths = ["src/widget.ts"], bash = true) {
  await mkdir(path.join(root, ".opencode", "agents"), { recursive: true });
  await mkdir(path.join(root, ".opencode", "tasks"), { recursive: true });
  await writeFile(path.join(root, ".opencode", "agents", `${name}.md`), "---\ndescription: executor\nmode: primary\n---\nRead the brief.\n");
  await writeFile(path.join(root, ".opencode", "tasks", `${name}.md`), "# Brief\n");
  await writeFile(path.join(root, ".opencode", "tasks", `${name}.json`), JSON.stringify({
    schema_version: 1, task_id: name, agent_name: name,
    agent_definition: `.opencode/agents/${name}.md`, task_brief: `.opencode/tasks/${name}.md`, strategy: "direct",
    permissions: { edit_paths: editPaths, bash }, implementation_scope: [...editPaths], durable_context: ["README.md"],
    verification: { commands: ["node --test"], success_evidence: ["Fresh output."], freshness: "After edits.", failure_conditions: ["A command fails."], independent_review: null },
    limits: { stop_conditions: ["Scope expands."] }, escalation_triggers: ["Ambiguous outcome."], strategy_config: { work_selection: "Complete the brief." },
  }));
  await writeFile(path.join(root, ".opencode", "generated-agents.json"), JSON.stringify({ schema_version: 1, agents: [{ name, manifest: `.opencode/tasks/${name}.json` }] }));
}

async function guard(root, agents, parents = {}) { return ImmutabilityGuard({ directory: root, worktree: root, client: client(agents, parents) }); }
function mutate(instance, sessionID, filePath) { return instance["tool.execute.before"]({ tool: "edit", sessionID, callID: "call" }, { args: { filePath, cwd: path.dirname(filePath) } }); }

test("unregistered local and native agents remain unmanaged", async () => fixture(async root => {
  const instance = await guard(root, { local: "local-agent", build: "build" });
  await mutate(instance, "local", path.join(root, "plugins", "immutability.ts"));
  await mutate(instance, "build", path.join(root, "plugins", "immutability.ts"));
}));

test("registered executor can edit only its manifest scope", async () => fixture(async root => {
  await publish(root);
  const instance = await guard(root, { executor: "fix-widget" });
  await mutate(instance, "executor", path.join(root, "src", "widget.ts"));
  await assert.rejects(mutate(instance, "executor", path.join(root, "README.md")), /outside its declared edit paths/);
  await assert.rejects(mutate(instance, "executor", path.join(root, ".opencode", "tasks", "fix-widget.json")), /published task package/);
}));

test("registered executor inherits its boundary through delegation", async () => fixture(async root => {
  await publish(root, "fix-widget", ["src/widget.ts"], false);
  const instance = await guard(root, { parent: "fix-widget", child: "build" }, { child: "parent" });
  await assert.rejects(mutate(instance, "child", path.join(root, "README.md")), /outside its declared edit paths/);
  await assert.rejects(instance["tool.execute.before"]({ tool: "bash", sessionID: "child", callID: "shell" }, { args: { command: "true", cwd: root } }), /may not execute shell/);
}));

test("prometheus may publish task packages but no ordinary project files", async () => fixture(async root => {
  const instance = await guard(root, { p: "prometheus" });
  await mutate(instance, "p", path.join(root, ".opencode", "agents", "fix-widget.md"));
  await mutate(instance, "p", path.join(root, ".opencode", "tasks", "fix-widget.json"));
  await mutate(instance, "p", path.join(root, ".opencode", "generated-agents.json"));
  await assert.rejects(mutate(instance, "p", path.join(root, "src", "widget.ts")), /restricted/);
}));

test("retained read-only roles cannot mutate or execute", async () => fixture(async root => {
  for (const name of ["ask", "grounder", "reviewer"]) {
    const instance = await guard(root, { [name]: name });
    await assert.rejects(mutate(instance, name, path.join(root, "README.md")), /read-only/);
    await assert.rejects(instance["tool.execute.before"]({ tool: "bash", sessionID: name, callID: "shell" }, { args: { command: "true", cwd: root } }), /read-only/);
  }
}));
