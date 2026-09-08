import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { AutonomousKpis, parseRunKpis, summarizeUsage } from "../../plugins/autonomous-kpis.ts";

async function fixture(fn) { const root = await mkdtemp(path.join(os.tmpdir(), "task-kpis-")); try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); } }
const runKpis = { enabled: true, unattended_runtime: { target_seconds: 600 }, token_burn: { target_tokens_per_active_minute: 100, hard_budget_tokens: 10 } };

async function publish(root) {
  await mkdir(path.join(root, ".opencode", "tasks"), { recursive: true });
  await writeFile(path.join(root, ".opencode", "generated-agents.json"), JSON.stringify({ schema_version: 1, agents: [{ name: "fix-widget", manifest: ".opencode/tasks/fix-widget.json" }] }));
  await writeFile(path.join(root, ".opencode", "tasks", "fix-widget.json"), JSON.stringify({ schema_version: 1, run_kpis: runKpis }));
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
  const guard = await AutonomousKpis({ directory: root, worktree: root, client: { session: { get: async () => ({ data: {} }) } } });
  const first = { maxOutputTokens: 100 };
  await guard["chat.params"]({ sessionID: "root", agent: "fix-widget" }, first);
  assert.equal(first.maxOutputTokens, 10);
  await guard.event({ event: { type: "message.updated", properties: { info: { id: "m", sessionID: "root", role: "assistant", time: { created: 1, completed: 2 }, tokens: { input: 4, output: 3, reasoning: 2, cache: { read: 1, write: 0 } } } } } });
  await assert.rejects(guard["chat.params"]({ sessionID: "root", agent: "fix-widget" }, { maxOutputTokens: undefined }), /hard token budget exhausted/);
}));

test("unregistered identities receive no KPI guidance", async () => fixture(async root => {
  await publish(root);
  const guard = await AutonomousKpis({ directory: root, worktree: root, client: { session: { get: async () => ({ data: {} }) } } });
  await guard["chat.params"]({ sessionID: "root", agent: "third-party" }, { maxOutputTokens: undefined });
  const output = { system: [] };
  await guard["experimental.chat.system.transform"]({ sessionID: "root" }, output);
  assert.deepEqual(output.system, []);
}));
