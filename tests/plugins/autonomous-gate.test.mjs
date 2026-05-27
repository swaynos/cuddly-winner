import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import AutonomousGatePlugin from "../../plugins/opencode-autonomous-gate/index.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gate-plugin-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("rejects COMPLETE when evidence is missing", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const prompts = [];
    const client = {
      app: { log: async () => {} },
      session: {
        prompt: async ({ body }) => {
          prompts.push(body.parts[0].text);
        },
      },
    };
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-1",
      agent: "autonomous",
      text: "<promise>COMPLETE</promise>",
    });

    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /COMPLETE preconditions not met/);
  });
});

test("accepts COMPLETE with evidence and reviewer APPROVE", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const prompts = [];
    const client = {
      app: { log: async () => {} },
      session: {
        prompt: async ({ body }) => {
          prompts.push(body.parts[0].text);
        },
      },
    };
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-2",
      agent: "reviewer",
      text: "APPROVE",
    });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-2",
      agent: "autonomous",
      text: [
        "```json",
        '{"command":"pytest -q","exit_code":0}',
        "```",
        "<promise>COMPLETE</promise>",
      ].join("\n"),
    });

    assert.equal(prompts.length, 0);
  });
});

test("rejects WORK_STUCK until progress.txt touched", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const prompts = [];
    const client = {
      app: { log: async () => {} },
      session: {
        prompt: async ({ body }) => {
          prompts.push(body.parts[0].text);
        },
      },
    };
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-3",
      agent: "autonomous",
      text: "<promise>WORK_STUCK</promise>",
    });
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /WORK_STUCK preconditions not met/);

    await hooks["file.edited"]({
      sessionId: "s-3",
      filePath: path.join(directory, "progress.txt"),
    });
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-3",
      agent: "autonomous",
      text: "<promise>WORK_STUCK</promise>",
    });

    assert.equal(prompts.length, 1);
  });
});
