import test from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { Goal } from "../../plugins/goal.ts";
import { ImmutabilityGuard } from "../../plugins/immutability.ts";
import { RUNTIME, CHECKPOINT, checkpoint, transition, resumeIntent } from "../../plugins/goal/state.ts";
import { canonical, captureFiles } from "../../plugins/goal/evidence.ts";
import { validateVerdict } from "../../plugins/goal/evaluation.ts";
import { publishGoalAgentFile } from "../../tools/publish_goal_agent.ts";

const model = { providerID: "local", modelID: "worker" };
const admission = { operation: "start", completion_target: "Counter and preparation verified offline",
  authorized_actions: "Edit counter.txt and readiness.json; offline checks only." };
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const clone = value => structuredClone(value);
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const checked = (passed, evidence = passed ? "Fresh counter bytes are good" : "Counter bytes are defective", resolution) => ({
  status: "checked", reason: "Independent file inspection", checks: { c0: { passed, evidence, ...(resolution ? { resolution } : {}) } },
});
const working = overrides => ({ runtime_contract: RUNTIME, agent: "fix-counter", definition_sha256: "a".repeat(64),
  state: "working", completion_target: admission.completion_target, authorized_actions: admission.authorized_actions,
  initial_worktree: { files: { "counter.txt": { state: "absent" } }, status: [], limitations: [] },
  findings: {}, pending_actions: {}, updated_at: 1, ...overrides });
const assignment = mode => ({ mode, artifacts: ["counter.txt"], candidate: { "counter.txt": { state: "present", sha256: "b".repeat(64), size: 5 } },
  ...(mode === "feedback" ? { focus: "Counter bytes are good" } : {}) });
const continuationText = "Fixture synthetic Goal continuation";
const humanMessage = (id, text, created, synthetic = false) => ({
  info: { id, role: "user", agent: "fix-counter", model, time: { created } }, parts: [{ type: "text", text, synthetic }],
});
const resumeQuestion = () => ({ header: "Resume Goal", question: "Resume this Goal after inspecting the recorded outcomes?",
  options: [{ label: "Resume Goal", description: "Resume reconciled work" }, { label: "Keep Paused", description: "Leave work paused" }], multiple: false });
function questionReceipt(end, { questions = [resumeQuestion()], answers = [["Resume Goal"]],
  output = "Native Question response recorded", status = "completed", tool = "question" } = {}) {
  return { info: { id: `question-${end}`, role: "assistant", time: { created: end - 1 } }, parts: [{ type: "tool", tool,
    callID: `question-call-${end}`, state: { status, input: { questions }, metadata: { answers }, time: { start: end - 1, end }, output } }] };
}

// Hold the actual captureFiles open, not an evaluator prompt or a timer. Tests
// install this after admission and restore the built-in before leaving the gate.
function snapshotGate(root) {
  const entered = gate(), resume = gate(), original = fs.open;
  let released = false, blockedReads = 0;
  fs.open = async (...args) => {
    if (!released && args[0] === path.join(root, "counter.txt")) {
      blockedReads++;
      entered.release();
      await resume.promise;
    }
    return original(...args);
  };
  syncBuiltinESMExports();
  return { entered: entered.promise, get blockedReads() { return blockedReads; }, release() {
    released = true;
    fs.open = original;
    syncBuiltinESMExports();
    resume.release();
  } };
}

// V1 calls use path/body. Metadata writes use the runtime's session.update
// fallback signature directly: this strict fake intentionally has no _client.
async function fixture(fn, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "persistent-goal-unit-"));
  try {
    await publishGoalAgentFile(root, {
      name: "fix-counter", description: "Persistent counter worker", outcome: admission.completion_target,
      acceptance_criteria: ["counter.txt contains good followed by a newline", "readiness.json records verified preparation"],
      durable_context: ["README.md"], edit_paths: ["counter.txt", "readiness.json"], bash: true,
      verification_commands: ["Read counter.txt and readiness.json and compare actual contents"],
      stop_conditions: ["Observed cancellation, denial or inaccessible required evidence"],
      escalation_triggers: ["Need another edit path"], instructions: "Prepare, implement, inspect feedback, repair and obtain final independent acceptance.",
      ...options,
    });
    await writeFile(path.join(root, "counter.txt"), "defective\n");
    await writeFile(path.join(root, "README.md"), "pre-existing task instructions\n");
    const sessions = new Map([["root", { id: "root", agent: "fix-counter", metadata: { unrelated: { preserved: true } } }]]);
    const history = new Map([["root", [{ info: { id: "user-0", role: "user", agent: "fix-counter", model, time: { created: Date.now() } },
      parts: [{ type: "text", text: "Implement and verify the counter offline." }] }]]]);
    const calls = [], prompts = [], continuations = [], aborts = [], updates = [], fixtureErrors = [];
    let hooks, provider, statuses = {}, sequence = 0;
    const controller = new AbortController();
    const context = { sessionID: "root", messageID: "worker-call", abort: controller.signal,
      metadata() { assert.fail("Persistent state belongs in session metadata, not tool context metadata"); } };
    const append = (id, parts, info = {}) => {
      const message = { info: { id: `message-${++sequence}`, role: "assistant", ...info }, parts };
      history.get(id).push(message);
      return message;
    };
    const record = (id, tool, output, status = "completed") => append(id, [{ type: "tool", tool,
      state: status === "completed" ? { status, output } : { status, error: output } }]);
    const client = { session: {
      get: async input => {
        assert.equal(typeof input.path?.id, "string");
        assert.ok(sessions.has(input.path.id), `Unknown session ${input.path.id}`);
        return { data: clone(sessions.get(input.path.id)) };
      },
      messages: async input => {
        assert.equal(typeof input.path?.id, "string");
        assert.ok(history.has(input.path.id));
        return { data: clone(history.get(input.path.id)) };
      },
      update: async input => {
        assert.equal(typeof input.sessionID, "string", "update must use sessionID, not path/body");
        assert.equal(input.directory, root);
        assert.equal(input.path, undefined);
        assert.equal(input.body, undefined);
        assert.ok(sessions.has(input.sessionID));
        assert.equal(typeof input.metadata, "object");
        assert.ok(input.metadata && !Array.isArray(input.metadata));
        const target = sessions.get(input.sessionID);
        if (input.sessionID === "root") {
          assert.ok(Object.hasOwn(input.metadata, CHECKPOINT), "Root updates must retain their native checkpoint");
          assert.equal(Object.hasOwn(input.metadata, "cuddly_winner_evaluator"), false, "Child role metadata cannot leak onto the worker");
          assert.deepEqual(input.metadata.unrelated, target.metadata.unrelated);
        } else {
          assert.equal(target.parentID, "root", "Only owned children receive evaluator metadata");
          assert.deepEqual(input.metadata.cuddly_winner_evaluator,
            { parentID: "root", definition_sha256: sessions.get("root").metadata[CHECKPOINT].definition_sha256 });
          assert.equal(Object.hasOwn(input.metadata, CHECKPOINT), false, "Child updates cannot copy the root checkpoint");
          assert.deepEqual(input.metadata.child_unrelated, target.metadata.child_unrelated);
          assert.equal(Object.hasOwn(input.metadata, "unrelated"), false, "Root-only metadata must stay on its owner");
        }
        updates.push(clone(input));
        sessions.get(input.sessionID).metadata = clone(input.metadata);
        return { data: clone(sessions.get(input.sessionID)) };
      },
      status: async () => ({ data: clone(statuses) }),
      children: async input => {
        assert.equal(typeof input.path?.id, "string");
        return { data: clone([...sessions.values()].filter(s => s.parentID === input.path.id)) };
      },
      create: async input => {
        assert.equal(input.body.parentID, "root");
        assert.match(input.body.title, /^Goal evaluator:/);
        const id = `evaluator-${calls.length}`;
        const child = { id, ...clone(input.body), metadata: { child_unrelated: { preserved: true } } };
        sessions.set(id, child);
        history.set(id, []);
        calls.push(clone(child));
        return { data: clone(child) };
      },
      prompt: async input => {
        assert.ok(sessions.get(input.path?.id)?.parentID === "root", "Only evaluators receive synchronous prompts");
        assert.equal(input.body.agent, "general");
        assert.deepEqual(sessions.get(input.path.id).metadata.cuddly_winner_evaluator,
          { parentID: "root", definition_sha256: sessions.get("root").metadata[CHECKPOINT].definition_sha256 },
          "The actual child role must be durably stored before its first prompt");
        assert.equal(Object.hasOwn(sessions.get(input.path.id).metadata, CHECKPOINT), false);
        prompts.push(clone({ path: input.path, body: input.body }));
        history.get(input.path.id).push({ info: { id: `child-user-${prompts.length}`, role: "user", agent: input.body.agent, model: input.body.model }, parts: clone(input.body.parts) });
        return provider ? provider(input) : inspectCandidate(input);
      },
      promptAsync: async input => {
        assert.equal(input.path.id, "root", "The worker continues in its original conversation");
        assert.equal(input.body.agent, "fix-counter");
        assert.match(input.body.messageID, /^msg_/);
        assert.equal(input.body.parts[0].synthetic, true);
        continuations.push(clone(input));
        history.get("root").push({ info: { id: input.body.messageID, role: "user", agent: input.body.agent, model: input.body.model }, parts: clone(input.body.parts) });
        return { response: { status: 204 } };
      },
      abort: async input => { assert.ok(sessions.has(input.path.id)); aborts.push(input.path.id); return { data: true }; },
    } };
    // Runtime catches transport errors. Fixture assertions must still fail the
    // test, even when thrown from a client/provider call inside that catch.
    for (const [name, method] of Object.entries(client.session)) client.session[name] = async (...args) => {
      try { return await method(...args); }
      catch (error) {
        if (error instanceof assert.AssertionError) fixtureErrors.push(error);
        throw error;
      }
    };
    const run = () => clone(sessions.get("root").metadata[CHECKPOINT]);
    const inspectFile = async (id, file) => {
      try {
        const bytes = await readFile(path.join(root, file), "utf8");
        record(id, "read", bytes);
        return bytes;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        record(id, "read", `ENOENT: ${file}`);
      }
    };
    const submit = async (id, report) => {
      const output = await hooks.tool.goal_verdict.execute(report, { ...context, sessionID: id });
      record(id, "goal_verdict", output);
      return { data: { info: { finish: "stop" }, parts: [] } };
    };
    // Fixed logical evaluator: reports are caused by real files and the current
    // assignment, never by prompt/child/turn counts.
    async function inspectCandidate(input, { resolution = true } = {}) {
      const id = input.path.id;
      const current = run();
      const bytes = await inspectFile(id, "counter.txt");
      const report = checked(bytes === "good\n", `Fresh counter.txt read: ${JSON.stringify(bytes)}`,
        resolution && current.findings.c0?.length ? "Fresh counter.txt is exactly good\\n, resolving all earlier defective-byte findings" : undefined);
      if (current.evaluation.mode === "final") {
        const readiness = await inspectFile(id, "readiness.json");
        report.checks.c1 = { passed: readiness === '{"verified":true}\n', evidence: `Fresh readiness.json read: ${JSON.stringify(readiness)}`,
          ...(resolution && current.findings.c1?.length ? { resolution: "Fresh preparation record now contains verified=true" } : {}) };
      }
      return submit(id, report);
    }
    const load = async () => { hooks = await Goal({ client, directory: root, worktree: root }); return hooks; };
    await load();
    const invoke = async (tool, args, ctx = context) => {
      try { return JSON.parse(await hooks.tool[tool].execute(args, ctx)); }
      finally { if (fixtureErrors.length) throw fixtureErrors.shift(); }
    };
    const event = (type, properties = {}) => hooks.event({ event: { type, properties: { sessionID: "root", ...properties } } });
    const before = (tool = "write", callID = "write-counter", sessionID = "root") => hooks["tool.execute.before"]({ tool, callID, sessionID });
    const after = (tool = "write", callID = "write-counter", sessionID = "root") => hooks["tool.execute.after"]({ tool, callID, sessionID });
    const mutate = async (file, bytes, callID = `write-${file}`) => {
      await before("write", callID);
      await writeFile(path.join(root, file), bytes);
      await after("write", callID);
    };
    const implement = async () => { await mutate("readiness.json", '{"verified":true}\n'); await mutate("counter.txt", "good\n"); };
    await fn({ root, client, sessions, history, calls, prompts, continuations, aborts, updates, controller, context,
      get hooks() { return hooks; }, run, load, invoke, event, before, after, mutate, implement, append, record, inspectFile, inspectCandidate, submit,
      start: (args = {}) => invoke("goal_run", { ...admission, ...args }),
      inspect: () => invoke("goal_run", { operation: "inspect" }),
      evaluate: (mode = "final", extra = {}) => invoke("goal_evaluate", { mode, artifacts: ["counter.txt", "readiness.json"],
        ...(mode === "feedback" ? { focus: "Counter bytes are good" } : {}), ...extra }),
      finish: (text = "Partial work remains", info = {}) => append("root", [{ type: "text", text }], { finish: "stop", ...info }),
      user: (text, agent = "fix-counter", synthetic = false, created = Date.now()) => history.get("root").push({ info: { id: `human-${++sequence}`, role: "user", agent, model, time: { created } }, parts: [{ type: "text", text, synthetic }] }),
      setProvider(value) { provider = value; }, setStatuses(value) { statuses = value; },
    });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("pure transitions retain admission and baseline through feedback, final failures, pause and resume", () => {
  const original = working(), frozen = clone(original);
  const partial = transition(transition(original, { type: "evaluate", evaluation: assignment("feedback") }), { type: "result", verdict: checked(true) });
  assert.equal(partial.state, "working");
  assert.equal(partial.validation, undefined);
  assert.equal(partial.accepted_candidate, undefined);
  assert.equal(partial.feedback.checks.c0.passed, true);
  let failed = transition(transition(partial, { type: "evaluate", evaluation: assignment("final") }), { type: "result", verdict: checked(false) });
  failed = transition(transition(failed, { type: "evaluate", evaluation: assignment("final") }), { type: "result", verdict: checked(false, "A second concrete defect") });
  assert.deepEqual(failed.findings.c0, ["Counter bytes are defective", "A second concrete defect"]);
  const resumed = transition(transition(failed, { type: "pause", reason: "Inspect unknown action" }), { type: "resume" });
  assert.equal(resumed.state, "working");
  assert.deepEqual(resumed.findings, failed.findings);
  assert.deepEqual(resumed.validation, failed.validation);
  assert.deepEqual(resumed.initial_worktree, original.initial_worktree);
  assert.equal(resumed.authorized_actions, original.authorized_actions);
  assert.equal(resumed.completion_target, original.completion_target);
  assert.deepEqual(original, frozen, "Transitions must not mutate their input");
});

test("pure transitions use only their supplied clock and preserve deterministic default timestamps", () => {
  const original = working({ updated_at: 7 });
  const event = { type: "evaluate", evaluation: assignment("feedback") };
  const defaultEvaluation = transition(original, event);
  assert.equal(defaultEvaluation.updated_at, 7);
  assert.deepEqual(transition(original, event), defaultEvaluation);
  const evaluated = transition(original, event, 21);
  assert.equal(evaluated.updated_at, 21);
  const result = transition(evaluated, { type: "result", verdict: checked(false) }, 22);
  assert.equal(result.updated_at, 22);
  const paused = transition(result, { type: "pause", reason: "Inspect receipts" }, 23);
  assert.equal(paused.updated_at, 23);
  assert.strictEqual(transition(paused, { type: "pause", reason: "Queued generic pause" }, 100), paused);
  const resumed = transition(paused, { type: "resume" }, 24);
  assert.equal(resumed.updated_at, 24);
  assert.equal(original.updated_at, 7);
  const accepted = transition(transition(original, { type: "evaluate", evaluation: assignment("final") }, 25),
    { type: "result", verdict: checked(true) }, 26);
  assert.strictEqual(transition(accepted, { type: "pause", reason: "Late stop" }, 100), accepted);
  assert.equal(accepted.updated_at, 26);
});

test("pure final acceptance is terminal and binds the evaluated candidate", () => {
  const evaluated = transition(working(), { type: "evaluate", evaluation: assignment("final") });
  const accepted = transition(evaluated, { type: "result", verdict: checked(true) });
  assert.equal(accepted.state, "accepted");
  assert.deepEqual(accepted.accepted_candidate, evaluated.evaluation.candidate);
  for (const event of [{ type: "pause", reason: "late" }, { type: "resume" },
    { type: "evaluate", evaluation: assignment("final") }, { type: "result", verdict: checked(false) }]) {
    assert.strictEqual(transition(accepted, event), accepted);
  }
});

test("pure queued generic pauses cannot downgrade an observed denial or change its pause boundary", () => {
  const denied = working({ state: "paused", reason: "Observed permission denial; explicit user resumption required.",
    paused_after_user: "human-before-denial", updated_at: 17,
    pending_actions: { uncertain: { tool: "write", callID: "uncertain" } } });
  const original = clone(denied);
  for (const reason of ["Interrupted action or evaluation outcome unknown", "Observed cancellation after child abort", "Later generic stop"]) {
    const queued = transition(denied, { type: "pause", reason });
    assert.strictEqual(queued, denied, "Repeated pause is a pure idempotent transition");
    assert.equal(queued.reason, original.reason);
    assert.equal(queued.paused_after_user, original.paused_after_user);
    assert.equal(queued.updated_at, original.updated_at);
    assert.deepEqual(queued.pending_actions, original.pending_actions);
  }
  assert.deepEqual(denied, original);
  const accepted = transition(transition(working(), { type: "evaluate", evaluation: assignment("final") }),
    { type: "result", verdict: checked(true) });
  assert.strictEqual(transition(accepted, { type: "pause", reason: "Queued unknown outcome" }), accepted,
    "Accepted remains terminal independently of pause idempotence");
});

test("pure transitions reject unstable evaluation and late reports; observed blockers pause", () => {
  assert.throws(() => transition(working(), { type: "resume" }), /paused/);
  assert.throws(() => transition(working(), { type: "result", verdict: checked(true) }), /no longer active/);
  assert.throws(() => transition(working({ pending_actions: { x: { tool: "write", callID: "x" } } }),
    { type: "evaluate", evaluation: assignment("final") }), /active task actions/);
  const evaluated = transition(working(), { type: "evaluate", evaluation: assignment("final") });
  assert.throws(() => transition(evaluated, { type: "evaluate", evaluation: assignment("final") }), /stable candidate/);
  const paused = transition(evaluated, { type: "result", verdict: { status: "blocked", reason: "Observed HTTP 503", checks: {} } });
  assert.equal(paused.state, "paused");
  assert.equal(paused.validation.reason, "Observed HTTP 503");
  assert.throws(() => transition(paused, { type: "result", verdict: checked(true) }), /no longer active/);
});

test("pure resume intent requires a fresh real authorization and excludes questions, negatives and synthetic text", () => {
  const paused = working({ state: "paused", paused_after_user: "original", paused_at: 100, updated_at: 200 });
  const original = humanMessage("original", "I authorize you to continue the Goal.", 50);
  assert.deepEqual(resumeIntent(paused, [original], continuationText), { fresh: false, confirmed: false });
  for (const text of ["Resume the Goal.", "Continue after inspecting the receipts.", "I authorize the reconciled work."]) {
    assert.deepEqual(resumeIntent(paused, [original, humanMessage("new", text, 110)], continuationText), { fresh: true, confirmed: true });
  }
  for (const text of ["What is the status?", "Can I resume?", "Tell me whether I should continue", "Do not resume", "Don't continue", "Never resume"]) {
    assert.deepEqual(resumeIntent(paused, [original, humanMessage("new", text, 110)], continuationText), { fresh: true, confirmed: false }, text);
  }
  for (const message of [humanMessage("synthetic", "Resume the Goal", 110, true),
    humanMessage("continuation", continuationText, 110), { info: { role: "assistant", id: "summary" }, parts: [{ type: "text", text: "Resume the Goal" }] }]) {
    assert.deepEqual(resumeIntent(paused, [original, message], continuationText), { fresh: false, confirmed: false });
  }
  const mixed = humanMessage("mixed", "Status only", 110);
  mixed.parts.push({ type: "text", text: "Resume the Goal", synthetic: true });
  assert.deepEqual(resumeIntent(paused, [original, mixed], continuationText), { fresh: true, confirmed: false });
  assert.deepEqual(resumeIntent(paused, [humanMessage("original", "Resume the Goal", 999)], continuationText),
    { fresh: false, confirmed: false }, "The original authorization ID cannot be reused by changing its timestamp or prose");
});

test("pure resume intent rejects explicit negation of authorize as well as resume and continue", () => {
  const paused = working({ state: "paused", paused_after_user: "original", paused_at: 100, updated_at: 200 });
  const original = humanMessage("original", "Continue the Goal", 50);
  for (const text of ["I do not authorize continuation.", "Don't authorize further work.", "Never authorize resumption."]) {
    assert.deepEqual(resumeIntent(paused, [original, humanMessage("negative", text, 150)], continuationText),
      { fresh: true, confirmed: false }, text);
  }
});

test("pure nonadjacent negations reject resume intent even after an earlier affirmative Question", () => {
  const paused = working({ state: "paused", paused_after_user: "original", paused_at: 100, updated_at: 200 });
  const original = humanMessage("original", "Continue the Goal", 50);
  for (const text of ["I do not want you to resume.", "I have not authorized you to continue."]) {
    const human = humanMessage("fresh-negative", text, 150);
    assert.deepEqual(resumeIntent(paused, [original, human], continuationText), { fresh: true, confirmed: false }, text);
    assert.deepEqual(resumeIntent(paused, [original, questionReceipt(130), human], continuationText),
      { fresh: true, confirmed: false }, "A newer nonadjacent denial cannot reuse an older popup authorization");
  }
});

test("pure native Question authorization uses exact offered labels, structured answers and the fixed pause time", () => {
  const paused = working({ state: "paused", paused_after_user: "original", paused_at: 100, updated_at: 200 });
  const original = humanMessage("original", "I authorize you to continue the Goal.", 50);
  const scenarios = [
    { name: "yes", end: 150, expected: { fresh: true, confirmed: true } },
    { name: "keep paused despite affirmative prose", end: 150, args: { answers: [["Keep Paused"]], output: "Resume Goal now; everything is authorized." }, expected: { fresh: true, confirmed: false } },
    { name: "stale", end: 99, expected: { fresh: false, confirmed: false } },
    { name: "exact pause boundary", end: 100, expected: { fresh: false, confirmed: false } },
    { name: "missing completion time", end: undefined, expected: { fresh: false, confirmed: false } },
    { name: "nonfinite completion time", end: NaN, expected: { fresh: false, confirmed: false } },
    { name: "not completed", end: 150, args: { status: "running" }, expected: { fresh: false, confirmed: false } },
    { name: "not native Question", end: 150, args: { tool: "question_fixture" }, expected: { fresh: false, confirmed: false } },
    { name: "ambiguous headers", end: 150, args: { questions: [resumeQuestion(), resumeQuestion()], answers: [["Resume Goal"], ["Resume Goal"]] }, expected: { fresh: true, confirmed: false } },
    { name: "multiple answers", end: 150, args: { answers: [["Resume Goal", "Keep Paused"]] }, expected: { fresh: true, confirmed: false } },
    { name: "empty answers", end: 150, args: { answers: [[]] }, expected: { fresh: true, confirmed: false } },
    { name: "prose only", end: 150, args: { answers: undefined, output: "Resume Goal" }, expected: { fresh: true, confirmed: false }, removeAnswers: true },
    { name: "wrong answer shape", end: 150, args: { answers: ["Resume Goal"] }, expected: { fresh: true, confirmed: false } },
    { name: "unoffered label", end: 150, args: { questions: [{ ...resumeQuestion(), options: [{ label: "Keep Paused" }] }] }, expected: { fresh: true, confirmed: false } },
    { name: "wrong label case", end: 150, args: { answers: [["Resume goal"]] }, expected: { fresh: true, confirmed: false } },
    { name: "wrong header", end: 150, args: { questions: [{ ...resumeQuestion(), header: "Other decision" }] }, expected: { fresh: false, confirmed: false } },
  ];
  for (const scenario of scenarios) {
    const receipt = questionReceipt(scenario.end, scenario.args);
    if (scenario.removeAnswers) delete receipt.parts[0].state.metadata.answers;
    const messages = [original, receipt], before = clone(messages);
    assert.deepEqual(resumeIntent(paused, messages, continuationText), scenario.expected, scenario.name);
    assert.deepEqual(messages, before, "Intent checking must not rewrite receipts");
  }
  const unrelated = { header: "Other decision", options: [{ label: "Other answer" }] };
  const aligned = questionReceipt(150, { questions: [unrelated, resumeQuestion()], answers: [["Other answer"], ["Resume Goal"]] });
  assert.deepEqual(resumeIntent(paused, [original, aligned], continuationText), { fresh: true, confirmed: true },
    "A single Resume Goal header may occur after unrelated questions; answers must use its actual index");
  assert.equal(paused.updated_at, 200, "Freshness is measured against paused_at, not a later reason-update timestamp");
});

test("pure resume intent respects the newest human decision across chat and native Question receipts", () => {
  const paused = working({ state: "paused", paused_after_user: "original", paused_at: 100, updated_at: 200 });
  const original = humanMessage("original", "Continue implementing the Goal", 50);
  const authorization = humanMessage("authorization", "Resume after inspection.", 120);
  const yes = questionReceipt(130), no = questionReceipt(140, { answers: [["Keep Paused"]] });
  assert.deepEqual(resumeIntent(paused, [original, authorization], continuationText), { fresh: true, confirmed: true });
  assert.deepEqual(resumeIntent(paused, [original, authorization, no], continuationText), { fresh: true, confirmed: false },
    "A newer negative Question receipt overrides older chat authorization");
  assert.deepEqual(resumeIntent(paused, [original, authorization, yes, no], continuationText), { fresh: true, confirmed: false });
  assert.deepEqual(resumeIntent(paused, [original, no, questionReceipt(150)], continuationText), { fresh: true, confirmed: true });
  assert.deepEqual(resumeIntent(paused, [original, no, humanMessage("new-authorization", "Resume the inspected Goal.", 150)], continuationText),
    { fresh: true, confirmed: true }, "A newer real chat authorization can override an older Keep Paused reply");
  assert.deepEqual(resumeIntent(paused, [original, yes, humanMessage("new-status", "What is the status?", 150)], continuationText),
    { fresh: true, confirmed: false }, "A newer status question must not reuse an older affirmative receipt");
  assert.deepEqual(resumeIntent(paused, [original, yes, humanMessage("new-negative", "Do not resume.", 150)], continuationText),
    { fresh: true, confirmed: false });
  assert.deepEqual(resumeIntent(paused, [original, authorization, no, humanMessage("synthetic", "Resume", 150, true)], continuationText),
    { fresh: true, confirmed: false });
});

test("pure explicit resume clears both pause anchors while preserving authority and evidence", () => {
  const paused = working({ state: "paused", paused_at: 100, paused_after_user: "original", updated_at: 200,
    reason: "Observed permission denial", findings: { c0: ["Recorded independent failure"] } });
  const before = clone(paused);
  const resumed = transition(paused, { type: "resume" }, 300);
  assert.equal(resumed.state, "working");
  assert.equal(resumed.paused_at, undefined);
  assert.equal(resumed.paused_after_user, undefined);
  assert.deepEqual(resumed.findings, paused.findings);
  assert.deepEqual(resumed.initial_worktree, paused.initial_worktree);
  assert.equal(resumed.authorized_actions, paused.authorized_actions);
  assert.deepEqual(paused, before);
});

test("checkpoint rejects malformed or retired state without inventing a new baseline", () => {
  assert.equal(checkpoint({ metadata: {} }), undefined);
  const valid = working();
  assert.deepEqual(checkpoint({ metadata: { [CHECKPOINT]: valid } }), valid);
  for (const overrides of [{ runtime_contract: "goal-criterion-readiness-v1" }, { agent: null }, { definition_sha256: "bad" },
    { state: "validated" }, { initial_worktree: undefined }, { findings: undefined }, { updated_at: NaN }]) {
    assert.throws(() => checkpoint({ metadata: { [CHECKPOINT]: { ...valid, ...overrides } } }), /Invalid Goal checkpoint/);
  }
});

test("persisted checkpoint without its original admission fails closed", () => {
  for (const overrides of [{ completion_target: undefined }, { authorized_actions: undefined },
    { completion_target: " " }, { authorized_actions: " " }]) {
    assert.throws(() => checkpoint({ metadata: { [CHECKPOINT]: working(overrides) } }), /Invalid Goal checkpoint/,
      "A structurally incomplete checkpoint cannot grant mutation authority");
  }
});

test("malformed checkpoint records, findings and baseline file maps reject with a controlled error", () => {
  const valid = working();
  const malformed = [null, [], "invalid", 42,
    { ...valid, findings: null }, { ...valid, findings: [] },
    { ...valid, initial_worktree: null }, { ...valid, initial_worktree: [] },
    { ...valid, initial_worktree: {} }, { ...valid, initial_worktree: { files: null } },
    { ...valid, initial_worktree: { files: [] } }, { ...valid, pending_actions: null }, { ...valid, pending_actions: [] }];
  for (const value of malformed) {
    assert.throws(() => checkpoint({ metadata: { [CHECKPOINT]: value } }), error => {
      assert.equal(error.name, "Error", "Malformed state must not escape as an accidental TypeError");
      assert.match(error.message, /^Invalid Goal checkpoint/);
      return true;
    });
  }
});

test("runtime inspection and mutation fail closed on malformed persisted file maps or findings", async () => {
  for (const change of [{ findings: null }, { findings: [] }, { initial_worktree: {} }, { initial_worktree: { files: [] } }]) await fixture(async f => {
    await f.start();
    f.sessions.get("root").metadata[CHECKPOINT] = { ...f.run(), ...change };
    const original = clone(f.sessions.get("root").metadata), updates = f.updates.length;
    const result = await f.invoke("goal_run", { operation: "inspect", include_baseline: true });
    assert.equal(result.state, "unknown");
    assert.match(result.reason, /^Invalid Goal checkpoint/);
    assert.equal(Object.hasOwn(result, "initial_worktree"), false);
    await assert.rejects(f.before(), /^Error: Invalid Goal checkpoint/);
    await assert.rejects(f.evaluate(), /^Error: Invalid Goal checkpoint/);
    assert.deepEqual(f.sessions.get("root").metadata, original, "Malformed authority must never be replaced with a new baseline");
    assert.equal(f.updates.length, updates);
    assert.equal(f.calls.length, 0);
  });
});

test("verdict protocol requires exactly assigned evidence and resolutions without rewriting input", () => {
  const failed = { c0: ["Defective counter", "Another defect"] };
  for (const report of [undefined, { status: "done" }, checked(true, ""), { status: "checked", checks: {} },
    { ...checked(true), checks: { c0: { passed: "true", evidence: "claimed" } } },
    { ...checked(true), checks: { ...checked(true).checks, c1: { passed: true, evidence: "extra" } } }]) {
    assert.throws(() => validateVerdict(report, ["Counter"], {}));
  }
  const unrelated = checked(true, "Unrelated tests pass"), before = clone(unrelated);
  assert.throws(() => validateVerdict(unrelated, ["Counter"], failed), /Resolution required.*c0/);
  assert.deepEqual(unrelated, before);
  assert.equal(validateVerdict(checked(true, "Fresh repaired bytes", "Both defects resolved by fresh reads"), ["Counter"], failed).checks.c0.passed, true);
  assert.throws(() => validateVerdict({ status: "blocked", reason: " ", checks: {} }, ["Counter"], {}), /observed concrete reason/);
});

test("candidate capture hashes real bytes and refuses escaping or symlink evidence", async () => fixture(async f => {
  for (const value of ["", "/tmp/file", "../file", "a/../file", "a//b", "./file", "a\\b", "C:foo"]) assert.equal(canonical(value), false, value);
  assert.equal(canonical("counter.txt"), true);
  await symlink(path.join(f.root, "counter.txt"), path.join(f.root, "link.txt"));
  await mkdir(path.join(f.root, "folder"));
  const captured = await captureFiles(f.root, ["counter.txt", "missing.txt", "link.txt", "folder", "counter.txt"]);
  assert.deepEqual(captured["counter.txt"], { state: "present", size: 10, sha256: sha256("defective\n") });
  assert.deepEqual(captured["missing.txt"], { state: "absent" });
  assert.deepEqual(captured["link.txt"], { state: "unavailable" });
  assert.deepEqual(captured.folder, { state: "unavailable" });
  await assert.rejects(captureFiles(f.root, ["../escape"]), /Noncanonical/);
}));

test("start persists an immutable baseline and authority before any root mutation", async () => fixture(async f => {
  await assert.rejects(f.before(), /working checkpoint/);
  assert.equal(f.run(), undefined);
  assert.equal((await f.start()).state, "working");
  const original = f.run();
  assert.equal(original.initial_worktree.files["counter.txt"].sha256, sha256("defective\n"));
  assert.equal(original.initial_worktree.files["README.md"].sha256, sha256("pre-existing task instructions\n"));
  assert.deepEqual(original.initial_worktree.files["readiness.json"], { state: "absent" });
  await f.mutate("counter.txt", "partial\n");
  await f.load();
  await f.start({ completion_target: "Different finish line", authorized_actions: "New authority" });
  const current = f.run();
  assert.deepEqual(current.initial_worktree, original.initial_worktree);
  assert.equal(current.completion_target, admission.completion_target);
  assert.equal(current.authorized_actions, admission.authorized_actions);
  assert.deepEqual(f.sessions.get("root").metadata.unrelated, { preserved: true });
  assert.ok(f.updates.every(update => update.sessionID === "root"));
  assert.equal(f.calls.length, 0, "Partial work never creates a builder child");
}));

test("optional baseline inspection returns original files for the Goal and historical Build without metadata writes", async () => fixture(async f => {
  const unstarted = await f.invoke("goal_run", { operation: "inspect", include_baseline: true });
  assert.equal(Object.hasOwn(unstarted, "initial_worktree"), false);
  assert.equal(f.run(), undefined);
  await f.start();
  const baseline = clone(f.run().initial_worktree);
  await f.mutate("counter.txt", "current partial implementation\n");
  await f.load();
  const metadata = clone(f.sessions.get("root").metadata), updates = f.updates.length;
  for (const agent of ["fix-counter", "build"]) {
    f.user("Inspect the original baseline", agent);
    const normal = await f.inspect();
    assert.equal(normal.selected_agent, agent);
    assert.equal(normal.goal_agent, "fix-counter");
    assert.equal(Object.hasOwn(normal, "initial_worktree"), false, "Normal inspection must not repeat the baseline payload");
    const excluded = await f.invoke("goal_run", { operation: "inspect", include_baseline: false });
    assert.equal(Object.hasOwn(excluded, "initial_worktree"), false);
    const included = await f.invoke("goal_run", { operation: "inspect", include_baseline: true });
    assert.equal(included.selected_agent, agent);
    assert.deepEqual(included.initial_worktree, baseline);
    assert.equal(included.initial_worktree.files["counter.txt"].sha256, sha256("defective\n"));
    assert.equal(included.initial_worktree.files["README.md"].sha256, sha256("pre-existing task instructions\n"));
    included.initial_worktree.files["counter.txt"].sha256 = "forged-inspection-copy";
    assert.deepEqual((await f.invoke("goal_run", { operation: "inspect", include_baseline: true })).initial_worktree, baseline);
    assert.deepEqual(f.sessions.get("root").metadata, metadata);
    assert.equal(f.updates.length, updates);
  }
  assert.equal(await readFile(path.join(f.root, "counter.txt"), "utf8"), "current partial implementation\n");
  assert.equal(f.calls.length, 0);
  assert.equal(f.continuations.length, 0);
}));

test("nested directory initialization uses the parent worktree definition, baseline and exact policy bounds", async () => fixture(async f => {
  const nested = path.join(f.root, "nested");
  await mkdir(nested);
  await writeFile(path.join(nested, "counter.txt"), "nested counter decoy\n");
  const hooks = await Goal({ client: f.client, directory: nested, worktree: f.root });
  const context = { ...f.context, directory: nested, worktree: f.root };
  const started = JSON.parse(await hooks.tool.goal_run.execute(admission, context));
  assert.equal(started.state, "working");
  assert.equal(started.worktree, f.root);
  assert.equal(f.run().agent, "fix-counter", "Definition is found at the worktree parent, not nested cwd");
  assert.equal(f.run().initial_worktree.files["counter.txt"].sha256, sha256("defective\n"));
  assert.notEqual(f.run().initial_worktree.files["counter.txt"].sha256, sha256("nested counter decoy\n"));
  const baseline = f.run().initial_worktree;
  const guard = await ImmutabilityGuard({ client: f.client, directory: nested, worktree: f.root });
  const input = { tool: "write", sessionID: "root", callID: "parent-counter-write" };
  await guard["tool.execute.before"](input, { args: { filePath: path.join(f.root, "counter.txt") } });
  await assert.rejects(guard["tool.execute.before"]({ ...input, callID: "nested-decoy-write" },
    { args: { filePath: path.join(nested, "counter.txt") } }), /outside its declared edit paths/);
  await hooks["tool.execute.before"](input, { args: { filePath: path.join(f.root, "counter.txt") } });
  await writeFile(path.join(f.root, "counter.txt"), "good\n");
  await hooks["tool.execute.after"](input, { output: "Parent counter written" });
  assert.deepEqual(f.run().pending_actions, {});
  assert.deepEqual(f.run().initial_worktree, baseline);
  assert.equal(await readFile(path.join(f.root, "counter.txt"), "utf8"), "good\n");
  assert.equal(await readFile(path.join(nested, "counter.txt"), "utf8"), "nested counter decoy\n");
  assert.ok(f.updates.every(update => update.directory === f.root), "SDK metadata updates target the parent scope");
  assert.equal(f.calls.length, 0);
}));

test("global filesystem-root worktree sentinel uses the fixture directory as its root scope", async () => fixture(async f => {
  const hooks = await Goal({ client: f.client, directory: f.root, worktree: "/" });
  const started = JSON.parse(await hooks.tool.goal_run.execute(admission, { ...f.context, directory: f.root, worktree: "/" }));
  assert.equal(started.state, "working");
  assert.equal(started.worktree, f.root);
  assert.equal(f.run().initial_worktree.files["counter.txt"].sha256, sha256("defective\n"));
  const guard = await ImmutabilityGuard({ client: f.client, directory: f.root, worktree: "/" });
  const input = { tool: "write", sessionID: "root", callID: "local-root-scope" };
  await guard["tool.execute.before"](input, { args: { filePath: path.join(f.root, "counter.txt") } });
  await assert.rejects(guard["tool.execute.before"](input, { args: { filePath: path.join(f.root, "outside.txt") } }), /outside its declared edit paths/);
  assert.ok(f.updates.every(update => update.directory === f.root));
  assert.equal(f.calls.length, 0);
}));

test("initial attribution preserves intentional deletion and pre-existing untracked input", async () => fixture(async f => {
  // Only temporary Git objects; no staging, commit or initialization commands.
  const object = async (type, content) => {
    const bytes = Buffer.concat([Buffer.from(`${type} ${content.length}\0`), content]);
    const hash = createHash("sha1").update(bytes).digest("hex");
    const directory = path.join(f.root, ".git/objects", hash.slice(0, 2));
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, hash.slice(2)), deflateSync(bytes));
    return hash;
  };
  const blob = await object("blob", Buffer.from("intentional deletion\n"));
  const tree = await object("tree", Buffer.concat([Buffer.from("100644 retired.md\0"), Buffer.from(blob, "hex")]));
  const commit = await object("commit", Buffer.from(`tree ${tree}\nauthor Fixture <fixture@localhost> 0 +0000\ncommitter Fixture <fixture@localhost> 0 +0000\n\nFixture snapshot\n`));
  await mkdir(path.join(f.root, ".git/refs"));
  await writeFile(path.join(f.root, ".git/HEAD"), `${commit}\n`);
  await writeFile(path.join(f.root, ".git/config"), "[core]\nrepositoryformatversion = 0\nbare = false\n");
  await writeFile(path.join(f.root, "input.txt"), "pre-existing source bytes");
  await f.start();
  const baseline = f.run().initial_worktree;
  assert.ok(baseline.status.some(entry => entry.path === "retired.md" && entry.status.includes("D")));
  assert.ok(baseline.status.some(entry => entry.path === "input.txt" && entry.status === "??"));
  assert.deepEqual(baseline.files["retired.md"], { state: "absent" });
  assert.equal(baseline.files["input.txt"].sha256, sha256("pre-existing source bytes"));
  await f.implement();
  await f.evaluate();
  assert.deepEqual(f.run().initial_worktree, baseline);
  assert.equal(await readFile(path.join(f.root, "input.txt"), "utf8"), "pre-existing source bytes");
  await assert.rejects(readFile(path.join(f.root, "retired.md")), { code: "ENOENT" });
}));

test("partial work and independent findings continue in the same worker, including after reload", async () => fixture(async f => {
  await f.start();
  const baseline = f.run().initial_worktree;
  await f.mutate("readiness.json", '{"verified":true}\n');
  f.finish("Preparation checked; implementation is still partial");
  await f.event("session.idle");
  assert.equal(f.continuations.length, 1);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.evaluate()).state, "working");
  assert.ok(f.run().findings.c0[0].includes("defective"));
  assert.equal(f.run().validation.checks.c1.passed, true);
  await f.load();
  f.finish("Independent counter failure needs repair");
  await f.event("session.idle");
  assert.equal(f.continuations.length, 2);
  assert.match(f.continuations.at(-1).body.parts[0].text, /same worker conversation|same worker/);
  assert.ok(f.continuations.every(input => input.path.id === "root" && JSON.stringify(input.body.model) === JSON.stringify(model)));
  await f.mutate("counter.txt", "good\n");
  assert.equal((await f.evaluate()).state, "accepted");
  assert.deepEqual(f.run().findings, {});
  assert.deepEqual(f.run().initial_worktree, baseline);
  assert.equal(await readFile(path.join(f.root, "readiness.json"), "utf8"), '{"verified":true}\n');
  assert.equal(f.calls.length, 2);
  assert.equal(new Set(f.calls.map(child => child.id)).size, 2);
  assert.ok(f.calls.every(child => child.parentID === "root" && child.title.startsWith("Goal evaluator:")));
}));

test("fresh independent feedback is actionable but never final acceptance", async () => fixture(async f => {
  await f.start();
  assert.equal((await f.evaluate("feedback")).state, "working");
  assert.equal(f.run().feedback.checks.c0.passed, false);
  assert.equal(f.run().validation, undefined);
  assert.deepEqual(f.run().findings, {});
  await f.implement();
  assert.equal((await f.evaluate("feedback")).state, "working");
  assert.equal(f.run().feedback.checks.c0.passed, true);
  assert.equal(f.run().accepted_candidate, undefined);
  f.user("WORKER_PRIVATE_CONVERSATION_SENTINEL");
  assert.equal((await f.evaluate()).state, "accepted");
  assert.equal(f.calls.length, 3);
  assert.equal(new Set(f.calls.map(child => child.id)).size, 3);
  for (const prompt of f.prompts) {
    assert.doesNotMatch(prompt.body.parts[0].text, /WORKER_PRIVATE_CONVERSATION_SENTINEL/);
    assert.match(prompt.body.parts[0].text, /actual candidate|actual inspection/);
    assert.deepEqual(prompt.body.model, model);
  }
  assert.match(f.prompts.at(-1).body.parts[0].text, /readiness.json records verified preparation/);
  assert.equal(f.run().validation.checks.c1.passed, true);
}));

test("failed final findings survive unrelated feedback and require resolution within the evaluator", async () => fixture(async f => {
  await f.start();
  await f.mutate("readiness.json", '{"verified":true}\n');
  await f.evaluate();
  await f.mutate("counter.txt", "another defect\n");
  await f.evaluate();
  const findings = f.run().findings;
  assert.equal(findings.c0.length, 2);
  await f.mutate("counter.txt", "good\n");
  await f.evaluate("feedback");
  assert.deepEqual(f.run().findings, findings, "Partial feedback cannot discharge final failures");
  f.setProvider(async input => {
    const id = input.path.id;
    assert.match(input.body.parts[0].text, /defective.*another defect/);
    await f.inspectFile(id, "counter.txt");
    const invalid = { ...checked(true), checks: { ...checked(true).checks, c1: { passed: true, evidence: "Fresh preparation read" } } };
    const untouched = clone(invalid);
    await assert.rejects(f.hooks.tool.goal_verdict.execute(invalid, { ...f.context, sessionID: id }), /Resolution required.*c0/);
    assert.deepEqual(invalid, untouched);
    assert.equal(f.run().state, "evaluating", "Rejected report leaves its child active for correction");
    return f.inspectCandidate(input);
  });
  assert.equal((await f.evaluate()).state, "accepted");
  assert.deepEqual(f.run().findings, {});
  assert.equal(f.calls.length, 4, "Report correction creates no extra evaluator");
}));

test("malformed, missing and evidence-free reports are corrected in the same independent child", async () => {
  for (const kind of ["missing", "json", "coverage", "extra", "no-inspection"]) await fixture(async f => {
    await f.start();
    await f.implement();
    const returned = new Set();
    f.setProvider(async input => {
      const id = input.path.id;
      if (!returned.has(id)) {
        returned.add(id);
        if (kind !== "no-inspection") await f.inspectFile(id, "counter.txt");
        if (kind === "json") f.record(id, "goal_verdict", "{invalid");
        if (kind === "coverage") f.record(id, "goal_verdict", JSON.stringify(checked(true)));
        if (kind === "extra") f.record(id, "goal_verdict", JSON.stringify({ ...checked(true), checks: { ...checked(true).checks,
          c1: { passed: true, evidence: "Preparation claimed" }, c2: { passed: true, evidence: "Unassigned" } } }));
        if (kind === "no-inspection") await f.submit(id, { ...checked(true), checks: { ...checked(true).checks, c1: { passed: true, evidence: "Preparation claimed" } } });
        return { data: { info: {} } };
      }
      assert.match(input.body.parts[0].text, /Evaluation report correction/);
      return f.inspectCandidate(input);
    });
    assert.equal((await f.evaluate()).state, "accepted", kind);
    assert.equal(f.calls.length, 1, kind);
    assert.equal(f.prompts.length, 2, kind);
    assert.equal(new Set(f.prompts.map(input => input.path.id)).size, 1);
  });
});

test("evaluator protocol watchdog returns to worker without acceptance or implementation restart", async () => fixture(async f => {
  await f.start();
  const original = await readFile(path.join(f.root, "counter.txt"));
  f.setProvider(async input => {
    f.record(input.path.id, "todowrite", "All done");
    f.record(input.path.id, "goal_verdict", JSON.stringify(checked(true)));
    return { data: { info: {} } };
  });
  const result = await f.evaluate();
  assert.equal(result.state, "working");
  assert.match(result.reason, /report incomplete/);
  assert.equal(f.run().feedback.status, "protocol_error");
  assert.equal(f.run().accepted_candidate, undefined);
  assert.equal(f.run().evaluation, undefined);
  assert.equal(f.calls.length, 1);
  assert.equal(f.prompts.length, 3, "Only evaluator protocol correction is bounded");
  assert.deepEqual(await readFile(path.join(f.root, "counter.txt")), original);
  f.finish();
  await f.event("session.idle");
  assert.equal(f.continuations.length, 1);
}));

test("third malformed evaluator report cannot let the protocol watchdog overwrite a durable pause or denial", async () => {
  for (const stop of ["pause", "denial"]) await fixture(async f => {
    await f.start();
    const baseline = f.run().initial_worktree;
    let paused;
    f.setProvider(async request => {
      await f.inspectFile(request.path.id, "counter.txt");
      f.record(request.path.id, "goal_verdict", "{malformed-report");
      const reports = f.history.get(request.path.id).flatMap(message => message.parts)
        .filter(part => part.tool === "goal_verdict" && part.state.status === "completed");
      if (reports.length === 3) {
        if (stop === "denial") await f.event("permission.replied", { sessionID: request.path.id, reply: "reject" });
        else await f.invoke("goal_run", { operation: "pause", reason: "Durable worker pause during the third report" });
        paused = f.run();
        assert.equal(paused.state, "paused");
      }
      return { data: { info: {} } };
    });
    const result = await f.evaluate();
    assert.equal(result.state, "paused");
    assert.equal(result.reason, paused.reason);
    assert.deepEqual(f.run(), paused, "Watchdog exhaustion must retain the existing pause, anchors and evidence");
    assert.match(paused.reason, stop === "denial" ? /^Observed permission denial/ : /Durable worker pause/);
    assert.equal(f.run().feedback, undefined, "Protocol feedback must not replace the controlling stop");
    assert.equal(f.run().accepted_candidate, undefined);
    assert.deepEqual(f.run().initial_worktree, baseline);
    assert.equal(f.calls.length, 1);
    assert.equal(f.prompts.length, 3, "All three reports belong to the same evaluator, not new worker attempts");
    const pauseWrite = f.updates.findIndex(input => input.sessionID === "root" && input.metadata[CHECKPOINT].state === "paused");
    assert.ok(pauseWrite >= 0);
    assert.ok(f.updates.slice(pauseWrite).filter(input => input.sessionID === "root")
      .every(input => input.metadata[CHECKPOINT].state === "paused"));
    await f.load();
    assert.equal((await f.inspect()).reason, paused.reason);
    f.finish("Incomplete evaluator protocol cannot undo the stop");
    await f.event("session.idle");
    assert.equal(f.continuations.length, 0);
    assert.equal(f.calls.length, 1);
  });
});

test("evaluator correction checks the current parent state and child assignment before another prompt", async () => {
  for (const change of ["pause", "replacement-child"]) await fixture(async f => {
    await f.start();
    f.setProvider(async request => {
      await f.inspectFile(request.path.id, "counter.txt");
      f.record(request.path.id, "goal_verdict", "{first-malformed-report");
      if (change === "pause") await f.invoke("goal_run", { operation: "pause", reason: "Pause before any evaluator correction" });
      else {
        const child = clone(f.sessions.get(request.path.id));
        child.id = "replacement-child";
        f.sessions.set(child.id, child);
        f.history.set(child.id, []);
        const metadata = clone(f.sessions.get("root").metadata);
        metadata[CHECKPOINT].evaluation.childID = child.id;
        await f.client.session.update({ sessionID: "root", directory: f.root, metadata });
      }
      return { data: { info: {} } };
    });
    const result = await f.evaluate();
    assert.equal(result.state, "paused");
    assert.match(result.reason, change === "pause" ? /Pause before any evaluator correction/ : /no longer active/);
    assert.equal(f.prompts.length, 1, "A stale evaluator must not receive a correction prompt");
    assert.equal(f.calls.length, 1);
    assert.equal(f.run().accepted_candidate, undefined);
    assert.equal(f.run().feedback, undefined);
    f.finish("Evaluator assignment is no longer active");
    await f.event("session.idle");
    assert.equal(f.continuations.length, 0);
  });
});

test("only an active independent evaluator can record a complete verdict", async () => fixture(async f => {
  await f.start();
  await assert.rejects(f.hooks.tool.goal_verdict.execute(checked(true), f.context), /active independent evaluator/);
  f.setProvider(async input => {
    const id = input.path.id;
    await assert.rejects(f.hooks.tool.goal_verdict.execute({ status: "checked", reason: "", checks: {} }, { ...f.context, sessionID: id }), /Missing independent evidence/);
    return f.inspectCandidate(input);
  });
  await f.evaluate();
  await assert.rejects(f.hooks.tool.goal_verdict.execute(checked(true), { ...f.context, sessionID: f.calls[0].id }), /active independent evaluator/);
}));

test("durable evaluator marker precedes prompting and keeps a completed child read-only after switching to Build", async () => fixture(async f => {
  await f.start();
  const fingerprint = f.run().definition_sha256;
  f.setProvider(async request => {
    const child = f.sessions.get(request.path.id);
    assert.deepEqual(child.metadata.cuddly_winner_evaluator, { parentID: "root", definition_sha256: fingerprint });
    assert.equal(Object.hasOwn(child.metadata, CHECKPOINT), false);
    return f.inspectCandidate(request);
  });
  assert.equal((await f.evaluate("feedback")).state, "working");
  const childID = f.calls[0].id;
  const marker = { parentID: "root", definition_sha256: fingerprint };
  assert.deepEqual(f.sessions.get(childID).metadata,
    { child_unrelated: { preserved: true }, cuddly_winner_evaluator: marker });
  assert.equal(f.run().evaluation, undefined, "Active assignment is finished; the marker must provide the permanent restriction");
  assert.equal(f.sessions.get("root").metadata.cuddly_winner_evaluator, undefined);
  f.sessions.get(childID).agent = "build";
  f.history.get(childID).push({ info: { id: "child-build-user", role: "user", agent: "build", model },
    parts: [{ type: "text", text: "Switch this child to native Build" }] });
  const product = await readFile(path.join(f.root, "counter.txt"));
  for (const reload of [false, true]) {
    if (reload) await f.load();
    const guard = await ImmutabilityGuard({ client: f.client, directory: f.root, worktree: f.root });
    await guard["chat.params"]({ sessionID: childID, agent: "build" });
    await assert.rejects(guard["tool.execute.before"]({ tool: "write", sessionID: childID, callID: "child-write" },
      { args: { filePath: path.join(f.root, "counter.txt") } }), /evaluator children are read-only/);
    await assert.rejects(guard["tool.execute.before"]({ tool: "bash", sessionID: childID, callID: "child-shell" },
      { args: { command: "node offline-check.mjs" } }), /mutation and Bash are frozen/);
    await guard["tool.execute.before"]({ tool: "write", sessionID: "root", callID: "root-remains-worker" },
      { args: { filePath: path.join(f.root, "counter.txt") } });
    assert.deepEqual(f.sessions.get(childID).metadata.cuddly_winner_evaluator, marker);
    assert.equal(Object.hasOwn(f.sessions.get(childID).metadata, CHECKPOINT), false);
  }
  assert.deepEqual(await readFile(path.join(f.root, "counter.txt")), product);
  assert.equal(f.run().state, "working");
  assert.equal(f.calls.length, 1);
}));

test("failed evaluator marker persistence pauses before dispatching any prompt", async () => {
  for (const failure of ["api", "not-persisted"]) await fixture(async f => {
    await f.start();
    const update = f.client.session.update;
    f.client.session.update = async input => input.sessionID === "root" ? update(input)
      : failure === "api" ? { error: "role update failed" } : { data: clone(f.sessions.get(input.sessionID)) };
    const result = await f.evaluate("feedback");
    assert.equal(result.state, "paused");
    assert.match(result.reason, failure === "api" ? /outcome unknown/ : /Evaluator role did not persist/);
    assert.equal(f.calls.length, 1);
    assert.equal(f.prompts.length, 0, "An unmarked evaluator must receive no task prompt");
    const childID = f.calls[0].id;
    assert.equal(f.sessions.get(childID).metadata.cuddly_winner_evaluator, undefined);
    assert.equal(Object.hasOwn(f.sessions.get(childID).metadata, CHECKPOINT), false);
    assert.equal(f.run().accepted_candidate, undefined);
    assert.ok(f.aborts.includes(childID));
    await f.load();
    assert.equal((await f.inspect()).state, "paused");
    f.finish("Evaluator role persistence failed");
    await f.event("session.idle");
    assert.equal(f.continuations.length, 0);
    assert.equal(f.prompts.length, 0);
  });
});

test("explicit resume marks an idle orphan from a lost create response before the worker becomes working", async () => fixture(async f => {
  await f.start();
  const baseline = f.run().initial_worktree, fingerprint = f.run().definition_sha256;
  const create = f.client.session.create;
  f.client.session.create = async input => {
    await create(input); // The actual server row exists; only its response is lost.
    return { error: "creation response lost" };
  };
  assert.equal((await f.evaluate("feedback")).state, "paused");
  const childID = f.calls[0].id;
  assert.equal(f.run().evaluation.childID, undefined, "The caller never received the created child ID");
  assert.equal(f.sessions.get(childID).metadata.cuddly_winner_evaluator, undefined);
  assert.equal(f.prompts.length, 0);
  await f.load();
  assert.equal((await f.inspect()).state, "paused");
  const marker = { parentID: "root", definition_sha256: fingerprint };
  const update = f.client.session.update;
  f.client.session.update = async input => {
    if (input.sessionID === "root" && input.metadata[CHECKPOINT].state === "working") {
      assert.deepEqual(f.sessions.get(childID).metadata.cuddly_winner_evaluator, marker,
        "Resumption must not become working until the orphan's role has persisted");
    }
    return update(input);
  };
  f.user("I inspected the child rows and receipts. Resume without repeating the uncertain create.");
  assert.equal((await f.invoke("goal_run", { operation: "resume", reconciled: true })).state, "working");
  assert.deepEqual(f.sessions.get(childID).metadata,
    { child_unrelated: { preserved: true }, cuddly_winner_evaluator: marker });
  assert.deepEqual(f.run().initial_worktree, baseline);
  const childWrite = f.updates.findIndex(input => input.sessionID === childID);
  const resumedWrite = f.updates.findLastIndex(input => input.sessionID === "root" && input.metadata[CHECKPOINT].state === "working");
  assert.ok(childWrite >= 0 && childWrite < resumedWrite);
  f.sessions.get(childID).agent = "build";
  const guard = await ImmutabilityGuard({ client: f.client, directory: f.root, worktree: f.root });
  await guard["chat.params"]({ sessionID: childID, agent: "build" });
  await assert.rejects(guard["tool.execute.before"]({ tool: "write", sessionID: childID, callID: "orphan-write" },
    { args: { filePath: path.join(f.root, "counter.txt") } }), /evaluator children are read-only/);
  assert.equal(f.calls.length, 1, "Unknown creation is not replayed");
  assert.equal(f.prompts.length, 0);
  assert.equal(f.continuations.length, 0);
}));

test("resume never overwrites foreign or unrecognized evaluator markers on orphan child rows", async () => {
  for (const marker of [{ parentID: "foreign-root", definition_sha256: "f".repeat(64) },
    { parentID: "root", definition_sha256: "f".repeat(64) }, { unrecognized_role: true }]) await fixture(async f => {
    await f.start();
    const create = f.client.session.create;
    f.client.session.create = async input => {
      const response = await create(input);
      f.sessions.get(response.data.id).metadata.cuddly_winner_evaluator = clone(marker);
      return { error: "creation response lost" };
    };
    assert.equal((await f.evaluate("feedback")).state, "paused");
    const childID = f.calls[0].id;
    const before = clone(f.sessions.get(childID).metadata), paused = f.run();
    await f.load();
    f.user("I inspected the orphan row. Resume if its identity matches this Goal.");
    await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Evaluator identity conflicts/);
    assert.deepEqual(f.sessions.get(childID).metadata, before);
    assert.deepEqual(f.run(), paused);
    assert.equal(f.updates.filter(input => input.sessionID === childID).length, 0);
    assert.equal(f.calls.length, 1);
    assert.equal(f.prompts.length, 0);
  });
});

test("evaluator is read-only, cannot delegate, and inherits worker model or evaluator override", async () => {
  for (const options of [{}, { bash: false, validator_model: "checker/independent" }]) await fixture(async f => {
    await f.start();
    await f.evaluate("feedback");
    const rules = f.calls[0].permission;
    assert.deepEqual(rules[0], { permission: "*", pattern: "*", action: "deny" });
    for (const permission of ["read", "glob", "grep", "list", "webfetch", "websearch", "lsp", "goal_verdict"]) {
      assert.equal(rules.find(rule => rule.permission === permission)?.action, "allow");
    }
    for (const permission of ["edit", "write", "apply_patch", "task", "publish_goal_agent", "goal_evaluate"]) {
      assert.equal(rules.find(rule => rule.permission === permission)?.action ?? rules[0].action, "deny");
    }
    assert.equal(rules.find(rule => rule.permission === "bash").action, options.bash === false ? "deny" : "ask");
    assert.deepEqual(f.prompts[0].body.model, options.validator_model ? { providerID: "checker", modelID: "independent" } : model);
  }, options);
});

test("evaluator explicitly allows browser inspection while mutating browser tools fall through to deny", async () => fixture(async f => {
  await f.start();
  await f.evaluate("feedback");
  const rules = f.calls[0].permission;
  const denied = { permission: "*", pattern: "*", action: "deny" };
  assert.deepEqual(rules[0], denied);
  assert.deepEqual(rules.filter(rule => rule.permission.includes("*")), [denied],
    "Evaluators must not inherit the root browser namespace wildcard grant");
  const inspection = ["status", "snapshot", "markdown", "links", "interactive_elements", "count", "search", "get_attribute",
    "extract", "console_messages", "navigate", "scroll", "wait_for", "wait_for_text"];
  for (const name of inspection) {
    assert.deepEqual(rules.find(rule => rule.permission === `cuddly-winner-browser_browser_${name}`),
      { permission: `cuddly-winner-browser_browser_${name}`, pattern: "*", action: "allow" });
  }
  for (const name of ["click", "upload_image", "evaluate", "press_key", "fill", "fill_form", "type", "select_option",
    "download", "save_media", "screenshot"]) {
    assert.equal(rules.find(rule => rule.permission === `cuddly-winner-browser_browser_${name}`), undefined,
      `${name} must have no exception to the initial deny, including arbitrary JavaScript evaluate`);
  }
  const text = f.prompts[0].body.parts[0].text;
  assert.match(text, /Inspect existing live outputs\/receipts instead of replaying actions/);
}));

test("published primary keeps its explicit MCP browser namespace grant and default deny", async () => fixture(async f => {
  const definition = await readFile(path.join(f.root, ".opencode/agents/generated/fix-counter.md"), "utf8");
  const header = parseYaml(definition.match(/^---\n([\s\S]*?)\n---/)[1]);
  assert.equal(header.mode, "primary");
  assert.equal(header.permission["*"], "deny");
  assert.equal(header.permission["cuddly-winner-browser_*"], "allow");
  assert.equal(header.permission.task, "deny");
  assert.equal(header.permission.goal_run, "allow");
  assert.equal(header.permission.goal_evaluate, "allow");
  assert.equal(f.run(), undefined, "Publishing capability does not admit browser side effects");
}));

test("candidate mutation during evaluation pauses and cannot establish acceptance", async () => fixture(async f => {
  await f.start();
  await f.implement();
  f.setProvider(async input => {
    await f.inspectCandidate(input);
    await writeFile(path.join(f.root, "counter.txt"), "changed during evaluation\n");
    return { data: { info: {} } };
  });
  const result = await f.evaluate();
  assert.equal(result.state, "paused");
  assert.match(result.reason, /Candidate bytes changed/);
  assert.equal(f.run().accepted_candidate, undefined);
  assert.equal(f.run().validation, undefined);
  assert.equal(f.calls.length, 1);
  f.finish("All done");
  await f.event("session.idle");
  assert.equal(f.continuations.length, 0);
}));

test("final acceptance automatically binds current baseline input hashes omitted from artifacts", async () => fixture(async f => {
  await f.start();
  const baseline = f.run().initial_worktree;
  const input = await readFile(path.join(f.root, "README.md"));
  const inputHash = { state: "present", size: input.length, sha256: sha256(input) };
  await f.implement();
  f.setProvider(async request => {
    const text = request.body.parts[0].text;
    const artifacts = JSON.parse(text.match(/^ARTIFACTS: (.+)$/m)[1]);
    const candidate = JSON.parse(text.match(/^CANDIDATE HASHES: (.+)$/m)[1]);
    const initial = JSON.parse(text.match(/^INITIAL WORKTREE: (.+)$/m)[1]);
    assert.deepEqual(artifacts, ["counter.txt"], "README.md is not an explicit artifact");
    assert.deepEqual(candidate["README.md"], inputHash, "Evaluator receives automatic current input hashes");
    assert.deepEqual(candidate["readiness.json"], await captureFiles(f.root, ["readiness.json"]).then(files => files["readiness.json"]),
      "All policy paths remain included even when omitted from explicit artifacts");
    assert.deepEqual(initial, baseline, "The original attribution baseline is never replaced by current candidate hashes");
    assert.equal(await f.inspectFile(request.path.id, "README.md"), input.toString());
    return f.inspectCandidate(request);
  });
  assert.equal((await f.evaluate("final", { artifacts: ["counter.txt"] })).state, "accepted");
  assert.deepEqual(f.run().accepted_candidate["README.md"], inputHash);
  assert.deepEqual(f.run().initial_worktree, baseline);
  assert.equal((await f.inspect()).acceptance_current, true);
  await f.load();
  assert.equal((await f.inspect()).acceptance_current, true);
  await writeFile(path.join(f.root, "README.md"), "later external input change\n");
  assert.equal((await f.inspect()).acceptance_current, false, "Acceptance must bind the read-only input as well as product bytes");
  assert.equal(f.run().state, "accepted", "Historical acceptance is terminal even when its candidate is no longer current");
  assert.deepEqual(f.run().accepted_candidate["README.md"], inputHash);
  assert.equal(f.calls.length, 1);
}));

test("read-only baseline input changes during final evaluation prevent acceptance", async () => fixture(async f => {
  await f.start();
  const baseline = f.run().initial_worktree;
  const input = await readFile(path.join(f.root, "README.md"), "utf8");
  await f.implement();
  const product = await captureFiles(f.root, ["counter.txt", "readiness.json"]);
  f.setProvider(async request => {
    const candidate = JSON.parse(request.body.parts[0].text.match(/^CANDIDATE HASHES: (.+)$/m)[1]);
    assert.equal(candidate["README.md"].sha256, sha256(input));
    assert.equal(await f.inspectFile(request.path.id, "README.md"), input);
    await f.inspectCandidate(request);
    // An external writer changes only the non-editable input after the child
    // records a passing report. The runtime must detect this independently.
    await writeFile(path.join(f.root, "README.md"), "external change during evaluation\n");
    return { data: { info: {} } };
  });
  const result = await f.evaluate("final", { artifacts: ["counter.txt"] });
  assert.equal(result.state, "paused");
  assert.match(result.reason, /Candidate bytes changed/);
  assert.equal(f.run().accepted_candidate, undefined);
  assert.equal(f.run().validation, undefined);
  assert.deepEqual(f.run().initial_worktree, baseline);
  assert.deepEqual(await captureFiles(f.root, ["counter.txt", "readiness.json"]), product,
    "Unchanged product files cannot hide a changed read-only input");
  assert.equal(f.calls.length, 1);
  assert.equal(f.prompts.length, 1, "Changed input must not trigger report correction or a replay");
  f.finish("Child reported success, but the candidate changed");
  await f.event("session.idle");
  assert.equal(f.continuations.length, 0);
}));

test("changed definition blocks mutation and evaluation across reload without replacing baseline", async () => fixture(async f => {
  await f.start();
  const original = f.run();
  const file = path.join(f.root, ".opencode/agents/generated/fix-counter.md");
  await writeFile(file, (await readFile(file, "utf8")).replace("Counter and preparation verified offline", "Revised goal"));
  await f.load();
  assert.equal((await f.inspect()).definition_matches, false);
  await assert.rejects(f.start(), /definition changed/);
  await assert.rejects(f.before(), /matching working checkpoint/);
  await assert.rejects(f.evaluate(), /matching Goal/);
  assert.deepEqual(f.run().initial_worktree, original.initial_worktree);
  assert.equal(f.calls.length, 0);
  f.finish();
  await f.event("session.idle");
  assert.equal(f.continuations.length, 0);
}));

test("definition revision during evaluation never accepts the old report", async () => fixture(async f => {
  await f.start();
  await f.implement();
  f.setProvider(async input => {
    await f.inspectCandidate(input);
    const file = path.join(f.root, ".opencode/agents/generated/fix-counter.md");
    await writeFile(file, `${await readFile(file, "utf8")}\nChanged instruction\n`);
    return { data: { info: {} } };
  });
  assert.equal((await f.evaluate()).state, "paused");
  assert.equal(f.run().accepted_candidate, undefined);
  assert.equal(f.run().validation, undefined);
}));

test("explicit pause survives status questions and reload; reconciled human resume is required", async () => fixture(async f => {
  await f.start();
  const initial = f.run();
  await f.invoke("goal_run", { operation: "pause", reason: "Inspect current receipts" });
  await f.load();
  f.user("What is the status?");
  await f.hooks["chat.message"]({ sessionID: "root", messageID: "status-question" }, { parts: [] });
  assert.equal((await f.inspect()).state, "paused");
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /status question/);
  f.user("Do not resume yet");
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/);
  f.user("Resume after inspection", "fix-counter", true);
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/);
  f.finish();
  await f.event("session.idle");
  assert.equal(f.continuations.length, 0);
  f.user("I inspected the receipts. Resume within the original authority.");
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: false }), /reconciled/);
  assert.equal((await f.invoke("goal_run", { operation: "resume", reconciled: true })).state, "working");
  assert.deepEqual(f.run().initial_worktree, initial.initial_worktree);
  assert.equal(f.run().authorized_actions, initial.authorized_actions);
}));

test("a status question mentioning resumption does not authorize it", async () => fixture(async f => {
  await f.start();
  await f.invoke("goal_run", { operation: "pause", reason: "Inspect unknown outcome" });
  f.user("Is the Goal paused, and what must I inspect before I resume?");
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption|status question/);
  assert.equal(f.run().state, "paused");
  assert.equal(f.calls.length, 0);
  assert.equal(f.continuations.length, 0);
}));

test("runtime native Question yes, no, stale and ambiguous receipts control resume without generating nudges", async () => {
  const scenarios = [
    { name: "yes", confirmed: true, fresh: true },
    { name: "no", args: { answers: [["Keep Paused"]] }, confirmed: false, fresh: true },
    { name: "stale", delta: -1, confirmed: false, fresh: false },
    { name: "at pause boundary", delta: 0, confirmed: false, fresh: false },
    { name: "ambiguous headers", args: { questions: [resumeQuestion(), resumeQuestion()], answers: [["Resume Goal"], ["Resume Goal"]] }, confirmed: false, fresh: true },
    { name: "multiple answers", args: { answers: [["Resume Goal", "Keep Paused"]] }, confirmed: false, fresh: true },
    { name: "affirmative prose but negative metadata", args: { answers: [["Keep Paused"]], output: "Resume Goal: all work should continue." }, confirmed: false, fresh: true },
    { name: "unoffered answer", args: { questions: [{ ...resumeQuestion(), options: [{ label: "Keep Paused" }] }] }, confirmed: false, fresh: true },
  ];
  for (const scenario of scenarios) await fixture(async f => {
    f.user("I authorize you to continue this offline Goal.");
    const originalUser = f.history.get("root").at(-1).info.id;
    await f.start();
    await f.invoke("goal_run", { operation: "pause", reason: "Inspect recorded outcomes" });
    const paused = f.run();
    assert.ok(Number.isFinite(paused.paused_at));
    assert.equal(paused.paused_at, paused.updated_at);
    assert.equal(paused.paused_after_user, originalUser);
    await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/,
      "The original authorization cannot resume the paused run without a new decision");
    const receipt = questionReceipt(paused.paused_at + (scenario.delta ?? 10), scenario.args);
    f.append("root", receipt.parts, { time: receipt.info.time });
    const updates = f.updates.length;
    const automatic = { enabled: true };
    await f.hooks["experimental.compaction.autocontinue"]({ sessionID: "root", agent: "fix-counter" }, automatic);
    assert.equal(automatic.enabled, scenario.fresh, scenario.name);
    assert.deepEqual(f.run(), paused, "Core may finish processing a reply without resuming Goal authority");
    assert.equal(f.updates.length, updates);
    const inspection = await f.invoke("goal_run", { operation: "inspect", include_baseline: true });
    assert.deepEqual(inspection.initial_worktree, paused.initial_worktree);
    assert.equal(f.updates.length, updates, "Inspecting a Question receipt cannot write a new checkpoint");
    await assert.rejects(f.before("write", "premature-question-write"), /working checkpoint/);
    f.finish("The native popup response has been processed");
    await f.event("session.idle");
    assert.equal(f.continuations.length, 0);
    if (scenario.confirmed) {
      await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: false }), /reconciled/);
      assert.equal((await f.invoke("goal_run", { operation: "resume", reconciled: true })).state, "working");
      assert.equal(f.run().paused_at, undefined);
      assert.equal(f.run().paused_after_user, undefined);
      assert.deepEqual(f.run().initial_worktree, paused.initial_worktree);
    } else {
      await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/, scenario.name);
      assert.deepEqual(f.run(), paused);
      assert.equal(f.updates.length, updates);
    }
    assert.equal(f.calls.length, 0);
    assert.equal(f.prompts.length, 0);
  });
});

test("runtime newer Keep Paused receipt vetoes older chat authorization until a newer human resumes", async () => fixture(async f => {
  await f.start();
  await f.invoke("goal_run", { operation: "pause" });
  const paused = f.run();
  f.user("Resume after inspecting the receipts.", "fix-counter", false, paused.paused_at + 10);
  const receipt = questionReceipt(paused.paused_at + 20, { answers: [["Keep Paused"]], output: "Resume Goal" });
  f.append("root", receipt.parts, { time: receipt.info.time });
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/);
  assert.deepEqual(f.run(), paused);
  const automatic = { enabled: true };
  await f.hooks["experimental.compaction.autocontinue"]({ sessionID: "root" }, automatic);
  assert.equal(automatic.enabled, true, "Core may complete the negative popup conversation");
  assert.equal(f.run().state, "paused");
  f.finish("Keep Paused acknowledged");
  await f.event("session.idle");
  assert.equal(f.continuations.length, 0);
  f.user("I inspected the receipts again. Resume this Goal.", "fix-counter", false, paused.paused_at + 30);
  assert.equal((await f.invoke("goal_run", { operation: "resume", reconciled: true })).state, "working");
  assert.equal(f.run().paused_at, undefined);
  assert.deepEqual(f.run().initial_worktree, paused.initial_worktree);
  assert.equal(f.calls.length, 0);
  assert.equal(f.continuations.length, 0);
}));

test("runtime fresh chat denying authorization cannot resume a paused Goal", async () => fixture(async f => {
  await f.start();
  await f.invoke("goal_run", { operation: "pause" });
  const paused = f.run(), updates = f.updates.length;
  f.user("I do not authorize continuation.");
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/);
  assert.deepEqual(f.run(), paused);
  assert.equal(f.updates.length, updates);
  assert.equal(f.calls.length, 0);
  assert.equal(f.continuations.length, 0);
}));

test("runtime rejects fresh nonadjacent resume negation without changing paused authority", async () => {
  for (const text of ["I do not want you to resume.", "I have not authorized you to continue."]) await fixture(async f => {
    await f.start();
    await f.invoke("goal_run", { operation: "pause" });
    const paused = f.run(), updates = f.updates.length;
    const receipt = questionReceipt(paused.paused_at + 10);
    f.append("root", receipt.parts, { time: receipt.info.time });
    f.user(text, "fix-counter", false, paused.paused_at + 20);
    await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/, text);
    assert.deepEqual(f.run(), paused);
    assert.equal(f.updates.length, updates);
    await assert.rejects(f.before("write", "negative-resume-write"), /working checkpoint/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.continuations.length, 0);
  });
});

test("native Question authorization still requires reconciled outcomes and idle evaluator children", async () => fixture(async f => {
  await f.start();
  await f.evaluate("feedback");
  const childID = f.calls[0].id;
  await f.invoke("goal_run", { operation: "pause" });
  const paused = f.run();
  const receipt = questionReceipt(paused.paused_at + 10);
  f.append("root", receipt.parts, { time: receipt.info.time });
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: false }), /reconciled/);
  f.setStatuses({ [childID]: { type: "busy" } });
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /active or its activity is unknown/);
  assert.deepEqual(f.run(), paused);
  f.setStatuses({});
  assert.equal((await f.invoke("goal_run", { operation: "resume", reconciled: true })).state, "working");
  assert.deepEqual(f.run().feedback, paused.feedback);
  assert.equal(f.run().paused_at, undefined);
  assert.equal(f.calls.length, 1);
  assert.equal(f.prompts.length, 1);
  assert.equal(f.continuations.length, 0);
}));

test("first pause time remains fixed across late denial, reload and inspection so a fresh popup reply stays usable", async t => fixture(async f => {
  await f.start();
  await f.invoke("goal_run", { operation: "pause", reason: "Interrupted action outcome unknown" });
  const first = f.run();
  assert.ok(Number.isFinite(first.paused_at));
  const clock = t.mock.method(Date, "now", () => first.paused_at + 1000);
  try { await f.event("permission.replied", { reply: "reject" }); }
  finally { clock.mock.restore(); }
  const denied = f.run();
  assert.match(denied.reason, /^Observed permission denial/);
  assert.equal(denied.updated_at, first.paused_at + 1000);
  assert.equal(denied.paused_at, first.paused_at);
  assert.equal(denied.paused_after_user, first.paused_after_user);
  const receipt = questionReceipt(first.paused_at + 10);
  assert.ok(receipt.parts[0].state.time.end < denied.updated_at, "The popup completed before the later denial update");
  f.append("root", receipt.parts, { time: receipt.info.time });
  await f.load();
  const updates = f.updates.length;
  assert.deepEqual((await f.invoke("goal_run", { operation: "inspect", include_baseline: true })).initial_worktree, first.initial_worktree);
  assert.deepEqual(f.run(), denied);
  assert.equal(f.updates.length, updates);
  const automatic = { enabled: true };
  await f.hooks["experimental.compaction.autocontinue"]({ sessionID: "root" }, automatic);
  assert.equal(automatic.enabled, true, "The fixed pause anchor keeps the native reply fresh through compaction");
  assert.deepEqual(f.run(), denied);
  assert.equal((await f.invoke("goal_run", { operation: "resume", reconciled: true })).state, "working");
  assert.equal(f.run().paused_at, undefined);
  assert.equal(f.run().paused_after_user, undefined);
  assert.equal(f.calls.length, 0);
}));

test("pre-pause authorization containing continue cannot authorize resumption after denial", async () => fixture(async f => {
  f.user("I authorize you to continue implementing and verifying the counter offline.");
  const authorizedUserID = f.history.get("root").at(-1).info.id;
  await f.start();
  const admitted = f.run();
  await f.event("permission.replied", { reply: "reject" });
  const paused = f.run();
  assert.equal(paused.state, "paused");
  assert.match(paused.reason, /permission denial/);
  assert.equal(paused.paused_after_user, authorizedUserID);
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/);
  assert.deepEqual(f.run(), paused, "Reconciled=true alone cannot reuse the original authorization");
  f.finish("The original request authorized continued work");
  await f.event("session.idle");
  assert.equal(f.continuations.length, 0);
  await f.load();
  assert.equal((await f.inspect()).state, "paused");
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/);
  f.user("Resume the Goal", "fix-counter", true);
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/);
  assert.equal(f.run().paused_after_user, authorizedUserID, "A synthetic user message is not a new human authorization");
  f.user("What is the status?");
  await f.invoke("goal_run", { operation: "pause", reason: "Already paused" });
  await f.event("permission.replied", { reply: "reject" });
  assert.equal(f.run().paused_after_user, authorizedUserID, "Repeated pauses retain the first pause's real-user boundary");
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/);
  f.user("I inspected the denial and receipts. Resume the existing Goal.");
  const resumedUserID = f.history.get("root").at(-1).info.id;
  assert.notEqual(resumedUserID, authorizedUserID);
  assert.equal((await f.invoke("goal_run", { operation: "resume", reconciled: true })).state, "working");
  assert.equal(f.run().paused_after_user, undefined);
  assert.deepEqual(f.run().initial_worktree, admitted.initial_worktree);
  assert.equal(f.run().authorized_actions, admitted.authorized_actions);
  await f.event("permission.replied", { reply: "reject" });
  assert.equal(f.run().paused_after_user, resumedUserID, "Each new pause requires another subsequent human decision");
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.continuations.length, 0);
}));

test("resume fails closed for busy, retry, unknown or unreadable children", async () => {
  for (const state of ["busy", "retry", "unknown", "status-error", "children-error"]) await fixture(async f => {
    await f.start();
    await f.evaluate("feedback");
    await f.invoke("goal_run", { operation: "pause" });
    f.user("Resume after inspecting prior evaluator evidence");
    if (state === "status-error") f.client.session.status = async () => ({ error: "unavailable" });
    else if (state === "children-error") f.client.session.children = async () => ({ error: "unavailable" });
    else f.setStatuses({ [f.calls[0].id]: { type: state } });
    await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /active or its activity is unknown|outcome unknown/);
    assert.equal(f.run().state, "paused");
    assert.equal(f.calls.length, 1);
  });
});

test("root mutation hooks journal caller IDs and clear only the completed action", async () => fixture(async f => {
  await f.start();
  const actions = [["write", "w"], ["edit", "e"], ["apply_patch", "p"], ["bash", "b"],
    ["cuddly-winner-browser_browser_click", "click"], ["cuddly-winner-browser_browser_upload_image", "upload"]];
  for (const [tool, callID] of actions) {
    await f.before(tool, callID);
    assert.deepEqual(f.run().pending_actions[callID], { tool, callID });
  }
  await f.before("write", "w");
  assert.equal(Object.keys(f.run().pending_actions).length, 6, "Same caller ID is a single pending action");
  await f.after("read", "unrelated");
  assert.equal(Object.keys(f.run().pending_actions).length, 6);
  await f.after("write", "w");
  assert.equal(f.run().pending_actions.w, undefined);
  assert.ok(f.run().pending_actions.e);
  for (const [tool, id] of actions.slice(1)) await f.after(tool, id);
  assert.deepEqual(f.run().pending_actions, {});
  const updates = f.updates.length;
  await f.after("write", "w");
  await f.before("read", "r");
  assert.equal(f.updates.length, updates, "Completed caller IDs and reads do not create action records");
}));

test("inspection during the first persisted action's blocked metadata ACK recognizes its live owner", { timeout: 5000 }, async () => fixture(async f => {
  await f.start();
  const entered = gate(), acknowledge = gate(), update = f.client.session.update;
  let held = false, finished = false;
  f.client.session.update = async input => {
    const stored = await update(input);
    if (!held && input.sessionID === "root" && input.metadata[CHECKPOINT].pending_actions["ack-gap"]) {
      held = true;
      entered.release();
      await acknowledge.promise; // The row is already durable; only its ACK is delayed.
    }
    return stored;
  };
  const action = Promise.allSettled([f.before("write", "ack-gap").then(() => { finished = true; })]);
  await entered.promise;
  let inspection, timeout;
  try {
    const persisted = f.run(), updates = f.updates.length;
    assert.deepEqual(persisted.pending_actions, { "ack-gap": { tool: "write", callID: "ack-gap" } });
    assert.equal(finished, false);
    inspection = f.inspect();
    const result = await Promise.race([inspection, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Inspection incorrectly queued a pause behind the live action's blocked metadata ACK")), 1000);
    })]);
    assert.equal(result.state, "working");
    assert.equal(finished, false, "The action still awaits its first metadata acknowledgement");
    assert.deepEqual(f.run(), persisted);
    assert.equal(f.updates.length, updates, "Live ownership avoids a queued reconciliation write");
    assert.equal(await readFile(path.join(f.root, "counter.txt"), "utf8"), "defective\n");
  } finally {
    clearTimeout(timeout);
    acknowledge.release();
    await Promise.allSettled([action, inspection]);
    f.client.session.update = update;
  }
  const [result] = await action;
  assert.equal(result.status, "fulfilled");
  await writeFile(path.join(f.root, "counter.txt"), "write after acknowledged admission\n");
  await f.after("write", "ack-gap");
  assert.deepEqual(f.run().pending_actions, {});
  assert.equal((await f.inspect()).state, "working");
  assert.equal(await readFile(path.join(f.root, "counter.txt"), "utf8"), "write after acknowledged admission\n");
}));

test("stale queued reconciliation rechecks current action ownership under the metadata lock", { timeout: 5000 }, async () => fixture(async f => {
  await f.start();
  await f.before("write", "late-owned");
  const delayedResponse = clone(f.sessions.get("root"));
  await f.after("write", "late-owned");
  assert.deepEqual(f.run().pending_actions, {});
  const entered = gate(), acknowledge = gate(), staleDelivered = gate();
  const update = f.client.session.update, get = f.client.session.get;
  let held = false, inspection, lateAction;
  f.client.session.update = async input => {
    const stored = await update(input);
    if (!held && input.sessionID === "root" && input.metadata[CHECKPOINT].pending_actions.anchor) {
      held = true;
      entered.release();
      await acknowledge.promise;
    }
    return stored;
  };
  const anchor = Promise.allSettled([f.before("edit", "anchor")]);
  await entered.promise;
  try {
    // Deliver a real older row to the inspection's definition/reconciliation
    // reads. Its completed caller looks unknown, while the current row is owned
    // by the anchor action holding the metadata lock.
    let delayedReads = 2;
    f.client.session.get = async input => {
      if (input.path.id === "root" && delayedReads > 0) {
        delayedReads--;
        if (delayedReads === 0) staleDelivered.release();
        return { data: clone(delayedResponse) };
      }
      return get(input);
    };
    inspection = f.inspect();
    await staleDelivered.promise;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.run().pending_actions, { anchor: { tool: "edit", callID: "anchor" } });
    // A repeated native before-hook notification establishes ownership of the
    // old caller ID before queued reconciliation can execute. No product action
    // is replayed; the fixture writes its product only once, after admission.
    lateAction = Promise.allSettled([f.before("write", "late-owned")]);
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    f.client.session.get = get;
    acknowledge.release();
    await Promise.allSettled([anchor, inspection, lateAction]);
    f.client.session.update = update;
  }
  assert.equal((await inspection).state, "working", "An old get response cannot cause a blind pause after ownership changes");
  assert.equal((await anchor)[0].status, "fulfilled");
  assert.equal((await lateAction)[0].status, "fulfilled");
  assert.equal(f.run().state, "working");
  assert.deepEqual(f.run().pending_actions, { anchor: { tool: "edit", callID: "anchor" }, "late-owned": { tool: "write", callID: "late-owned" } });
  assert.equal(f.updates.some(input => input.sessionID === "root" && input.metadata[CHECKPOINT].state === "paused"), false);
  assert.equal(await readFile(path.join(f.root, "counter.txt"), "utf8"), "defective\n");
  await writeFile(path.join(f.root, "counter.txt"), "single admitted fixture write\n");
  await f.after("write", "late-owned");
  await f.after("edit", "anchor");
  assert.deepEqual(f.run().pending_actions, {});
  assert.equal((await f.inspect()).state, "working");
  assert.equal(await readFile(path.join(f.root, "counter.txt"), "utf8"), "single admitted fixture write\n");
}));

test("MCP media-save, screenshot and download requests serialize pending markers and enforce exact output paths", async () => fixture(async f => {
  const requests = [
    { name: "save_media", file: "media.png", args: { selector: "#fixture-media", min_bytes: 1 } },
    { name: "screenshot", file: "screen.png", args: { full_page: true } },
    { name: "download", file: "download.png", args: { ref: "fixture-download", min_bytes: 1 } },
  ];
  // Static local image bytes simulate the fake MCP's saved output; no browser or
  // remote generation is involved in journal/path verification.
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4S0AAAAASUVORK5CYII=", "base64");
  const guard = await ImmutabilityGuard({ client: f.client, directory: f.root, worktree: f.root });
  for (const request of requests) {
    const input = { tool: `cuddly-winner-browser_browser_${request.name}`, sessionID: "root", callID: `mcp-${request.name}` };
    await assert.rejects(f.hooks["tool.execute.before"](input, { args: { ...request.args, path: path.join(f.root, request.file) } }), /working checkpoint/);
  }
  await f.start();
  for (const request of requests) {
    const input = { tool: `cuddly-winner-browser_browser_${request.name}`, sessionID: "root", callID: `mcp-${request.name}` };
    const output = { args: { ...request.args, path: path.join(f.root, request.file) } };
    await f.hooks["tool.execute.before"](input, output);
    const pending = JSON.parse(JSON.stringify(f.run())).pending_actions;
    assert.deepEqual(pending[input.callID], { tool: input.tool, callID: input.callID });
    assert.deepEqual(f.updates.at(-1).metadata[CHECKPOINT].pending_actions, pending);
    assert.deepEqual(Object.keys(pending[input.callID]).sort(), ["callID", "tool"], "Tool arguments/output are not journal authority");
    await guard["tool.execute.before"](input, output);
    await assert.rejects(guard["tool.execute.before"](input, { args: { ...request.args, path: path.join(f.root, "outside.png") } }), /outside its declared edit paths/);
    await writeFile(output.args.path, bytes);
    await f.hooks["tool.execute.after"](input, { args: output.args, output: JSON.stringify({ path: output.args.path, size: bytes.length }) });
    assert.deepEqual(f.run().pending_actions, {});
    assert.deepEqual(await readFile(output.args.path), bytes);
    assert.equal(f.run().state, "working");
  }
  await f.load();
  assert.equal((await f.inspect()).state, "working");
  assert.equal(f.calls.length, 0);
}, { edit_paths: ["counter.txt", "readiness.json", "media.png", "screen.png", "download.png"] }));

test("MCP file-writer component errors clear undispatched guard rejections but preserve unknown outcomes", async () => {
  for (const name of ["save_media", "screenshot"]) for (const guarded of [true, false]) await fixture(async f => {
    await f.start();
    const guard = await ImmutabilityGuard({ client: f.client, directory: f.root, worktree: f.root });
    const input = { tool: `cuddly-winner-browser_browser_${name}`, sessionID: "root", callID: `component-${name}` };
    // filePath is a deliberately invalid serialized component field: browser
    // file-writers require their absolute `path` field.
    const output = { args: guarded ? { filePath: path.join(f.root, "capture.png") } : { path: path.join(f.root, "capture.png") } };
    await f.hooks["tool.execute.before"](input, output);
    let error;
    if (guarded) await assert.rejects(guard["tool.execute.before"](input, output), rejection => {
      assert.match(rejection.message, /^ImmutabilityGuard:.*unsupported target arguments/);
      error = rejection.message;
      return true;
    });
    else {
      await guard["tool.execute.before"](input, output);
      await writeFile(output.args.path, "partial fake MCP component output\n");
      error = "MCP component failed while acknowledging saved output; outcome unknown";
    }
    const part = { type: "tool", ...input, state: { status: "error", error } };
    f.append("root", [part]);
    await f.hooks.event({ event: { type: "message.part.updated", properties: { part } } });
    assert.equal(f.run().state, guarded ? "working" : "paused");
    assert.deepEqual(f.run().pending_actions, guarded ? {} : { [input.callID]: { tool: input.tool, callID: input.callID } });
    const updates = f.updates.length;
    await f.hooks["tool.execute.after"](input, {});
    assert.equal(f.updates.length, updates, "Error handling removes the active marker in both branches");
    if (guarded) await assert.rejects(readFile(path.join(f.root, "capture.png")), { code: "ENOENT" });
    else {
      assert.match(f.run().reason, /outcome unknown/);
      assert.equal(await readFile(output.args.path, "utf8"), "partial fake MCP component output\n");
    }
    await f.load();
    assert.equal((await f.inspect()).state, guarded ? "working" : "paused");
    assert.equal(f.calls.length, 0);
    assert.equal(f.continuations.length, 0);
  }, { edit_paths: ["counter.txt", "readiness.json", "capture.png"] });
});

test("confirmed guard rejection clears only the undispatched action without pausing root work", async () => fixture(async f => {
  await f.start();
  const admitted = f.run();
  const guard = await ImmutabilityGuard({ client: f.client, directory: f.root, worktree: f.root });
  const outside = path.join(f.root, "outside.txt");
  const input = { tool: "write", sessionID: "root", callID: "guard-rejected" };
  await f.before("edit", "other-active-action");
  await f.before(input.tool, input.callID);
  let rejection;
  await assert.rejects(guard["tool.execute.before"](input, { args: { filePath: outside } }), error => {
    assert.match(error.message, /^ImmutabilityGuard:.*outside its declared edit paths/);
    rejection = error.message;
    return true;
  });
  const part = { type: "tool", ...input, state: { status: "error", error: rejection } };
  f.append("root", [part]);
  // Real part-update events identify the session on the part, not necessarily
  // on event.properties. No write implementation or after hook was dispatched.
  await f.hooks.event({ event: { type: "message.part.updated", properties: { part } } });
  assert.equal(f.run().state, "working");
  assert.equal(f.run().reason, undefined);
  assert.equal(f.run().paused_after_user, undefined);
  assert.deepEqual(f.run().pending_actions, { "other-active-action": { tool: "edit", callID: "other-active-action" } });
  await assert.rejects(readFile(outside), { code: "ENOENT" });
  assert.equal(await readFile(path.join(f.root, "counter.txt"), "utf8"), "defective\n");
  const updates = f.updates.length;
  await f.after(input.tool, input.callID);
  await f.hooks.event({ event: { type: "message.part.updated", properties: { part } } });
  assert.equal(f.updates.length, updates, "The rejected caller's active marker is cleared and duplicate errors do nothing");
  assert.equal((await f.inspect()).state, "working", "The unrelated action remains live, not unknown");
  await f.after("edit", "other-active-action");
  assert.deepEqual(f.run().pending_actions, {});
  await f.load();
  assert.equal((await f.inspect()).state, "working");
  assert.deepEqual(f.run().initial_worktree, admitted.initial_worktree);
  await f.mutate("counter.txt", "repair after guard rejection\n");
  f.finish("The blocked tool was not dispatched; continue within policy");
  await f.event("session.idle");
  assert.equal(f.continuations.length, 1);
  assert.equal(f.calls.length, 0);
}));

test("native patch preflight rejections clear only their pending action and continue without human resumption", async () => fixture(async f => {
  await f.start();
  const admitted = f.run();
  await f.before("edit", "other-active-action");
  const errors = [
    "apply_patch verification failed: Error: Invalid patch format: missing Begin/End markers",
    "apply_patch verification failed: Error: Failed to find expected lines in counter.txt:\nmissing context",
    "apply_patch verification failed: Error: Failed to find expected lines in readiness.json:\nmissing definition",
    "Error: apply_patch verification failed: Failed to read file to update: readiness.json",
    "apply_patch verification failed: no hunks found",
    "patch rejected: empty patch",
    "patchText is required",
  ];
  for (const [index, error] of errors.entries()) {
    const callID = `rejected-patch-${index}`;
    await f.before("apply_patch", callID);
    const part = { type: "tool", tool: "apply_patch", sessionID: "root", callID,
      state: { status: "error", error } };
    f.append("root", [part]);
    await f.hooks.event({ event: { type: "message.part.updated", properties: { part } } });
    assert.equal(f.run().state, "working", error);
    assert.equal(f.run().paused_after_user, undefined);
    assert.deepEqual(f.run().pending_actions, { "other-active-action": { tool: "edit", callID: "other-active-action" } });
    assert.equal(await readFile(path.join(f.root, "counter.txt"), "utf8"), "defective\n");
    await assert.rejects(readFile(path.join(f.root, "readiness.json")), { code: "ENOENT" });
    const updates = f.updates.length;
    await f.after("apply_patch", callID);
    await f.hooks.event({ event: { type: "message.part.updated", properties: { part } } });
    assert.equal(f.updates.length, updates, "Late hooks and duplicate error receipts cannot clear another action");
    assert.equal((await f.inspect()).state, "working");
  }
  await f.after("edit", "other-active-action");
  await f.load();
  assert.equal((await f.inspect()).state, "working");
  for (const key of ["completion_target", "authorized_actions", "initial_worktree", "definition_sha256"]) {
    assert.deepEqual(f.run()[key], admitted[key], `${key} survives recoverable patch failures`);
  }
  f.finish("Rejected patches made no changes; correct the patch in this worker");
  await f.event("session.idle");
  assert.equal(f.continuations.length, 1);
  await f.implement();
  assert.equal((await f.evaluate()).state, "accepted");
  assert.equal(f.calls.length, 1, "Only the independent evaluator is a child");
}));

test("patch-like text in other tools and non-preflight patch errors remain unknown after partial mutation", async () => {
  for (const [tool, error, reportedTool = tool] of [
    ["bash", "apply_patch verification failed: Error: Invalid patch format: missing Begin/End markers"],
    ["bash", "apply_patch verification failed: no hunks found", "apply_patch"],
    ["write", "patch rejected: empty patch"],
    ["apply_patch", "EACCES: permission denied while writing the second file"],
    ["apply_patch", "Patch output lost after writing counter.txt"],
    ["apply_patch", "Tool failed after mutation: apply_patch verification failed: missing context"],
  ]) await fixture(async f => {
    await f.start();
    const callID = "unknown-action";
    await f.before(tool, callID);
    await writeFile(path.join(f.root, "counter.txt"), "partial mutation before the failure\n");
    const pending = f.run().pending_actions;
    const part = { type: "tool", tool: reportedTool, sessionID: "root", callID, state: { status: "error", error } };
    f.append("root", [part]);
    await f.hooks.event({ event: { type: "message.part.updated", properties: { part } } });
    assert.equal(f.run().state, "paused", `${tool}: ${error}`);
    assert.match(f.run().reason, /outcome unknown/);
    assert.deepEqual(f.run().pending_actions, pending);
    await f.after(tool, callID);
    await f.load();
    assert.equal((await f.inspect()).state, "paused");
    await assert.rejects(f.before("apply_patch", "replay"), /working checkpoint/);
    await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/);
    f.finish("The action effects are unknown; do not replay");
    await f.event("session.idle");
    assert.equal(f.continuations.length, 0);
    assert.equal(await readFile(path.join(f.root, "counter.txt"), "utf8"), "partial mutation before the failure\n");
  });
});

test("a known patch rejection cannot resume a separately cancelled or denied Goal", async () => {
  for (const stop of ["denial", "cancellation"]) await fixture(async f => {
    await f.start();
    await f.before("apply_patch", "rejected-after-stop");
    if (stop === "denial") await f.event("permission.replied", { reply: "reject" });
    else await f.event("session.error", { error: { name: "MessageAbortedError" } });
    const paused = f.run();
    const part = { type: "tool", tool: "apply_patch", sessionID: "root", callID: "rejected-after-stop",
      state: { status: "error", error: "apply_patch verification failed: no hunks found" } };
    await f.hooks.event({ event: { type: "message.part.updated", properties: { part } } });
    assert.equal(f.run().state, "paused");
    assert.deepEqual(f.run().pending_actions, {});
    for (const key of ["reason", "paused_at", "paused_after_user", "initial_worktree", "authorized_actions"]) {
      assert.deepEqual(f.run()[key], paused[key], `${key} retains the actual ${stop}`);
    }
    f.finish("Preflight failure does not override the user's stop");
    await f.event("session.idle");
    assert.equal(f.continuations.length, 0);
    await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/);
  });
});

test("patch rejection cleanup must persist before further mutation is permitted", async () => fixture(async f => {
  await f.start();
  await f.before("apply_patch", "unacknowledged-rejection");
  const original = clone(f.sessions.get("root")), update = f.client.session.update;
  f.client.session.update = async () => ({ data: clone(original) });
  const part = { type: "tool", tool: "apply_patch", sessionID: "root", callID: "unacknowledged-rejection",
    state: { status: "error", error: "apply_patch verification failed: no hunks found" } };
  try {
    await assert.rejects(f.hooks.event({ event: { type: "message.part.updated", properties: { part } } }), /checkpoint did not persist/);
  } finally { f.client.session.update = update; }
  assert.deepEqual(f.run().pending_actions, original.metadata[CHECKPOINT].pending_actions);
  await f.load();
  assert.equal((await f.inspect()).state, "paused");
  await assert.rejects(f.before("write", "cannot-assume-cleanup"), /working checkpoint/);
  assert.equal(await readFile(path.join(f.root, "counter.txt"), "utf8"), "defective\n");
}));

test("unknown active-action error parts retain receipts and pause until explicit reconciled resumption", async () => fixture(async f => {
  f.user("I authorize you to continue the offline counter task.");
  const authorizedUserID = f.history.get("root").at(-1).info.id;
  await f.start();
  const baseline = f.run().initial_worktree;
  await f.before("write", "unknown-write");
  const pending = f.run().pending_actions;
  await writeFile(path.join(f.root, "counter.txt"), "write completed before acknowledgement was lost\n");
  const part = { type: "tool", tool: "write", sessionID: "root", callID: "unknown-write",
    state: { status: "error", error: "Transport lost during action acknowledgement; outcome unknown" } };
  f.append("root", [part]);
  await f.hooks.event({ event: { type: "message.part.updated", properties: { part } } });
  assert.equal(f.run().state, "paused");
  assert.match(f.run().reason, /outcome unknown/);
  assert.equal(f.run().paused_after_user, authorizedUserID);
  assert.deepEqual(f.run().pending_actions, pending, "An error is not a completion receipt");
  const updates = f.updates.length;
  await f.after("write", "unknown-write");
  await f.hooks.event({ event: { type: "message.part.updated", properties: { part } } });
  assert.equal(f.updates.length, updates, "Clearing the active marker prevents late hooks from erasing the unknown journal");
  assert.deepEqual(f.run().pending_actions, pending);
  f.finish("The write returned an unknown error");
  await f.event("session.idle");
  assert.equal(f.continuations.length, 0);
  await f.load();
  assert.equal((await f.inspect()).state, "paused");
  await assert.rejects(f.before("write", "replay"), /working checkpoint/);
  await assert.rejects(f.evaluate(), /active task actions\/evaluation/);
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/);
  const receipt = await f.inspectFile("root", "counter.txt");
  assert.equal(receipt, "write completed before acknowledgement was lost\n");
  f.user("I inspected counter.txt: the prior write completed. Resume without replaying it.");
  assert.equal((await f.invoke("goal_run", { operation: "resume", reconciled: true })).state, "working");
  assert.deepEqual(f.run().pending_actions, {});
  assert.deepEqual(f.run().initial_worktree, baseline);
  assert.equal(await readFile(path.join(f.root, "counter.txt"), "utf8"), receipt);
  assert.equal(f.calls.length, 0);
  assert.equal(f.continuations.length, 0);
}));

test("late observed denial upgrades an unknown root-action stop without changing its user boundary", async () => {
  for (const type of ["permission.replied", "session.error"]) await fixture(async f => {
    f.user("I authorize you to continue the offline counter task.");
    const authorizedUserID = f.history.get("root").at(-1).info.id;
    await f.start();
    await f.before("write", "denial-ordering");
    await writeFile(path.join(f.root, "counter.txt"), "partial action receipt before permission event\n");
    const part = { type: "tool", tool: "write", sessionID: "root", callID: "denial-ordering",
      state: { status: "error", error: "Tool acknowledgement failed; action outcome unknown" } };
    f.append("root", [part]);
    await f.hooks.event({ event: { type: "message.part.updated", properties: { part } } });
    const unknown = f.run();
    assert.equal(unknown.state, "paused");
    assert.match(unknown.reason, /outcome unknown/);
    assert.equal(unknown.paused_after_user, authorizedUserID);
    f.user("What is the current status?");
    await f.event(type, type === "permission.replied" ? { reply: "reject" } : { error: { name: "PermissionRejectedError" } });
    const denied = f.run();
    assert.equal(denied.state, "paused");
    assert.match(denied.reason, /^Observed permission denial/);
    assert.equal(denied.paused_after_user, authorizedUserID, "Upgrading the reason must not move the first-pause boundary");
    assert.deepEqual(denied.pending_actions, unknown.pending_actions);
    assert.deepEqual(denied.initial_worktree, unknown.initial_worktree);
    assert.equal(denied.authorized_actions, unknown.authorized_actions);
    await f.load();
    assert.equal((await f.inspect()).reason, denied.reason);
    assert.deepEqual(f.run(), denied, "Reload/inspection must retain the actual denial and unknown-action evidence");
    f.finish("Permission denial is incomplete, not accepted");
    await f.event("session.idle");
    await assert.rejects(f.before("write", "replay-denied-action"), /working checkpoint/);
    await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/);
    assert.equal(await readFile(path.join(f.root, "counter.txt"), "utf8"), "partial action receipt before permission event\n");
    assert.equal(f.continuations.length, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(f.run().accepted_candidate, undefined);
  });
});

test("explicit root cancellation upgrades a generic unknown stop and preserves the original pause boundary", async () => fixture(async f => {
  await f.start();
  const authorizedUserID = f.history.get("root").at(-1).info.id;
  await f.before("write", "cancel-ordering");
  await writeFile(path.join(f.root, "counter.txt"), "unknown action receipt before cancellation\n");
  const part = { type: "tool", tool: "write", sessionID: "root", callID: "cancel-ordering",
    state: { status: "error", error: "Transport interrupted; action outcome unknown" } };
  f.append("root", [part]);
  await f.hooks.event({ event: { type: "message.part.updated", properties: { part } } });
  const unknown = f.run();
  assert.equal(unknown.state, "paused");
  assert.match(unknown.reason, /outcome unknown/);
  f.user("Cancel this Goal. Do not resume.");
  await f.event("session.error", { error: { name: "MessageAbortedError" } });
  const cancelled = f.run();
  assert.equal(cancelled.state, "paused");
  assert.match(cancelled.reason, /^Observed cancellation/);
  assert.equal(cancelled.paused_after_user, authorizedUserID);
  assert.deepEqual(cancelled.pending_actions, unknown.pending_actions);
  assert.deepEqual(cancelled.initial_worktree, unknown.initial_worktree);
  await f.load();
  assert.equal((await f.inspect()).reason, cancelled.reason);
  f.finish("The user cancelled the already-interrupted Goal");
  await f.event("session.idle");
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/);
  assert.equal(await readFile(path.join(f.root, "counter.txt"), "utf8"), "unknown action receipt before cancellation\n");
  assert.equal(f.continuations.length, 0);
  assert.equal(f.calls.length, 0);
}));

test("completed bash checks with ordinary failing results clear their journal without pausing", async () => fixture(async f => {
  await f.start();
  await f.before("bash", "counter-check");
  const counter = await readFile(path.join(f.root, "counter.txt"), "utf8");
  assert.notEqual(counter, "good\n");
  const part = { type: "tool", tool: "bash", sessionID: "root", callID: "counter-check",
    state: { status: "completed", output: `Assertion failed: expected good\\n, got ${JSON.stringify(counter)}; exit code 1. Test rejected input: expected cancelled job, got running.` } };
  f.append("root", [part]);
  await f.hooks.event({ event: { type: "message.part.updated", properties: { part } } });
  assert.equal(f.run().state, "working");
  assert.ok(f.run().pending_actions[part.callID], "Completed part updates do not substitute for the after hook");
  await f.after("bash", part.callID);
  assert.deepEqual(f.run().pending_actions, {});
  assert.equal((await f.inspect()).state, "working");
  assert.equal(f.run().paused_after_user, undefined);
  f.finish("The offline counter check failed; repair it");
  await f.event("session.idle");
  assert.equal(f.continuations.length, 1);
  assert.equal(f.calls.length, 0);
}));

test("metadata writes must be acknowledged and actually persisted before admission or mutation", async () => {
  for (const phase of ["start", "write"]) await fixture(async f => {
    if (phase === "write") await f.start();
    const original = clone(f.sessions.get("root"));
    f.client.session.update = async () => ({ data: clone(original) });
    if (phase === "start") await assert.rejects(f.start(), /checkpoint did not persist/);
    else await assert.rejects(f.before("write", "not-persisted"), /checkpoint did not persist/);
    assert.deepEqual(f.sessions.get("root"), original);
    assert.equal(f.run()?.pending_actions["not-persisted"], undefined);
    assert.equal(f.calls.length, 0);
    assert.equal(await readFile(path.join(f.root, "counter.txt"), "utf8"), "defective\n");
  });
});

test("evaluation refuses active writes without pausing the live action", async () => fixture(async f => {
  await f.start();
  await f.before("write", "pending");
  const pending = f.run().pending_actions;
  const result = await f.evaluate().catch(error => {
    assert.match(error.message, /active task actions/);
  });
  assert.equal(f.calls.length, 0);
  assert.equal(f.run().state, "working", "Invalid evaluation must not pause a live worker action");
  assert.deepEqual(f.run().pending_actions, pending);
  assert.equal(result?.validation, undefined);
  await f.after("write", "pending");
  assert.deepEqual(f.run().pending_actions, {});
}));

test("root writes cannot overlap an active independent evaluation", async () => fixture(async f => {
  await f.start();
  const entered = gate(), release = gate();
  f.setProvider(async input => { entered.release(); await release.promise; return f.inspectCandidate(input); });
  const evaluation = f.evaluate("feedback");
  await entered.promise;
  try { await assert.rejects(f.before("write", "overlap"), /working checkpoint/); }
  finally { release.release(); }
  assert.equal((await evaluation).state, "working");
  assert.equal(f.run().pending_actions.overlap, undefined);
}));

test("reload marks an in-flight root action unknown and never replays it", async () => fixture(async f => {
  await f.start();
  const baseline = f.run().initial_worktree;
  await f.before("write", "external-action");
  await writeFile(path.join(f.root, "counter.txt"), "action actually completed\n");
  await f.load();
  const result = await f.inspect();
  assert.equal(result.state, "paused");
  assert.match(result.reason, /outcome unknown/);
  assert.ok(result.pending_actions["external-action"]);
  f.finish();
  await f.event("session.idle");
  assert.equal(f.continuations.length, 0);
  await assert.rejects(f.before("write", "replay"), /working checkpoint/);
  f.user("I inspected the file: the action completed. Resume without replaying it.");
  assert.equal((await f.invoke("goal_run", { operation: "resume", reconciled: true })).state, "working");
  assert.deepEqual(f.run().pending_actions, {});
  assert.deepEqual(f.run().initial_worktree, baseline);
  assert.equal(await readFile(path.join(f.root, "counter.txt"), "utf8"), "action actually completed\n");
  assert.equal(f.calls.length, 0);
}));

test("reload pauses an unknown evaluator instead of accepting a completed child report", async () => fixture(async f => {
  await f.start();
  await f.implement();
  const entered = gate(), release = gate();
  f.setProvider(async input => { await f.inspectCandidate(input); entered.release(); await release.promise; return { data: { info: {} } }; });
  const evaluating = f.evaluate();
  await entered.promise;
  try {
    await f.load();
    assert.equal((await f.inspect()).state, "paused");
    assert.equal(f.run().validation, undefined);
    assert.equal(f.run().accepted_candidate, undefined);
    f.finish();
    await f.event("session.idle");
    assert.equal(f.continuations.length, 0);
  } finally { release.release(); }
  assert.equal((await evaluating).state, "paused");
  assert.equal(f.calls.length, 1);
}));

test("observed cancellation and permission denial pause root work and abort active evaluators", async () => {
  for (const incident of ["cancel", "deny", "error"]) await fixture(async f => {
    await f.start();
    f.setProvider(async input => {
      await f.event(incident === "deny" ? "permission.replied" : "session.error", { sessionID: input.path.id,
        ...(incident === "deny" ? { reply: "reject" } : { error: { name: incident === "cancel" ? "MessageAbortedError" : "APIError" } }) });
      await assert.rejects(f.hooks.tool.goal_verdict.execute(checked(true), { ...f.context, sessionID: input.path.id }), /paused or no longer active/);
      return { data: { info: { error: { name: "MessageAbortedError" } } } };
    });
    assert.equal((await f.evaluate()).state, "paused");
    assert.ok(f.aborts.includes(f.calls[0].id));
    f.finish();
    await f.event("session.idle");
    assert.equal(f.continuations.length, 0);
    await assert.rejects(f.before(), /working checkpoint/);
  });
});

test("late permission events resolve an unregistered evaluator through its actual parent session", async () => {
  for (const reload of [false, true]) await fixture(async f => {
    await f.start();
    assert.equal((await f.evaluate("feedback")).state, "working");
    const childID = f.calls[0].id;
    const working = f.run();
    assert.equal(f.sessions.get(childID).parentID, "root");
    assert.equal(working.evaluation, undefined);
    await assert.rejects(f.hooks.tool.goal_verdict.execute(checked(true), { ...f.context, sessionID: childID }), /active independent evaluator/,
      "The completed child has already been removed from the active evaluator map");
    if (reload) await f.load();
    await f.event("permission.replied", { sessionID: childID, reply: "reject" });
    const denied = f.run();
    assert.equal(denied.state, "paused");
    assert.match(denied.reason, /^Observed permission denial/);
    assert.equal(denied.paused_after_user, f.history.get("root")[0].info.id);
    assert.deepEqual(denied.feedback, working.feedback);
    assert.deepEqual(denied.initial_worktree, working.initial_worktree);
    assert.equal(f.sessions.get(childID).metadata?.[CHECKPOINT], undefined, "The child must not acquire root Goal state");
    await f.event("session.error", { sessionID: childID, error: { name: "MessageAbortedError" } });
    assert.deepEqual(f.run(), denied, "A late child cancellation cannot replace the actual denial");
    await f.load();
    assert.equal((await f.inspect()).reason, denied.reason);
    f.finish("Late evaluator permission rejection requires reconciliation");
    await f.event("session.idle");
    assert.equal(f.calls.length, 1);
    assert.equal(f.prompts.length, 1);
    assert.equal(f.continuations.length, 0);
    assert.equal(f.run().accepted_candidate, undefined);
  });
});

test("cancellation induced by aborting a denied evaluator cannot overwrite the permission denial", async () => fixture(async f => {
  await f.start();
  const authorizedUserID = f.history.get("root")[0].info.id;
  const abort = f.client.session.abort;
  let cancelledChildID;
  f.client.session.abort = async input => {
    const result = await abort(input);
    cancelledChildID = input.path.id;
    // Model the child cancellation causally emitted by the runtime's abort,
    // while its evaluator registration is still active.
    await f.event("session.error", { sessionID: input.path.id, error: { name: "MessageAbortedError" } });
    return result;
  };
  f.setProvider(async input => {
    await f.inspectFile(input.path.id, "counter.txt");
    await f.event("permission.replied", { sessionID: input.path.id, reply: "reject" });
    await assert.rejects(f.hooks.tool.goal_verdict.execute(checked(true), { ...f.context, sessionID: input.path.id }), /paused or no longer active/);
    return { data: { info: { error: { name: "MessageAbortedError" } } } };
  });
  const result = await f.evaluate("feedback");
  const denied = f.run();
  assert.equal(result.state, "paused");
  assert.match(result.reason, /^Observed permission denial/);
  assert.equal(denied.reason, result.reason);
  assert.equal(denied.paused_after_user, authorizedUserID);
  assert.equal(cancelledChildID, f.calls[0].id);
  assert.deepEqual(f.aborts, [cancelledChildID], "Aborting the child must not start a recursive cancellation/abort chain");
  await assert.rejects(f.hooks.tool.goal_verdict.execute(checked(true), { ...f.context, sessionID: cancelledChildID }), /active independent evaluator/);
  await f.event("session.error", { sessionID: cancelledChildID, error: { name: "MessageAbortedError" } });
  assert.deepEqual(f.run(), denied, "Denial also retains priority after evaluator map cleanup");
  await f.load();
  await f.event("session.error", { sessionID: cancelledChildID, error: { name: "MessageAbortedError" } });
  assert.deepEqual(f.run(), denied, "Actual parent ancestry retains the denial across reload");
  assert.equal((await f.inspect()).reason, denied.reason);
  assert.equal(f.run().accepted_candidate, undefined);
  f.finish("Permission denial remains authoritative over abort side effects");
  await f.event("session.idle");
  assert.equal(f.continuations.length, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.prompts.length, 1);
}));

test("abort signal aborts the evaluator and cannot turn interruption into acceptance", async () => fixture(async f => {
  await f.start();
  f.setProvider(async () => { f.controller.abort(); return { data: { info: { error: { name: "MessageAbortedError" } } } }; });
  assert.equal((await f.evaluate()).state, "paused");
  assert.ok(f.aborts.includes(f.calls[0].id));
  f.finish();
  await f.event("session.idle");
  assert.equal(f.continuations.length, 0);
}));

test("late completed report after signal cancellation cannot accept the candidate", async () => fixture(async f => {
  await f.start();
  await f.implement();
  f.setProvider(async input => { await f.inspectCandidate(input); f.controller.abort(); return { data: { info: {} } }; });
  assert.equal((await f.evaluate()).state, "paused");
  assert.equal(f.run().accepted_candidate, undefined);
  assert.equal(f.run().validation, undefined);
}));

test("root denial survives reload; ordinary domain failures do not imply denial", async () => fixture(async f => {
  await f.start();
  f.record("root", "bash", "test rejected input: expected cancelled job, got running", "error");
  f.finish();
  await f.event("session.idle");
  assert.equal(f.run().state, "working");
  assert.equal(f.continuations.length, 1);
  await f.event("permission.replied", { reply: "reject" });
  assert.match(f.run().reason, /permission denial/);
  await f.load();
  f.finish();
  await f.event("session.idle");
  assert.equal(f.run().state, "paused");
  assert.equal(f.continuations.length, 1);
}));

test("unknown evaluator creation and prompt outcomes pause without automatic replay", async () => {
  for (const failure of ["create-error", "create-missing", "prompt-error", "prompt-throw", "assistant-error", "messages-error"]) await fixture(async f => {
    await f.start();
    if (failure.startsWith("create")) f.client.session.create = async () => failure === "create-error" ? { error: "connection lost" } : { data: {} };
    else if (failure === "messages-error") {
      const messages = f.client.session.messages;
      f.client.session.messages = async input => input.path.id === "root" ? messages(input) : { error: "evidence inaccessible" };
    } else f.setProvider(async () => {
      if (failure === "prompt-throw") throw new Error("Transport lost; outcome unknown");
      return failure === "prompt-error" ? { error: "connection lost" } : { data: { info: { error: { name: "APIError" } } } };
    });
    assert.equal((await f.evaluate()).state, "paused", failure);
    assert.ok(f.prompts.length <= 1, "Unknown requests must not be repeated");
    f.finish();
    await f.event("session.idle");
    await f.load();
    await f.event("session.idle");
    assert.equal(f.continuations.length, 0);
    assert.equal(f.run().accepted_candidate, undefined);
  });
});

test("evaluation API failures retain only safe error kind and reference without response headers or secret values", async () => {
  const cases = [
    { name: "APIError", ref: "err_case1", expected: "APIError err_case1", wire: "error" },
    { name: "ProviderError", ref: "err_case2", expected: "ProviderError err_case2", wire: "assistant" },
    { name: "APIError", ref: "err_case3?fixture-secret-reference", expected: "APIError", wire: "error" },
    { name: "APIError/fixture-secret-kind", ref: "fixture-secret-reference", expected: "missing or failed response", wire: "assistant" },
  ];
  for (const scenario of cases) await fixture(async f => {
    await f.start();
    const error = { name: scenario.name, message: "fixture-secret-message", data: {
      ref: scenario.ref, apiKey: "fixture-secret-api-key", responseBody: "fixture-secret-response-body",
      headers: { authorization: "fixture-secret-authorization", cookie: "fixture-secret-cookie" },
      responseHeaders: { "set-cookie": "fixture-secret-set-cookie" },
    }, requestHeaders: { authorization: "fixture-secret-request-header" } };
    f.setProvider(async () => scenario.wire === "error" ? { error: clone(error) } : { data: { info: { error: clone(error) } } });
    const result = await f.evaluate("feedback");
    assert.equal(result.state, "paused");
    assert.equal(result.reason,
      `Evaluator interrupted or its API outcome unknown (${scenario.expected}); inspect its recorded outcome before resuming.`);
    assert.equal(f.run().reason, result.reason);
    const stored = JSON.stringify({ result, run: f.run(), updates: f.updates, continuations: f.continuations });
    assert.doesNotMatch(stored, /fixture-secret-|responseHeaders|requestHeaders|authorization|set-cookie/,
      "Raw API payloads must not enter the result or durable pause metadata");
    assert.equal(f.run().accepted_candidate, undefined);
    assert.equal(f.calls.length, 1);
    assert.equal(f.prompts.length, 1);
    await f.load();
    assert.equal((await f.inspect()).reason, result.reason);
    f.finish("Inspect the recorded API failure before resumption");
    await f.event("session.idle");
    assert.equal(f.calls.length, 1);
    assert.equal(f.prompts.length, 1);
    assert.equal(f.continuations.length, 0);
  });
});

test("missing prompt response data is an unknown API outcome, not an evaluator protocol retry", async () => fixture(async f => {
  await f.start();
  f.setProvider(async () => ({}));
  assert.equal((await f.evaluate()).state, "paused");
  assert.equal(f.prompts.length, 1);
  assert.equal(f.run().accepted_candidate, undefined);
}));

test("unknown continuation dispatch journals its caller ID before submission and never auto-replays", async () => fixture(async f => {
  await f.start();
  const dispatches = [];
  f.client.session.promptAsync = async input => {
    assert.equal(f.run().continuation.messageID, input.body.messageID);
    dispatches.push(clone(input));
    return { error: "delivery unknown" };
  };
  f.finish();
  await f.event("session.idle");
  assert.equal(f.run().state, "paused");
  assert.match(f.run().reason, /outcome unknown/);
  await f.load();
  await f.event("session.idle");
  assert.equal(dispatches.length, 1);
  assert.match(dispatches[0].body.messageID, /^msg_/);
}));

test("unconfirmed continuation receipt after reload pauses instead of dispatching again", async () => fixture(async f => {
  await f.start();
  const sent = [];
  f.client.session.promptAsync = async input => { sent.push(input); return { response: { status: 204 } }; };
  f.finish();
  await f.event("session.idle");
  assert.equal(f.run().state, "working");
  assert.equal(f.run().continuation.messageID, sent[0].body.messageID);
  await f.load();
  await f.event("session.idle");
  assert.equal(f.run().state, "paused");
  assert.match(f.run().reason, /dispatch outcome unknown/);
  assert.equal(sent.length, 1);
}));

test("fresh-plugin inspection or mutation preflight pauses an unreceipted continuation before any side effect", async () => {
  for (const first of ["inspect", "mutation"]) await fixture(async f => {
    await f.start();
    const original = await readFile(path.join(f.root, "counter.txt"));
    const sent = [];
    f.client.session.promptAsync = async input => { sent.push(clone(input)); return { response: { status: 204 } }; };
    f.finish("Continue partial implementation");
    await f.event("session.idle");
    const intent = f.run().continuation;
    assert.equal(intent.messageID, sent[0].body.messageID);
    assert.equal(f.history.get("root").some(message => message.info.id === intent.messageID), false);
    await f.load();
    // No idle event is delivered after reload: inspection and preflight must
    // themselves reconcile the uncertain dispatch before permitting work.
    if (first === "inspect") {
      const inspection = await f.inspect();
      assert.equal(inspection.state, "paused");
      assert.match(inspection.reason, /Continuation dispatch outcome unknown/);
    } else await assert.rejects(f.mutate("counter.txt", "unsafe replay\n", "before-dispatch-reconciliation"), /working checkpoint/);
    assert.equal(f.run().state, "paused");
    assert.match(f.run().reason, /Continuation dispatch outcome unknown/);
    assert.deepEqual(f.run().pending_actions, {});
    assert.deepEqual(await readFile(path.join(f.root, "counter.txt")), original);
    await assert.rejects(f.before("write", "another-replay"), /working checkpoint/);
    await assert.rejects(f.evaluate(), /active task actions\/evaluation/);
    assert.equal(sent.length, 1);
    assert.equal(f.calls.length, 0);
    assert.equal(f.prompts.length, 0);
  });
});

test("fresh-plugin reconciliation clears a receipted continuation without replaying the dispatch", async () => fixture(async f => {
  await f.start();
  f.finish();
  await f.event("session.idle");
  const before = f.run(), messageID = before.continuation.messageID;
  assert.ok(f.history.get("root").some(message => message.info.id === messageID && message.info.role === "user"));
  await f.load();
  const inspection = await f.inspect();
  assert.equal(inspection.state, "working");
  assert.equal(f.run().continuation, undefined);
  assert.equal(f.run().reason, undefined);
  assert.deepEqual(f.run().initial_worktree, before.initial_worktree);
  assert.equal(f.run().authorized_actions, before.authorized_actions);
  assert.equal(f.continuations.length, 1);
  assert.equal(f.calls.length, 0);
  await f.mutate("counter.txt", "repair after known delivery\n");
  assert.equal(await readFile(path.join(f.root, "counter.txt"), "utf8"), "repair after known delivery\n");
  assert.equal(f.run().state, "working");
  assert.equal(f.continuations.length, 1, "Reconciliation does not repeat promptAsync");
}));

test("inspection during live continuation dispatch does not mistake its missing receipt for an interruption", { timeout: 5000 }, async () => fixture(async f => {
  await f.start();
  const entered = gate(), acknowledge = gate(), submit = f.client.session.promptAsync;
  let messageID;
  f.client.session.promptAsync = async input => {
    messageID = input.body.messageID;
    entered.release();
    await acknowledge.promise;
    return submit(input);
  };
  f.finish();
  const dispatch = Promise.allSettled([f.event("session.idle")]);
  await entered.promise;
  try {
    const live = f.run(), updates = f.updates.length;
    assert.equal(live.continuation.messageID, messageID);
    assert.equal(f.history.get("root").some(message => message.info.id === messageID), false);
    assert.equal((await f.inspect()).state, "working");
    assert.deepEqual(f.run(), live, "A live dispatcher owns the pending receipt");
    assert.equal(f.updates.length, updates);
    await f.event("session.idle");
    assert.equal(f.continuations.length, 0, "Concurrent idle cannot submit a second prompt");
  } finally { acknowledge.release(); await dispatch; }
  assert.equal(f.continuations.length, 1);
  await f.load();
  assert.equal((await f.inspect()).state, "working");
  assert.equal(f.run().continuation, undefined);
  assert.equal(f.continuations.length, 1);
}));

test("accepted state is terminal across reload and creates no extra evaluation or continuation", async () => fixture(async f => {
  await f.start();
  await f.implement();
  assert.equal((await f.evaluate()).state, "accepted");
  const accepted = f.run();
  await f.load();
  assert.equal((await f.inspect()).acceptance_current, true);
  assert.equal((await f.evaluate()).state, "accepted");
  assert.equal((await f.invoke("goal_run", { operation: "pause" })).state, "accepted");
  f.finish("Goal complete");
  await f.event("session.idle");
  await assert.rejects(f.before(), /working checkpoint/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.continuations.length, 0);
  assert.deepEqual(f.run(), accepted);
  await writeFile(path.join(f.root, "counter.txt"), "later unrelated mutation\n");
  assert.equal((await f.inspect()).acceptance_current, false, "Historical acceptance must not claim changed bytes are current");
  assert.equal(f.calls.length, 1);
}));

test("unadmitted or invalid start cannot mutate, evaluate or dispatch work", async () => {
  for (const args of [{ completion_target: undefined }, { authorized_actions: " " }, { completion_target: "x".repeat(4001) }]) await fixture(async f => {
    await assert.rejects(f.start(args), /Start requires/);
    assert.equal(f.run(), undefined);
    await assert.rejects(f.before(), /working checkpoint/);
    await assert.rejects(f.evaluate(), /Start the matching Goal/);
    f.finish();
    await f.event("session.idle");
    assert.equal(f.calls.length, 0);
    assert.equal(f.continuations.length, 0);
    assert.equal(f.updates.length, 0);
  });
});

test("invalid evaluation paths, absent focus and missing model fail before child creation", async () => fixture(async f => {
  await f.start();
  for (const args of [{ mode: "unknown" }, { artifacts: [] }, { artifacts: ["../escape"] }, { artifacts: ["a//b"] },
    { artifacts: Array(257).fill("counter.txt") }, { mode: "feedback", focus: " " }]) {
    await assert.rejects(f.evaluate("final", args), /canonical candidate|feedback focus/);
  }
  await symlink(path.join(f.root, "counter.txt"), path.join(f.root, "link.txt"));
  await assert.rejects(f.evaluate("final", { artifacts: ["link.txt"] }), /Candidate evidence unavailable/);
  delete f.history.get("root")[0].info.model;
  await assert.rejects(f.evaluate(), /selected worker model/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.run().state, "working");
}));

test("retired Goal definitions and historical coordinator runs fail closed", async () => {
  for (const legacy of ["options-missing", "old-runtime", "historical-run"]) await fixture(async f => {
    const file = path.join(f.root, ".opencode/agents/generated/fix-counter.md");
    if (legacy === "options-missing") await writeFile(file, (await readFile(file, "utf8")).replace(/^options: .*\n/m, ""));
    if (legacy === "old-runtime") await writeFile(file, (await readFile(file, "utf8")).replace(RUNTIME, "goal-criterion-readiness-v1"));
    if (legacy === "historical-run") f.record("root", "goal_cycle", JSON.stringify({ status: "blocked", reason: "Historical task limit reached" }));
    await assert.rejects(f.start(), /Retired coordinator|Historical coordinator/);
    await assert.rejects(f.before(), /Retired coordinator|working checkpoint/);
    assert.equal(f.run(), undefined);
    f.finish();
    await f.event("session.idle");
    assert.equal(f.calls.length, 0);
    assert.equal(f.continuations.length, 0);
  });
});

test("malformed persisted state fails closed rather than being silently readmitted", async () => fixture(async f => {
  f.sessions.get("root").metadata[CHECKPOINT] = { ...working(), state: "invalid" };
  assert.equal((await f.inspect()).state, "unknown");
  await assert.rejects(f.start(), /Invalid Goal checkpoint/);
  await assert.rejects(f.before(), /Invalid Goal checkpoint/);
  assert.equal(f.sessions.get("root").metadata[CHECKPOINT].state, "invalid");
  assert.equal(f.updates.length, 0);
}));

test("native Plan and Build remain isolated, even while inspecting recorded Goal evidence", async () => {
  for (const agent of ["plan", "build"]) await fixture(async f => {
    f.user("Native session", agent);
    await f.before("write", "native-write");
    await f.after("write", "native-write");
    f.finish();
    await f.event("session.idle");
    const compacting = { context: [] };
    await f.hooks["experimental.session.compacting"]({ sessionID: "root" }, compacting);
    const automatic = { enabled: true };
    await f.hooks["experimental.compaction.autocontinue"]({ sessionID: "root" }, automatic);
    assert.deepEqual(compacting.context, []);
    assert.equal(automatic.enabled, true);
    await assert.rejects(f.start(), /Select the root persistent Goal/);
    assert.equal(f.updates.length, 0);
    f.user("Select the Goal");
    await f.start();
    await f.evaluate();
    const before = f.run(), updates = f.updates.length;
    f.user("Inspect Goal findings", agent);
    const inspection = await f.inspect();
    assert.equal(inspection.selected_agent, agent);
    assert.equal(inspection.goal_agent, "fix-counter");
    assert.equal(inspection.validation.checks.c0.passed, false);
    await f.before("write", "native-again");
    f.finish();
    await f.event("session.idle");
    await assert.rejects(f.evaluate(), /selected root Goal/);
    assert.deepEqual(f.run(), before);
    assert.equal(f.updates.length, updates);
    assert.equal(f.continuations.length, 0);
  });
});

test("historical Goal metadata does not take over native Plan or Build compaction", async () => {
  for (const agent of ["plan", "build"]) await fixture(async f => {
    await f.start();
    f.user("Continue as the native agent", agent);
    const original = f.run();
    const compacting = { context: ["Native context"] }, automatic = { enabled: true };
    await f.hooks["experimental.session.compacting"]({ sessionID: "root" }, compacting);
    await f.hooks["experimental.compaction.autocontinue"]({ sessionID: "root" }, automatic);
    assert.equal(automatic.enabled, true, "Native automatic continuation must retain its existing owner");
    assert.deepEqual(compacting.context, ["Native context"]);
    assert.deepEqual(f.run(), original);
    assert.equal(f.continuations.length, 0);
  });
});

test("child sessions cannot admit a root Goal or independently dispatch worker continuation", async () => fixture(async f => {
  f.sessions.get("root").parentID = "parent";
  await assert.rejects(f.start(), /root persistent Goal/);
  await f.before("write", "child-owned-by-other-guard");
  f.finish();
  await f.event("session.idle");
  assert.equal(f.updates.length, 0);
  assert.equal(f.continuations.length, 0);
}));

test("compaction preserves findings and gives automatic continuation a single owner", async () => fixture(async f => {
  await f.start();
  await f.evaluate();
  const original = f.run();
  const output = { context: ["Native compaction context"] };
  await f.hooks["experimental.session.compacting"]({ sessionID: "root" }, output);
  assert.equal(output.context[0], "Native compaction context");
  assert.match(output.context[1], /checkpoint remains authoritative.*State=working/);
  assert.match(output.context[1], /defective/);
  const automatic = { enabled: true };
  await f.hooks["experimental.compaction.autocontinue"]({ sessionID: "root" }, automatic);
  assert.equal(automatic.enabled, false);
  assert.deepEqual(f.run(), original);
  f.finish("Compaction summary does not accept the Goal", { summary: true });
  await Promise.all([f.event("session.idle"), f.event("session.idle"), f.event("session.idle")]);
  assert.equal(f.continuations.length, 1);
  assert.equal(f.calls.length, 1, "Compaction must not start another evaluator");
}));

test("paused compaction admits fresh status conversation without resuming authority or generating Goal nudges", async () => fixture(async f => {
  await f.start();
  f.finish("Partial work remains");
  await f.event("session.idle");
  const actualContinuation = f.continuations[0].body.parts[0].text;
  await f.invoke("goal_run", { operation: "pause", reason: "Inspect uncertain outcomes" });
  const paused = f.run(), updates = f.updates.length, dispatched = f.continuations.length;
  const noHuman = { enabled: true };
  await f.hooks["experimental.compaction.autocontinue"]({ sessionID: "root" }, noHuman);
  assert.equal(noHuman.enabled, false, "An old authorization or synthetic continuation does not restart core processing");
  f.user("Resume the Goal", "fix-counter", true);
  const synthetic = { enabled: true };
  await f.hooks["experimental.compaction.autocontinue"]({ sessionID: "root" }, synthetic);
  assert.equal(synthetic.enabled, false);
  f.user(actualContinuation, "fix-counter", false);
  const echoedContinuation = { enabled: true };
  await f.hooks["experimental.compaction.autocontinue"]({ sessionID: "root" }, echoedContinuation);
  assert.equal(echoedContinuation.enabled, false, "The real continuation text cannot masquerade as new human authorization");
  assert.deepEqual(f.run(), paused);
  f.user("What is the status of this paused Goal?");
  const conversation = { enabled: true };
  await f.hooks["experimental.compaction.autocontinue"]({ sessionID: "root" }, conversation);
  assert.equal(conversation.enabled, true, "Native core may answer a fresh human status question");
  const alreadyDisabled = { enabled: false };
  await f.hooks["experimental.compaction.autocontinue"]({ sessionID: "root" }, alreadyDisabled);
  assert.equal(alreadyDisabled.enabled, false, "Goal hooks must not force native core continuation on");
  await assert.rejects(f.invoke("goal_run", { operation: "resume", reconciled: true }), /Explicit user resumption/);
  await assert.rejects(f.before("write", "status-is-not-authority"), /working checkpoint/);
  assert.deepEqual(f.run(), paused);
  assert.equal(f.updates.length, updates);
  f.finish("Status answered; work remains paused", { summary: true });
  await f.event("session.idle");
  await f.load();
  await f.event("session.idle");
  assert.equal(f.continuations.length, dispatched);
  assert.equal(f.run().state, "paused");
  assert.equal(f.calls.length, 0);
}));

test("working and evaluating compaction have one continuation owner; accepted allows only native final reporting", { timeout: 5000 }, async () => fixture(async f => {
  await f.start();
  f.user("What is the current status?");
  const workingRun = f.run(), workingUpdates = f.updates.length;
  const workingCore = { enabled: true };
  await f.hooks["experimental.compaction.autocontinue"]({ sessionID: "root" }, workingCore);
  assert.equal(workingCore.enabled, false);
  assert.deepEqual(f.run(), workingRun);
  assert.equal(f.updates.length, workingUpdates);
  await f.implement();
  const entered = gate(), release = gate();
  f.setProvider(async request => { entered.release(); await release.promise; return f.inspectCandidate(request); });
  const settled = Promise.allSettled([f.evaluate()]);
  await entered.promise;
  try {
    const evaluating = f.run(), updates = f.updates.length;
    assert.equal(evaluating.state, "evaluating");
    const evaluatingCore = { enabled: true };
    await f.hooks["experimental.compaction.autocontinue"]({ sessionID: "root" }, evaluatingCore);
    assert.equal(evaluatingCore.enabled, false);
    assert.deepEqual(f.run(), evaluating);
    assert.equal(f.updates.length, updates);
  } finally { release.release(); await settled; }
  const [evaluation] = await settled;
  assert.equal(evaluation.status, "fulfilled");
  assert.equal(evaluation.value.state, "accepted");
  const accepted = f.run(), updates = f.updates.length;
  const finalReport = { enabled: true };
  await f.hooks["experimental.compaction.autocontinue"]({ sessionID: "root" }, finalReport);
  assert.equal(finalReport.enabled, true, "Accepted Goal leaves native core able to finish the final report");
  assert.deepEqual(f.run(), accepted);
  assert.equal(f.updates.length, updates);
  f.finish("Independent acceptance reported", { summary: true });
  await f.event("session.idle");
  assert.deepEqual(f.run(), accepted);
  assert.equal(f.continuations.length, 0, "The accepted Goal driver has no further work to dispatch");
  assert.equal(f.calls.length, 1);
}));

test("continuation uses its caller-supplied ID and clears only on the matching chat message", async () => fixture(async f => {
  await f.start();
  f.finish();
  await Promise.all([f.event("session.idle"), f.event("session.idle")]);
  assert.equal(f.continuations.length, 1);
  const id = f.continuations[0].body.messageID;
  assert.equal(f.run().continuation.messageID, id);
  assert.ok(f.history.get("root").some(message => message.info.id === id));
  await f.hooks["chat.message"]({ sessionID: "root", messageID: "unrelated" }, {});
  assert.equal(f.run().continuation.messageID, id);
  await f.hooks["chat.message"]({ sessionID: "root", messageID: id }, {});
  assert.equal(f.run().continuation, undefined);
  await f.event("session.idle");
  assert.equal(f.continuations.length, 1, "Acknowledgement is not another worker completion");
  f.finish();
  await f.event("session.idle");
  assert.equal(f.continuations.length, 2);
  assert.notEqual(f.continuations[1].body.messageID, id);
}));

test("chat.message without an ID creates no checkpoint and never changes accepted timestamps", async () => fixture(async f => {
  const withoutID = async () => {
    for (const input of [{ sessionID: "root" }, { sessionID: "root", messageID: undefined }]) {
      const metadata = clone(f.sessions.get("root").metadata), updates = f.updates.length;
      await f.hooks["chat.message"](input, {});
      assert.deepEqual(f.sessions.get("root").metadata, metadata);
      assert.equal(f.updates.length, updates, "Missing IDs must not cause even a same-timestamp checkpoint write");
    }
  };
  await withoutID();
  assert.equal(f.run(), undefined, "An unstarted session must not acquire a checkpoint through the chat hook");
  await f.start();
  await withoutID();
  await f.implement();
  assert.equal((await f.evaluate()).state, "accepted");
  const accepted = f.run();
  await withoutID();
  await f.load();
  await withoutID();
  assert.equal(f.run().updated_at, accepted.updated_at);
  assert.deepEqual(f.run(), accepted);
}));

test("parallel idle events dispatch once and busy or unfinished workers do not dispatch", async () => fixture(async f => {
  await f.start();
  f.append("root", [{ type: "text", text: "Still streaming" }]);
  await f.event("session.idle");
  assert.equal(f.continuations.length, 0);
  f.finish();
  f.setStatuses({ root: { type: "busy" } });
  await f.event("session.idle");
  assert.equal(f.continuations.length, 0);
  f.setStatuses({});
  await Promise.all(Array.from({ length: 8 }, () => f.event("session.idle")));
  assert.equal(f.continuations.length, 1);
  await f.load();
  await f.event("session.idle");
  assert.equal(f.continuations.length, 1, "Persisted caller ID prevents restart duplication");
}));

test("parallel evaluation requests cannot overlap or cancel the existing evaluator", async () => fixture(async f => {
  await f.start();
  const entered = gate(), release = gate();
  f.setProvider(async input => { entered.release(); await release.promise; return f.inspectCandidate(input); });
  const first = f.evaluate("feedback");
  await entered.promise;
  try {
    const result = await f.evaluate("feedback").catch(error => {
      assert.match(error.message, /active|evaluat|stable candidate/);
    });
    assert.equal(f.calls.length, 1);
    assert.equal(f.run().state, "evaluating", "Concurrent request must not pause the existing evaluator");
    assert.equal(f.aborts.length, 0);
    assert.equal(result?.validation, undefined);
    f.finish();
    await f.event("session.idle");
    assert.equal(f.continuations.length, 0);
  } finally { release.release(); await first; }
  assert.equal(f.run().state, "working");
  assert.equal(f.run().feedback.checks.c0.passed, false);
}));

test("simultaneous evaluation requests before the first snapshot admit exactly one owner", { timeout: 5000 }, async () => fixture(async f => {
  await f.start();
  await f.implement();
  const snapshot = snapshotGate(f.root);
  // Both requests start in the same turn, before either can reserve or capture
  // its candidate. Attach allSettled immediately so rejection is always observed.
  const settled = Promise.allSettled([f.evaluate(), f.evaluate()]);
  try {
    await snapshot.entered;
    assert.equal(snapshot.blockedReads, 1, "Only one request may enter candidate capture");
    assert.equal(f.run().state, "evaluating");
    assert.deepEqual(f.run().evaluation.candidate, {}, "Reservation precedes the unfinished snapshot");
    assert.equal(f.calls.length, 0, "No evaluator has been dispatched during capture");
    assert.equal((await f.inspect()).state, "evaluating", "The rejected contender must not clear the live evaluation owner");
    assert.equal(f.aborts.length, 0);
  } finally { snapshot.release(); await settled; }
  const results = await settled;
  const fulfilled = results.filter(result => result.status === "fulfilled");
  const rejected = results.filter(result => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /active|evaluat|stable candidate/);
  assert.equal(fulfilled[0].value.state, "accepted");
  assert.equal(f.run().state, "accepted");
  assert.equal(f.run().validation.checks.c0.passed, true);
  assert.equal(f.run().validation.checks.c1.passed, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.aborts.length, 0);
  assert.equal(f.continuations.length, 0);
}));

test("root mutation is frozen while candidate snapshot capture is still in progress", { timeout: 5000 }, async () => fixture(async f => {
  await f.start();
  await f.implement();
  const bytes = await readFile(path.join(f.root, "counter.txt"));
  const snapshot = snapshotGate(f.root);
  const settled = Promise.allSettled([f.evaluate()]);
  try {
    await snapshot.entered;
    assert.equal(f.run().state, "evaluating");
    assert.deepEqual(f.run().evaluation.candidate, {});
    assert.equal(f.run().evaluation.childID, undefined);
    assert.equal(f.calls.length, 0);
    await assert.rejects(f.mutate("counter.txt", "overlapping write\n", "during-snapshot"), /working checkpoint/);
    assert.deepEqual(await readFile(path.join(f.root, "counter.txt")), bytes);
    assert.deepEqual(f.run().pending_actions, {});
    assert.equal((await f.inspect()).state, "evaluating", "A denied write must not pause the snapshot owner");
    assert.equal(f.aborts.length, 0);
  } finally { snapshot.release(); await settled; }
  const [result] = await settled;
  assert.equal(result.status, "fulfilled");
  assert.equal(result.value.state, "accepted");
  assert.equal(f.run().accepted_candidate["counter.txt"].sha256, sha256(bytes));
  assert.equal(f.calls.length, 1);
  assert.equal(f.aborts.length, 0);
}));

test("evidence-backed external blocker pauses; bookkeeping-only blocker returns to worker", async () => {
  for (const observed of [true, false]) await fixture(async f => {
    await f.start();
    f.setProvider(async input => {
      f.record(input.path.id, observed ? "webfetch" : "todowrite", observed ? "HTTP 503: required evidence unavailable" : "Waiting for evidence", observed ? "error" : "completed");
      return f.submit(input.path.id, { status: "blocked", reason: "Required external evidence returned HTTP 503", checks: {} });
    });
    assert.equal((await f.evaluate()).state, observed ? "paused" : "working");
    assert.equal(f.run().accepted_candidate, undefined);
    f.finish();
    await f.event("session.idle");
    assert.equal(f.continuations.length, observed ? 0 : 1);
  });
});

test("repeated honest partial work has no invented attempt or stall quota", async () => fixture(async f => {
  await f.start();
  const initial = f.run().initial_worktree;
  for (let i = 0; i < 12; i++) {
    // Each repeated finding is a new read of unchanged defective bytes, not a
    // provider response selected by this loop index.
    assert.equal((await f.evaluate("feedback")).state, "working");
    f.finish("Counter remains defective; explore another repair");
    await f.event("session.idle");
  }
  assert.equal(f.calls.length, 12);
  assert.equal(f.continuations.length, 12);
  assert.equal(f.run().state, "working");
  assert.deepEqual(f.run().initial_worktree, initial);
  assert.equal(f.run().max_cycles, undefined);
  await f.implement();
  assert.equal((await f.evaluate()).state, "accepted");
}));
