import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { ImmutabilityGuard } from "../../plugins/immutability.ts";

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "immutability-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function client(agents = {}, parents = {}, sessions = {}, prompts = []) {
  return { session: {
    get: async ({ path: value }) => ({ data: sessions[value.id] ?? (parents[value.id] ? { parentID: parents[value.id] } : {}) }),
    messages: async ({ path: value }) => ({ data: agents[value.id] ? [{ info: { role: "user", agent: agents[value.id] } }] : [] }),
    promptAsync: async (input) => { prompts.push(input); },
  } };
}

async function hooks(root, agents = {}, parents = {}, sessions = {}, prompts = [], worktree = root) {
  return ImmutabilityGuard({ directory: root, worktree, client: client(agents, parents, sessions, prompts) });
}

const mutate = (guard, agent, filePath, tool = "edit") => guard["tool.execute.before"](
  { tool, sessionID: agent, callID: "call" },
  { args: { filePath, cwd: path.dirname(filePath) } },
);

test("native build and plan are never intercepted", async () => fixture(async root => {
  const guard = await hooks(root, { build: "build", plan: "plan" });
  for (const agent of ["build", "plan"]) {
    await mutate(guard, agent, path.join(root, "tools/spike.ts"));
    await guard["tool.execute.before"]({ tool: "bash", sessionID: agent, callID: "shell" }, { args: { command: "true", cwd: root } });
  }
}));

test("a root session switched from prometheus to build is not intercepted", async () => fixture(async root => {
  const guard = await hooks(root, { switched: "prometheus" }, {}, { switched: { agent: "build" } });
  await mutate(guard, "switched", path.join(root, "README.md"));
  await guard["tool.execute.before"](
    { tool: "bash", sessionID: "switched", callID: "shell" },
    { args: { command: "true", cwd: root } },
  );
}));

test("unknown and unrelated agents are never intercepted", async () => fixture(async root => {
  const guard = await hooks(root, { custom: "third-party-agent" });
  await mutate(guard, "custom", path.join(root, "plugins/immutability.ts"));
  await mutate(guard, "missing", path.join(root, "anything"));
}));

test("prometheus can write scaffold artifacts only", async () => fixture(async root => {
  const guard = await hooks(root, { p: "prometheus" });
  await mutate(guard, "p", path.join(root, "SPEC.md"));
  await mutate(guard, "p", path.join(root, "opencode-autonomous.json"));
  await mutate(guard, "p", path.join(root, ".prometheus", "evaluator", "score.py"));
  await mutate(guard, "p", path.join(root, ".spike", "probe", "result.txt"));
  await assert.rejects(mutate(guard, "p", path.join(root, "src", "app.ts")), /restricted/);
  await assert.rejects(guard["tool.execute.before"]({ tool: "bash", sessionID: "p", callID: "shell" }, { args: { command: "true", cwd: root } }), /directly/);
  await guard["tool.execute.before"]({ tool: "spike", sessionID: "p", callID: "spike" }, { args: { spike_id: "probe" } });
}));

test("prometheus may replace existing scaffold content, not just absent files", async () => fixture(async root => {
  await writeFile(path.join(root, "SPEC.md"), "# Stale unrelated SPEC\n");
  await writeFile(path.join(root, "opencode-autonomous.json"), "{\"strategy\":\"stale\"}");
  const guard = await hooks(root, { p: "prometheus" });
  await mutate(guard, "p", path.join(root, "SPEC.md"));
  await mutate(guard, "p", path.join(root, "opencode-autonomous.json"));
}));

test("a prometheus-labeled child of an autonomous parent inherits the autonomous restriction", async () => fixture(async root => {
  const guard = await hooks(root, {}, {}, {
    parent: { agent: "autonomous" },
    child: { agent: "prometheus", parentID: "parent" },
  });
  await assert.rejects(mutate(guard, "child", path.join(root, "SPEC.md")), /published scaffold/);
  await assert.rejects(mutate(guard, "child", path.join(root, "opencode-autonomous.json")), /published scaffold/);
}));

test("session directory remains the managed root when worktree is stale", async () => fixture(async root => {
  const guard = await hooks(root, { p: "prometheus" }, {}, {}, [], "/");
  await mutate(guard, "p", path.join(root, "SPEC.md"));
  await assert.rejects(mutate(guard, "p", "/SPEC.md"), /escapes active worktree/);
}));

test("prometheus is continued once when it idles without publishing a scaffold", async () => fixture(async root => {
  const prompts = [];
  const guard = await hooks(root, { p: "prometheus" }, {}, {}, prompts);
  const idle = () => guard.event({ event: { type: "session.idle", properties: { sessionID: "p" } } });

  await idle();
  await idle();

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].path.id, "p");
  assert.match(prompts[0].body.parts[0].text, /SPEC\.md/);

  await writeFile(path.join(root, "SPEC.md"), "spec");
  await writeFile(path.join(root, "opencode-autonomous.json"), "{}");
  const publishedPrompts = [];
  const publishedGuard = await hooks(root, { p: "prometheus" }, {}, {}, publishedPrompts);
  await publishedGuard.event({ event: { type: "session.idle", properties: { sessionID: "p" } } });
  assert.equal(publishedPrompts.length, 0);
}));

test("idle publication reminder does not fire for a managed descendant of prometheus", async () => fixture(async root => {
  const prompts = [];
  const guard = await hooks(root, { parent: "prometheus", child: "grounder" }, { child: "parent" }, {}, prompts);
  await guard.event({ event: { type: "session.idle", properties: { sessionID: "child" } } });
  await guard.event({ event: { type: "session.idle", properties: { sessionID: "child" } } });
  assert.equal(prompts.length, 0);
}));

test("idle publication reminder ignores a cache poisoned by prior inheritance resolution", async () => fixture(async root => {
  const prompts = [];
  const guard = await hooks(root, { parent: "prometheus", child: "grounder" }, { child: "parent" }, {}, prompts);
  await assert.rejects(mutate(guard, "child", path.join(root, "README.md")), /prometheus is restricted/);
  await guard.event({ event: { type: "session.idle", properties: { sessionID: "child" } } });
  assert.equal(prompts.length, 0);
}));

test("only prometheus may invoke workflow tools", async () => fixture(async root => {
  const invoke = (guard, agent, tool) => guard["tool.execute.before"](
    { tool, sessionID: agent, callID: "c" }, { args: tool === "spike" ? { spike_id: "probe" } : {} });
  const pg = await hooks(root, { p: "prometheus" });
  for (const tool of ["spike", "scaffold_gitignore", "validate_scaffold"]) {
    await invoke(pg, "p", tool);
    for (const agent of ["autonomous", "ask", "karpathy", "reviewer", "grounder", "implementation-validator"]) {
      const guard = await hooks(root, { [agent]: agent });
      await assert.rejects(invoke(guard, agent, tool), /only @prometheus may invoke/);
    }
  }
  // Unmanaged identities are still bypassed entirely.
  const ug = await hooks(root, { x: "third-party" });
  await invoke(ug, "x", "spike");
}));

test("autonomous may use native Bash while prometheus may not", async () => fixture(async root => {
  const guard = await hooks(root, { a: "autonomous", p: "prometheus" });
  await guard["tool.execute.before"]({ tool: "bash", sessionID: "a", callID: "shell" }, { args: { command: "node --test", cwd: root } });
  await assert.rejects(guard["tool.execute.before"]({ tool: "bash", sessionID: "p", callID: "shell" }, { args: { command: "true", cwd: root } }), /directly/);
}));

test("autonomous edits source but not trusted extension paths", async () => fixture(async root => {
  const guard = await hooks(root, { a: "autonomous" });
  await mutate(guard, "a", path.join(root, "src", "app.ts"));
  await assert.rejects(mutate(guard, "a", path.join(root, "plugins", "immutability.ts")), /trusted control-plane/);
  await assert.rejects(mutate(guard, "a", path.join(root, "plugins", "autonomous-kpis.ts")), /trusted control-plane/);
  await assert.rejects(mutate(guard, "a", path.join(root, "tools", "spike.ts")), /trusted control-plane/);
  await assert.rejects(mutate(guard, "a", path.join(root, "tools", "validate_scaffold.ts")), /trusted control-plane/);
  await assert.rejects(mutate(guard, "a", path.join(root, "tools", "scaffold_gitignore.ts")), /trusted control-plane/);
}));

test("read-only managed agents cannot mutate or execute", async () => fixture(async root => {
  for (const agent of ["ask", "karpathy", "reviewer", "grounder", "implementation-validator"]) {
    const guard = await hooks(root, { [agent]: agent });
    await assert.rejects(mutate(guard, agent, path.join(root, "README.md")), /read-only/);
    await assert.rejects(guard["tool.execute.before"]({ tool: "bash", sessionID: agent, callID: "shell" }, { args: { command: "true", cwd: root } }), /read-only/);
  }
}));

test("managed descendants inherit the parent restriction", async () => fixture(async root => {
  const guard = await hooks(root, { parent: "prometheus", child: "grounder" }, { child: "parent" });
  await assert.rejects(mutate(guard, "child", path.join(root, "README.md")), /prometheus is restricted/);
}));

test("a build child of prometheus remains restricted", async () => fixture(async root => {
  const guard = await hooks(root, {}, {}, {
    parent: { agent: "prometheus" },
    child: { agent: "build", parentID: "parent" },
  });
  await assert.rejects(mutate(guard, "child", path.join(root, "README.md")), /prometheus is restricted/);
}));

test("managed children remain restricted below unmanaged parents", async () => fixture(async root => {
  const guard = await hooks(root, { parent: "third-party", child: "grounder" }, { child: "parent" });
  await assert.rejects(mutate(guard, "child", path.join(root, "README.md")), /read-only/);
}));

test("autonomous cannot rewrite a published scaffold", async () => fixture(async root => {
  const guard = await hooks(root, { a: "autonomous" });
  for (const target of ["SPEC.md", "opencode-autonomous.json", ".prometheus/evaluator/score.py"]) {
    await assert.rejects(mutate(guard, "a", path.join(root, target)), /published scaffold/);
  }
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

test("managed mutation paths reject dangling and ancestor symlinks", async () => fixture(async outer => {
  const root = path.join(outer, "root"), outside = path.join(outer, "outside");
  await mkdir(root); await mkdir(outside);
  await symlink(path.join(outside, "new-target"), path.join(root, "dangling"));
  await symlink(outside, path.join(root, "linked-dir"));
  const guard = await hooks(root, { a: "autonomous" });
  await assert.rejects(mutate(guard, "a", path.join(root, "dangling")), /escapes active worktree/);
  await assert.rejects(mutate(guard, "a", path.join(root, "linked-dir", "new-target")), /escapes active worktree/);
}));
