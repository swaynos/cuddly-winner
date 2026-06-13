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
  hasUncheckedItems,
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

// ---------------------------------------------------------------------------
// hasUncheckedItems helper
// ---------------------------------------------------------------------------

test("hasUncheckedItems: detects open checkbox in text", () => {
  assert.equal(hasUncheckedItems("- [ ] do this\n- [x] done\n"), true);
  assert.equal(hasUncheckedItems("- [x] done\n- [x] also done\n"), false);
  assert.equal(hasUncheckedItems("no checkboxes at all"), false);
  assert.equal(hasUncheckedItems(""), false);
});

// ---------------------------------------------------------------------------
// Turn-boundary continuation nudge (premature-exit fix)
// ---------------------------------------------------------------------------

test("continuation nudge: fires when spec present, progress has open items, no promise token", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = {
      app: { log: async () => {} },
      session: {
        prompt: async ({ body }) => { prompts.push(body.parts[0].text); },
      },
    };
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(
      path.join(directory, "progress.txt"),
      "- [ ] implement step 1\n- [x] setup done\n",
      "utf-8",
    );
    const hooks = await AutonomousLoopPlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "nudge-1",
      agent: "autonomous",
      text: "I looked at the code. Seems okay.",
    });

    assert.equal(prompts.length, 1, "should post continuation corrective");
    assert.match(prompts[0], /unchecked|unfinished|open item|continue|resume/i);
  });
});

test("continuation nudge: does NOT fire when COMPLETE token is present", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = {
      app: { log: async () => {} },
      session: {
        prompt: async ({ body }) => { prompts.push(body.parts[0].text); },
      },
    };
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(
      path.join(directory, "progress.txt"),
      "- [ ] implement step 1\n",
      "utf-8",
    );
    const hooks = await AutonomousLoopPlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "nudge-2",
      agent: "autonomous",
      text: [
        "```json",
        '{"command":"pytest -q","exit_code":0}',
        "```",
        "<promise>COMPLETE</promise>",
      ].join("\n"),
    });

    assert.equal(prompts.length, 0, "should NOT nudge when promise token is present");
  });
});

test("continuation nudge: does NOT fire when WORK_STUCK token is present", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = {
      app: { log: async () => {} },
      session: {
        prompt: async ({ body }) => { prompts.push(body.parts[0].text); },
      },
    };
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(
      path.join(directory, "progress.txt"),
      "- [ ] something\n",
      "utf-8",
    );
    const hooks = await AutonomousLoopPlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "nudge-3",
      agent: "autonomous",
      text: "Tried everything.\n<promise>WORK_STUCK</promise>",
    });

    assert.equal(prompts.length, 0, "should NOT nudge when WORK_STUCK is present");
  });
});

test("continuation nudge: does NOT fire when BLOCKED token is present", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = {
      app: { log: async () => {} },
      session: {
        prompt: async ({ body }) => { prompts.push(body.parts[0].text); },
      },
    };
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(
      path.join(directory, "progress.txt"),
      "- [ ] something\n",
      "utf-8",
    );
    const hooks = await AutonomousLoopPlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "nudge-4",
      agent: "autonomous",
      text: "Bash not available.\n<promise>BLOCKED</promise>",
    });

    assert.equal(prompts.length, 0, "should NOT nudge when BLOCKED is present");
  });
});

test("continuation nudge: does NOT fire when all checklist items are checked", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = {
      app: { log: async () => {} },
      session: {
        prompt: async ({ body }) => { prompts.push(body.parts[0].text); },
      },
    };
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(
      path.join(directory, "progress.txt"),
      "- [x] step 1 done\n- [x] step 2 done\n",
      "utf-8",
    );
    const hooks = await AutonomousLoopPlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "nudge-5",
      agent: "autonomous",
      text: "All steps complete.",
    });

    assert.equal(prompts.length, 0, "should NOT nudge when all items are checked");
  });
});

test("continuation nudge: does NOT fire when progress.txt has no checkboxes", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = {
      app: { log: async () => {} },
      session: {
        prompt: async ({ body }) => { prompts.push(body.parts[0].text); },
      },
    };
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(
      path.join(directory, "progress.txt"),
      "Some freeform notes without checkboxes.\n",
      "utf-8",
    );
    const hooks = await AutonomousLoopPlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "nudge-6",
      agent: "autonomous",
      text: "Still working.",
    });

    assert.equal(prompts.length, 0, "should NOT nudge when progress.txt has no checkboxes");
  });
});

test("continuation nudge: does NOT fire when progress.txt is absent", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = {
      app: { log: async () => {} },
      session: {
        prompt: async ({ body }) => { prompts.push(body.parts[0].text); },
      },
    };
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    // No progress.txt written
    const hooks = await AutonomousLoopPlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "nudge-7",
      agent: "autonomous",
      text: "Still working.",
    });

    assert.equal(prompts.length, 0, "should NOT nudge when progress.txt does not exist yet");
  });
});

test("continuation nudge: does NOT fire when spec is absent", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = {
      app: { log: async () => {} },
      session: {
        prompt: async ({ body }) => { prompts.push(body.parts[0].text); },
      },
    };
    // No SPEC.md
    await writeFile(
      path.join(directory, "progress.txt"),
      "- [ ] something\n",
      "utf-8",
    );
    const hooks = await AutonomousLoopPlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "nudge-8",
      agent: "autonomous",
      text: "Still working.",
    });

    assert.equal(prompts.length, 0, "should NOT nudge when no spec is present");
  });
});

test("continuation nudge: does NOT fire for non-autonomous agents", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = {
      app: { log: async () => {} },
      session: {
        prompt: async ({ body }) => { prompts.push(body.parts[0].text); },
      },
    };
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(
      path.join(directory, "progress.txt"),
      "- [ ] step 1\n",
      "utf-8",
    );
    const hooks = await AutonomousLoopPlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "nudge-9",
      agent: "reviewer",
      text: "REQUEST_CHANGES: fix this.",
    });

    assert.equal(prompts.length, 0, "should NOT nudge messages from non-autonomous agents");
  });
});

test("continuation nudge: does not fire twice for same identical turn text", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = {
      app: { log: async () => {} },
      session: {
        prompt: async ({ body }) => { prompts.push(body.parts[0].text); },
      },
    };
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(
      path.join(directory, "progress.txt"),
      "- [ ] step 1\n",
      "utf-8",
    );
    const hooks = await AutonomousLoopPlugin({ client, directory });

    const msg = {
      role: "assistant",
      sessionId: "nudge-10",
      agent: "autonomous",
      text: "Still working on something.",
    };
    await hooks["message.part.updated"](msg);
    await hooks["message.part.updated"](msg); // same text, same session

    assert.equal(prompts.length, 1, "should not fire duplicate nudge for identical repeated turn");
  });
});
