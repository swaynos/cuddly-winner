import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { ImmutabilityGuard } from "../../plugins/immutability.ts";

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "immutability-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function client(agents = {}, parents = {}) {
  return { session: {
    get: async ({ path: value }) => ({ data: parents[value.id] ? { parentID: parents[value.id] } : {} }),
    messages: async ({ path: value }) => ({ data: agents[value.id] ? [{ info: { role: "user", agent: agents[value.id] } }] : [] }),
  } };
}

async function hooks(root, agents = {}, parents = {}) {
  return ImmutabilityGuard({ directory: root, worktree: root, client: client(agents, parents) });
}

const mutate = (guard, agent, filePath, tool = "edit") => guard["tool.execute.before"](
  { tool, sessionID: agent, callID: "call" },
  { args: { filePath, cwd: path.dirname(filePath) } },
);

test("native build and plan are never intercepted", async () => fixture(async root => {
  const guard = await hooks(root, { build: "build", plan: "plan" });
  for (const agent of ["build", "plan"]) {
    await mutate(guard, agent, path.join(root, "tools/run.ts"));
    await guard["tool.execute.before"]({ tool: "bash", sessionID: agent, callID: "shell" }, { args: { command: "true", cwd: root } });
  }
}));

test("unknown and unrelated agents are never intercepted", async () => fixture(async root => {
  const guard = await hooks(root, { custom: "third-party-agent" });
  await mutate(guard, "custom", path.join(root, "plugins/immutability.ts"));
  await mutate(guard, "missing", path.join(root, "anything"));
}));

test("placeholder policy is not loaded or enforced", async () => fixture(async root => {
  await writeFile(path.join(root, "opencode-immutable.json"), "not-json");
  const guard = await hooks(root, { autonomous: "autonomous", build: "build" });
  await mutate(guard, "autonomous", path.join(root, "arbitrary-project-file"));
  await mutate(guard, "build", path.join(root, "tools/run.ts"));
}));

test("prometheus can write only SPEC.md and spike files", async () => fixture(async root => {
  const guard = await hooks(root, { p: "prometheus" });
  await mutate(guard, "p", path.join(root, "SPEC.md"));
  await mutate(guard, "p", path.join(root, ".spike", "probe", "result.txt"));
  await assert.rejects(mutate(guard, "p", path.join(root, "src", "app.ts")), /restricted/);
  await assert.rejects(guard["tool.execute.before"]({ tool: "bash", sessionID: "p", callID: "shell" }, { args: { command: "true", cwd: root } }), /directly/);
  await guard["tool.execute.before"]({ tool: "run", sessionID: "p", callID: "spike" }, { args: { context: "spike", spike_id: "probe", cwd: root } });
}));

test("autonomous edits source but not trusted control-plane paths", async () => fixture(async root => {
  const guard = await hooks(root, { a: "autonomous" });
  await mutate(guard, "a", path.join(root, "src", "app.ts"));
  await assert.rejects(mutate(guard, "a", path.join(root, ".opencode", "runs", "forged.json")), /trusted control-plane/);
  await assert.rejects(mutate(guard, "a", path.join(root, "plugins", "immutability.ts")), /trusted control-plane/);
}));

test("read-only managed agents cannot mutate or execute", async () => fixture(async root => {
  for (const agent of ["ask", "karpathy", "reviewer", "grounder"]) {
    const guard = await hooks(root, { [agent]: agent });
    await assert.rejects(mutate(guard, agent, path.join(root, "README.md")), /read-only/);
    await assert.rejects(guard["tool.execute.before"]({ tool: "bash", sessionID: agent, callID: "shell" }, { args: { command: "true", cwd: root } }), /read-only/);
  }
}));

test("managed descendants inherit the parent restriction", async () => fixture(async root => {
  const guard = await hooks(root, { parent: "prometheus", child: "grounder" }, { child: "parent" });
  await assert.rejects(mutate(guard, "child", path.join(root, "README.md")), /prometheus is restricted/);
}));

test("managed mutation paths reject aliases and cross-worktree targets", async () => fixture(async outer => {
  const root = path.join(outer, "root"), outside = path.join(outer, "outside");
  await mkdir(root); await mkdir(outside); await writeFile(path.join(outside, "target"), "x");
  await symlink(path.join(outside, "target"), path.join(root, "alias"));
  const guard = await hooks(root, { a: "autonomous" });
  for (const tool of ["write", "edit", "patch"]) await assert.rejects(mutate(guard, "a", path.join(root, "alias"), tool), /escapes active worktree/);
  const patch = `*** Begin Patch\n*** Update File: ${path.join(root, "alias")}\n+x\n*** End Patch`;
  await assert.rejects(guard["tool.execute.before"]({ tool: "apply_patch", sessionID: "a", callID: "patch" }, { args: { patchText: patch, cwd: root } }), /escapes active worktree/);
}));
