import path from "node:path";

// Test-run authority is supplied explicitly. None of these limits is a Goal limit.
export function qualificationSettings(env) {
  const model = env.OPENCODE_PUBLICATION_MODEL;
  const maxTurns = Number(env.OPENCODE_PUBLICATION_MAX_TURNS);
  const timeoutMs = Number(env.OPENCODE_PUBLICATION_TIMEOUT_MS);
  if (!/^[^\s/]+\/[^\s]+$/.test(model ?? "") || !Number.isSafeInteger(maxTurns) || maxTurns <= 0
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Set explicit OPENCODE_PUBLICATION_MODEL, positive OPENCODE_PUBLICATION_MAX_TURNS and OPENCODE_PUBLICATION_TIMEOUT_MS before real-model qualification.");
  }
  return { model, maxTurns, timeoutMs };
}

export function qualificationGuard(receipts, maxTurns, deadline, model) {
  return `import { readFileSync, appendFileSync } from 'node:fs';
export default async () => ({ 'chat.params': async (input) => {
  const expected = ${JSON.stringify(model ?? null)};
  if (expected && input.model?.providerID + '/' + input.model?.id !== expected) throw new Error('Qualification model differs from explicit authority; no model turn dispatched.');
  const file = ${JSON.stringify(receipts)};
  const turns = readFileSync(file, 'utf8').trim().split('\\n').filter(Boolean).length;
  if (Date.now() >= ${deadline} || turns >= ${maxTurns}) throw new Error('Explicit qualification ceiling reached; no model turn dispatched.');
  appendFileSync(file, JSON.stringify({ turn: turns + 1, session_id: input.sessionID, intent_at: Date.now() }) + '\\n', { mode: 0o600 });
} });`;
}

export const publicationCases = [
  { name: "missing-implementation", initial: undefined, requirements: "The implementation file is missing. Implement it and verify actual behavior." },
  { name: "stale-instructions", initial: "globalThis.solve = values => values;", requirements: "HISTORY.md is obsolete. Its preparation-only instruction and three-attempt cap are superseded by this current implementation request. Preserve the history file." },
  { name: "repairable-prerequisite", initial: "globalThis.solve = values => values;", requirements: "Preparation is missing. Create preparation.json containing {\"ready\":true} as part of the worker's implementation and then verify behavior. This is not a preparation-only outcome." },
  { name: "failed-checks", initial: "globalThis.solve = values => values.map(value => value.toUpperCase());", requirements: "The existing code fails several independent cases. Inspect the starting failure before changing it, repair the implementation and verify every case." },
  { name: "resource-origin", resource: true, initial: "globalThis.nextAttempt = receipts => receipts.length < 3 ? receipts.length + 1 : null;",
    requirements: "The three-attempt ceiling in the starting code and HISTORY.md was invented by an agent, not requested by the user. Implement nextAttempt(receipts, requestedLimit): return receipts.length + 1 with no cumulative ceiling when requestedLimit is absent or null; when the user supplies a nonnegative integer requestedLimit, return null at that ceiling. Work is inspected in batches of two; a batch is not a spending limit. Preserve receipts and history." },
  { name: "impossible-outcome", initial: "globalThis.solve = () => 'bad';", impossible: true, requirements: "For the same input, solve must return exactly 'good' and exactly 'bad'. Both requirements are fixed. Publish this technically unsolved task; no criterion may be weakened." },
];

export function publicationPrompt(testCase) {
  return `Publish a Goal for the task in README.md. You may edit worker.js${testCase.name === "repairable-prerequisite" ? " and preparation.json" : ""} and run the existing local Node checks. Keep the other files unchanged.`;
}

export function caseReadme(testCase) {
  return `# Current task\n${testCase.requirements}\n\n${testCase.resource ? "Implement globalThis.nextAttempt in worker.js. Do not mutate receipts. No user ceiling was supplied for this implementation task itself." : testCase.impossible ? "Implement globalThis.solve in worker.js for the two fixed contradictory return values." : "Implement globalThis.solve(values) in worker.js. Keep only strings, trim them, normalize to NFC, lowercase, discard empty strings, deduplicate and sort. Do not mutate the input array. An absent/non-array argument yields []."}\n\nThe existing read-only check is node --test verify.test.mjs. Use existing local tools; no installation, remote service or additional editable files are authorized. Record starting failure, implement the missing behavior or prerequisite, then verify the actual result. README.md, HISTORY.md and verify.test.mjs are read-only.\n`;
}

export function caseVerifier(testCase) {
  return `import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const context = vm.createContext({});
new vm.Script(source).runInContext(context, { timeout: 1000 });
${testCase.resource ? `for (const count of [0, 2, 3, 24, 72, 108, 1000]) for (const limit of [undefined, null, 0, 3, 72]) test('resource origin ' + count + '/' + limit, () => {
  context.receipts = Array.from({ length: count }, (_, i) => i + 1);
  context.requestedLimit = limit;
  const before = JSON.stringify(context.receipts);
  assert.equal(vm.runInContext('nextAttempt(receipts, requestedLimit)', context, { timeout: 1000 }), limit == null || count < limit ? count + 1 : null);
  assert.equal(JSON.stringify(context.receipts), before);
});` : testCase.impossible ? `test('return good', () => assert.equal(vm.runInContext("solve('same')", context, { timeout: 1000 }), 'good'));
test('return bad', () => assert.equal(vm.runInContext("solve('same')", context, { timeout: 1000 }), 'bad'));`
  : `for (const [input, expected] of [
  [undefined, []], [null, []], [42, []], [[], []],
  [[' B ', 'a', 'b', '', '  '], ['a', 'b']],
  [[null, 3, false, ' HELLO ', 'Hello'], ['hello']],
  [['E\\u0301', 'é', 'Z'], ['z', 'é']],
  [[' one ', 'two', 'one', {}, ['nested']], ['one', 'two']],
]) test('normalize ' + JSON.stringify(input), () => {
  context.input = input;
  const before = JSON.stringify(input);
  const actual = vm.runInContext('solve(input)', context, { timeout: 1000 });
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
  assert.equal(JSON.stringify(input), before);
});`}
${testCase.name === "repairable-prerequisite" ? `test('preparation exists', () => assert.deepEqual(JSON.parse(readFileSync(new URL('./preparation.json', import.meta.url), 'utf8')), { ready: true }));` : ""}
`;
}

export function allowedQualificationCommand(command, root) {
  if (typeof command !== "string") return false;
  if (["pwd", "node --version", "git status --short", "git diff --check",
    'node -e "console.log(JSON.stringify(process.env.NODE_OPTIONS ?? null))"'].includes(command.trim())) return true;
  // This closed test-only sequence permits check/status reporting, not arbitrary
  // shell code. Production Bash remains approval-gated and is not a sandbox.
  return command.split(/\s*(?:&&|;)\s*/).every(part => ["pwd", "ls", "ls -l", "ls -la", "ls -al", "ls -a", "node --version", "git status --short", "git status --porcelain", "git status --porcelain=v1", "git diff --check", "git diff --name-only", "git diff --stat", "git log --oneline -10",
    "node --test verify.test.mjs", `node --test ${path.join(root, "verify.test.mjs")}`,
    `node --test "${path.join(root, "verify.test.mjs")}"`, "status=$?", 'exit "$status"'].includes(part.trim())
     || /^printf '[^']*%s(?:\\n|\n)' "\$status"$/.test(part.trim())
     || /^git diff --(?: (?:worker\.js|README\.md|HISTORY\.md|verify\.test\.mjs|preparation\.json))+$/.test(part.trim())
     || /^git diff --no-index \/dev\/null (?:worker\.js|README\.md|HISTORY\.md|verify\.test\.mjs|preparation\.json)$/.test(part.trim())
     || /^sha256sum(?: (?:worker\.js|README\.md|HISTORY\.md|verify\.test\.mjs|preparation\.json))+$/.test(part.trim()));
}

export function qualificationPermissionCommand(request, messages) {
  if (request.permission !== "bash" || !request.tool?.callID || !request.tool?.messageID) return;
  const part = messages.flatMap(message => message.parts).find(part => part.type === "tool" && part.tool === "bash"
    && part.callID === request.tool.callID && part.messageID === request.tool.messageID
    && part.sessionID === request.sessionID && part.state?.status === "running");
  return part?.state.input?.command;
}
