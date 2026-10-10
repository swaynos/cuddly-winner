import test from "node:test";
import assert from "node:assert/strict";
import { goalActivityForSession, publicSummary, evidenceTool } from "../../plugins/tui/progress.ts";

const snapshot = { agent: "fix-counter", parentID: "root", cycle: 2, phase: "builder", status: "running",
  activity: "Reading project files", milestone: "Checking masks", phaseStartedAt: 1, updatedAt: 2, recent: ["Builder working"] };

test("panel hydrates only current root Goal activity and hides native or unrelated sessions", () => {
  const messages = [{ id: "user", role: "user", agent: "fix-counter" }, { id: "assistant", role: "assistant" }];
  const parts = () => [{ type: "tool", tool: "goal_cycle", state: { status: "running", metadata: { goal_activity: snapshot } } }];
  assert.deepEqual(goalActivityForSession({ id: "root" }, messages, parts), snapshot);
  assert.equal(goalActivityForSession({ id: "child", parentID: "root" }, messages, parts), undefined);
  assert.equal(goalActivityForSession({ id: "other" }, messages, parts), undefined);
  for (const agent of ["build", "plan", "general", "ask", "another-goal"]) {
    assert.equal(goalActivityForSession({ id: "root" }, [{ ...messages[0], agent }, messages[1]], parts), undefined);
  }
  assert.equal(evidenceTool("goal_progress"), false);
});

test("public summaries strip terminal controls, bound text and reject sensitive forms", () => {
  assert.equal(publicSummary("Inspecting\nmask\tfiles"), "Inspecting mask files");
  assert.equal(publicSummary("x".repeat(1000)).length, 160);
  for (const text of ["", "https://private.example/image", "token=secret", "Authorization: Bearer secret"]) {
    assert.throws(() => publicSummary(text));
  }
});

test("malformed or interrupted metadata never claims successful progress", () => {
  const messages = [{ id: "m", role: "user", agent: "fix-counter" }];
  const parts = status => () => [{ type: "tool", tool: "goal_cycle", state: { status, metadata: { goal_activity: { ...snapshot, status: "validated" } } } }];
  assert.equal(goalActivityForSession({ id: "root" }, messages, parts("error")).status, "blocked");
  assert.equal(goalActivityForSession({ id: "root" }, [{ ...messages[0], error: { name: "MessageAbortedError" } }], parts("error")).status, "cancelled");
  assert.equal(goalActivityForSession({ id: "root" }, messages, () => [{ type: "tool", tool: "goal_cycle", state: { metadata: { goal_activity: { ...snapshot, cycle: -1 } } } }]), undefined);
});

test("coordinator non-progress stops preserve the failed verdict during hydration", () => {
  const value = goalActivityForSession({ id: "root" }, [{ id: "m", role: "user", agent: "fix-counter" }], () => [{ type: "tool", tool: "goal_cycle", state: {
    status: "completed", metadata: { coordinator_stop: "Coordinator non-progress", goal_activity: { ...snapshot, verdict: "failed (c0)", retryReason: "Repair counter" } },
  } }]);
  assert.equal(value.status, "blocked");
  assert.equal(value.verdict, "failed (c0)");
  assert.match(value.activity, /Coordinator non-progress/);
});

test("inspection and rejected arguments do not hide the latest execution panel", () => {
  const messages = [{ id: "run", role: "user", agent: "fix-counter" }, { id: "inspect", role: "assistant" }, { id: "invalid", role: "assistant" }];
  const parts = id => id === "run"
    ? [{ type: "tool", tool: "goal_cycle", state: { status: "completed", metadata: { goal_activity: { ...snapshot, status: "failed", activity: "Builder unfinished; validation not started" } } } }]
    : [{ type: "tool", tool: "goal_cycle", state: { status: "completed", output: JSON.stringify({ status: id === "inspect" ? "inspected" : "invalid_request" }) } }];
  const value = goalActivityForSession({ id: "root" }, messages, parts);
  assert.equal(value.status, "failed");
  assert.match(value.activity, /Builder unfinished/);
});
