import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import AutonomousLoopPlugin, {
  hashText,
  jsonSafeParse,
  normalizeRunId,
  normalizeSessionId,
} from "../../plugins/opencode-autonomous-loop/index.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "loop-plugin-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("normalize helpers are deterministic", () => {
  assert.equal(normalizeSessionId(null), "__unscoped__");
  assert.equal(normalizeRunId("abc/123"), "abc_123");
  assert.equal(normalizeRunId("abc-123"), "abc-123");
  assert.equal(hashText("SPEC"), hashText("SPEC"));
  assert.deepEqual(jsonSafeParse("bad json", { ok: false }), { ok: false });
});

test("plugin writes run state on autonomous message", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const client = { app: { log: async () => {} } };
    const hooks = await AutonomousLoopPlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "session-1",
      agent: "autonomous",
      text: "Working on step 1",
    });

    const runsRaw = await readFile(
      path.join(directory, ".opencode", "autonomous-loop", "runs.json"),
      "utf-8",
    );
    const runs = JSON.parse(runsRaw);
    const run = runs.runs["session-1"];
    assert.ok(run);
    assert.equal(run.status, "running");
    assert.equal(run.iterations, 1);
    assert.equal(run.spec_present, true);
    assert.equal(run.spec_file, "SPEC.md");
  });
});

test("plugin marks complete and stores last evidence", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const client = { app: { log: async () => {} } };
    const hooks = await AutonomousLoopPlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "session-2",
      agent: "autonomous",
      text: [
        "done",
        "```json",
        '{"command":"pytest -q","exit_code":0}',
        "```",
        "<promise>COMPLETE</promise>",
      ].join("\n"),
    });

    const runs = JSON.parse(
      await readFile(
        path.join(directory, ".opencode", "autonomous-loop", "runs.json"),
        "utf-8",
      ),
    );
    const run = runs.runs["session-2"];
    assert.equal(run.status, "complete");
    assert.equal(run.complete_count, 1);
    assert.equal(run.last_complete_evidence.exit_code, 0);
  });
});
