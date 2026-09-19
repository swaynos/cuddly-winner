import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import publishDirectAgent, {
  publishDirectAgentFile,
  readDirectAgentPolicy,
} from "../../tools/publish_direct_agent.ts";

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "direct-agent-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function request(overrides = {}) {
  return {
    name: "retry-fix",
    description: "Fix retry scheduling.",
    outcome: "Retry scheduling follows the requested policy.",
    acceptance_criteria: ["The retry policy has focused coverage."],
    durable_context: ["docs/REQUIREMENTS.md"],
    edit_paths: ["src/retry.ts", "tests/retry.test.mjs"],
    bash: true,
    verification_commands: ["node --test tests/retry.test.mjs"],
    stop_conditions: ["The requested outcome becomes ambiguous."],
    escalation_triggers: ["Required work exceeds the declared paths."],
    instructions: "Make the smallest correct change and run the declared verification.",
    ...overrides,
  };
}

test("publishes one self-contained task-derived Direct agent", async () => fixture(async root => {
  const result = await publishDirectAgentFile(root, request());
  assert.deepEqual(result, {
    name: "retry-fix",
    path: ".opencode/agents/generated/retry-fix.md",
  });

  const file = path.join(root, result.path);
  assert.equal((await lstat(file)).isFile(), true);
  const content = await readFile(file, "utf8");
  assert.match(content, /^---\nname: retry-fix\n/m);
  assert.match(content, /# Outcome\nRetry scheduling follows the requested policy\./);
  assert.match(content, /# Verification\n- `node --test tests\/retry\.test\.mjs`/);

  const policy = readDirectAgentPolicy(root, "retry-fix");
  assert.deepEqual(policy, {
    schema_version: 1,
    name: "retry-fix",
    edit_paths: ["src/retry.ts", "tests/retry.test.mjs"],
    bash: true,
  });
}));

test("publisher rejects unsafe input before writing", async () => fixture(async root => {
  for (const candidate of [
    request({ name: "Build" }),
    request({ name: "build" }),
    request({ name: "reviewer" }),
    request({ edit_paths: ["../outside.ts"] }),
    request({ edit_paths: ["src/retry.ts", "src/retry.ts"] }),
    request({ bash: "yes" }),
    request({ model: "unqualified-model" }),
    request({ model: null }),
    request({ instructions: "<!-- CUDDLY-WINNER DIRECT POLICY BEGIN -->" }),
  ]) {
    await assert.rejects(publishDirectAgentFile(root, candidate));
  }
  await assert.rejects(lstat(path.join(root, ".opencode", "agents", "generated", "retry-fix.md")), { code: "ENOENT" });
}));

test("publisher never replaces an existing agent", async () => fixture(async root => {
  const first = await publishDirectAgentFile(root, request());
  const file = path.join(root, first.path);
  const original = await readFile(file, "utf8");
  await assert.rejects(publishDirectAgentFile(root, request()), /already exists/);
  assert.equal(await readFile(file, "utf8"), original);
}));

test("publisher rejects a name declared by another local agent", async () => fixture(async root => {
  const existing = path.join(root, ".opencode", "agents", "team", "custom.md");
  await mkdir(path.dirname(existing), { recursive: true });
  await writeFile(existing, "---\nname: >-\n  retry-fix\nmode: primary\n---\nexisting agent\n");

  await assert.rejects(publishDirectAgentFile(root, request()), /agent name already exists: retry-fix/);
  await assert.rejects(
    lstat(path.join(root, ".opencode", "agents", "generated", "retry-fix.md")),
    { code: "ENOENT" },
  );
}));

test("publisher rejects a symlinked generated parent", async () => fixture(async root => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "direct-agent-outside-"));
  try {
    const agents = path.join(root, ".opencode", "agents");
    await mkdir(agents, { recursive: true });
    await symlink(outside, path.join(agents, "generated"), "dir");
    await assert.rejects(publishDirectAgentFile(root, request()), /symlink/);
    await assert.rejects(lstat(path.join(outside, "retry-fix.md")), { code: "ENOENT" });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
}));

test("tool publishes from the active worktree", async () => fixture(async root => {
  const result = JSON.parse(await publishDirectAgent.execute(request(), { directory: root, worktree: root }));
  assert.equal(result.name, "retry-fix");
  await statPolicy(root, "retry-fix");
}));

async function statPolicy(root, name) {
  assert.deepEqual(readDirectAgentPolicy(root, name).edit_paths, ["src/retry.ts", "tests/retry.test.mjs"]);
}
