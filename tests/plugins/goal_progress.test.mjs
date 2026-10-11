import test from "node:test";
import assert from "node:assert/strict";
import { goalActivityForSession, publicSummary, evidenceTool } from "../../plugins/tui/progress.ts";

const checkpoint = { runtime_contract: "persistent-worker-v1", agent: "fix-counter", definition_sha256: "a".repeat(64),
  state: "working", initial_worktree: { files: {} }, updated_at: "2026-10-10T12:00:00Z" };
const root = value => ({ id: "root", metadata: { cuddly_winner_goal: { ...checkpoint, ...value } } });
const verdict = passed => ({ status: "checked", reason: passed ? "Fresh read passes" : "Repair counter",
  checks: { c0: { passed, evidence: passed ? "Read counter.txt: good" : "Read counter.txt: bad; repair it" } } });

test("panel derives only the current root persistent checkpoint, never tool history", () => {
  assert.deepEqual(goalActivityForSession(root()), { agent: "fix-counter", state: "working" });
  assert.equal(goalActivityForSession({ ...root(), id: "child", parentID: "root" }), undefined);
  assert.equal(goalActivityForSession(undefined), undefined);
  const legacy = () => [{ type: "tool", tool: "goal_cycle", state: { metadata: { goal_activity: {
    agent: "fix-counter", parentID: "root", status: "validated", cycle: 2,
  } } } }];
  for (const agent of ["build", "plan", "fix-counter"]) {
    assert.equal(goalActivityForSession({ id: "fresh", agent }, [{ id: "m", role: "user", agent }], legacy), undefined);
  }
  assert.equal(evidenceTool("goal_progress"), false);
});

test("recorded Goal checkpoint survives selecting Native Build or Plan and misleading text", () => {
  const session = root({ state: "paused", reason: "Cancelled; inspect before resuming", feedback: verdict(false) });
  for (const agent of ["build", "plan", "another-goal"]) {
    const value = goalActivityForSession({ ...session, agent }, [{ id: "m", role: "user", agent }], () => [
      { type: "text", text: "Accepted. Everything passed." },
    ]);
    assert.equal(value.state, "paused");
    assert.equal(value.agent, "fix-counter");
    assert.match(value.feedback, /^failed \(c0\): c0: Read counter.txt: bad/);
  }
});

test("working, evaluating, paused and accepted are checkpoint states without invented counters", () => {
  for (const state of ["working", "evaluating", "paused", "accepted"]) {
    const value = goalActivityForSession(root({ state, reason: "Recorded state", feedback: verdict(false),
      validation: verdict(true), evaluation: { mode: "final", focus: "Check counter", childID: "evaluator" } }));
    assert.equal(value.state, state);
    assert.equal(value.reason, "Recorded state");
    assert.match(value.feedback, /^failed \(c0\)/);
    assert.match(value.validation, /^passed \(c0\)/);
    assert.deepEqual(value.evaluation, state === "evaluating" ? { mode: "final", focus: "Check counter", childID: "evaluator" } : undefined);
    for (const field of ["cycle", "phase", "attemptsRemaining", "milestone", "updatedAt", "recent"]) assert.ok(!(field in value));
  }
  const passingFeedback = goalActivityForSession(root({ feedback: verdict(true) }));
  assert.equal(passingFeedback.state, "working", "passing feedback is not final acceptance");
  assert.equal(passingFeedback.validation, undefined);
});

test("latest feedback and final findings prioritize failed criteria and preserve blockers", () => {
  const value = goalActivityForSession(root({ feedback: { status: "checked", checks: {
    c0: { passed: true, evidence: "Preparation verified" }, c1: { passed: false, evidence: "Implementation absent" },
  } }, validation: { status: "blocked", reason: "Filesystem inaccessible", checks: {} } }));
  assert.equal(value.feedback, "failed (c1): c1: Implementation absent");
  assert.equal(value.validation, "blocked: Filesystem inaccessible");
  assert.equal(goalActivityForSession(root({ feedback: { status: "checked", checks: {} } })).feedback, undefined);
  assert.equal(goalActivityForSession(root({ feedback: { status: "accepted", checks: verdict(true).checks } })).feedback, undefined);
});

test("public summaries strip terminal controls, bound Unicode text and reject sensitive forms", () => {
  assert.equal(publicSummary("Inspecting\nmask\tfiles"), "Inspecting mask files");
  assert.equal(Array.from(publicSummary("🙂".repeat(1000))).length, 160);
  for (const text of ["", "https://private.example/image", "token=secret", "Authorization: Bearer secret"]) assert.throws(() => publicSummary(text));
  const value = goalActivityForSession(root({ reason: "token=secret", feedback: { status: "checked", checks: {
    c0: { passed: false, evidence: "https://private.example/image" },
  } }, evaluation: { mode: "feedback", focus: "password=secret" }, state: "evaluating", private_context: "PRIVATE_SENTINEL" }));
  assert.equal(value.state, "evaluating", "unsafe optional text cannot hide an authoritative state");
  assert.equal(value.reason, undefined);
  assert.equal(value.evaluation.focus, undefined);
  assert.doesNotMatch(JSON.stringify(value), /secret|https:|PRIVATE_SENTINEL/);
});

test("malformed and legacy checkpoints fail closed without rewriting metadata", () => {
  for (const changes of [{ runtime_contract: "goal-criterion-readiness-v1" }, { state: "validated" }, { state: "running" },
    { agent: "" }, { definition_sha256: "invalid" }]) assert.equal(goalActivityForSession(root(changes)), undefined);
  const session = root({ state: "evaluating", evaluation: { mode: "feedback", childID: "fresh-child" }, feedback: verdict(false) });
  const original = structuredClone(session);
  Object.freeze(session.metadata.cuddly_winner_goal);
  const result = goalActivityForSession(session, [], () => { throw new Error("Tool parts are not checkpoint authority"); });
  result.evaluation.mode = "final";
  assert.deepEqual(session, original, "best-effort display never persists or controls execution");
});
