import test, { after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

// Redirect the audit record before the plugin is imported. Any transform that
// drops a turn appends to it, so without this the suite writes into the real
// record at ~/.local/share/opencode/announce-hygiene.jsonl.
const AUDIT_ROOT = await mkdtemp(path.join(os.tmpdir(), "announce-hygiene-"));
const AUDIT_FILE = path.join(AUDIT_ROOT, "audit.jsonl");
process.env.OPENCODE_ANNOUNCE_HYGIENE_AUDIT = AUDIT_FILE;
after(() => rm(AUDIT_ROOT, { recursive: true, force: true }));

const { AnnounceHygiene } = await import("../../plugins/announce-hygiene.ts");

// The plugin exports only its factory, because OpenCode calls every exported
// function as a plugin factory. Its predicates are reached through the inert
// __selftest property instead.
const hooks = await AnnounceHygiene();
const { announceShape, isSeededTurn, providerOf, RULE } = hooks.__selftest;
const transform = hooks["experimental.chat.messages.transform"];
const systemTransform = hooks["experimental.chat.system.transform"];

/** Run against an empty audit record and hand back its path. */
async function auditFixture(fn) {
  await writeFile(AUDIT_FILE, "");
  await fn(hooks, AUDIT_FILE);
}

function turn(id, overrides = {}, parts = []) {
  return {
    info: {
      id,
      sessionID: "ses_test",
      role: "assistant",
      finish: "stop",
      providerID: "ollama-heavy",
      modelID: "qwen36-35b-coding",
      ...overrides,
    },
    parts,
  };
}

const text = (value) => ({ type: "text", text: value });
const seeded = (id, value = "The mock is wrong. Let me fix it:") =>
  turn(id, {}, [{ type: "step-start" }, text(value), { type: "step-finish" }]);

test("a turn promising an action is recognised, a real conclusion is not", () => {
  assert.equal(announceShape("Let me fix it:"), true);
  assert.equal(announceShape("The mock is wrong. Let me rewrite the handler"), true);
  assert.equal(announceShape("Now let's fix the SEARCH branch:"), true);
  assert.equal(announceShape("Done. All 12 tests pass, 0 failures."), false);
  assert.equal(announceShape("Which file did you mean?"), false);
  assert.equal(announceShape(""), false);
});

test("a model correctly waiting on the user is not treated as a failure", () => {
  // A looser rule matched this and flagged legitimate endings on every
  // provider, including Claude at an apparent 3-5%.
  assert.equal(
    announceShape("Once you have applied that change, let me know and I will verify."),
    false,
  );
  assert.equal(announceShape("Please run the deploy, then I will check the config."), false);
});

test("non-string input is inert, which is what OpenCode passes at load time", () => {
  // OpenCode calls exported functions with { directory, worktree, client }.
  // Assuming a string here is what took the whole plugin down on first write.
  assert.equal(announceShape({ directory: "/tmp", client: {} }), false);
  assert.equal(announceShape(undefined), false);
  assert.equal(announceShape(null), false);
  assert.equal(announceShape(42), false);
});

test("only a local assistant turn that stopped without a tool call qualifies", () => {
  assert.equal(isSeededTurn(seeded("msg_a")), true);

  assert.equal(
    isSeededTurn(turn("msg_b", { role: "user" }, [text("Let me fix it:")])),
    false,
    "a user message is never a candidate",
  );
  assert.equal(
    isSeededTurn(turn("msg_c", { finish: "tool-calls" }, [text("Let me fix it:")])),
    false,
    "a turn that did call a tool is never a candidate",
  );
  assert.equal(
    isSeededTurn(turn("msg_d", { providerID: "anthropic" }, [text("Let me fix it:")])),
    false,
    "Claude and GPT never showed this failure, so their history is left alone",
  );
  assert.equal(
    isSeededTurn(turn("msg_e", {}, [text("Let me fix it:"), { type: "tool", tool: "read" }])),
    false,
    "a tool part present means removal could orphan a tool result",
  );
  assert.equal(
    isSeededTurn(turn("msg_f", {}, [text("Done, all tests pass.")])),
    false,
    "a genuine conclusion stays",
  );
});

test("malformed entries never throw", () => {
  for (const entry of [{}, { info: null }, { info: {} }, { parts: null }, { info: { role: "assistant" } }]) {
    assert.equal(isSeededTurn(entry), false);
  }
});

test("the transform drops seeded turns and keeps everything else", async () => {
  const messages = [
    turn("msg_user1", { role: "user", finish: undefined }, [text("fix the test")]),
    seeded("msg_seed1"),
    turn("msg_user2", { role: "user", finish: undefined }, [text("keep going")]),
    seeded("msg_seed2", "Let me look at how the other mocks do it:"),
    turn("msg_work", { finish: "tool-calls" }, [text("Reading it now"), { type: "tool", tool: "read" }]),
    turn("msg_done", {}, [text("All 12 tests pass.")]),
    turn("msg_last", { role: "user", finish: undefined }, [text("and the notebook?")]),
  ];
  const output = { messages: messages.slice() };
  await transform({}, output);

  const kept = output.messages.map((entry) => entry.info.id);
  assert.deepEqual(kept, ["msg_user1", "msg_user2", "msg_work", "msg_done", "msg_last"]);
});

test("the final entry is kept even when it is itself seeded", async () => {
  // It is the turn being continued from. Removing it would change the request
  // rather than clean the history behind it.
  const messages = [
    turn("msg_user", { role: "user", finish: undefined }, [text("go")]),
    seeded("msg_seed"),
    seeded("msg_final", "Let me fix the SEARCH handler:"),
  ];
  const output = { messages: messages.slice() };
  await transform({}, output);
  assert.deepEqual(output.messages.map((e) => e.info.id), ["msg_user", "msg_final"]);
});

test("the transform is idempotent and leaves clean histories alone", async () => {
  const clean = {
    messages: [
      turn("msg_user", { role: "user", finish: undefined }, [text("go")]),
      turn("msg_done", {}, [text("All tests pass.")]),
    ],
  };
  const before = clean.messages.slice();
  await transform({}, clean);
  assert.deepEqual(clean.messages, before);

  const dirty = {
    messages: [
      turn("msg_user", { role: "user", finish: undefined }, [text("go")]),
      seeded("msg_seed"),
      turn("msg_last", { role: "user", finish: undefined }, [text("again")]),
    ],
  };
  await transform({}, dirty);
  const after = dirty.messages.length;
  await transform({}, dirty);
  assert.equal(dirty.messages.length, after);
});

test("a short or absent message list is safe", async () => {
  await transform({}, {});
  await transform({}, { messages: null });
  const single = { messages: [seeded("msg_only")] };
  await transform({}, single);
  assert.equal(single.messages.length, 1);
});

test("each removal is recorded once, with the turn ids", async () => {
  await auditFixture(async (scoped, file) => {
    const output = {
      messages: [
        turn("msg_user", { role: "user", finish: undefined }, [text("go")]),
        seeded("msg_seed1"),
        seeded("msg_seed2"),
        turn("msg_last", { role: "user", finish: undefined }, [text("again")]),
      ],
    };
    await scoped["experimental.chat.messages.transform"]({}, output);
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.before, 4);
    assert.equal(record.after, 2);
    assert.deepEqual(record.dropped, ["msg_seed1", "msg_seed2"]);
    assert.equal(record.sessionID, "ses_test");
  });
});

test("nothing is recorded when nothing is dropped", async () => {
  await auditFixture(async (scoped, file) => {
    const output = {
      messages: [
        turn("msg_user", { role: "user", finish: undefined }, [text("go")]),
        turn("msg_done", {}, [text("All tests pass.")]),
      ],
    };
    await scoped["experimental.chat.messages.transform"]({}, output);
    assert.equal(await readFile(file, "utf8"), "");
  });
});

test("the prompt rule is appended for local models only", async () => {
  const local = { system: ["base prompt"] };
  await systemTransform({ model: { providerID: "ollama-heavy", modelID: "qwen36-35b-coding" } }, local);
  assert.deepEqual(local.system, ["base prompt", RULE]);

  await systemTransform({ model: { providerID: "ollama-heavy" } }, local);
  assert.equal(local.system.length, 2, "appending twice would waste context");

  const remote = { system: ["base prompt"] };
  await systemTransform({ model: { providerID: "openai", modelID: "gpt-5.6-terra" } }, remote);
  assert.deepEqual(remote.system, ["base prompt"]);

  const missing = { system: ["base prompt"] };
  await systemTransform({ model: undefined }, missing);
  await systemTransform({}, { system: null });
  assert.deepEqual(missing.system, ["base prompt"]);
});

test("provider identity is read from either shape", () => {
  assert.equal(providerOf({ providerID: "ollama-heavy" }), "ollama-heavy");
  assert.equal(providerOf({ provider: { id: "ollama-local" } }), "ollama-local");
  assert.equal(providerOf(undefined), undefined);
  assert.equal(providerOf("ollama"), undefined);
});

test("the module exports only its factory, so OpenCode can load it", async () => {
  const module = await import("../../plugins/announce-hygiene.ts");
  assert.deepEqual(Object.keys(module), ["AnnounceHygiene"]);
  await module.AnnounceHygiene({ directory: "/tmp", worktree: "/tmp", client: {} });
});
