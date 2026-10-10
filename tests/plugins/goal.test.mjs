import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import http from "node:http";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { Goal } from "../../plugins/goal.ts";
import { ImmutabilityGuard } from "../../plugins/immutability.ts";
import { publishGoalAgentFile } from "../../tools/publish_goal_agent.ts";

const model = { providerID: "local", modelID: "test" };
const request = { alignment: "confirmed", completion_target: "Executable counter implementation verified offline", authorized_actions: "Edit counter.mjs and run offline checks. No generation.",
  max_cycles: 10, max_stalled_cycles: 8, finding: "c0 remains unresolved", repair: "Repair the rejected counter result", expected_evidence: "Fresh independent check returns two" };
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
    let handoff = { status: "ready", evidence: "Fixture implementation and checks are ready for independent validation", remaining: [] };
    let run;
    const client = { session: {
      status: async () => ({ data: {} }),
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
        const result = run ? await run(input) : { data: { info: {}, parts: [] } };
        // Most fixtures model a ready builder; incident/handback tests override
        // this checkpoint explicitly rather than relying on plain final text.
        if (input.body.parts[0].text.includes("Perform only your assigned builder phase") && handoff
          && !history.get(input.path.id).some(m => m.parts.some(p => p.tool === "goal_handoff"))) {
          history.get(input.path.id)[0].parts.push({ type: "tool", tool: "goal_handoff", state: { status: "completed", output: JSON.stringify(handoff) } });
        }
        if (run) return result;
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
    const cycle = async (args = request) => {
      const result = await hooks.tool.goal_cycle.execute(args, context);
      return JSON.parse(typeof result === "string" ? result : result.output);
    };
    await fn({ root, hooks, client, sessions, history, calls, prompts, continuations, aborts, metadata, controller, context, finish, idle, cycle, request,
      setResponse(value) { response = value; }, setRun(value) { run = value; }, setHandoff(value) { handoff = value; } });
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

test("metadata-only builder hands back unfinished implementation without starting validation", async () => fixture(async f => {
  f.setHandoff(undefined);
  await writeFile(path.join(f.root, "counter.mjs"), "missing implementation");
  f.setRun(async input => {
    assert.match(input.body.parts[0].text, /Acceptance criteria are implementation and verification obligations/);
    await writeFile(path.join(f.root, "readiness.json"), '{"inventory":"available"}');
    const handoff = { status: "unfinished", evidence: "Inventory is available, but counter.mjs still lacks the execution path", remaining: ["Implement the missing execution path and exercise it through the HTTP fixture"] };
    const output = await f.hooks.tool.goal_handoff.execute(handoff, { ...f.context, sessionID: input.path.id });
    f.history.get(input.path.id)[0].parts.push({ type: "tool", tool: "goal_handoff", state: { status: "completed", output } });
    return { data: { info: {} } };
  });
  const first = await f.cycle({ ...request, max_cycles: 3, max_stalled_cycles: 2 });
  assert.equal(first.status, "failed");
  assert.equal(first.children.length, 1);
  assert.equal(first.validation, undefined);
  assert.equal(await readFile(path.join(f.root, "counter.mjs"), "utf8"), "missing implementation");
  assert.match(f.metadata.at(-1).metadata.goal_activity.activity, /Builder unfinished; validation not started/);
  f.finish(first);
  const reload = await Goal({ client: f.client, directory: f.root, worktree: f.root });
  f.setHandoff({ status: "ready", evidence: "Execution path implemented and checked", remaining: [] });
  f.setRun(async input => {
    if (input.body.parts[0].text.includes("assigned builder phase")) {
      assert.match(input.body.parts[0].text, /UNFINISHED BUILDER CHECKPOINT.*Implement the missing execution path/);
      await writeFile(path.join(f.root, "counter.mjs"), "implemented");
    } else {
      assert.equal(await readFile(path.join(f.root, "counter.mjs"), "utf8"), "implemented");
      assert.doesNotMatch(input.body.parts[0].text, /UNFINISHED BUILDER CHECKPOINT|Inventory is available/);
      f.history.get(input.path.id)[0].parts.push({ type: "tool", tool: "goal_verdict", state: { status: "completed", output: JSON.stringify(verdict(true)) } });
    }
    return { data: { info: {} } };
  });
  // No fabricated independent finding is necessary to resume unfinished work.
  const raw = await reload.tool.goal_cycle.execute({}, f.context);
  const second = JSON.parse(typeof raw === "string" ? raw : raw.output);
  assert.equal(second.status, "validated");
  assert.deepEqual(second.initial_worktree, first.initial_worktree);
  assert.deepEqual(second.admission, first.admission);
  assert.deepEqual(f.calls.map(c => c.title.split(":")[0]), ["Goal builder", "Goal builder", "Goal validator"]);
  assert.equal(new Set(f.calls.map(c => c.id)).size, 3);
}));

test("missing and malformed handoffs stop as repeated protocol failures after reload", async () => {
  for (const handoff of [undefined, { status: "ready", evidence: "Not implemented", remaining: ["Implement"] }]) {
    await fixture(async f => {
      f.setHandoff(handoff);
      const first = await f.cycle({ ...request, max_cycles: 3, max_stalled_cycles: 2 });
      assert.equal(first.status, "failed");
      assert.equal(first.builder_handoff.status, "unfinished");
      f.finish(first);
      const reload = await Goal({ client: f.client, directory: f.root, worktree: f.root });
      const raw = await reload.tool.goal_cycle.execute({}, f.context);
      const second = JSON.parse(typeof raw === "string" ? raw : raw.output);
      assert.equal(second.status, "blocked");
      assert.match(second.reason, /2 consecutive identical protocol failures/);
      assert.equal(second.validation, undefined);
      assert.equal(f.calls.length, 2, "not a single validator is started");
      f.finish(second);
      await reload.event({ event: { type: "session.idle", properties: { sessionID: "root" } } });
      assert.equal(f.continuations.length, 0);
    });
  }
});

test("builder handoffs are active-role scoped, shaped and evidence-gated", async () => fixture(async f => {
  const ready = { status: "ready", evidence: "Inspected product and checks", remaining: [] };
  await assert.rejects(f.hooks.tool.goal_handoff.execute(ready, f.context), /Only the active/);
  f.setHandoff(undefined);
  f.setRun(async input => {
    const context = { ...f.context, sessionID: input.path.id };
    await assert.rejects(f.hooks.tool.goal_handoff.execute({ ...ready, remaining: ["Missing implementation"] }, context), /Ready handoffs/);
    await assert.rejects(f.hooks.tool.goal_handoff.execute({ ...ready, status: "unfinished" }, context), /next action/);
    const output = await f.hooks.tool.goal_handoff.execute(ready, context);
    f.history.set(input.path.id, [{ info: {}, parts: [{ type: "tool", tool: "goal_handoff", state: { status: "completed", output } }] }]);
    return { data: { info: {} } };
  });
  const result = await f.cycle();
  assert.equal(result.status, "failed");
  assert.match(result.builder_handoff.evidence, /without attempting/);
  await assert.rejects(f.hooks.tool.goal_handoff.execute(ready, { ...f.context, sessionID: f.calls[0].id }), /Only the active/);
}));

test("observed builder dependency blocker stops, bookkeeping-only blocker resumes implementation", async () => {
  for (const observed of [true, false]) await fixture(async f => {
    f.setHandoff({ status: "blocked", evidence: "Required external input returned HTTP 503", remaining: ["Restore access to the required input"] });
    f.setRun(async input => {
      f.history.set(input.path.id, [{ info: {}, parts: [{ type: "tool", tool: observed ? "webfetch" : "goal_progress",
        state: observed ? { status: "error", error: "HTTP 503" } : { status: "completed", output: "Pending" } }] }]);
      return { data: { info: {} } };
    });
    const result = await f.cycle();
    assert.equal(result.status, observed ? "blocked" : "failed");
    assert.equal(f.calls.length, 1);
    assert.equal(result.validation, undefined);
    f.finish(result);
    await f.idle();
    assert.equal(f.continuations.length, observed ? 0 : 1);
  });
});

test("unfinished attempts consume total bound even when mixed with failed validations", async () => fixture(async f => {
  f.finish(await f.cycle({ ...request, max_cycles: 2, max_stalled_cycles: 2 }));
  f.setHandoff({ status: "unfinished", evidence: "Repair still needs implementation", remaining: ["Finish the repair"] });
  const second = await f.cycle();
  assert.equal(second.status, "blocked");
  assert.match(second.reason, /Cycle bound reached/);
  assert.equal(f.calls.length, 3);
  f.finish(second);
  await f.idle();
  assert.equal(f.continuations.length, 0);
}));

test("multiple legitimate partial builders continue before independent validation", async () => fixture(async f => {
  f.setHandoff({ status: "unfinished", evidence: "Partial implementation checked", remaining: ["Finish the next operation"] });
  f.setRun(async input => {
    await writeFile(path.join(f.root, "counter.mjs"), `implemented operation ${f.calls.length}`);
    return { data: { info: {} } };
  });
  for (let i = 0; i < 2; i++) {
    const result = await f.cycle({ ...request, max_cycles: 3, max_stalled_cycles: 2 });
    assert.equal(result.status, "failed");
    assert.equal(result.validation, undefined);
    assert.equal(result.protocol_failure, undefined);
    f.finish(result);
    await f.idle();
  }
  assert.equal(f.continuations.length, 2);
  f.setRun(undefined);
  f.setHandoff({ status: "ready", evidence: "All operations implemented and checked", remaining: [] });
  f.setResponse(verdict(true));
  assert.equal((await f.cycle()).status, "validated");
  assert.deepEqual(f.calls.map(c => c.title.split(":")[0]), ["Goal builder", "Goal builder", "Goal builder", "Goal validator"]);
}));

test("honest unfinished work is bounded by overall attempts, not a progress heuristic", async () => fixture(async f => {
  f.setHandoff({ status: "unfinished", evidence: "No product change yet", remaining: ["Implement the authorized work"] });
  for (let i = 0; i < 3; i++) {
    const result = await f.cycle({ ...request, max_cycles: 3, max_stalled_cycles: 2 });
    assert.equal(result.status, i === 2 ? "blocked" : "failed");
    if (i === 2) assert.match(result.reason, /Cycle bound reached/);
    f.finish(result);
  }
  assert.equal(f.calls.length, 3);
  assert.equal((await f.cycle()).status, "blocked");
  assert.equal(f.calls.length, 3);
}));

test("prior findings survive unrelated passing evidence until explicitly resolved", async () => fixture(async f => {
  const first = await f.cycle();
  f.finish(first);
  f.setResponse({ status: "checked", reason: "", checks: { c0: { passed: false, evidence: "A second independent defect also remains" } } });
  f.finish(await f.cycle());
  f.setResponse({ status: "checked", reason: "", checks: { c0: { passed: true, evidence: "Unrelated legacy tests passed" } } });
  const drift = await f.cycle();
  assert.equal(drift.status, "failed");
  assert.match(drift.reason, /Resolution required.*c0/);
  assert.equal(drift.validation, undefined, "invalid verdict is rejected, not silently rewritten");
  assert.match(f.prompts.at(-1).body.parts[0].text, /expected 2, got 1.*second independent defect/);
  f.finish(drift);
  f.setResponse(verdict(true));
  assert.equal((await f.cycle()).status, "validated");
}));

test("validator corrects missing resolution in its own active session instead of silent verdict rewriting", async () => fixture(async f => {
  f.finish(await f.cycle());
  let corrected = false;
  f.setRun(async input => {
    if (input.body.parts[0].text.includes("assigned validator phase")) {
      const context = { ...f.context, sessionID: input.path.id };
      await assert.rejects(f.hooks.tool.goal_handoff.execute({ status: "ready", evidence: "Validator cannot hand off", remaining: [] }, context), /Only the active Goal builder/);
      const invalid = { status: "checked", reason: "", checks: { c0: { passed: true, evidence: "Counter now returns two" } } };
      await assert.rejects(f.hooks.tool.goal_verdict.execute(invalid, context), /Resolution required.*c0.*has not been accepted/);
      assert.equal(invalid.checks.c0.passed, true, "reject without mutating independent input");
      const output = await f.hooks.tool.goal_verdict.execute(verdict(true), context);
      f.history.get(input.path.id)[0].parts.push({ type: "tool", tool: "goal_verdict", state: { status: "completed", output } });
      corrected = true;
    }
    return { data: { info: {} } };
  });
  assert.equal((await f.cycle()).status, "validated");
  assert.ok(corrected);
}));

test("child prompts do not duplicate prior cycle output or the initial baseline", async () => fixture(async f => {
  const first = await f.cycle();
  first.initial_worktree.limitations.push("unique-baseline-sentinel");
  first.reason = "previous-result-only-sentinel";
  f.finish(first);
  await f.cycle();
  for (const prompt of f.prompts.slice(-2)) {
    const text = prompt.body.parts[0].text;
    assert.equal(text.split("unique-baseline-sentinel").length - 1, 1);
    assert.doesNotMatch(text, /previous-result-only-sentinel/);
    assert.match(text, /expected 2, got 1/);
  }
}));

test("fresh roles receive preparation ownership and scoped readiness checks on every cycle", async () => fixture(async f => {
  f.finish(await f.cycle());
  await f.cycle();
  for (const index of [0, 2]) {
    const prompt = f.prompts[index].body.parts[0].text;
    assert.match(prompt, /PREREQUISITES: Preparation is part of this run/);
    assert.match(prompt, /verify readiness, then continue directly into authorized iterative work/);
    assert.match(prompt, /Record dependencies and readiness evidence so fresh children can resume/);
    assert.match(prompt, /invalidate dependent evidence while preserving unaffected work and history/);
    assert.match(prompt, /For scaffolding-only scope, implement and test/);
    assert.match(prompt, /unknown side effects require inspection before any retry/);
  }
  for (const index of [1, 3]) {
    const prompt = f.prompts[index].body.parts[0].text;
    assert.match(prompt, /PREREQUISITES: Independently check preparation readiness and dependency evidence against current inputs/);
    assert.match(prompt, /respect explicit preparation-only scope and do not perform unauthorized execution/);
    assert.match(prompt, /Missing or stale preparation that the builder can repair within policy is a failed criterion/);
  }
}));

test("changed definitions invalidate previous success across runtime reload", async () => fixture(async f => {
  f.setResponse(verdict(true));
  f.finish(await f.cycle());
  const inspected = await publishGoalAgentFile(f.root, { operation: "inspect", name: "fix-counter" });
  await writeFile(path.join(f.root, inspected.path), inspected.content.replace("Counter works", "Counter works differently"));
  const reloaded = await Goal({ client: f.client, directory: f.root, worktree: f.root });
   const result = await reloaded.tool.goal_cycle.execute(request, f.context);
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

test("admission mismatch and missing admission stop before children, including after reload", async () => {
  for (const args of [{}, { alignment: "clarification_required" }]) {
    await fixture(async f => {
      const result = await f.cycle(args);
      assert.equal(result.status, args.alignment === "clarification_required" ? "blocked" : "invalid_request");
      assert.match(result.reason, /Admission required|Execution mismatch/);
      assert.equal(f.calls.length, 0);
      f.finish(result);
      const reload = await Goal({ client: f.client, directory: f.root, worktree: f.root });
      await reload.event({ event: { type: "session.idle", properties: { sessionID: "root" } } });
      assert.equal(f.continuations.length, 0);
    });
  }
});

test("executor enforces advertised request bounds before child creation", async () => {
  for (const args of [{ ...request, repair: "x".repeat(161) }, { ...request, max_cycles: 101 },
    { ...request, completion_target: "x".repeat(1001) }]) await fixture(async f => {
    const result = await f.cycle(args);
    assert.equal(result.status, "invalid_request");
    assert.match(result.reason, /Invalid .*provide/);
    assert.equal(f.calls.length, 0);
  });
});

test("input correction preserves explicit handback, admission and attempt accounting", async () => fixture(async f => {
  f.finish(await f.cycle({ alignment: "clarification_required" }));
  f.history.get("root").push({ info: { role: "user", agent: "fix-counter", model }, parts: [{ type: "text", text: "Implement and verify offline within the original policy." }] });
  await f.hooks["chat.message"]({ sessionID: "root" }, { parts: [{ type: "text", text: "Implement and verify offline." }] });
  const invalid = await f.cycle({ ...request, authorized_actions: "x".repeat(1001) });
  assert.equal(invalid.status, "invalid_request");
  f.finish(invalid);
  const inspection = await f.cycle({ operation: "inspect" });
  assert.equal(inspection.attempts_used, 0);
  f.finish(inspection);
  f.setResponse(verdict(true));
  const valid = await f.cycle(request);
  assert.equal(valid.status, "validated");
  assert.deepEqual(valid.admission.authorized_actions, request.authorized_actions);
  f.finish(valid);
  const laterInvalid = await f.cycle({ repair: "x".repeat(161) });
  assert.equal(laterInvalid.status, "invalid_request");
  f.finish(laterInvalid);
  assert.equal((await f.cycle({ operation: "inspect" })).attempts_used, 1);
  assert.equal(f.calls.length, 2);
}));

test("a mismatch resumes only after a real user decision and confirmed admission", async () => fixture(async f => {
  f.finish(await f.cycle({ alignment: "clarification_required" }));
  f.history.get("root").push({ info: { role: "user", agent: "fix-counter", model }, parts: [{ type: "text", text: "Implement and verify offline. Do not generate." }] });
  await f.hooks["chat.message"]({ sessionID: "root" }, { parts: [{ type: "text", text: "Implement and verify offline. Do not generate." }] });
  f.setResponse(verdict(true));
  assert.equal((await f.cycle()).status, "validated");
  assert.equal(f.calls.length, 2);
}));

test("repair admission requires a current finding and a concrete resolving hypothesis", async () => fixture(async f => {
  f.finish(await f.cycle());
  const result = await f.cycle({ finding: "c10", repair: "Repeat tests", expected_evidence: "Same test output" });
  assert.equal(result.status, "invalid_request");
  assert.match(result.reason, /Repair diagnosis required/);
  assert.equal(f.calls.length, 2);
  f.finish(result);
  await f.idle();
  assert.equal(f.continuations.length, 1, "the failed execution remains available for a corrected repair request");
}));

test("identical findings stop at the admitted bound without accepting or resetting it", async () => fixture(async f => {
  for (let i = 0; i < 3; i++) {
    const result = await f.cycle({ ...request, max_stalled_cycles: i === 0 ? 3 : 9 });
    assert.equal(result.status, i === 2 ? "blocked" : "failed");
    assert.equal(result.admission.max_stalled_cycles, 3, "later tool arguments cannot increase the admitted bound");
    assert.equal(result.validation.checks.c0.passed, false);
    if (i === 2) assert.match(result.reason, /Non-progress: 3 consecutive identical/);
    f.finish(result);
    await f.idle();
  }
  assert.equal(f.calls.length, 6);
  assert.equal(f.continuations.length, 2);
  const reload = await Goal({ client: f.client, directory: f.root, worktree: f.root });
  await reload.event({ event: { type: "session.idle", properties: { sessionID: "root" } } });
  assert.equal(f.continuations.length, 2);
}));

test("a coordinator that never starts its repair cannot receive unbounded continuation prompts", async () => fixture(async f => {
  f.finish(await f.cycle({ ...request, max_stalled_cycles: 2 }));
  for (let i = 0; i < 3; i++) {
    await f.idle();
    if (i < 2) {
      f.history.get("root").push({ info: { role: "user", agent: "fix-counter", model }, parts: f.continuations.at(-1).body.parts });
      f.finish();
    }
  }
  assert.equal(f.continuations.length, 2);
  assert.equal(f.calls.length, 2);
  const reload = await Goal({ client: f.client, directory: f.root, worktree: f.root });
  await reload.event({ event: { type: "session.idle", properties: { sessionID: "root" } } });
  assert.equal(f.continuations.length, 2);
  const raw = await reload.tool.goal_cycle.execute(request, f.context);
  assert.match(JSON.parse(typeof raw === "string" ? raw : raw.output).reason, /Coordinator non-progress/);
  assert.equal(f.calls.length, 2, "an explicit call cannot bypass a persisted stop without user handback");
}));

test("changing evidence for the same criterion continues until the overall cycle bound", async () => fixture(async f => {
  for (let i = 0; i < 3; i++) {
    f.setResponse({ status: "checked", checks: { c0: { passed: false, evidence: `Fresh check found defect ${i}` } } });
    const result = await f.cycle({ ...request, max_cycles: 3, max_stalled_cycles: 2 });
    assert.equal(result.status, i === 2 ? "blocked" : "failed");
    if (i === 2) assert.match(result.reason, /Cycle bound reached/);
    f.finish(result);
  }
  assert.equal(f.calls.length, 6);
  await f.idle();
  assert.equal(f.continuations.length, 0);
}));

test("non-progress stops retain failed findings across an explicit user handback", async () => fixture(async f => {
  const stopped = await f.cycle({ ...request, max_cycles: 3, max_stalled_cycles: 1 });
  assert.equal(stopped.status, "blocked");
  f.finish(stopped);
  f.history.get("root").push({ info: { role: "user", agent: "fix-counter", model }, parts: [{ type: "text", text: "I inspected the failure. Repair the actual counter defect within the remaining bound." }] });
  await f.hooks["chat.message"]({ sessionID: "root" }, { parts: [{ type: "text", text: "Repair the actual counter defect." }] });
  f.setResponse({ status: "checked", checks: { c0: { passed: true, evidence: "Unrelated tests passed" } } });
  const drift = await f.cycle();
  assert.notEqual(drift.status, "validated");
  assert.match(drift.reason, /Resolution required.*c0/);
  assert.equal(drift.validation, undefined);
  assert.ok(drift.retry);
}));

test("interrupted metadata retains the original admission and baseline after reload", async () => fixture(async f => {
  await writeFile(path.join(f.root, "counter.mjs"), "original bytes");
  f.setRun(async () => {
    await writeFile(path.join(f.root, "counter.mjs"), "partial action bytes");
    throw new Error("Transport lost; outcome unknown");
  });
  const stopped = await f.cycle({ ...request, max_cycles: 2, max_stalled_cycles: 2 });
  assert.equal(stopped.status, "blocked");
  const metadata = f.metadata.at(-1).metadata;
  f.history.get("root").push({ info: { role: "assistant", finish: "stop" }, parts: [{ type: "tool", tool: "goal_cycle", state: { status: "error", error: "interrupted", metadata } }] });
  f.history.get("root").push({ info: { role: "user", agent: "fix-counter", model }, parts: [{ type: "text", text: "I inspected the partial action. Resume without replaying it." }] });
  f.setRun(undefined);
  f.setResponse(verdict(true));
  const reload = await Goal({ client: f.client, directory: f.root, worktree: f.root });
  const raw = await reload.tool.goal_cycle.execute({ ...request, max_cycles: 10 }, f.context);
  const resumed = JSON.parse(typeof raw === "string" ? raw : raw.output);
  assert.equal(resumed.status, "validated");
  assert.equal(resumed.admission.max_cycles, 2);
  assert.deepEqual(resumed.initial_worktree, stopped.initial_worktree);
  assert.equal(resumed.initial_worktree.files["counter.mjs"].sha256, createHash("sha256").update("original bytes").digest("hex"));
}));

test("inspect and same-session recovery count stale running attempts without replay", async () => fixture(async f => {
  let submissions = 0;
  await writeFile(path.join(f.root, "counter.mjs"), "original");
  f.setRun(async input => {
    submissions++;
    await writeFile(path.join(f.root, "counter.mjs"), "external action completed");
    f.history.get(input.path.id)[0].parts.push({ type: "tool", tool: "bash", state: { status: "completed", output: "submission known complete" } });
    throw new Error("Connection lost after action");
  });
  await f.cycle({ ...request, max_cycles: 2, max_stalled_cycles: 2 });
  const metadata = f.metadata.at(-1).metadata;
  f.history.get("root").push({ info: { role: "assistant", finish: "stop" }, parts: [{ type: "tool", tool: "goal_cycle", state: { status: "running", metadata } }] });
  const reload = await Goal({ client: f.client, directory: f.root, worktree: f.root });
  const execute = async args => {
    const raw = await reload.tool.goal_cycle.execute(args, f.context);
    return JSON.parse(typeof raw === "string" ? raw : raw.output);
  };
  const inspect = await execute({ operation: "inspect" });
  assert.equal(inspect.status, "inspected");
  assert.equal(inspect.attempts_used, 1);
  assert.equal(inspect.attempts_remaining, 1);
  assert.equal(inspect.definition_matches, true);
  assert.equal(inspect.interrupted_children[0].status, "idle");
  assert.equal(inspect.interrupted_children[0].completed_tools, 2);
  assert.equal(inspect.checkpoint.status, "blocked");
  assert.equal(inspect.initial_worktree, undefined, "inspection does not dump baseline records");
  f.finish(inspect);
  assert.equal((await execute(request)).status, "blocked", "inspection alone cannot clear the interruption");
  assert.equal(submissions, 1);
  assert.equal(f.calls.length, 1);
  f.history.get("root").push({ info: { role: "user", agent: "fix-counter", model }, parts: [{ type: "text", text: "I inspected the known action; resume without replay." }] });
  await reload["chat.message"]({ sessionID: "root" }, { parts: [{ type: "text", text: "Resume without replay." }] });
  f.setRun(async input => {
    assert.equal(await readFile(path.join(f.root, "counter.mjs"), "utf8"), "external action completed");
    if (input.body.parts[0].text.includes("assigned builder phase")) {
      assert.match(input.body.parts[0].text, /Reconcile recorded task actions/);
    } else f.history.get(input.path.id)[0].parts.push({ type: "tool", tool: "goal_verdict", state: { status: "completed", output: JSON.stringify(verdict(true)) } });
    return { data: { info: {} } };
  });
  const resumed = await execute({ ...request, max_cycles: 10 });
  assert.equal(resumed.status, "validated");
  assert.equal(resumed.admission.max_cycles, 2);
  assert.equal(resumed.initial_worktree.files["counter.mjs"].sha256, createHash("sha256").update("original").digest("hex"));
  assert.equal(submissions, 1);
  f.finish(resumed);
  const finalInspection = await execute({ operation: "inspect" });
  assert.equal(finalInspection.attempts_used, 2);
  assert.match(finalInspection.next_action, /independently validated/);
  assert.equal((await execute(request)).status, "blocked");
  assert.equal(f.calls.length, 3);
}));

test("busy and unknown interrupted children prevent another writer", async () => {
  for (const state of ["busy", "retry", "unknown"]) await fixture(async f => {
    f.setRun(async () => { throw new Error("Connection lost"); });
    await f.cycle(request);
    f.history.get("root").push({ info: { role: "assistant", finish: "stop" }, parts: [{ type: "tool", tool: "goal_cycle", state: { status: "running", metadata: f.metadata.at(-1).metadata } }] });
    f.client.session.status = async () => state === "unknown" ? { error: "Unavailable" } : { data: { "child-0": { type: state } } };
    const reload = await Goal({ client: f.client, directory: f.root, worktree: f.root });
    const raw = await reload.tool.goal_cycle.execute({ operation: "inspect" }, f.context);
    assert.equal(JSON.parse(raw).interrupted_children[0].status, state);
    f.history.get("root").push({ info: { role: "user", agent: "fix-counter", model }, parts: [{ type: "text", text: "Resume if the old child is inactive." }] });
    const result = await reload.tool.goal_cycle.execute(request, f.context);
    assert.match(JSON.parse(typeof result === "string" ? result : result.output).reason, /active or its activity is unknown/);
    assert.equal(f.calls.length, 1);
  });
});

test("a recorded independent verdict survives an interrupted parent result", async () => fixture(async f => {
  await f.cycle({ ...request, max_cycles: 4, max_stalled_cycles: 2 });
  f.history.get("root").push({ info: { role: "assistant", finish: "stop" }, parts: [{ type: "tool", tool: "goal_cycle", state: { status: "running", metadata: f.metadata.at(-1).metadata } }] });
  const reload = await Goal({ client: f.client, directory: f.root, worktree: f.root });
  const inspection = JSON.parse(await reload.tool.goal_cycle.execute({ operation: "inspect" }, f.context));
  assert.equal(inspection.latest_verdict.checks.c0.passed, false);
  f.history.get("root").push({ info: { role: "user", agent: "fix-counter", model }, parts: [{ type: "text", text: "Resume and resolve the recorded independent failure." }] });
  f.setResponse({ status: "checked", checks: { c0: { passed: true, evidence: "Unrelated check passed" } } });
  const raw = await reload.tool.goal_cycle.execute(request, f.context);
  const result = JSON.parse(typeof raw === "string" ? raw : raw.output);
  assert.equal(result.status, "failed");
  assert.match(result.reason, /Resolution required/);
  assert.match(f.prompts.at(-1).body.parts[0].text, /expected 2, got 1/);
}));

test("initial status and hashes preserve attribution for an intentional deletion and untracked input", async () => fixture(async f => {
  // Construct a tiny local Git fixture without running staging, commit or branch commands.
  const object = async (type, content) => {
    const bytes = Buffer.concat([Buffer.from(`${type} ${content.length}\0`), content]);
    const hash = createHash("sha1").update(bytes).digest("hex");
    const directory = path.join(f.root, ".git/objects", hash.slice(0, 2));
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, hash.slice(2)), deflateSync(bytes));
    return hash;
  };
  const blob = await object("blob", Buffer.from("user intentionally removed this agent\n"));
  const tree = await object("tree", Buffer.concat([Buffer.from("100644 retired.md\0"), Buffer.from(blob, "hex")]));
  const commit = await object("commit", Buffer.from(`tree ${tree}\nauthor Fixture <fixture@localhost> 0 +0000\ncommitter Fixture <fixture@localhost> 0 +0000\n\nFixture snapshot\n`));
  await writeFile(path.join(f.root, ".git/HEAD"), `${commit}\n`);
  await mkdir(path.join(f.root, ".git/refs"));
  await writeFile(path.join(f.root, ".git/config"), "[core]\nrepositoryformatversion = 0\nbare = false\n");
  const input = path.join(f.root, "input.txt");
  await writeFile(input, "pre-existing untracked source bytes");
  let builds = 0;
  f.setRun(async session => {
    const prompt = session.body.parts[0].text;
    if (prompt.includes("assigned builder phase") && ++builds === 2) await writeFile(input, "new out-of-scope edit");
    if (prompt.includes("assigned validator phase")) {
      const captured = f.metadata.at(-1).metadata.cycle_evidence.initial_worktree;
      assert.ok(captured.status.some(entry => entry.path === "retired.md" && entry.status.includes("D")));
      assert.ok(captured.status.some(entry => entry.path === "input.txt" && entry.status === "??"));
      assert.equal(captured.files["retired.md"].state, "absent");
      const unchanged = captured.files["input.txt"].sha256 === createHash("sha256").update(await readFile(input)).digest("hex");
      const report = { status: "checked", checks: { c0: { passed: unchanged, evidence: unchanged
        ? "Initial hash and status confirm existing untracked bytes and intentional deletion are preserved"
        : "Fresh hash differs from initial input.txt hash: newly caused out-of-scope mutation" } } };
      f.history.get(session.path.id)[0].parts.push({ type: "tool", tool: "goal_verdict", state: { status: "completed", output: JSON.stringify(report) } });
    }
    return { data: { info: {} } };
  });
  const first = await f.cycle();
  assert.equal(first.status, "validated");
  f.finish(first);
  const changed = await f.cycle();
  assert.equal(changed.status, "failed");
  assert.match(changed.validation.checks.c0.evidence, /newly caused out-of-scope/);
  assert.deepEqual(changed.initial_worktree, first.initial_worktree, "later cycles never replace the initial hashes");
  await assert.rejects(readFile(path.join(f.root, "retired.md")), { code: "ENOENT" });
}));

test("failed independent verdict remains authoritative while a builder artifact says pending", async () => fixture(async f => {
  const first = await f.cycle();
  f.finish(first);
  await writeFile(path.join(f.root, "validation.json"), JSON.stringify({ independent_validation: "pending" }));
  f.setRun(async input => {
    assert.match(f.metadata.at(-1).metadata.goal_activity.verdict, /failed \(c0\)/);
    assert.equal(f.metadata.at(-1).metadata.goal_activity.retryReason, request.repair);
    if (input.body.parts[0].text.includes("assigned validator phase")) {
      f.history.get(input.path.id)[0].parts.push({ type: "tool", tool: "goal_verdict", state: { status: "completed", output: JSON.stringify(verdict(false)) } });
    }
    return { data: { info: {} } };
  });
  const second = await f.cycle();
  assert.equal(second.status, "failed");
  assert.equal(JSON.parse(await readFile(path.join(f.root, "validation.json"))).independent_validation, "pending");
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

test("scaffold verification makes zero live calls; authorized fixture submits, reviews, repairs and preserves accepted bytes", async () => {
  const submissions = [];
  const accepted = Buffer.from("accepted fixture region\0");
  const service = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    submissions.push(input);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ artifact: Buffer.concat([accepted, Buffer.from(input.repair ? "repaired" : "defective")]).toString("base64") }));
  });
  service.listen(0, "127.0.0.1");
  await once(service, "listening");
  const endpoint = `http://127.0.0.1:${service.address().port}`;
  // This is a deterministic service contract, not GPU generation or live quality evidence.
  const source = `export async function execute(submit, prior) {
    const response = await submit({ repair: Boolean(prior) });
    const bytes = Buffer.from(response.artifact, "base64");
    if (prior && !bytes.subarray(0, ${accepted.length}).equals(prior.subarray(0, ${accepted.length}))) throw new Error("Accepted region changed");
    return bytes;
  }`;
  try {
    for (const live of [false, true]) {
      await fixture(async f => {
        const runner = path.join(f.root, "runner.mjs");
        const artifact = path.join(f.root, "artifact.bin");
        let builds = 0;
        f.setRun(async input => {
          const builder = input.body.parts[0].text.includes("assigned builder phase");
          if (builder) {
            builds++;
            if (builds === 1) await writeFile(runner, source);
            const { execute } = await import(runner);
            await writeFile(path.join(f.root, "ready.txt"), createHash("sha256").update(await readFile(runner)).digest("hex"));
            const prior = builds > 1 ? await readFile(artifact) : undefined;
            const submit = live
              ? async payload => {
                const response = await fetch(endpoint, { method: "POST", body: JSON.stringify(payload), signal: AbortSignal.timeout(3000) });
                return response.json();
              }
              : async payload => ({ artifact: Buffer.concat([accepted, Buffer.from(payload.repair ? "repaired" : "defective")]).toString("base64") });
            await writeFile(artifact, await execute(submit, prior));
          } else {
            const bytes = await readFile(artifact);
            assert.deepEqual(bytes.subarray(0, accepted.length), accepted);
            assert.equal(await readFile(path.join(f.root, "ready.txt"), "utf8"), createHash("sha256").update(await readFile(runner)).digest("hex"));
            const passed = bytes.subarray(accepted.length).toString() === "repaired";
            const report = { status: "checked", checks: { c0: { passed,
              evidence: passed ? "Fixture artifact: accepted prefix unchanged, rejected suffix repaired" : "Fixture rejected suffix is defective",
              ...(passed ? { resolution: "Fresh fixture bytes resolve defective suffix while retaining the exact accepted prefix" } : {}) } } };
            f.history.get(input.path.id)[0].parts.push({ type: "tool", tool: "goal_verdict", state: { status: "completed", output: JSON.stringify(report) } });
          }
          return { data: { info: {} } };
        });
        const admission = { ...request, completion_target: live ? "Authorized deterministic service-fixture outcome" : "Executable scaffold verified offline",
          authorized_actions: live ? "Local fixture HTTP submissions only. No GPU generation." : "Offline implementation and injected synthetic checks only. No live calls." };
        const failed = await f.cycle(admission);
        assert.equal(failed.status, "failed");
        f.finish(failed);
        const passed = await f.cycle(admission);
        assert.equal(passed.status, "validated");
        f.finish(passed);
        await f.idle();
        assert.equal(f.continuations.length, 0);
        assert.equal(builds, 2);
        assert.equal(submissions.length, live ? 2 : 0);
      }, { edit_paths: ["runner.mjs", "artifact.bin", "ready.txt"], outcome: "Implement and verify fixture continuation without claiming live visual acceptance",
        acceptance_criteria: ["The implemented fixture submission path repairs a rejected suffix, preserves accepted bytes and checks preparation readiness"] });
    }
    assert.deepEqual(submissions, [{ repair: false }, { repair: true }]);
  } finally {
    service.closeAllConnections();
    await new Promise(resolve => service.close(resolve));
  }
});

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

test("no admission means idle cannot restart a clarification; failed admitted cycles still resume", async () => fixture(async f => {
   f.finish();
   await Promise.all([f.idle(), f.idle()]);
   assert.equal(f.continuations.length, 0);
   f.finish(await f.cycle());
   f.finish();
   await Promise.all([f.idle(), f.idle()]);
   assert.equal(f.continuations.length, 1);
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
      assert.match(result.reason, failure === "denied" ? /Observed permission denial/ : failure === "assistant" ? /Observed child abort/ : /outcome unknown/);
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
   const result = await f.hooks.tool.goal_cycle.execute(request, f.context);
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
   const result = await f.hooks.tool.goal_cycle.execute(request, f.context);
  assert.equal(JSON.parse(result.output).status, "blocked");
  assert.equal(result.metadata.goal_activity.status, "cancelled");
}));
