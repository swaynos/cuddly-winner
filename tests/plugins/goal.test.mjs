import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Goal } from "../../plugins/goal.ts";
import { ImmutabilityGuard } from "../../plugins/immutability.ts";
import { publishGoalAgentFile } from "../../tools/publish_goal_agent.ts";

const model = { providerID: "local", modelID: "test" };
const verdict = (passed) => ({ status: "checked", reason: "", checks: { c0: { passed, evidence: passed ? "node test.mjs passed against current files" : "node test.mjs failed: expected 2, got 1", ...(passed ? { resolution: "Fresh node test.mjs result now returns 2, resolving the earlier expected 2, got 1 finding" } : {}) } } });

async function fixture(fn, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "goal-agent-runtime-"));
  try {
    await publishGoalAgentFile(root, {
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
    const metadata = [];
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
    const context = { sessionID: "root", messageID: "current", abort: controller.signal,
      metadata(value) { metadata.push(structuredClone(value)); } };
    const finish = (result, extra = {}) => history.get("root").push({ info: { role: "assistant", finish: "stop", ...extra }, parts: result ? [{ type: "tool", tool: "goal_cycle", state: { status: "completed", output: JSON.stringify(result) } }] : [] });
    const idle = () => hooks.event({ event: { type: "session.idle", properties: { sessionID: "root" } } });
    const cycle = async () => {
      const result = await hooks.tool.goal_cycle.execute({}, context);
      return JSON.parse(typeof result === "string" ? result : result.output);
    };
    await fn({ root, hooks, client, sessions, history, calls, prompts, continuations, aborts, metadata, controller, context, finish, idle, cycle,
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
  assert.match(f.prompts[3].body.parts[0].text, /Unresolved independent findings:.*expected 2, got 1/);
  assert.ok(f.prompts.every(p => p.body.agent === "general" && p.body.model.providerID === model.providerID && p.body.model.modelID === model.modelID));
  assert.ok(f.continuations.every(p => p.body.model.providerID === model.providerID && p.body.model.modelID === model.modelID));
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

test("prior findings survive unrelated passing evidence until explicitly resolved", async () => fixture(async f => {
  const first = await f.cycle();
  f.finish(first);
  f.setResponse({ status: "checked", reason: "", checks: { c0: { passed: false, evidence: "A second independent defect also remains" } } });
  f.finish(await f.cycle());
  f.setResponse({ status: "checked", reason: "", checks: { c0: { passed: true, evidence: "Unrelated legacy tests passed" } } });
  const drift = await f.cycle();
  assert.equal(drift.status, "failed");
  assert.equal(drift.validation.checks.c0.evidence, first.validation.checks.c0.evidence);
  assert.match(f.prompts.at(-1).body.parts[0].text, /expected 2, got 1.*second independent defect/);
  f.finish(drift);
  f.setResponse(verdict(true));
  assert.equal((await f.cycle()).status, "validated");
}));

test("changed definitions invalidate previous success across runtime reload", async () => fixture(async f => {
  f.setResponse(verdict(true));
  f.finish(await f.cycle());
  const inspected = await publishGoalAgentFile(f.root, { operation: "inspect", name: "fix-counter" });
  await writeFile(path.join(f.root, inspected.path), inspected.content.replace("Counter works", "Counter works differently"));
  const reloaded = await Goal({ client: f.client, directory: f.root, worktree: f.root });
  const result = await reloaded.tool.goal_cycle.execute({}, f.context);
  assert.equal(JSON.parse(typeof result === "string" ? result : result.output).status, "blocked");
  assert.equal(f.calls.length, 2, "revised definition cannot reuse the old conversation");
  await reloaded.event({ event: { type: "session.idle", properties: { sessionID: "root" } } });
  assert.equal(f.continuations.length, 0);
}));

test("required historical evidence remains a terminal blocker without generation", async () => fixture(async f => {
  f.setResponse({ status: "blocked", reason: "Inspection confirms the required pre-change baseline is absent", checks: {} });
  const result = await f.cycle();
  assert.equal(result.status, "blocked");
  f.finish(result);
  await f.idle();
  assert.equal(f.continuations.length, 0);
}));

test("offline executable continuation repairs only rejected work and preserves accepted bytes", async () => fixture(async f => {
  const accepted = Buffer.from("accepted-region\0exact-bytes");
  const file = path.join(f.root, "counter.mjs");
  await writeFile(file, Buffer.concat([accepted, Buffer.from("defective")]));
  let builds = 0;
  f.setRun(async input => {
    const text = input.body.parts[0].text;
    if (text.includes("assigned builder phase")) {
      builds++;
      if (builds === 2) {
        assert.match(text, /Rejected suffix is defective/);
        const current = await readFile(file);
        await writeFile(file, Buffer.concat([current.subarray(0, accepted.length), Buffer.from("repaired")]));
      }
    } else {
      const bytes = await readFile(file);
      assert.deepEqual(bytes.subarray(0, accepted.length), accepted);
      const passed = bytes.subarray(accepted.length).toString() === "repaired";
      const report = { status: "checked", reason: "", checks: { c0: { passed,
        evidence: passed ? "Fresh byte comparison: accepted prefix unchanged and rejected suffix repaired" : "Rejected suffix is defective",
        ...(passed ? { resolution: "Fresh byte comparison confirms the defective suffix is repaired; accepted prefix is byte-identical" } : {}) } } };
      f.history.get(input.path.id)[0].parts.push({ type: "tool", tool: "goal_verdict", state: { status: "completed", output: JSON.stringify(report) } });
    }
    return { data: { info: {}, parts: [] } };
  });
  const failed = await f.cycle();
  assert.equal(failed.status, "failed");
  f.finish(failed);
  f.finish(); // Premature coordinator completion must still continue.
  await f.idle();
  assert.equal(f.continuations.length, 1);
  const passed = await f.cycle();
  assert.equal(passed.status, "validated");
  f.finish(passed);
  await f.idle();
  assert.equal(f.continuations.length, 1);
  assert.equal(builds, 2);
  assert.ok([...f.history.values()].flatMap(messages => messages.flatMap(m => m.parts)).every(part => !part.tool?.startsWith("cuddly-winner-browser")));
}));

test("mutation guard freezes changed definitions before and after reload", async () => fixture(async f => {
  const invoke = hooks => hooks["tool.execute.before"]({ tool: "write", sessionID: "child", callID: "write" }, { args: { filePath: path.join(f.root, "counter.mjs") } });
  f.sessions.set("child", { id: "child", parentID: "root", agent: "general" });
  const guard = await ImmutabilityGuard({ client: f.client, directory: f.root, worktree: f.root });
  await invoke(guard);
  f.finish(await f.cycle());
  const inspected = await publishGoalAgentFile(f.root, { operation: "inspect", name: "fix-counter" });
  await writeFile(path.join(f.root, inspected.path), inspected.content.replace("Counter works", "Revised outcome"));
  await assert.rejects(invoke(guard), /denied|invalid/);
  const reloaded = await ImmutabilityGuard({ client: f.client, directory: f.root, worktree: f.root });
  await assert.rejects(invoke(reloaded), /denied|invalid/);
}));

test("a revision during an active build blocks mutation and never starts validation", async () => fixture(async f => {
  f.setRun(async input => {
    const inspected = await publishGoalAgentFile(f.root, { operation: "inspect", name: "fix-counter" });
    f.history.get("root").push({ info: { role: "assistant" }, parts: [{ type: "tool", tool: "goal_cycle", state: {
      status: "running", metadata: f.metadata.at(-1).metadata,
    } }] });
    await writeFile(path.join(f.root, inspected.path), inspected.content.replace("Counter works", "Changed during build"));
    const guard = await ImmutabilityGuard({ client: f.client, directory: f.root, worktree: f.root });
    await assert.rejects(guard["tool.execute.before"]({ tool: "write", sessionID: input.path.id, callID: "write" },
      { args: { filePath: path.join(f.root, "counter.mjs") } }), /invalid|denied/);
    return { data: { info: {}, parts: [] } };
  });
  const result = await f.cycle();
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /definition changed/);
  assert.equal(f.calls.length, 1);
}));

test("premature stops continue repeatedly, with duplicate idle events deduplicated", async () => fixture(async f => {
  f.finish();
  await Promise.all([f.idle(), f.idle()]);
  assert.equal(f.continuations.length, 1);
  f.finish();
  await f.idle();
  assert.equal(f.continuations.length, 2);
}));

test("observed blockers stop but malformed completed reports return to repair", async () => {
  for (const response of [{ status: "checked", checks: {} }, { status: "blocked", reason: "Required game is unavailable" }]) {
    await fixture(async f => {
      f.setResponse(response);
      const result = await f.cycle();
      assert.equal(result.status, response.status === "blocked" ? "blocked" : "failed");
      f.finish(result);
      await f.idle();
      assert.equal(f.continuations.length, response.status === "blocked" ? 0 : 1);
    });
  }
});

test("evidence-free orchestration blocker is repaired across repeated cycles", async () => fixture(async f => {
  f.setRun(async input => {
    if (input.body.parts[0].text.includes("Perform only your assigned validator phase")) {
      f.history.set(input.path.id, [{ info: {}, parts: [{ type: "tool", tool: "goal_verdict", state: {
        status: "completed", output: JSON.stringify({ status: "blocked", reason: "goal_cycle is unavailable", checks: {} }),
      } }] }]);
    }
    return { data: { info: {} } };
  });
  for (let i = 0; i < 6; i++) {
    const result = await f.cycle();
    assert.equal(result.status, "failed");
    assert.match(result.reason, /without inspecting/);
    f.finish(result);
    await f.idle();
  }
  assert.equal(f.continuations.length, 6);
  assert.equal(new Set(f.calls.map(c => c.id)).size, 12);
  assert.ok(f.prompts.every(p => /ROLE BOUNDARY/.test(p.body.parts[0].text)));
}));

test("bookkeeping and unavailable tools do not establish blocker evidence", async () => {
  for (const part of [
    { type: "tool", tool: "todowrite", state: { status: "completed", output: "Validation pending" } },
    { type: "tool", tool: "invalid", state: { status: "error", error: "Model tried to call unavailable tool goal_cycle" } },
    { type: "tool", tool: "goal_cycle", state: { status: "error", error: "Tool unavailable" } },
  ]) {
    await fixture(async f => {
      f.setRun(async input => {
        if (input.body.parts[0].text.includes("Perform only your assigned validator phase")) {
          f.history.set(input.path.id, [{ info: {}, parts: [part, { type: "tool", tool: "goal_verdict", state: {
            status: "completed", output: JSON.stringify({ status: "blocked", reason: "goal_cycle is unavailable", checks: {} }),
          } }] }]);
        }
        return { data: { info: {} } };
      });
      const result = await f.cycle();
      assert.equal(result.status, "failed", part.tool);
      assert.match(result.reason, /without inspecting/);
      f.finish(result);
      await f.idle();
      assert.equal(f.continuations.length, 1);
    });
  }
});

test("failed inspection of an unavailable external resource remains terminal", async () => fixture(async f => {
  f.setRun(async input => {
    if (input.body.parts[0].text.includes("Perform only your assigned validator phase")) {
      f.history.set(input.path.id, [{ info: {}, parts: [
        { type: "tool", tool: "webfetch", state: { status: "error", error: "Required external service is unavailable: HTTP 503" } },
        { type: "tool", tool: "goal_verdict", state: {
          status: "completed", output: JSON.stringify({ status: "blocked", reason: "Required external service returned HTTP 503", checks: {} }),
        } },
      ] }]);
    }
    return { data: { info: {} } };
  });
  const result = await f.cycle();
  assert.equal(result.status, "blocked");
  f.finish(result);
  await f.idle();
  assert.equal(f.continuations.length, 0);
}));

test("invalid JSON in a completed validator report returns to repair", async () => fixture(async f => {
  f.setRun(async input => {
    if (input.body.parts[0].text.includes("Perform only your assigned validator phase")) {
      f.history.get(input.path.id)[0].parts.push({ type: "tool", tool: "goal_verdict", state: {
        status: "completed", output: "{invalid JSON",
      } });
    }
    return { data: { info: {} } };
  });
  const result = await f.cycle();
  assert.equal(result.status, "failed");
  assert.match(result.reason, /Invalid completed validator report/);
  f.finish(result);
  await f.idle();
  assert.equal(f.continuations.length, 1);
}));

test("ordinary rejected inputs and cancelled test assertions do not imply user denial", async () => fixture(async f => {
  f.setRun(async input => {
    f.history.get(input.path.id)[0].parts.push({ type: "tool", tool: "bash", state: { status: "error", error: "test rejected input: expected cancelled job, got running" } });
    if (input.body.parts[0].text.includes("Perform only your assigned validator phase")) {
      f.history.get(input.path.id)[0].parts.push({ type: "tool", tool: "goal_verdict", state: { status: "completed", output: JSON.stringify(verdict(false)) } });
    }
    return { data: { info: {} } };
  });
  const result = await f.cycle();
  assert.equal(result.status, "failed");
  f.finish(result);
  await f.idle();
  assert.equal(f.continuations.length, 1);
}));

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

test("child tools inherit exact Goal Agent edit boundaries through real guard", async () => fixture(async f => {
  await f.cycle();
  const guard = await ImmutabilityGuard({ client: f.client, directory: f.root, worktree: f.root });
  for (const child of f.calls) {
    await guard["chat.params"]({ sessionID: child.id, agent: "general" });
    await assert.rejects(guard["tool.execute.before"]({ tool: "write", sessionID: child.id }, { args: { filePath: path.join(f.root, "outside.mjs") } }), /outside its declared/);
    await assert.rejects(guard["tool.execute.before"]({ tool: "publish_goal_agent", sessionID: child.id }, { args: {} }), /only @prometheus/);
  }
}));

test("native agents, child sessions and Goal Agents without goal metadata do not start goals", async () => fixture(async f => {
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

test("builder and validator can use separate published model overrides", async () => fixture(async f => {
  await f.cycle();
  assert.deepEqual(f.prompts.map(p => p.body.model), [
    { providerID: "qwen", modelID: "coder" },
    { providerID: "anthropic", modelID: "checker" },
  ]);
}, { builder_model: "qwen/coder", validator_model: "anthropic/checker" }));

test("builder and validator inherit the Goal Agent session model by default", async () => fixture(async f => {
  await f.cycle();
  assert.deepEqual(f.prompts.map(p => p.body.model), [model, model]);
}));

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

test("live progress is parent scoped, bounded and survives completion metadata", async () => fixture(async f => {
  const milestones = [];
  f.setRun(async input => {
    const id = input.path.id;
    const role = input.body.parts[0].text.includes("Perform only your assigned builder phase") ? "builder" : "validator";
    const childContext = { ...f.context, sessionID: id };
    await f.hooks.tool.goal_progress.execute({ summary: role === "builder" ? "Preparing source overlays" : "Checking independent evidence" }, childContext);
    assert.equal(f.metadata.at(-1).metadata.goal_activity.phase, role);
    assert.equal(f.metadata.at(-1).metadata.goal_activity.milestone, role === "builder" ? "Preparing source overlays" : "Checking independent evidence");
    const count = f.metadata.length;
    await f.hooks.tool.goal_progress.execute({ summary: f.metadata.at(-1).metadata.goal_activity.milestone }, childContext);
    assert.equal(f.metadata.length, count, "identical milestones are deduplicated");
    await f.hooks.event({ event: { type: "message.part.updated", properties: { part: {
      sessionID: id, type: "tool", callID: "inspect", tool: "read", state: { status: "running", input: { secret: "PRIVATE_SENTINEL" }, output: "PRIVATE_SENTINEL" },
    } } } });
    assert.equal(f.metadata.at(-1).metadata.goal_activity.activity, "Reading project files");
    await f.hooks["tool.execute.after"]({ sessionID: id, callID: "inspect", tool: "read" }, { output: "PRIVATE_SENTINEL" });
    assert.match(f.metadata.at(-1).metadata.goal_activity.activity, /Tool finished/);
    await f.hooks.event({ event: { type: "permission.asked", properties: { sessionID: id } } });
    assert.equal(f.metadata.at(-1).metadata.goal_activity.status, "waiting");
    await f.hooks.event({ event: { type: "permission.replied", properties: { sessionID: id, reply: "once" } } });
    assert.equal(f.metadata.at(-1).metadata.goal_activity.status, "running");
    milestones.push(id);
    if (role === "validator") {
      await assert.rejects(f.hooks.tool.goal_progress.execute({ summary: "Late builder event" }, { ...f.context, sessionID: milestones[0] }), /active Goal child/);
      f.history.get(id)[0].parts.push({ type: "tool", tool: "goal_verdict", state: { status: "completed", output: JSON.stringify(verdict(true)) } });
    }
    return { data: { info: {} } };
  });
  await assert.rejects(f.hooks.tool.goal_progress.execute({ summary: "Root cannot report" }, f.context), /active Goal child/);
  const result = await f.hooks.tool.goal_cycle.execute({}, f.context);
  assert.equal(JSON.parse(result.output).status, "validated");
  assert.equal(result.metadata.goal_activity.status, "validated");
  assert.equal(result.metadata.goal_activity.cycle, 1);
  assert.ok(result.metadata.goal_activity.recent.length <= 3);
  assert.doesNotMatch(JSON.stringify(f.metadata), /PRIVATE_SENTINEL/);
  const count = f.metadata.length;
  await f.hooks["tool.execute.before"]({ sessionID: "unrelated", callID: "x", tool: "bash" });
  await f.hooks["tool.execute.before"]({ sessionID: milestones[1], callID: "late", tool: "bash" });
  assert.equal(f.metadata.length, count);
}));

test("milestone reporting alone never establishes validation evidence", async () => fixture(async f => {
  f.setRun(async input => {
    if (input.body.parts[0].text.includes("Perform only your assigned validator phase")) {
      f.history.set(input.path.id, [{ info: {}, parts: [
        { type: "tool", tool: "goal_progress", state: { status: "completed", output: "All done" } },
        { type: "tool", tool: "goal_verdict", state: { status: "completed", output: JSON.stringify(verdict(true)) } },
      ] }]);
    }
    return { data: { info: {} } };
  });
  assert.equal((await f.cycle()).status, "failed");
}));

test("cancelled cycles keep an honest final activity state", async () => fixture(async f => {
  f.setRun(async () => { f.controller.abort(); return { data: { info: {} } }; });
  const result = await f.hooks.tool.goal_cycle.execute({}, f.context);
  assert.equal(JSON.parse(result.output).status, "blocked");
  assert.equal(result.metadata.goal_activity.status, "cancelled");
}));
