import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import spikeTool, { runSpike, __testing } from "../../tools/spike.ts";

async function fixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spike-tool-"));
  try { await fn(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function contract(root, id = "probe") {
  const dir = path.join(root, ".spike", id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "QUESTION.md"), "## Question\nDoes it work?\n\n## Kill criterion\nThe command fails.\n");
  return dir;
}

test("spike exports an explicitly unsandboxed OpenCode tool", () => {
  assert.match(spikeTool.description, /not sandboxed/i);
  assert.equal(typeof spikeTool?.args?.command?.safeParse, "function");
  assert.equal(typeof spikeTool?.execute, "function");
});

test("spike requires a contracted question and kill criterion", async () => fixture(async root => {
  await assert.rejects(runSpike({ command: "true", root, spike_id: "probe" }), /Missing spike contract/);
  const dir = path.join(root, ".spike", "probe");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "QUESTION.md"), "## Question\nDoes it work?\n");
  await assert.rejects(runSpike({ command: "true", root, spike_id: "probe" }), /question and kill criterion/i);
}));

test("spike runs natively from its directory and persists bounded evidence", async () => fixture(async root => {
  const dir = await contract(root);
  const result = await runSpike({ command: "printf measured > result.txt; printf ok", root, spike_id: "probe" });
  assert.equal(result.exit_code, 0);
  assert.equal(result.stdout_tail, "ok");
  assert.equal(result.spike_id, "probe");
  assert.equal(result.sandboxed, false);
  assert.equal(await fs.readFile(path.join(dir, "result.txt"), "utf8"), "measured");
  const saved = JSON.parse(await fs.readFile(path.join(dir, "runs", `${result.run_id}.json`), "utf8"));
  assert.deepEqual(saved, result);
  assert.equal(await fs.readFile(path.join(dir, "runs", `${result.run_id}.log`), "utf8"), "ok");
}));

test("spike reports nonzero exits and enforces time and output bounds", async () => fixture(async root => {
  await contract(root);
  assert.equal((await runSpike({ command: "exit 7", root, spike_id: "probe" })).exit_code, 7);
  const timed = await runSpike({ command: "sleep 2", root, spike_id: "probe", timeoutSec: 0.01 });
  assert.equal(timed.timed_out, true);
  const noisy = await runSpike({ command: "yes x", root, spike_id: "probe" });
  assert.equal(noisy.output_truncated, true);
  assert.equal(__testing.running, 0);
}));

test("spike rejects unsafe identifiers and worktree escapes", async () => fixture(async root => {
  await assert.rejects(runSpike({ command: "true", root, spike_id: "../escape" }), /safe spike_id/);
  await assert.rejects(runSpike({ command: "true", root: path.join(root, "missing"), spike_id: "probe" }), /Invalid project root/);
}));
