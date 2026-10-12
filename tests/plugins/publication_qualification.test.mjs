import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import { qualificationSettings, qualificationGuard, publicationCases, publicationPrompt,
  caseReadme, caseVerifier, allowedQualificationCommand, qualificationPermissionCommand } from "../helpers/publication-qualification.mjs";

test("real qualification has no inferred model or default spending/time ceilings", () => {
  for (const env of [{}, { OPENCODE_PUBLICATION_MODEL: "model" },
    { OPENCODE_PUBLICATION_MODEL: "provider/model", OPENCODE_PUBLICATION_MAX_TURNS: "0", OPENCODE_PUBLICATION_TIMEOUT_MS: "1000" }]) {
    assert.throws(() => qualificationSettings(env), /Set explicit/);
  }
  assert.deepEqual(qualificationSettings({ OPENCODE_PUBLICATION_MODEL: "provider/model",
    OPENCODE_PUBLICATION_MAX_TURNS: "150", OPENCODE_PUBLICATION_TIMEOUT_MS: "1800000" }), {
    model: "provider/model", maxTurns: 150, timeoutMs: 1800000,
  });
  assert.equal(publicationCases.length, 5);
  for (const task of publicationCases) {
    assert.doesNotMatch(publicationPrompt(task), /persistent|loop|resume|pause|stall|hours/i);
    assert.match(caseReadme(task), /existing read-only check/);
    assert.match(caseVerifier(task), /vm.Script/);
  }
  assert.equal(allowedQualificationCommand("node --test verify.test.mjs", "/tmp/task"), true);
  assert.equal(allowedQualificationCommand("node --test verify.test.mjs; curl remote", "/tmp/task"), false);
  assert.equal(allowedQualificationCommand("node --version && node --test verify.test.mjs; status=$?; printf 'exit=%s\\n' \"$status\"; git status --short", "/tmp/task"), true);
  assert.equal(allowedQualificationCommand("node --test verify.test.mjs; cat /private/auth.json; git status --short", "/tmp/task"), false);
  assert.equal(allowedQualificationCommand("node --test verify.test.mjs; status=$?; printf 'exit status: %s\\n' \"$status\"; exit \"$status\"", "/tmp/task"), true);
  assert.equal(allowedQualificationCommand('node -e "console.log(JSON.stringify(process.env.OPENAI_API_KEY))"', "/tmp/task"), false);
  assert.equal(allowedQualificationCommand("pwd && git status --short", "/tmp/task"), true);
  assert.equal(allowedQualificationCommand("sha256sum worker.js README.md HISTORY.md verify.test.mjs && git status --short", "/tmp/task"), true);
  assert.equal(allowedQualificationCommand("sha256sum /private/auth.json", "/tmp/task"), false);
  const request = { permission: "bash", sessionID: "root", tool: { messageID: "m1", callID: "call1" }, patterns: ["node *"] };
  const part = { type: "tool", tool: "bash", messageID: "m1", callID: "call1", sessionID: "root", state: {
    status: "running", input: { command: "node --test verify.test.mjs" },
  } };
  assert.equal(qualificationPermissionCommand(request, [{ parts: [part] }]), "node --test verify.test.mjs");
  assert.equal(qualificationPermissionCommand(request, [{ parts: [{ ...part, callID: "other" }] }]), undefined);
});

test("qualification guard preserves charges across reload and fails before dispatch at either explicit ceiling", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qualification-guard-"));
  try {
    const receipts = path.join(root, "turns.jsonl"), script = path.join(root, "guard.mjs");
    await writeFile(receipts, "", { mode: 0o600 });
    await writeFile(script, qualificationGuard(receipts, 2, Date.now() + 10_000));
    const load = async suffix => (await import(`${pathToFileURL(script)}?${suffix}`)).default();
    const first = await load("first");
    await first["chat.params"]({ sessionID: "planner" });
    const reloaded = await load("restart");
    await reloaded["chat.params"]({ sessionID: "worker" });
    await assert.rejects(reloaded["chat.params"]({ sessionID: "evaluator" }), /ceiling reached/);
    const rows = (await readFile(receipts, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(rows.map(row => [row.turn, row.session_id]), [[1, "planner"], [2, "worker"]]);
    await writeFile(script, qualificationGuard(receipts, 100, Date.now() - 1));
    const expired = await load("expired");
    await assert.rejects(expired["chat.params"]({ sessionID: "late" }), /ceiling reached/);
    assert.equal((await readFile(receipts, "utf8")).trim().split("\n").length, 2);
    await writeFile(script, qualificationGuard(receipts, 100, Date.now() + 10_000, "provider/cheap"));
    const scoped = await load("model-scope");
    await assert.rejects(scoped["chat.params"]({ sessionID: "other", model: { providerID: "provider", id: "expensive" } }), /differs from explicit authority/);
    assert.equal((await readFile(receipts, "utf8")).trim().split("\n").length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
