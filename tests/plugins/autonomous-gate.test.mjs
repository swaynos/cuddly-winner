import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdtempSync as mkdtempSyncFs } from "node:fs";

// Hermetic isolation: the plugin probes OPENCODE_CONFIG_DIR (default
// ~/.config/opencode) for a globally deployed reviewer agent. On machines
// where agents ARE deployed globally, that leaks into every temp-dir test and
// silently activates the reviewer requirement. Point the config dir at an
// empty directory before the plugin is exercised.
process.env.OPENCODE_CONFIG_DIR = mkdtempSyncFs(
  path.join(os.tmpdir(), "gate-test-config-"),
);

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

const PROGRESS_DIRECT = "## Strategy\nSelected: direct\nReason: test fixture\n";

test("rejects COMPLETE when evidence is missing", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(path.join(directory, "progress.txt"), PROGRESS_DIRECT, "utf-8");
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
    assert.match(prompts[0], /Failed check\(s\):/);
    assert.match(prompts[0], /missing\/failing evidence block/);
    assert.match(prompts[0], /Next action\(s\):/);
    assert.match(prompts[0], /Run verification and include a fenced JSON evidence block/);
    assert.doesNotMatch(prompts[0], /progress\.txt .*WORK_STUCK/);
  });
});

test("accepts COMPLETE with evidence and reviewer APPROVE", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(path.join(directory, "progress.txt"), PROGRESS_DIRECT, "utf-8");
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
    assert.match(prompts[0], /Failed check\(s\):/);
    assert.match(prompts[0], /progress\.txt\/PROGRESS\.txt not updated this session/);
    assert.match(prompts[0], /Update `progress\.txt` with the current blocker/);
    assert.match(prompts[0], /try and record at least 3 distinct approaches/);

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

test("observed Prometheus payload is auto-materialized; WORK_STUCK then demands progress", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = makeClient({ prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });
    const specContent = "# generated spec\n\n## Problem\nMaterialize this handoff.\n";

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-prometheus-handoff",
      agent: "prometheus",
      text: `<spec filename="SPEC.md">\n${specContent}</spec>\n\nInvoke @autonomous to write this SPEC.md verbatim and execute it.`,
    });

    // The gate writes the payload to disk the moment it is observed.
    const { readFile } = await import("node:fs/promises");
    const onDisk = await readFile(path.join(directory, "SPEC.md"), "utf-8");
    assert.equal(onDisk.trim(), specContent.trim(), "payload must be auto-materialized to SPEC.md");

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-prometheus-handoff",
      agent: "autonomous",
      text: "No spec file found (`SPEC.md` or `spec.md`). Run `@prometheus` to scaffold one, then invoke me again.\n<promise>WORK_STUCK</promise>",
    });

    // Spec now exists, so a WORK_STUCK claim of "missing spec" is rejected on
    // the ordinary precondition: progress.txt was never updated.
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /WORK_STUCK preconditions not met/i);
    assert.match(prompts[0], /progress\.txt/i);
  });
});

test("event hook auto-materializes observed Prometheus payload", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = makeClient({ prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });
    const specContent = "# event spec\n\n## Problem\nMaterialize event payload.\n";

    await hooks["chat.params"]?.({
      sessionID: "s-event-handoff",
      agent: "prometheus",
    }, {});
    await hooks.event({
      event: {
        type: "message.part.updated",
        properties: {
          sessionID: "s-event-handoff",
          part: {
            type: "text",
            sessionID: "s-event-handoff",
            text: `<spec filename="SPEC.md">\n${specContent}</spec>`,
          },
        },
      },
    });

    // Payload observed through the event hook is written to disk.
    const { readFile } = await import("node:fs/promises");
    const onDisk = await readFile(path.join(directory, "SPEC.md"), "utf-8");
    assert.equal(onDisk.trim(), specContent.trim(), "event-hook payload must be auto-materialized");

    await hooks["chat.params"]?.({
      sessionID: "s-event-handoff",
      agent: "autonomous",
    }, {});
    await hooks.event({
      event: {
        type: "message.part.updated",
        properties: {
          sessionID: "s-event-handoff",
          part: {
            type: "text",
            sessionID: "s-event-handoff",
            text: "No spec file found.\n<promise>WORK_STUCK</promise>",
          },
        },
      },
    });

    // Spec exists on disk now; the stuck claim is rejected on progress.
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /WORK_STUCK preconditions not met/i);
  });
});

test("WORK_STUCK with missing SPEC is accepted after three documented attempts", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = makeClient({ prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-missing-spec-bootstrap",
      agent: "autonomous",
      text: [
        "No spec file found (`SPEC.md` or `spec.md`).",
        "Attempt 1: checked SPEC.md, spec.md, docs/SPEC.md, docs/spec.md — none exist.",
        "Attempt 2: searched the repo for spec-like documents with rg — none found.",
        "Attempt 3: checked session context for a Prometheus payload — none observed.",
        "Run `@prometheus` to scaffold one, then invoke me again.",
        "<promise>WORK_STUCK</promise>",
      ].join("\n"),
    });

    assert.equal(prompts.length, 0);
  });
});

test("WORK_STUCK with missing SPEC is rejected without three documented attempts", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = makeClient({ prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-missing-spec-lazy",
      agent: "autonomous",
      text: "No spec file found (`SPEC.md` or `spec.md`). Run `@prometheus` to scaffold one, then invoke me again.\n<promise>WORK_STUCK</promise>",
    });

    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /three documented recovery attempts/i);
  });
});

// ---------------------------------------------------------------------------
// bash-unavailable scenarios
// ---------------------------------------------------------------------------

test("bash unavailable: COMPLETE accepted without evidence block", async () => {
  // When bash is not in the tool list, the evidence requirement is auto-disabled.
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(path.join(directory, "progress.txt"), PROGRESS_DIRECT, "utf-8");
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
    const { mkdir } = await import("node:fs/promises");
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    // BLOCKED is legitimately accepted when the runner tool is absent from
    // disk; install it so the anti-rationalization rejection is exercised.
    await mkdir(path.join(directory, ".opencode", "tool"), { recursive: true });
    await writeFile(path.join(directory, ".opencode", "tool", "run.ts"), "export default {}\n", "utf-8");
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
    assert.match(prompts[0], /Failed check\(s\):/);
    assert.match(prompts[0], /Use <promise>COMPLETE<\/promise> with a valid evidence block/);
  });
});

test("bash available: COMPLETE still requires evidence", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(path.join(directory, "progress.txt"), PROGRESS_DIRECT, "utf-8");
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
    const { mkdir } = await import("node:fs/promises");
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    // Runner tool present so BLOCKED cannot ride the runner-missing exit.
    await mkdir(path.join(directory, ".opencode", "tool"), { recursive: true });
    await writeFile(path.join(directory, ".opencode", "tool", "run.ts"), "export default {}\n", "utf-8");
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

// ---------------------------------------------------------------------------
// Strategy-consistency enforcement
// ---------------------------------------------------------------------------

test("strategy: COMPLETE rejected when Selected: karpathy but no artifacts and no delegation", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    // progress.txt claims karpathy but no program.md / karpathy.json / experiments.md exist
    await writeFile(
      path.join(directory, "progress.txt"),
      "## Strategy\nSelected: karpathy\nReason: has tests\n",
      "utf-8",
    );
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    // Provide reviewer APPROVE and a passing evidence block — everything else satisfied
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-karp-no-artifacts",
      agent: "reviewer",
      text: "APPROVE",
    });
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-karp-no-artifacts",
      agent: "autonomous",
      text: [
        "```json",
        '{"command":"pytest -q","exit_code":0}',
        "```",
        "<promise>COMPLETE</promise>",
      ].join("\n"),
    });

    assert.equal(prompts.length, 1, "should reject COMPLETE due to missing Karpathy evidence");
    assert.match(prompts[0], /karpathy/i);
    assert.match(prompts[0], /experiments\.md|program\.md|karpathy\.json/i);
  });
});

test("strategy: COMPLETE accepted when Selected: karpathy and all three artifacts exist", async () => {
  await withTempDir(async (directory) => {
    const dotOpencode = path.join(directory, ".opencode");
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(
      path.join(directory, "progress.txt"),
      "## Strategy\nSelected: karpathy\nKarpathy gate: PASS\n",
      "utf-8",
    );
    await writeFile(path.join(directory, "program.md"), "# program\n", "utf-8");
    await writeFile(
      path.join(directory, "experiments.md"),
      "## Run 0 — Baseline\nScore: 0.72\nDecision: BASELINE\n",
      "utf-8",
    );
    // mkdir .opencode and write karpathy.json
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(dotOpencode, { recursive: true }),
    );
    await writeFile(
      path.join(dotOpencode, "karpathy.json"),
      '{"baseline_command":"python train.py"}\n',
      "utf-8",
    );

    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-karp-artifacts",
      agent: "reviewer",
      text: "APPROVE",
    });
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-karp-artifacts",
      agent: "autonomous",
      text: [
        "```json",
        '{"command":"python train.py","exit_code":0}',
        "```",
        "<promise>COMPLETE</promise>",
      ].join("\n"),
    });

    assert.equal(prompts.length, 0, "should accept COMPLETE when Karpathy artifacts exist");
  });
});

test("strategy: COMPLETE accepted when Selected: karpathy and @karpathy delegation observed", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(
      path.join(directory, "progress.txt"),
      "## Strategy\nSelected: karpathy\nKarpathy gate: PASS\n",
      "utf-8",
    );
    // No artifacts on disk — but the session observed a karpathy delegation
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    // Simulate @karpathy delegation by triggering the delegation-observed signal
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-karp-delegation",
      agent: "karpathy",
      text: "## Run 0 — Baseline\nScore: 0.72\nDecision: BASELINE",
    });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-karp-delegation",
      agent: "reviewer",
      text: "APPROVE",
    });
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-karp-delegation",
      agent: "autonomous",
      text: [
        "```json",
        '{"command":"python train.py","exit_code":0}',
        "```",
        "<promise>COMPLETE</promise>",
      ].join("\n"),
    });

    assert.equal(prompts.length, 0, "should accept COMPLETE when @karpathy delegation was observed");
  });
});

test("strategy: COMPLETE accepted when Selected: direct", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(
      path.join(directory, "progress.txt"),
      "## Strategy\nSelected: direct\nReason: one-shot implementation with tests\n",
      "utf-8",
    );
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-direct",
      agent: "reviewer",
      text: "APPROVE",
    });
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-direct",
      agent: "autonomous",
      text: [
        "```json",
        '{"command":"pytest -q","exit_code":0}',
        "```",
        "<promise>COMPLETE</promise>",
      ].join("\n"),
    });

    assert.equal(prompts.length, 0, "should accept COMPLETE when Selected: direct");
  });
});

test("strategy: COMPLETE rejected when progress.txt has no Selected: line", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(
      path.join(directory, "progress.txt"),
      "## Log\n- did some things\n",
      "utf-8",
    );
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-no-selected",
      agent: "reviewer",
      text: "APPROVE",
    });
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-no-selected",
      agent: "autonomous",
      text: [
        "```json",
        '{"command":"pytest -q","exit_code":0}',
        "```",
        "<promise>COMPLETE</promise>",
      ].join("\n"),
    });

    assert.equal(prompts.length, 1, "should reject when no Selected: line");
    assert.match(prompts[0], /Selected:|strategy/i);
  });
});

test("strategy: COMPLETE rejected when progress.txt is absent (progress is required)", async () => {
  // progress.txt is part of the autonomous contract ("required" in the agent
  // prompt). A missing file must fail COMPLETE, not silently skip the
  // strategy check.
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    // No progress.txt
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-no-progress",
      agent: "reviewer",
      text: "APPROVE",
    });
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-no-progress",
      agent: "autonomous",
      text: [
        "```json",
        '{"command":"pytest -q","exit_code":0}',
        "```",
        "<promise>COMPLETE</promise>",
      ].join("\n"),
    });

    assert.equal(prompts.length, 1, "should reject COMPLETE when progress.txt is absent");
    assert.match(prompts[0], /progress\.txt not found/i);
  });
});

// ---------------------------------------------------------------------------
// Spec-freshness enforcement
// ---------------------------------------------------------------------------

test("spec freshness: COMPLETE rejected when SPEC.md diverges from the observed payload", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# old spec\n", "utf-8");
    await writeFile(
      path.join(directory, "progress.txt"),
      "## Strategy\nSelected: direct\n",
      "utf-8",
    );
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    // Prometheus payload observed — the gate auto-materializes it to SPEC.md.
    const newSpecContent = "# new spec from Prometheus\n## Problem\nA different problem.\n";
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-stale-spec",
      agent: "prometheus",
      text: `Here is the plan.\n\n<spec filename="SPEC.md">\n${newSpecContent}</spec>\n\nInvoke @autonomous to write this SPEC.md verbatim and execute it.`,
    });

    // SPEC.md is then overwritten with content that no longer matches the
    // payload (agent drift, stale checkout, manual edit — any divergence).
    await writeFile(path.join(directory, "SPEC.md"), "# old spec\n", "utf-8");

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-stale-spec",
      agent: "reviewer",
      text: "APPROVE",
    });
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-stale-spec",
      agent: "autonomous",
      text: [
        "```json",
        '{"command":"pytest -q","exit_code":0}',
        "```",
        "<promise>COMPLETE</promise>",
      ].join("\n"),
    });

    assert.equal(prompts.length, 1, "should reject COMPLETE when SPEC.md does not match the observed payload");
    assert.match(prompts[0], /SPEC\.md|payload|materializ/i);
  });
});

test("spec freshness: COMPLETE accepted when SPEC.md matches the Prometheus payload", async () => {
  await withTempDir(async (directory) => {
    const newSpecContent = "# new spec from Prometheus\n## Problem\nA different problem.\n";
    // SPEC.md already has the correct content (materialized before COMPLETE)
    await writeFile(path.join(directory, "SPEC.md"), newSpecContent, "utf-8");
    await writeFile(
      path.join(directory, "progress.txt"),
      "## Strategy\nSelected: direct\n",
      "utf-8",
    );
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-fresh-spec",
      agent: "prometheus",
      text: `<spec filename="SPEC.md">\n${newSpecContent}</spec>\n\nInvoke @autonomous to write this SPEC.md verbatim and execute it.`,
    });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-fresh-spec",
      agent: "reviewer",
      text: "APPROVE",
    });
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-fresh-spec",
      agent: "autonomous",
      text: [
        "```json",
        '{"command":"pytest -q","exit_code":0}',
        "```",
        "<promise>COMPLETE</promise>",
      ].join("\n"),
    });

    assert.equal(prompts.length, 0, "should accept COMPLETE when SPEC.md matches the Prometheus payload");
  });
});

test("spec freshness: COMPLETE accepted when no Prometheus payload was observed this session", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# any spec\n", "utf-8");
    await writeFile(
      path.join(directory, "progress.txt"),
      "## Strategy\nSelected: direct\n",
      "utf-8",
    );
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });
    // No Prometheus message observed this session

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-no-prometheus",
      agent: "reviewer",
      text: "APPROVE",
    });
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-no-prometheus",
      agent: "autonomous",
      text: [
        "```json",
        '{"command":"pytest -q","exit_code":0}',
        "```",
        "<promise>COMPLETE</promise>",
      ].join("\n"),
    });

    assert.equal(prompts.length, 0, "should not fail when no Prometheus payload was seen this session");
  });
});

// ---------------------------------------------------------------------------
// Mutation gate
// ---------------------------------------------------------------------------

async function setupMutationConfig(directory, cfg) {
  const oc = path.join(directory, ".opencode");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(oc, { recursive: true }));
  await writeFile(path.join(oc, "mutation.json"), JSON.stringify(cfg), "utf-8");
  // These tests exercise the mutation gate; satisfy the progress requirement
  // so correctives stay single-purpose.
  await writeFile(path.join(directory, "progress.txt"), PROGRESS_DIRECT, "utf-8");
}

async function writeMutationResult(directory, result) {
  const oc = path.join(directory, ".opencode");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(oc, { recursive: true }));
  await writeFile(
    path.join(oc, "mutation-result.json"),
    JSON.stringify(result),
    "utf-8",
  );
}

const COMPLETE_WITH_EVIDENCE = [
  "```json",
  '{"command":"pytest -q","exit_code":0}',
  "```",
  "<promise>COMPLETE</promise>",
].join("\n");

test("mutation gate: inert when .opencode/mutation.json is absent", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(path.join(directory, "progress.txt"), PROGRESS_DIRECT, "utf-8");
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant", sessionId: "s-mut-inert", agent: "reviewer", text: "APPROVE",
    });
    await hooks["message.part.updated"]({
      role: "assistant", sessionId: "s-mut-inert", agent: "autonomous",
      text: COMPLETE_WITH_EVIDENCE,
    });

    assert.equal(prompts.length, 0, "gate should be inert when mutation.json absent");
  });
});

test("mutation gate: inert when enabled=false", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await setupMutationConfig(directory, { enabled: false, result_path: ".opencode/mutation-result.json", score_threshold: 0.70 });
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant", sessionId: "s-mut-disabled", agent: "reviewer", text: "APPROVE",
    });
    await hooks["message.part.updated"]({
      role: "assistant", sessionId: "s-mut-disabled", agent: "autonomous",
      text: COMPLETE_WITH_EVIDENCE,
    });

    assert.equal(prompts.length, 0, "gate should be inert when enabled=false");
  });
});

test("mutation gate: blocks COMPLETE when result artifact is missing", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await setupMutationConfig(directory, { enabled: true, result_path: ".opencode/mutation-result.json", score_threshold: 0.70 });
    // No result file written
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant", sessionId: "s-mut-missing", agent: "reviewer", text: "APPROVE",
    });
    await hooks["message.part.updated"]({
      role: "assistant", sessionId: "s-mut-missing", agent: "autonomous",
      text: COMPLETE_WITH_EVIDENCE,
    });

    assert.equal(prompts.length, 1, "should block when result is missing");
    assert.match(prompts[0], /mutation/i);
  });
});

test("mutation gate: blocks COMPLETE when score below threshold", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await setupMutationConfig(directory, { enabled: true, result_path: ".opencode/mutation-result.json", score_threshold: 0.70 });
    await writeMutationResult(directory, {
      score: 0.40, killed: 4, survived: 6, total: 10, files: [], generated_at: new Date().toISOString(), passed: false,
    });
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant", sessionId: "s-mut-low", agent: "reviewer", text: "APPROVE",
    });
    await hooks["message.part.updated"]({
      role: "assistant", sessionId: "s-mut-low", agent: "autonomous",
      text: COMPLETE_WITH_EVIDENCE,
    });

    assert.equal(prompts.length, 1, "should block when score < threshold");
    assert.match(prompts[0], /threshold|mutation/i);
  });
});

test("mutation gate: blocks COMPLETE when result is stale", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    // Write a source file
    const srcFile = path.join(directory, "src.py");
    await writeFile(srcFile, "x = 1\n", "utf-8");

    await setupMutationConfig(directory, { enabled: true, result_path: ".opencode/mutation-result.json", score_threshold: 0.70 });

    // Result was generated BEFORE the source file (use a past timestamp)
    const pastTs = new Date(Date.now() - 10000).toISOString();
    await writeMutationResult(directory, {
      score: 0.85, killed: 17, survived: 3, total: 20,
      files: [srcFile],
      generated_at: pastTs,
      passed: true,
    });

    // Touch the source file to make it newer than the result
    const now = new Date();
    await import("node:fs/promises").then(({ utimes }) => utimes(srcFile, now, now));

    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant", sessionId: "s-mut-stale", agent: "reviewer", text: "APPROVE",
    });
    await hooks["message.part.updated"]({
      role: "assistant", sessionId: "s-mut-stale", agent: "autonomous",
      text: COMPLETE_WITH_EVIDENCE,
    });

    assert.equal(prompts.length, 1, "should block when result is stale");
    assert.match(prompts[0], /stale|mutation/i);
  });
});

test("mutation gate: accepts COMPLETE when score passes and result is fresh", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await setupMutationConfig(directory, { enabled: true, result_path: ".opencode/mutation-result.json", score_threshold: 0.70 });
    await writeMutationResult(directory, {
      score: 0.85, killed: 17, survived: 3, total: 20, files: [], generated_at: new Date().toISOString(), passed: true,
    });
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant", sessionId: "s-mut-pass", agent: "reviewer", text: "APPROVE",
    });
    await hooks["message.part.updated"]({
      role: "assistant", sessionId: "s-mut-pass", agent: "autonomous",
      text: COMPLETE_WITH_EVIDENCE,
    });

    assert.equal(prompts.length, 0, "should accept COMPLETE when mutation gate passes");
  });
});

// ---------------------------------------------------------------------------
// Karpathy artifact CONTENT checks (existence alone must not pass)
// ---------------------------------------------------------------------------

test("strategy: COMPLETE rejected when Karpathy artifacts exist but are hollow", async () => {
  await withTempDir(async (directory) => {
    const { mkdir } = await import("node:fs/promises");
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(
      path.join(directory, "progress.txt"),
      "## Strategy\nSelected: karpathy\n",
      "utf-8",
    );
    // All three artifacts exist — but carry no real loop content.
    await writeFile(path.join(directory, "program.md"), "", "utf-8");
    await writeFile(path.join(directory, "experiments.md"), "notes\n", "utf-8");
    await mkdir(path.join(directory, ".opencode"), { recursive: true });
    await writeFile(path.join(directory, ".opencode", "karpathy.json"), "{}", "utf-8");

    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-karp-hollow",
      agent: "autonomous",
      text: [
        "```json",
        '{"command":"python train.py","exit_code":0}',
        "```",
        "<promise>COMPLETE</promise>",
      ].join("\n"),
    });

    assert.equal(prompts.length, 1, "hollow artifacts (touched files) must not satisfy the Karpathy gate");
    assert.match(prompts[0], /hollow|empty|no '## Run'/i);
  });
});

// ---------------------------------------------------------------------------
// Workaround-dump detector: evidence output must not false-positive
// ---------------------------------------------------------------------------

test("workaround dump: evidence block containing 'unavailable' is not intercepted", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const prompts = [];
    // No bash in the tool list — detector is armed.
    const client = makeClient({ tools: ["read", "glob", "grep"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    // Trigger word appears only INSIDE the fenced evidence block.
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-evidence-excerpt",
      agent: "autonomous",
      text: [
        "Final verification output:",
        "```json",
        '{"command":"pytest -q","exit_code":0,"excerpt":"warning: plugin xdist unavailable\\n42 passed"}',
        "```",
      ].join("\n"),
    });

    // Trigger word in prose, but the only code block is an evidence block.
    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-evidence-prose",
      agent: "autonomous",
      text: [
        "The staging server is unavailable, so I verified locally instead:",
        "```json",
        '{"command":"pytest -q","exit_code":0,"excerpt":"42 passed"}',
        "```",
      ].join("\n"),
    });

    assert.equal(prompts.length, 0, "evidence reporting must not trigger the workaround-dump corrective");
  });
});

// ---------------------------------------------------------------------------
// Reviewer approval staleness
// ---------------------------------------------------------------------------

async function setupLocalReviewer(directory) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(directory, "agents"), { recursive: true });
  await writeFile(
    path.join(directory, "agents", "reviewer.md"),
    "---\ndescription: reviewer\n---\nreviewer\n",
    "utf-8",
  );
}

const REVIEWER_APPROVAL = "## Review\n\n### Verdict\nAPPROVE";

test("reviewer approval: invalidated by a post-approval code edit", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(path.join(directory, "progress.txt"), PROGRESS_DIRECT, "utf-8");
    await setupLocalReviewer(directory);

    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read", "task"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-stale-approve",
      agent: "reviewer",
      text: REVIEWER_APPROVAL,
    });

    // Code changes after the APPROVE — the reviewer signed off on old state.
    await hooks["file.edited"]({
      sessionId: "s-stale-approve",
      filePath: path.join(directory, "src.py"),
    });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-stale-approve",
      agent: "autonomous",
      text: [
        "```json",
        '{"command":"pytest -q","exit_code":0}',
        "```",
        "<promise>COMPLETE</promise>",
      ].join("\n"),
    });

    assert.equal(prompts.length, 1, "COMPLETE must be rejected when approval predates the last code edit");
    assert.match(prompts[0], /reviewer/i);
  });
});

test("reviewer approval: still valid when no edits follow it", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(path.join(directory, "progress.txt"), PROGRESS_DIRECT, "utf-8");
    await setupLocalReviewer(directory);

    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read", "task"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    // Edits happen BEFORE the review — the normal implement-then-review order.
    await hooks["file.edited"]({
      sessionId: "s-fresh-approve",
      filePath: path.join(directory, "src.py"),
    });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-fresh-approve",
      agent: "reviewer",
      text: REVIEWER_APPROVAL,
    });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-fresh-approve",
      agent: "autonomous",
      text: [
        "```json",
        '{"command":"pytest -q","exit_code":0}',
        "```",
        "<promise>COMPLETE</promise>",
      ].join("\n"),
    });

    assert.equal(prompts.length, 0, "COMPLETE should be accepted when approval postdates the last edit");
  });
});

// ---------------------------------------------------------------------------
// Runner-artifact preference: transcript evidence is fallback-only
// ---------------------------------------------------------------------------

test("runner installed: transcript evidence block alone is rejected", async () => {
  await withTempDir(async (directory) => {
    const { mkdir } = await import("node:fs/promises");
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(path.join(directory, "progress.txt"), PROGRESS_DIRECT, "utf-8");
    // The deterministic runner tool exists on disk.
    await mkdir(path.join(directory, ".opencode", "tool"), { recursive: true });
    await writeFile(path.join(directory, ".opencode", "tool", "run.ts"), "export default {}\n", "utf-8");

    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-runner-transcript",
      agent: "autonomous",
      text: [
        "```json",
        '{"command":"pytest -q","exit_code":0}',
        "```",
        "<promise>COMPLETE</promise>",
      ].join("\n"),
    });

    assert.equal(prompts.length, 1, "agent-authored transcript evidence must not satisfy the gate when the runner exists");
    assert.match(prompts[0], /runner artifact/i);
  });
});

test("runner installed: passing runner artifact satisfies the gate", async () => {
  await withTempDir(async (directory) => {
    const { mkdir } = await import("node:fs/promises");
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(path.join(directory, "progress.txt"), PROGRESS_DIRECT, "utf-8");
    await mkdir(path.join(directory, ".opencode", "tool"), { recursive: true });
    await writeFile(path.join(directory, ".opencode", "tool", "run.ts"), "export default {}\n", "utf-8");
    await mkdir(path.join(directory, ".opencode", "runs"), { recursive: true });
    await writeFile(
      path.join(directory, ".opencode", "runs", "abcd1234.json"),
      JSON.stringify({ run_id: "abcd1234", exit_code: 0, command: "pytest -q" }),
      "utf-8",
    );

    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-runner-artifact",
      agent: "autonomous",
      text: "Verification ran through the runner tool.\n<promise>COMPLETE</promise>",
    });

    assert.equal(prompts.length, 0, "a passing runner artifact on disk should satisfy the evidence check");
  });
});

// ---------------------------------------------------------------------------
// Outcome recorder: plan-outcomes.jsonl ledger
// ---------------------------------------------------------------------------

async function readLedger(directory) {
  const { readFile } = await import("node:fs/promises");
  try {
    const raw = await readFile(path.join(directory, ".opencode", "plan-outcomes.jsonl"), "utf-8");
    return raw.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
  } catch {
    return [];
  }
}

test("outcome recorder: COMPLETE accepted writes ledger record", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(path.join(directory, "progress.txt"), PROGRESS_DIRECT, "utf-8");
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-ledger-complete",
      agent: "autonomous",
      text: '```json\n{"command":"pytest -q","exit_code":0}\n```\n<promise>COMPLETE</promise>',
    });

    assert.equal(prompts.length, 0, "COMPLETE should be accepted");
    const records = await readLedger(directory);
    assert.equal(records.length, 1);
    assert.equal(records[0].event, "COMPLETE");
    assert.equal(records[0].session_id, "s-ledger-complete");
    assert.ok(records[0].ts, "record must have a timestamp");
  });
});

test("outcome recorder: COMPLETE rejected writes COMPLETE_REJECTED record", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    await writeFile(path.join(directory, "progress.txt"), PROGRESS_DIRECT, "utf-8");
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-ledger-rejected",
      agent: "autonomous",
      text: "<promise>COMPLETE</promise>",
    });

    assert.equal(prompts.length, 1, "COMPLETE should be rejected");
    const records = await readLedger(directory);
    assert.equal(records.length, 1);
    assert.equal(records[0].event, "COMPLETE_REJECTED");
    assert.equal(records[0].session_id, "s-ledger-rejected");
    assert.match(records[0].detail, /evidence/i);
  });
});

test("outcome recorder: WORK_STUCK accepted writes ledger record", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "SPEC.md"), "# spec\n", "utf-8");
    const prompts = [];
    const client = makeClient({ tools: ["bash", "edit", "read"], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["file.edited"]({ sessionID: "s-ledger-stuck", path: path.join(directory, "progress.txt") });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-ledger-stuck",
      agent: "autonomous",
      text: "<promise>WORK_STUCK</promise>",
    });

    assert.equal(prompts.length, 0, "WORK_STUCK should be accepted");
    const records = await readLedger(directory);
    assert.equal(records.length, 1);
    assert.equal(records[0].event, "WORK_STUCK");
    assert.equal(records[0].session_id, "s-ledger-stuck");
  });
});

test("outcome recorder: BLOCKED accepted writes ledger record", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = makeClient({ tools: [], prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-ledger-blocked",
      agent: "autonomous",
      text: "<promise>BLOCKED</promise>",
    });

    assert.equal(prompts.length, 0, "BLOCKED should be accepted when bash is unavailable");
    const records = await readLedger(directory);
    assert.equal(records.length, 1);
    assert.equal(records[0].event, "BLOCKED");
    assert.equal(records[0].session_id, "s-ledger-blocked");
  });
});

test("outcome recorder: REQUEST_CHANGES from reviewer writes ledger record", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = makeClient({ prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-ledger-rc",
      agent: "reviewer",
      text: "## Review\n\n### Verdict\nREQUEST_CHANGES\n",
    });

    const records = await readLedger(directory);
    assert.equal(records.length, 1);
    assert.equal(records[0].event, "REQUEST_CHANGES");
    assert.equal(records[0].session_id, "s-ledger-rc");
  });
});

test("outcome recorder: SPEC_REVISED writes ledger record when prometheus payload is active", async () => {
  await withTempDir(async (directory) => {
    const prompts = [];
    const client = makeClient({ prompts });
    const hooks = await AutonomousGatePlugin({ client, directory });

    await hooks["message.part.updated"]({
      role: "assistant",
      sessionId: "s-ledger-spec",
      agent: "prometheus",
      text: '<spec filename="SPEC.md">\n# Plan\nDo the thing\n</spec>',
    });

    await hooks["file.edited"]({
      sessionID: "s-ledger-spec",
      path: path.join(directory, "SPEC.md"),
    });

    const records = await readLedger(directory);
    const specRevised = records.filter(r => r.event === "SPEC_REVISED");
    assert.equal(specRevised.length, 1);
    assert.equal(specRevised[0].session_id, "s-ledger-spec");
    assert.ok(specRevised[0].spec_hash, "record must carry the prometheus payload hash");
  });
});
