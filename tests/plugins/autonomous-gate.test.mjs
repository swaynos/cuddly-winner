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

// Helper: build a client that reports a specific tool list
function makeClient({ tools = null, prompts = [] } = {}) {
  const client = {
    app: { log: async () => {} },
    session: {
      prompt: async ({ body }) => {
        prompts.push(body.parts[0].text);
      },
    },
  };
  if (tools !== null) {
    client.tools = tools;
  }
  return client;
}

test("rejects COMPLETE when evidence is missing", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const prompts = [];
    const client = makeClient({ prompts });
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
    const client = makeClient({ prompts });
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
    const client = makeClient({ prompts });
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

// ---------------------------------------------------------------------------
// bash-unavailable scenarios
// ---------------------------------------------------------------------------

test("bash unavailable: COMPLETE accepted without evidence block", async () => {
  // When bash is not in the tool list, the evidence requirement is auto-disabled.
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const prompts = [];
    // Expose a tool list that does NOT include bash
    const client = makeClient({ tools: ["edit", "read", "write", "glob"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    // No evidence block, no reviewer — but bash is absent so evidence is waived
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-nobash-complete",
      agent: "autonomous",
      text: "<promise>COMPLETE</promise>",
    });

    assert.equal(prompts.length, 0, "COMPLETE should be accepted without evidence when bash is unavailable");
  });
});

test("bash unavailable: BLOCKED accepted", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const prompts = [];
    const client = makeClient({ tools: ["edit", "read", "write"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-nobash-blocked",
      agent: "autonomous",
      text: "Cannot run verification — bash is unavailable.\n<promise>BLOCKED</promise>",
    });

    assert.equal(prompts.length, 0, "BLOCKED should be accepted when bash is genuinely unavailable");
  });
});

test("bash available: BLOCKED rejected (prevents rationalization)", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const prompts = [];
    // Expose a tool list that INCLUDES bash
    const client = makeClient({ tools: ["bash", "edit", "read", "task"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-hasbash-blocked",
      agent: "autonomous",
      text: "bash is unavailable this turn, so I'll defer.\n<promise>BLOCKED</promise>",
    });

    assert.equal(prompts.length, 1, "BLOCKED should be rejected when bash IS available");
    assert.match(prompts[0], /BLOCKED rejected/);
  });
});

test("bash available: COMPLETE still requires evidence", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-hasbash-noevidance",
      agent: "autonomous",
      text: "<promise>COMPLETE</promise>",
    });

    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /COMPLETE preconditions not met/);
    assert.match(prompts[0], /evidence/);
  });
});

test("tool list unknown (no client.tools): BLOCKED rejected (fail-safe)", async () => {
  // When we can't determine tool availability, we assume bash exists.
  // BLOCKED should therefore be rejected to prevent false escapes.
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const prompts = [];
    // Client exposes no tool list at all
    const client = makeClient({ tools: null, prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-unknown-tools",
      agent: "autonomous",
      text: "<promise>BLOCKED</promise>",
    });

    assert.equal(prompts.length, 1, "BLOCKED should be rejected when tool list is unknown (assume bash available)");
    assert.match(prompts[0], /BLOCKED rejected/);
  });
});

test("corrective message mentions BLOCKED path when bash is unavailable", async () => {
  // When COMPLETE is rejected for any reason, the corrective message should
  // tell the agent about BLOCKED as the clean exit if bash is absent.
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const prompts = [];
    const client = makeClient({ prompts });  // no tool list — bash assumed available
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-corrective-blocked-hint",
      agent: "autonomous",
      text: "<promise>COMPLETE</promise>",
    });

    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /<promise>BLOCKED<\/promise>/,
      "corrective message should mention BLOCKED as the clean exit for no-bash environments");
  });
});

// ---------------------------------------------------------------------------
// Workaround-dump detection
// ---------------------------------------------------------------------------

// Simulates the pattern that emerges when @autonomous is asked to run
// something on a remote server (SSH/git host, CI runner, cloud VM, etc.)
// and has no bash tool available — instead of emitting BLOCKED, it
// produces a "here's what you'd run yourself" dump.
const REMOTE_EXEC_DUMP = `I can't run that discovery or edit files in this session — the tools I currently have
available don't include shell/SSH execution or file writing.

Find what's hosted on the remote server:
\`\`\`bash
ls -1 /srv/git/repos
\`\`\`

Fuller report (repo + default branch + refs):
\`\`\`bash
for r in /srv/git/repos/*.git; do
  echo "=== $r ==="
  git --git-dir="$r" symbolic-ref HEAD 2>/dev/null
  git --git-dir="$r" show-ref 2>/dev/null
done
\`\`\`
`;

test("workaround dump: intercepted when bash is unavailable", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const prompts = [];
    // No bash in tool list — simulates MCP-only or restricted environment
    const client = makeClient({ tools: ["read", "glob", "grep"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-workaround-dump",
      agent: "autonomous",
      text: REMOTE_EXEC_DUMP,
    });

    assert.equal(prompts.length, 1, "workaround dump should trigger corrective");
    assert.match(prompts[0], /Workaround dump detected/);
    assert.match(prompts[0], /BLOCKED/);
  });
});

test("workaround dump: NOT intercepted when bash is available (normal code output)", async () => {
  // A response with a code block is fine when bash is available —
  // it may be evidence output, not a workaround dump.
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const prompts = [];
    // Bash IS available
    const client = makeClient({ tools: ["bash", "read", "edit"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-normal-code",
      agent: "autonomous",
      text: REMOTE_EXEC_DUMP,
    });

    assert.equal(prompts.length, 0, "code blocks should not be intercepted when bash is available");
  });
});

test("workaround dump: code block alone (no cant-do statement) is not intercepted", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const prompts = [];
    const client = makeClient({ tools: ["read", "glob"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    // A code block without any "I can't" language — normal evidence reporting
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-code-only",
      agent: "autonomous",
      text: "Here are the test results:\n```\npytest passed 42 tests\n```\nAll green.",
    });

    assert.equal(prompts.length, 0, "code block alone should not trigger interception");
  });
});

test("workaround dump: cant-do alone (no code block) is not intercepted", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const prompts = [];
    const client = makeClient({ tools: ["read", "glob"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    // A cant-do statement without a code block — correct one-sentence decline
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-cant-only",
      agent: "autonomous",
      text: "The bash tool is not available in this session.",
    });

    assert.equal(prompts.length, 0, "cant-do statement alone should not trigger interception");
  });
});
