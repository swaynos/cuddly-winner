import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { AutonomousKpis, parseRunKpis, summarizeUsage } from "../../plugins/autonomous-kpis.ts";

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "autonomous-kpis-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function manifest(run_kpis) {
  return JSON.stringify({ schema_version: 3, strategy: "direct", run_kpis });
}

test("absent or disabled run KPIs do not activate the monitor", () => {
  assert.equal(parseRunKpis({ schema_version: 3 }), undefined);
  assert.equal(parseRunKpis({ run_kpis: { enabled: false } }), undefined);
  assert.equal(parseRunKpis({ run_kpis: { enabled: true } }), undefined);
});

test("usage totals replace repeated message updates and merge overlapping active intervals", () => {
  const summary = summarizeUsage([
    { tokens: 20, created: 0, completed: 60_000 },
    { tokens: 10, created: 30_000, completed: 90_000 },
    { tokens: 30, created: 120_000, completed: 180_000 },
  ]);
  assert.equal(summary.tokens, 60);
  assert.equal(summary.activeMilliseconds, 150_000);
  assert.equal(summary.tokensPerActiveMinute, 24);
});

test("enabled KPIs cap output and block the next turn after the hard budget", async () => fixture(async root => {
  await writeFile(path.join(root, "opencode-autonomous.json"), manifest({
    enabled: true,
    unattended_runtime: { target_seconds: 600 },
    token_burn: { target_tokens_per_active_minute: 100, hard_budget_tokens: 10 },
  }));
  const guard = await AutonomousKpis({
    directory: root,
    worktree: root,
    client: { session: { get: async () => ({ data: {} }) } },
  });
  const first = { maxOutputTokens: 100 };
  await guard["chat.params"]({ sessionID: "root", agent: "autonomous" }, first);
  assert.equal(first.maxOutputTokens, 10);

  await guard.event({ event: { type: "message.updated", properties: { info: {
    id: "m1", sessionID: "root", role: "assistant", time: { created: 1, completed: 2 },
    tokens: { input: 4, output: 3, reasoning: 2, cache: { read: 1, write: 0 } },
  } } } });
  await assert.rejects(
    guard["chat.params"]({ sessionID: "root", agent: "autonomous" }, { maxOutputTokens: undefined }),
    /hard token budget exhausted/,
  );
}));

test("enabled KPI guidance is injected only for autonomous sessions", async () => fixture(async root => {
  await writeFile(path.join(root, "opencode-autonomous.json"), manifest({
    enabled: true,
    unattended_runtime: { target_seconds: 600 },
    token_burn: { target_tokens_per_active_minute: 100, hard_budget_tokens: 1000 },
  }));
  const guard = await AutonomousKpis({ directory: root, worktree: root, client: { session: { get: async () => ({ data: {} }) } } });
  const unmanaged = { system: [] };
  await guard["experimental.chat.system.transform"]({ sessionID: "other" }, unmanaged);
  assert.deepEqual(unmanaged.system, []);

  await guard["chat.params"]({ sessionID: "root", agent: "autonomous" }, { maxOutputTokens: undefined });
  const managed = { system: [] };
  await guard["experimental.chat.system.transform"]({ sessionID: "root" }, managed);
  assert.equal(managed.system.length, 1);
  assert.match(managed.system[0], /Do not sleep, pad/);
}));
