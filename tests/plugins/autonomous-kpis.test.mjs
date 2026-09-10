import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { AutonomousKpis, parseRunKpis, summarizeUsage } from "../../plugins/autonomous-kpis.ts";

async function fixture(fn) { const root = await mkdtemp(path.join(os.tmpdir(), "task-kpis-")); try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); } }
const runKpis = { enabled: true, unattended_runtime: { target_seconds: 600 }, token_burn: { target_tokens_per_active_minute: 100, hard_budget_tokens: 10 } };

function manifest(name, hardBudgetTokens = 10) {
  return {
    schema_version: 1,
    task_id: name,
    agent_name: name,
    agent_definition: `.opencode/agents/${name}.md`,
    task_brief: `.opencode/tasks/${name}.md`,
    strategy: "direct",
    permissions: { edit_paths: ["src/widget.ts"], bash: true },
    implementation_scope: ["src/widget.ts"],
    durable_context: ["README.md"],
    verification: {
      commands: ["node --test"],
      success_evidence: ["Fresh output."],
      freshness: "After edits.",
      failure_conditions: ["A command fails."],
      independent_review: null,
    },
    limits: { stop_conditions: ["Scope expands."] },
    escalation_triggers: ["Ambiguous outcome."],
    strategy_config: { work_selection: "Complete the brief." },
    run_kpis: { ...runKpis, token_burn: { ...runKpis.token_burn, hard_budget_tokens: hardBudgetTokens } },
  };
}

async function publish(root, name = "fix-widget") {
  await mkdir(path.join(root, ".opencode", "agents"), { recursive: true });
  await mkdir(path.join(root, ".opencode", "tasks"), { recursive: true });
  await writeFile(path.join(root, ".opencode", "agents", `${name}.md`), "---\ndescription: executor\nmode: primary\n---\nRead the brief.\n");
  await writeFile(path.join(root, ".opencode", "tasks", `${name}.md`), "# Brief\n");
  await writeFile(path.join(root, ".opencode", "tasks", `${name}.json`), JSON.stringify(manifest(name)));
  await writeFile(path.join(root, ".opencode", "generated-agents.json"), JSON.stringify({ schema_version: 1, agents: [{ name, manifest: `.opencode/tasks/${name}.json` }] }));
}

async function publishSecond(root, name, hardBudgetTokens) {
  await writeFile(path.join(root, ".opencode", "agents", `${name}.md`), "---\ndescription: executor\nmode: primary\n---\nRead the brief.\n");
  await writeFile(path.join(root, ".opencode", "tasks", `${name}.md`), "# Brief\n");
  await writeFile(path.join(root, ".opencode", "tasks", `${name}.json`), JSON.stringify(manifest(name, hardBudgetTokens)));
  await writeFile(path.join(root, ".opencode", "generated-agents.json"), JSON.stringify({
    schema_version: 1,
    agents: ["fix-widget", name].map(agent => ({ name: agent, manifest: `.opencode/tasks/${agent}.json` })),
  }));
}

async function assertKpisInactive(root, agent) {
  const guard = await AutonomousKpis({ directory: root, worktree: root, client: { session: {
    get: async ({ path: value }) => ({ data: { id: value.id } }),
    messages: async () => ({ data: [] }),
  } } });
  const params = { maxOutputTokens: 100 };
  await guard["chat.params"]({ sessionID: "root", agent }, params);
  assert.equal(params.maxOutputTokens, 100);
  const output = { system: [] };
  await guard["experimental.chat.system.transform"]({ sessionID: "root" }, output);
  assert.deepEqual(output.system, []);
}

test("absent or disabled run KPIs do not activate the monitor", () => {
  assert.equal(parseRunKpis({ schema_version: 1 }), undefined);
  assert.equal(parseRunKpis({ run_kpis: { enabled: false } }), undefined);
});

test("usage totals merge overlapping active intervals", () => {
  const summary = summarizeUsage([{ tokens: 20, created: 0, completed: 60_000 }, { tokens: 10, created: 30_000, completed: 90_000 }]);
  assert.equal(summary.tokens, 30);
  assert.equal(summary.activeMilliseconds, 90_000);
});

test("registered task KPIs cap output and block a later turn", async () => fixture(async root => {
  await publish(root);
  const guard = await AutonomousKpis({ directory: root, worktree: root, client: { session: {
    get: async ({ path: value }) => ({ data: { id: value.id } }),
    messages: async () => ({ data: [] }),
  } } });
  const first = { maxOutputTokens: 100 };
  await guard["chat.params"]({ sessionID: "root", agent: "fix-widget" }, first);
  assert.equal(first.maxOutputTokens, 10);
  await guard.event({ event: { type: "message.updated", properties: { info: { id: "m", sessionID: "root", role: "assistant", time: { created: 1, completed: 2 }, tokens: { input: 4, output: 3, reasoning: 2, cache: { read: 1, write: 0 } } } } } });
  await assert.rejects(guard["chat.params"]({ sessionID: "root", agent: "fix-widget" }, { maxOutputTokens: undefined }), /hard token budget exhausted/);
}));

test("switching a generated KPI root to Build cannot disable its policy", async () => fixture(async root => {
  await publish(root);
  const guard = await AutonomousKpis({ directory: root, worktree: root, client: { session: {
    get: async ({ path: value }) => ({ data: { id: value.id } }),
    messages: async () => ({ data: [] }),
  } } });
  await guard["chat.params"]({ sessionID: "root", agent: "fix-widget" }, { maxOutputTokens: 100 });

  const switched = { maxOutputTokens: 100 };
  await guard["chat.params"]({ sessionID: "root", agent: "build" }, switched);

  assert.equal(switched.maxOutputTokens, 10);
}));

test("a cold reload reconstructs generated KPIs before a Build switch", async () => fixture(async root => {
  await publish(root);
  for (const session of [{ id: "root" }, { id: "root", agent: "build" }]) {
    const historyClient = {
      session: {
        get: async () => ({ data: session }),
        messages: async () => ({ data: [
          { info: { role: "user", agent: "fix-widget" } },
          { info: { role: "user", agent: "build" } },
        ] }),
      },
    };
    const reloaded = await AutonomousKpis({ directory: root, worktree: root, client: historyClient });
    const params = { maxOutputTokens: 100 };

    await reloaded["chat.params"]({ sessionID: "root", agent: "build" }, params);

    assert.equal(params.maxOutputTokens, 10);
  }
}));

test("KPI reconstruction uses timestamps and ignores initial native selections", async () => fixture(async root => {
  await publish(root);
  await publishSecond(root, "other-widget", 50);
  const historyClient = {
    session: {
      get: async () => ({ data: { id: "root" } }),
      messages: async () => ({ data: [
        { info: { role: "user", agent: "other-widget", time: { created: 30 } } },
        { info: { role: "user", agent: "build", time: { created: 40 } } },
        { info: { role: "user", agent: "fix-widget", time: { created: 20 } } },
        { info: { role: "user", agent: "build", time: { created: 10 } } },
      ] }),
    },
  };
  const reloaded = await AutonomousKpis({ directory: root, worktree: root, client: historyClient });
  const params = { maxOutputTokens: 100 };

  await reloaded["chat.params"]({ sessionID: "root", agent: "build" }, params);

  assert.equal(params.maxOutputTokens, 10);
}));

test("a cold Ask to generated session keeps generated KPIs inactive", async () => fixture(async root => {
  await publish(root);
  const historyClient = {
    session: {
      get: async () => ({ data: { id: "root", agent: "fix-widget" } }),
      messages: async () => ({ data: [
        { info: { role: "user", agent: "ask" } },
        { info: { role: "user", agent: "fix-widget" } },
      ] }),
    },
  };
  const reloaded = await AutonomousKpis({ directory: root, worktree: root, client: historyClient });
  const params = { maxOutputTokens: 100 };

  await reloaded["chat.params"]({ sessionID: "root", agent: "fix-widget" }, params);

  assert.equal(params.maxOutputTokens, 100);
  const output = { system: [] };
  await reloaded["experimental.chat.system.transform"]({ sessionID: "root" }, output);
  assert.deepEqual(output.system, []);
}));

test("a cold generated-A to generated-B session keeps generated-A KPIs", async () => fixture(async root => {
  await publish(root);
  await publishSecond(root, "other-widget", 50);
  const reloaded = await AutonomousKpis({ directory: root, worktree: root, client: { session: {
    get: async () => ({ data: { id: "root", agent: "other-widget" } }),
    messages: async () => ({ data: [
      { info: { role: "user", agent: "fix-widget" } },
      { info: { role: "user", agent: "other-widget" } },
    ] }),
  } } });
  const params = { maxOutputTokens: 100 };

  await reloaded["chat.params"]({ sessionID: "root", agent: "other-widget" }, params);

  assert.equal(params.maxOutputTokens, 10);
}));

test("failed or malformed history lookup leaves cold-reload KPIs inactive", async () => fixture(async root => {
  await publish(root);
  const cases = [
    ["lookup failure", async () => { throw new Error("history failed"); }],
    ["non-array response", async () => ({ data: {} })],
    ["malformed user selection", async () => ({ data: [{ info: { role: "user", agent: 42 } }] })],
  ];

  for (const [label, messages] of cases) {
    const reloaded = await AutonomousKpis({
      directory: root,
      worktree: root,
      client: { session: { get: async () => ({ data: { id: "root", agent: "build" } }), messages } },
    });
    const params = { maxOutputTokens: 100 };
    await reloaded["chat.params"]({ sessionID: "root", agent: "build" }, params);
    assert.equal(params.maxOutputTokens, 100, label);
  }
}));

test("generated session metadata cannot activate KPIs without history", async () => fixture(async root => {
  await publish(root);
  const reloaded = await AutonomousKpis({ directory: root, worktree: root, client: { session: {
    get: async () => ({ data: { id: "root", agent: "fix-widget" } }),
    messages: async () => { throw new Error("history failed"); },
  } } });
  const params = { maxOutputTokens: 100 };

  await reloaded["chat.params"]({ sessionID: "root", agent: "build" }, params);

  assert.equal(params.maxOutputTokens, 100);
}));

test("switching a generated KPI root cannot replace its policy", async () => fixture(async root => {
  await publish(root);
  await publishSecond(root, "other-widget", 50);
  const guard = await AutonomousKpis({ directory: root, worktree: root, client: { session: {
    get: async ({ path: value }) => ({ data: { id: value.id } }),
    messages: async () => ({ data: [] }),
  } } });
  await guard["chat.params"]({ sessionID: "root", agent: "fix-widget" }, { maxOutputTokens: 100 });

  const switched = { maxOutputTokens: 100 };
  await guard["chat.params"]({ sessionID: "root", agent: "other-widget" }, switched);

  assert.equal(switched.maxOutputTokens, 10);
}));

test("an ancestry cycle cannot select a generated KPI root", async () => fixture(async root => {
  await publish(root);
  const sessions = {
    generated: { id: "generated", agent: "fix-widget", parentID: "ask" },
    ask: { id: "ask", agent: "ask", parentID: "generated" },
  };
  const guard = await AutonomousKpis({
    directory: root,
    worktree: root,
    client: { session: { get: async ({ path: value }) => ({ data: sessions[value.id] }) } },
  });
  const params = { maxOutputTokens: 100 };
  await guard["chat.params"]({ sessionID: "generated", agent: "fix-widget" }, params);
  assert.equal(params.maxOutputTokens, 100);
  const output = { system: [] };
  await guard["experimental.chat.system.transform"]({ sessionID: "generated" }, output);
  assert.deepEqual(output.system, []);
}));

test("unresolved ancestry cannot activate a generated KPI policy", async () => fixture(async root => {
  await publish(root);
  const cases = [
    ["lookup throw", "fix-widget", async () => { throw new Error("lookup failed"); }],
    ["missing parent", "fix-widget", async id => id === "child" ? { data: { id, parentID: "parent" } } : { data: undefined }],
    ["malformed parent", "third-party", async id => id === "child" ? { data: { id, parentID: "parent" } } : { data: { agent: "fix-widget" } }],
  ];

  for (const [label, agent, lookup] of cases) {
    const guard = await AutonomousKpis({
      directory: root,
      worktree: root,
      client: { session: { get: async ({ path: value }) => lookup(value.id) } },
    });
    const params = { maxOutputTokens: 100 };
    await guard["chat.params"]({ sessionID: "child", agent }, params);
    assert.equal(params.maxOutputTokens, 100, label);
    const output = { system: [] };
    await guard["experimental.chat.system.transform"]({ sessionID: "child" }, output);
    assert.deepEqual(output.system, [], label);
  }
}));

test("unregistered identities receive no KPI guidance", async () => fixture(async root => {
  await publish(root);
  const guard = await AutonomousKpis({ directory: root, worktree: root, client: { session: {
    get: async ({ path: value }) => ({ data: { id: value.id } }),
    messages: async () => ({ data: [] }),
  } } });
  await guard["chat.params"]({ sessionID: "root", agent: "third-party" }, { maxOutputTokens: undefined });
  const output = { system: [] };
  await guard["experimental.chat.system.transform"]({ sessionID: "root" }, output);
  assert.deepEqual(output.system, []);
}));

test("an incomplete manifest cannot activate KPIs", async () => fixture(async root => {
  await publish(root);
  await writeFile(path.join(root, ".opencode", "tasks", "fix-widget.json"), JSON.stringify({ schema_version: 1, run_kpis: runKpis }));
  await assertKpisInactive(root, "fix-widget");
}));

test("a duplicate registry cannot activate KPIs", async () => fixture(async root => {
  await publish(root);
  const entry = { name: "fix-widget", manifest: ".opencode/tasks/fix-widget.json" };
  await writeFile(path.join(root, ".opencode", "generated-agents.json"), JSON.stringify({ schema_version: 1, agents: [entry, entry] }));
  await assertKpisInactive(root, "fix-widget");
}));

test("a native identity registration attempt cannot activate KPIs", async () => fixture(async root => {
  await publish(root, "build");
  await assertKpisInactive(root, "build");
}));
