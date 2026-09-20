import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Goal } from "../../plugins/goal.ts";
import { ImmutabilityGuard } from "../../plugins/immutability.ts";
import { publishDirectAgentFile } from "../../tools/publish_direct_agent.ts";

const model = { providerID: "local", modelID: "test" };
const verdict = (passed) => ({ status: "checked", reason: "", checks: { c0: { passed, evidence: passed ? "node test.mjs passed against current files" : "node test.mjs failed: expected 2, got 1" } } });

async function fixture(fn, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "direct-goal-"));
  try {
    await publishDirectAgentFile(root, {
      name: "fix-counter", description: "Fix the counter", outcome: "Counter works",
      acceptance_criteria: ["Counter returns two"], durable_context: ["README.md"],
      edit_paths: ["counter.mjs"], bash: true, verification_commands: ["node test.mjs"],
      stop_conditions: ["Missing required external dependency"], escalation_triggers: ["Need a new edit path"],
      instructions: "Fix it and verify independently", ...options,
    });
    const sessions = new Map([["root", { id: "root", agent: "fix-counter" }]]);
    const history = new Map([["root", [{ info: { role: "user", agent: "fix-counter", model }, parts: [] }]]]);
    const calls = [];
    const prompts = [];
    const continuations = [];
    const aborts = [];
    let response = verdict(false);
    let run;
    const client = { session: {
      get: async ({ path }) => ({ data: sessions.get(path.id) }),
      messages: async ({ path }) => ({ data: history.get(path.id) ?? [] }),
      create: async ({ body }) => {
        const id = `child-${calls.length}`;
        sessions.set(id, { id, ...body });
        calls.push({ id, ...body });
        return { data: sessions.get(id) };
      },
      prompt: async (input) => {
        prompts.push(input);
        history.set(input.path.id, [{ info: { role: "assistant" }, parts: [{ type: "tool", tool: "bash", state: { status: "completed", output: "test evidence" } }] }]);
        if (run) return run(input);
        if (input.body.parts[0].text.includes("Perform only your assigned validator phase") && response) {
          history.get(input.path.id)[0].parts.push({ type: "tool", tool: "goal_verdict", state: { status: "completed", output: JSON.stringify(response) } });
        }
        return { data: { info: {}, parts: [] } };
      },
      promptAsync: async (input) => { continuations.push(input); return { response: { status: 204 } }; },
      abort: async ({ path }) => { aborts.push(path.id); return { data: true }; },
    } };
    const hooks = await Goal({ client, directory: root, worktree: root });
    const controller = new AbortController();
    const context = { sessionID: "root", messageID: "current", abort: controller.signal, metadata() {} };
    const finish = (result, extra = {}) => history.get("root").push({ info: { role: "assistant", finish: "stop", ...extra }, parts: result ? [{ type: "tool", tool: "goal_cycle", state: { status: "completed", output: JSON.stringify(result) } }] : [] });
    const idle = () => hooks.event({ event: { type: "session.idle", properties: { sessionID: "root" } } });
    const cycle = async () => JSON.parse(await hooks.tool.goal_cycle.execute({}, context));
    await fn({ root, hooks, client, sessions, history, calls, prompts, continuations, aborts, controller, context, finish, idle, cycle,
      setResponse(value) { response = value; }, setRun(value) { run = value; } });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("failed validation repairs in new sessions; only independent validation completes", async () => fixture(async f => {
  const first = await f.cycle();
  assert.equal(first.status, "failed");
  f.finish(first);
  await f.idle();
  assert.equal(f.continuations.length, 1);
  f.setResponse(verdict(true));
  const second = await f.cycle();
  assert.equal(second.status, "validated");
  assert.equal(new Set(f.calls.map(c => c.id)).size, 4);
  assert.deepEqual(f.calls.map(c => c.parentID), ["root", "root", "root", "root"]);
  assert.match(f.prompts[2].body.parts[0].text, /expected 2, got 1/);
  assert.doesNotMatch(f.prompts[3].body.parts[0].text, /expected 2, got 1/);
  assert.ok(f.prompts.every(p => p.body.agent === "general" && p.body.model.modelID === "test"));
  for (const call of [f.calls[0], f.calls[1]]) {
    for (const perm of ["read", "glob", "grep", "list"]) {
      assert.equal(call.permission.find(p => p.permission === perm)?.action, "allow");
    }
  }
  assert.equal(f.calls[0].permission.find(p => p.permission === "edit").action, "allow");
  assert.equal(f.calls[1].permission.find(p => p.permission === "edit").action, "deny");
  assert.equal(f.calls[0].permission.find(p => p.permission === "bash").action, "ask");
  assert.equal(f.calls[1].permission.find(p => p.permission === "bash").action, "ask");
  f.finish(second);
  await f.idle();
  assert.equal(f.continuations.length, 1);
}));

test("premature stops continue repeatedly, with duplicate idle events deduplicated", async () => fixture(async f => {
  f.finish();
  await Promise.all([f.idle(), f.idle()]);
  assert.equal(f.continuations.length, 1);
  f.finish();
  await f.idle();
  assert.equal(f.continuations.length, 2);
}));

test("blocked and malformed validator results remain incomplete", async () => {
  for (const response of [{ status: "checked", checks: {} }, { status: "blocked", reason: "Required game is unavailable" }]) {
    await fixture(async f => {
      f.setResponse(response);
      const result = await f.cycle();
      assert.equal(result.status, "blocked");
      f.finish(result);
      await f.idle();
      assert.equal(f.continuations.length, 0);
    });
  }
});

test("cancellation aborts the active child and never starts validation", async () => fixture(async f => {
  f.setRun(async () => {
    f.controller.abort();
    return { data: { info: {}, parts: [] } };
  });
  const result = await f.cycle();
  assert.equal(result.status, "blocked");
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.aborts, ["child-0"]);
  f.finish(result);
  await f.idle();
  assert.equal(f.continuations.length, 0);
}));

test("permission denial, API failure and assistant errors never auto-retry", async () => {
  for (const failure of ["denied", "api", "assistant"]) {
    await fixture(async f => {
      f.setRun(async input => {
        if (failure === "api") throw new Error("Connection lost; outcome unknown");
        if (failure === "assistant") return { data: { info: { error: { name: "MessageAbortedError" } } } };
        await f.hooks.event({ event: { type: "permission.replied", properties: { sessionID: input.path.id, reply: "reject" } } });
        return { data: { info: {} } };
      });
      const result = await f.cycle();
      assert.equal(result.status, "blocked");
      assert.equal(f.calls.length, 1);
      f.finish(result);
      await f.idle();
      assert.equal(f.continuations.length, 0);
    });
  }
});

test("child tools inherit exact Direct edit boundaries through real guard", async () => fixture(async f => {
  await f.cycle();
  const guard = await ImmutabilityGuard({ client: f.client, directory: f.root, worktree: f.root });
  for (const child of f.calls) {
    await guard["chat.params"]({ sessionID: child.id, agent: "general" });
    await assert.rejects(guard["tool.execute.before"]({ tool: "write", sessionID: child.id }, { args: { filePath: path.join(f.root, "outside.mjs") } }), /outside its declared/);
    await assert.rejects(guard["tool.execute.before"]({ tool: "publish_direct_agent", sessionID: child.id }, { args: {} }), /only @prometheus/);
  }
}));

test("native agents, child sessions and historical non-goal Direct files do not start goals", async () => fixture(async f => {
  f.history.get("root")[0].info.agent = "build";
  f.finish();
  await f.idle();
  assert.equal(f.continuations.length, 0);
  await assert.rejects(f.cycle(), /selected root/);
  f.history.get("root")[0].info.agent = "fix-counter";
  f.sessions.get("root").parentID = "parent";
  await f.idle();
  assert.equal(f.continuations.length, 0);
  delete f.sessions.get("root").parentID;
  const file = path.join(f.root, ".opencode/agents/generated/fix-counter.md");
  await writeFile(file, (await readFile(file, "utf8")).replace(/^options: .*\n/m, ""));
  await f.idle();
  assert.equal(f.continuations.length, 0);
}));

test("premature validator completion is retried, not treated as a genuine blocker", async () => fixture(async f => {
  f.setResponse(undefined);
  const result = await f.cycle();
  assert.equal(result.status, "failed");
  f.finish(result);
  await f.idle();
  assert.equal(f.continuations.length, 1);
}));

test("only the current independent validator can record a criterion-complete verdict", async () => fixture(async f => {
  await assert.rejects(f.hooks.tool.goal_verdict.execute(verdict(true), f.context), /Only the active/);
  f.setRun(async input => {
    const childContext = { ...f.context, sessionID: input.path.id };
    if (input.body.parts[0].text.includes("Perform only your assigned builder phase")) {
      await assert.rejects(f.hooks.tool.goal_verdict.execute(verdict(true), childContext), /Only the active/);
    } else {
      await assert.rejects(f.hooks.tool.goal_verdict.execute({ status: "checked", checks: {} }, childContext), /omitted criterion/);
      const output = await f.hooks.tool.goal_verdict.execute(verdict(true), childContext);
      f.history.get(input.path.id)[0].parts.push({ type: "tool", tool: "goal_verdict", state: { status: "completed", output } });
    }
    return { data: { info: {} } };
  });
  const result = await f.cycle();
  assert.equal(result.status, "validated");
  await assert.rejects(f.hooks.tool.goal_verdict.execute(verdict(true), { ...f.context, sessionID: f.calls[1].id }), /Only the active/);
}));

test("published execution model overrides the coordinator model in both children", async () => fixture(async f => {
  await f.cycle();
  assert.ok(f.prompts.every(p => p.body.model.providerID === "qwen" && p.body.model.modelID === "verified-model"));
}, { model: "qwen/verified-model" }));

test("interrupted tool records and model aborts survive plugin reload without replay", async () => fixture(async f => {
  f.finish(null, { error: { name: "MessageAbortedError" } });
  await f.idle();
  assert.equal(f.continuations.length, 0);
  f.history.get("root").pop();
  f.history.get("root").push({ info: { role: "assistant", finish: "stop" }, parts: [{ type: "tool", tool: "goal_cycle", state: { status: "error", error: "interrupted" } }] });
  const reloaded = await Goal({ client: f.client, directory: f.root, worktree: f.root });
  await reloaded.event({ event: { type: "session.idle", properties: { sessionID: "root" } } });
  assert.equal(f.continuations.length, 0);
}));

test("disabled bash in policy denies bash on both children", async () => fixture(async f => {
  await f.cycle();
  for (const call of f.calls) {
    assert.equal(call.permission.find(p => p.permission === "bash")?.action, "deny");
  }
}, { bash: false }));
