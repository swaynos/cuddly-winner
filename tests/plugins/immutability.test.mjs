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
    get: async ({ path: value }) => ({ data: parents[value.id] ? { id: value.id, agent: agents[value.id], parentID: parents[value.id] } : { id: value.id, agent: agents[value.id] } }),
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

async function publishSecond(root, name, editPaths, bash) {
  await writeFile(path.join(root, ".opencode", "agents", `${name}.md`), "---\ndescription: executor\nmode: primary\n---\nRead the brief.\n");
  await writeFile(path.join(root, ".opencode", "tasks", `${name}.md`), "# Brief\n");
  await writeFile(path.join(root, ".opencode", "tasks", `${name}.json`), JSON.stringify({
    schema_version: 1, task_id: name, agent_name: name,
    agent_definition: `.opencode/agents/${name}.md`, task_brief: `.opencode/tasks/${name}.md`, strategy: "direct",
    permissions: { edit_paths: editPaths, bash }, implementation_scope: [...editPaths], durable_context: ["README.md"],
    verification: { commands: ["node --test"], success_evidence: ["Fresh output."], freshness: "After edits.", failure_conditions: ["A command fails."], independent_review: null },
    limits: { stop_conditions: ["Scope expands."] }, escalation_triggers: ["Ambiguous outcome."], strategy_config: { work_selection: "Complete the brief." },
  }));
  await writeFile(path.join(root, ".opencode", "generated-agents.json"), JSON.stringify({
    schema_version: 1,
    agents: ["fix-widget", name].map(agent => ({ name: agent, manifest: `.opencode/tasks/${agent}.json` })),
  }));
}

async function assertInvalidRegisteredIdentityFailsClosed(root, agents) {
  await publish(root, "fix-widget", ["src/widget.ts"], false);
  await writeFile(path.join(root, ".opencode", "generated-agents.json"), JSON.stringify({ schema_version: 1, agents }));
  const instance = await guard(root, { executor: "fix-widget" });
  await assert.rejects(mutate(instance, "executor", path.join(root, "src", "widget.ts")), /invalid generated task package/);
  await assert.rejects(
    instance["tool.execute.before"]({ tool: "bash", sessionID: "executor", callID: "shell" }, { args: { command: "true", cwd: root } }),
    /invalid generated task package/,
  );
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

test("apply_patch move destinations are checked against trusted control-plane paths", async () => fixture(async root => {
  await publish(root);
  const instance = await guard(root, { executor: "fix-widget" });
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "apply_patch", sessionID: "executor", callID: "move" },
      { args: { cwd: root, patchText: "*** Begin Patch\n*** Update File: src/widget.ts\n*** Move to: tools/spike.ts\n*** End Patch" } },
    ),
    /trusted control-plane/,
  );
}));

test("registered executor inherits its boundary through delegation", async () => fixture(async root => {
  await publish(root, "fix-widget", ["src/widget.ts"], false);
  const instance = await guard(root, { parent: "fix-widget", child: "build" }, { child: "parent" });
  await assert.rejects(mutate(instance, "child", path.join(root, "README.md")), /outside its declared edit paths/);
  await assert.rejects(instance["tool.execute.before"]({ tool: "bash", sessionID: "child", callID: "shell" }, { args: { command: "true", cwd: root } }), /may not execute shell/);
}));

test("a child adopts a parent that switches from native Build to Ask", async () => fixture(async root => {
  await publish(root, "fix-widget", ["src/widget.ts"], true);
  const agents = { parent: "build", child: "fix-widget" };
  const instance = await guard(root, agents, { child: "parent" });
  await mutate(instance, "child", path.join(root, "src", "widget.ts"));
  await instance["tool.execute.before"]({ tool: "bash", sessionID: "child", callID: "initial-shell" }, { args: { command: "true", cwd: root } });

  agents.parent = "ask";
  await instance["chat.params"]({ sessionID: "parent", agent: "ask" });

  await assert.rejects(mutate(instance, "child", path.join(root, "src", "widget.ts")), /@ask is read-only/);
  await assert.rejects(
    instance["tool.execute.before"]({ tool: "bash", sessionID: "child", callID: "shell" }, { args: { command: "true", cwd: root } }),
    /@ask is read-only/,
  );
}));

test("a generated session keeps its boundary after switching to Build", async () => fixture(async root => {
  await publish(root, "fix-widget", ["src/widget.ts"], false);
  const agents = { session: "fix-widget" };
  const instance = await guard(root, agents);
  await mutate(instance, "session", path.join(root, "src", "widget.ts"));

  agents.session = "build";
  await instance["chat.params"]({ sessionID: "session", agent: "build" });

  await assert.rejects(mutate(instance, "session", path.join(root, "README.md")), /outside its declared edit paths/);
  await assert.rejects(
    instance["tool.execute.before"]({ tool: "bash", sessionID: "session", callID: "shell" }, { args: { command: "true", cwd: root } }),
    /may not execute shell/,
  );
}));

test("a cold reload reconstructs a generated boundary before a Build switch", async () => fixture(async root => {
  await publish(root, "fix-widget", ["src/widget.ts"], false);
  for (const session of [{ id: "session" }, { id: "session", agent: "build" }]) {
    const historyClient = {
      session: {
        get: async () => ({ data: session }),
        messages: async () => ({ data: [
          { info: { role: "user", agent: "fix-widget" } },
          { info: { role: "user", agent: "build" } },
        ] }),
      },
    };
    const reloaded = await ImmutabilityGuard({ directory: root, worktree: root, client: historyClient });

    await assert.rejects(mutate(reloaded, "session", path.join(root, "README.md")), /outside its declared edit paths/);
    await assert.rejects(
      reloaded["tool.execute.before"]({ tool: "bash", sessionID: "session", callID: "shell" }, { args: { command: "true", cwd: root } }),
      /may not execute shell/,
    );
  }
}));

test("cold reconstruction uses timestamps and ignores initial native selections", async () => fixture(async root => {
  await publish(root, "fix-widget", ["src/widget.ts"], false);
  const historyClient = {
    session: {
      get: async () => ({ data: { id: "session" } }),
      messages: async () => ({ data: [
        { info: { role: "user", agent: "ask", time: { created: 30 } } },
        { info: { role: "user", agent: "build", time: { created: 10 } } },
        { info: { role: "user", agent: "fix-widget", time: { created: 20 } } },
        { info: { role: "user", agent: "build", time: { created: 40 } } },
      ] }),
    },
  };
  const reloaded = await ImmutabilityGuard({ directory: root, worktree: root, client: historyClient });

  await mutate(reloaded, "session", path.join(root, "src", "widget.ts"));
  await assert.rejects(mutate(reloaded, "session", path.join(root, "README.md")), /outside its declared edit paths/);
}));

test("a cold Ask to generated session remains read-only using API array order", async () => fixture(async root => {
  await publish(root, "fix-widget", ["src/widget.ts"], true);
  const historyClient = {
    session: {
      get: async () => ({ data: { id: "session", agent: "fix-widget" } }),
      messages: async () => ({ data: [
        { info: { role: "user", agent: "ask" } },
        { info: { role: "user", agent: "fix-widget" } },
      ] }),
    },
  };
  const reloaded = await ImmutabilityGuard({ directory: root, worktree: root, client: historyClient });

  await assert.rejects(mutate(reloaded, "session", path.join(root, "src", "widget.ts")), /read-only/);
  await assert.rejects(
    reloaded["tool.execute.before"]({ tool: "bash", sessionID: "session", callID: "shell" }, { args: { command: "true", cwd: root } }),
    /read-only/,
  );
}));

test("a cold generated-A to generated-B session keeps generated-A boundaries", async () => fixture(async root => {
  await publish(root, "fix-widget", ["src/widget.ts"], false);
  await publishSecond(root, "other-widget", ["README.md"], true);
  const reloaded = await ImmutabilityGuard({ directory: root, worktree: root, client: { session: {
    get: async () => ({ data: { id: "session", agent: "other-widget" } }),
    messages: async () => ({ data: [
      { info: { role: "user", agent: "fix-widget" } },
      { info: { role: "user", agent: "other-widget" } },
    ] }),
  } } });

  await mutate(reloaded, "session", path.join(root, "src", "widget.ts"));
  await assert.rejects(mutate(reloaded, "session", path.join(root, "README.md")), /outside its declared edit paths/);
  await assert.rejects(
    reloaded["tool.execute.before"]({ tool: "bash", sessionID: "session", callID: "shell" }, { args: { command: "true", cwd: root } }),
    /may not execute shell/,
  );
}));

test("root mutation and Bash fail closed when required history is unavailable or malformed", async () => fixture(async root => {
  const cases = [
    ["lookup failure", async () => { throw new Error("history failed"); }],
    ["non-array response", async () => ({ data: {} })],
    ["malformed user selection", async () => ({ data: [{ info: { role: "user", agent: 42 } }] })],
  ];

  for (const [label, messages] of cases) {
    const reloaded = await ImmutabilityGuard({
      directory: root,
      worktree: root,
      client: { session: { get: async () => ({ data: { id: "session", agent: "build" } }), messages } },
    });
    await assert.rejects(mutate(reloaded, "session", path.join(root, "README.md")), /invalid or cyclic ancestry/, label);
    await assert.rejects(
      reloaded["tool.execute.before"]({ tool: "bash", sessionID: "session", callID: "shell" }, { args: { command: "true", cwd: root } }),
      /invalid or cyclic ancestry/,
      label,
    );
  }
}));

test("managed session metadata fails closed when history is unavailable", async () => fixture(async root => {
  await publish(root, "fix-widget", ["src/widget.ts"], false);
  const reloaded = await ImmutabilityGuard({
    directory: root,
    worktree: root,
    client: { session: {
      get: async () => ({ data: { id: "session", agent: "fix-widget" } }),
      messages: async () => { throw new Error("history failed"); },
    } },
  });

  await assert.rejects(mutate(reloaded, "session", path.join(root, "src", "widget.ts")), /invalid or cyclic ancestry/);
  await assert.rejects(
    reloaded["tool.execute.before"]({ tool: "bash", sessionID: "session", callID: "shell" }, { args: { command: "true", cwd: root } }),
    /invalid or cyclic ancestry/,
  );
}));

test("an Ask session stays read-only after switching to Build", async () => fixture(async root => {
  const agents = { session: "ask" };
  const instance = await guard(root, agents);
  await assert.rejects(mutate(instance, "session", path.join(root, "README.md")), /read-only/);

  agents.session = "build";
  await instance["chat.params"]({ sessionID: "session", agent: "build" });

  await assert.rejects(mutate(instance, "session", path.join(root, "README.md")), /read-only/);
  await assert.rejects(
    instance["tool.execute.before"]({ tool: "bash", sessionID: "session", callID: "shell" }, { args: { command: "true", cwd: root } }),
    /read-only/,
  );
}));

test("a native session adopts its first managed switch and keeps that boundary", async () => fixture(async root => {
  await publish(root, "fix-widget", ["src/widget.ts"], false);
  const agents = { session: "build" };
  const instance = await guard(root, agents);
  await mutate(instance, "session", path.join(root, "plugins", "immutability.ts"));

  agents.session = "fix-widget";
  await instance["chat.params"]({ sessionID: "session", agent: "fix-widget" });
  await mutate(instance, "session", path.join(root, "src", "widget.ts"));

  agents.session = "build";
  await instance["chat.params"]({ sessionID: "session", agent: "build" });
  await assert.rejects(mutate(instance, "session", path.join(root, "README.md")), /outside its declared edit paths/);
  await assert.rejects(
    instance["tool.execute.before"]({ tool: "bash", sessionID: "session", callID: "shell" }, { args: { command: "true", cwd: root } }),
    /may not execute shell/,
  );
}));

test("a managed ancestry cycle denies mutation and Bash without widening Ask", async () => fixture(async root => {
  await publish(root);
  const agents = { ask: "ask", generated: "fix-widget" };
  const parents = { ask: "generated", generated: "ask" };
  const instance = await guard(root, agents, parents);

  await assert.rejects(mutate(instance, "ask", path.join(root, "src", "widget.ts")), /invalid or cyclic ancestry/);
  await assert.rejects(
    instance["tool.execute.before"]({ tool: "bash", sessionID: "ask", callID: "shell" }, { args: { command: "true", cwd: root } }),
    /invalid or cyclic ancestry/,
  );
}));

test("failed or malformed ancestry lookups deny generated and unknown descendants", async () => fixture(async root => {
  await publish(root);
  const cases = [
    ["lookup throw", "fix-widget", async () => { throw new Error("lookup failed"); }],
    ["lookup throw", "third-party", async () => { throw new Error("lookup failed"); }],
    ["missing parent", "fix-widget", async () => ({ data: undefined })],
    ["missing parent", "third-party", async () => ({ data: undefined })],
    ["malformed parent", "fix-widget", async () => ({ data: [] })],
    ["malformed parent", "third-party", async () => ({ data: { id: 42 } })],
    ["unresolved parent identity", "fix-widget", async () => ({ data: { id: "parent" } })],
    ["unresolved parent identity", "third-party", async () => ({ data: { id: "parent" } })],
  ];

  for (const [label, agent, parentLookup] of cases) {
    const lookupClient = {
      session: {
        get: async ({ path: value }) => value.id === "child"
          ? { data: { id: "child", agent, parentID: "parent" } }
          : parentLookup(),
        messages: async () => ({ data: [] }),
      },
    };
    const instance = await ImmutabilityGuard({ directory: root, worktree: root, client: lookupClient });
    await assert.rejects(
      mutate(instance, "child", path.join(root, "src", "widget.ts")),
      error => /invalid or cyclic ancestry/.test(error.message),
      label,
    );
    await assert.rejects(
      instance["tool.execute.before"]({ tool: "bash", sessionID: "child", callID: "shell" }, { args: { command: "true", cwd: root } }),
      error => /invalid or cyclic ancestry/.test(error.message),
      label,
    );
  }
}));

test("an unresolved descendant identity cannot fall through an unmanaged parent", async () => fixture(async root => {
  const lookupClient = {
    session: {
      get: async ({ path: value }) => ({ data: value.id === "child"
        ? { id: "child", parentID: "parent" }
        : { id: "parent", agent: "third-party" } }),
      messages: async () => { throw new Error("messages failed"); },
    },
  };
  const instance = await ImmutabilityGuard({ directory: root, worktree: root, client: lookupClient });
  await assert.rejects(mutate(instance, "child", path.join(root, "src", "widget.ts")), /invalid or cyclic ancestry/);
  await assert.rejects(
    instance["tool.execute.before"]({ tool: "bash", sessionID: "child", callID: "shell" }, { args: { command: "true", cwd: root } }),
    /invalid or cyclic ancestry/,
  );
}));

test("duplicate registry entries fail closed for the registered identity", async () => fixture(async root => {
  const entry = { name: "fix-widget", manifest: ".opencode/tasks/fix-widget.json" };
  await assertInvalidRegisteredIdentityFailsClosed(root, [entry, entry]);
}));

test("a malformed registry fails closed for its registered identity", async () => fixture(async root => {
  await assertInvalidRegisteredIdentityFailsClosed(root, [
    { name: "fix-widget", manifest: ".opencode/tasks/fix-widget.json" },
    { name: 42, manifest: ".opencode/tasks/other.json" },
  ]);
}));

test("an invalid manifest fails closed for its registered identity", async () => fixture(async root => {
  await publish(root, "fix-widget", ["src/widget.ts"], false);
  await writeFile(path.join(root, ".opencode", "tasks", "fix-widget.json"), JSON.stringify({ schema_version: 1 }));
  const instance = await ImmutabilityGuard({ directory: root, worktree: root, client: { session: {
    get: async () => ({ data: { id: "executor", agent: "build" } }),
    messages: async () => ({ data: [
      { info: { role: "user", agent: "fix-widget" } },
      { info: { role: "user", agent: "build" } },
    ] }),
  } } });
  await assert.rejects(mutate(instance, "executor", path.join(root, "src", "widget.ts")), /invalid generated task package/);
}));

test("invalid registrations cannot reclassify native identities", async () => fixture(async root => {
  await publish(root, "build", ["src/widget.ts"], false);
  const instance = await ImmutabilityGuard({ directory: root, worktree: root, client: { session: {
    get: async () => ({ data: { id: "build" } }),
    messages: async () => ({ data: [{ info: { role: "user", agent: "build" } }] }),
  } } });
  await mutate(instance, "build", path.join(root, "plugins", "immutability.ts"));
  await instance["tool.execute.before"]({ tool: "bash", sessionID: "build", callID: "shell" }, { args: { command: "true", cwd: root } });
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
