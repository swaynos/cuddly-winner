import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import publishGoalAgent, {
  isProtectedControlPath,
  publishGoalAgentFile,
  readGoalAgentPolicy,
} from "../../tools/publish_goal_agent.ts";

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "goal-agent-"));
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

test("publishes one self-contained persistent Goal worker", async () => fixture(async root => {
  const result = await publishGoalAgentFile(root, request());
  assert.equal(result.name, "retry-fix");
  assert.equal(result.path, ".opencode/agents/generated/retry-fix.md");
  assert.match(result.instruction, /Definition published; implementation and outcome unverified/);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);

  const file = path.join(root, result.path);
  assert.equal((await lstat(file)).isFile(), true);
  const content = await readFile(file, "utf8");
  assert.equal(result.sha256, createHash("sha256").update(content).digest("hex"));
  assert.match(content, /^---\nname: retry-fix\n/m);
  assert.match(content, /\n  bash: ask\n/);
  assert.doesNotMatch(content, /^model:/m);
  const options = JSON.parse(content.match(/^options: (.*)$/m)[1]);
  assert.deepEqual(options.goal, {
    runtime: "persistent-worker-v1",
    criteria: ["The retry policy has focused coverage."],
  });
  const header = parseYaml(content.match(/^---\n([\s\S]*?)\n---\n/)[1]);
  assert.equal(header.mode, "primary");
  assert.deepEqual(header.permission, {
    "*": "deny",
    read: "allow", glob: "allow", grep: "allow", list: "allow", question: "allow",
    edit: "allow", write: "allow", todowrite: "allow", skill: "allow",
    webfetch: "allow", websearch: "allow", lsp: "allow",
    bash: "ask", task: "deny", goal_run: "allow", goal_evaluate: "allow",
    "cuddly-winner-browser_*": "allow",
  });
  assert.match(content, /# Outcome\nRetry scheduling follows the requested policy\./);
  assert.match(content, /# Verification\n- `node --test tests\/retry\.test\.mjs`/);
  assert.match(content, /goal_run\(operation=start\) once before mutation/);
  assert.match(content, /Work directly and creatively within the exact edit_paths and Bash policy/);
  assert.match(content, /Preparation alone is not completion unless explicitly requested/);
  assert.match(content, /refresh affected preparation and invalidate dependent evidence/);
  assert.match(content, /Acceptance criteria are implementation and verification obligations/);
  assert.match(content, /Continue partial work in this conversation/);
  assert.match(content, /Keep looping even when progress is slow or the outcome appears impossible/);
  assert.match(content, /no default time, attempt or stall limit/);
  assert.match(content, /Correct invalid tool arguments and retry/);
  assert.match(content, /saying blocked is feedback, not permission to stop/);
  assert.match(content, /observed failure, the materially justified change and the evidence/);
  assert.match(content, /goal_evaluate\(mode=feedback, focus=\.\.\., artifacts=\[\.\.\.\]\)/);
  assert.match(content, /goal_evaluate\(mode=final, artifacts=\[\.\.\.\]\)/);
  assert.match(content, /goal_run operations inspect, pause, and resume/);
  assert.match(content, /native Question with header and offered option Resume Goal/);
  assert.match(content, /reconcile actual task actions before resuming the same conversation/);
  assert.doesNotMatch(content, /goal_cycle|goal_handoff|builder_model|max_cycles|max_stalled_cycles|coordinator|bounded builders/);

  const policy = readGoalAgentPolicy(root, "retry-fix");
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
    request({ builder_model: "qwen/coder" }),
    request({ validator_model: null }),
    request({ validator_model: "unqualified-model" }),
    request({ acceptance_criteria: [] }),
    request({ acceptance_criteria: null }),
    request({ acceptance_criteria: [""] }),
    request({ instructions: "<!-- CUDDLY-WINNER GOAL POLICY BEGIN -->" }),
  ]) {
    await assert.rejects(publishGoalAgentFile(root, candidate));
  }
  await assert.rejects(lstat(path.join(root, ".opencode", "agents", "generated", "retry-fix.md")), { code: "ENOENT" });
}));

test("publisher inherits the selected root model and stores only an evaluator override", async () => fixture(async root => {
  const result = await publishGoalAgentFile(root, request({
    validator_model: "anthropic/checker",
  }));
  const content = await readFile(path.join(root, result.path), "utf8");
  const options = JSON.parse(content.match(/^options: (.*)$/m)[1]);
  assert.deepEqual(options.goal, {
    runtime: "persistent-worker-v1",
    criteria: ["The retry policy has focused coverage."],
    validator_model: "anthropic/checker",
  });
  assert.doesNotMatch(content, /^model:|builder_model/m);
  assert.equal("builder_model" in publishGoalAgent.args, false);
  await assert.rejects(publishGoalAgentFile(root, request({ builder_model: "qwen/coder" })), /unknown Goal Agent field: builder_model/);
}));

test("publication rejects objective path and verification dead ends without writing a scaffold", async () => fixture(async root => {
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "existing.mjs"), "// readonly verification\n");
  await symlink(path.join(root, "existing.mjs"), path.join(root, "linked.mjs"));
  for (const [definition, error] of [
    [request({ edit_paths: ["src", "src/retry.ts"] }), /file and its descendant/],
    [request({ edit_paths: ["src"] }), /exact regular files/],
    [request({ edit_paths: ["linked.mjs"] }), /symlink/],
    [request({ bash: false }), /requires Bash/],
    [request({ verification_commands: ["node --test tests/missing.test.mjs"] }), /no implementation path/],
    [request({ verification_commands: ["node linked.mjs"] }), /symlink/],
  ]) await assert.rejects(publishGoalAgentFile(root, definition), error);
  await assert.rejects(lstat(path.join(root, ".opencode")), { code: "ENOENT" });
  await publishGoalAgentFile(root, request({ verification_commands: ["node existing.mjs"] }));
  const inspected = await publishGoalAgentFile(root, { operation: "inspect", name: "retry-fix" });
  await assert.rejects(publishGoalAgentFile(root, { ...request({ verification_commands: ["node missing.mjs"] }),
    operation: "update", expected_sha256: inspected.sha256 }), /no implementation path/);
  assert.equal(await readFile(path.join(root, inspected.path), "utf8"), inspected.content);
}));

test("missing implementations are publishable when their exact verification paths are authorized", async () => fixture(async root => {
  const result = await publishGoalAgentFile(root, request({ instructions: "The solution is technically unsolved. Implement and experiment within the declared paths." }));
  assert.match(await readFile(path.join(root, result.path), "utf8"), /technically unsolved/);
  await assert.rejects(lstat(path.join(root, "tests/retry.test.mjs")), { code: "ENOENT" });
}));

test("evaluator model is optional while fixed criteria and the policy schema are preserved", async () => fixture(async root => {
  const definition = request({ bash: false, verification_commands: ["Inspect src/retry.ts and tests/retry.test.mjs through Read"] });
  const result = await publishGoalAgentFile(root, definition);
  const content = await readFile(path.join(root, result.path), "utf8");
  const header = parseYaml(content.match(/^---\n([\s\S]*?)\n---\n/)[1]);
  assert.deepEqual(header.options.goal, {
    runtime: "persistent-worker-v1", criteria: definition.acceptance_criteria,
  });
  assert.equal(header.permission.bash, "deny");
  assert.match(content, /# Acceptance Criteria\n- The retry policy has focused coverage\./);
  assert.doesNotMatch(content, /^model:/m);
  assert.deepEqual(readGoalAgentPolicy(root, "retry-fix"), {
    schema_version: 1, name: "retry-fix", edit_paths: definition.edit_paths, bash: false,
  });
}));

test("creation and revision require nonempty acceptance criteria", async () => fixture(async root => {
  const missing = request();
  delete missing.acceptance_criteria;
  const invalid = [missing, ...[undefined, null, [], [""], ["  "], [42]].map(
    acceptance_criteria => request({ acceptance_criteria }),
  )];
  for (const definition of invalid) {
    await assert.rejects(publishGoalAgentFile(root, definition), /acceptance_criteria/);
  }
  await assert.rejects(lstat(path.join(root, ".opencode")), { code: "ENOENT" });

  const first = await publishGoalAgentFile(root, request());
  const inspected = await publishGoalAgentFile(root, { operation: "inspect", name: first.name });
  for (const definition of invalid) {
    await assert.rejects(publishGoalAgentFile(root, {
      ...definition, operation: "update", expected_sha256: inspected.sha256,
    }), /acceptance_criteria/);
  }
  assert.equal(await readFile(path.join(root, first.path), "utf8"), inspected.content);
}));

test("publisher protects worktree authority paths before creating or revising a definition", async () => fixture(async root => {
  const controls = [
    ".opencode", ".opencode/agents/generated/retry-fix.md", ".opencode/agents/custom.md",
    ".opencode/plugins/guard.ts", ".opencode/tools/tool.ts", ".opencode/rules/local.md",
    ".opencode/opencode.json", ".OpEnCoDe/skills/local/SKILL.md",
    "opencode.json", "opencode.jsonc", "AGENTS.md",
  ];
  for (const editPath of controls) {
    assert.equal(isProtectedControlPath(editPath), true, editPath);
    await assert.rejects(publishGoalAgentFile(root, request({ edit_paths: [editPath] })), /protected control-plane path/);
  }
  await assert.rejects(lstat(path.join(root, ".opencode")), { code: "ENOENT" });
  const first = await publishGoalAgentFile(root, request());
  const inspected = await publishGoalAgentFile(root, { operation: "inspect", name: first.name });
  for (const editPath of controls) {
    await assert.rejects(publishGoalAgentFile(root, {
      ...request({ edit_paths: [editPath] }), operation: "update", expected_sha256: inspected.sha256,
    }), /protected control-plane path/);
  }
  assert.equal(await readFile(path.join(root, first.path), "utf8"), inspected.content);
}));

test("publisher accepts ordinary application paths with control-directory names", async () => fixture(async root => {
  const edit_paths = [
    "scripts/build.mjs", "tools/convert.ts", "plugins/export.ts", "agents/example.md", "rules/pricing.ts",
    "src/scripts/helper.ts", "docs/AGENTS.md", ".opencode-backup/notes.md", "src/opencode.json",
  ];
  for (const editPath of edit_paths) assert.equal(isProtectedControlPath(editPath), false, editPath);
  await publishGoalAgentFile(root, request({ edit_paths, verification_commands: ["Inspect the declared application files"] }));
  assert.deepEqual(readGoalAgentPolicy(root, "retry-fix").edit_paths, edit_paths);
}));

test("publisher never replaces an existing agent", async () => fixture(async root => {
  const first = await publishGoalAgentFile(root, request());
  const file = path.join(root, first.path);
  const original = await readFile(file, "utf8");
  await assert.rejects(publishGoalAgentFile(root, request()), /already exists/);
  assert.equal(await readFile(file, "utf8"), original);
}));

test("deleting a Goal Agent allows publishing an updated definition with the same name", async () => fixture(async root => {
  const first = await publishGoalAgentFile(root, request());
  const file = path.join(root, first.path);
  await rm(file);

  await publishGoalAgentFile(root, request({ outcome: "Retry scheduling follows the updated policy." }));
  assert.match(await readFile(file, "utf8"), /# Outcome\nRetry scheduling follows the updated policy\./);
}));

test("publisher rejects a name declared by another local agent", async () => fixture(async root => {
  const existing = path.join(root, ".opencode", "agents", "team", "custom.md");
  await mkdir(path.dirname(existing), { recursive: true });
  await writeFile(existing, "---\nname: >-\n  retry-fix\nmode: primary\n---\nexisting agent\n");

  await assert.rejects(publishGoalAgentFile(root, request()), /agent name already exists: retry-fix/);
  await assert.rejects(
    lstat(path.join(root, ".opencode", "agents", "generated", "retry-fix.md")),
    { code: "ENOENT" },
  );
}));

test("explicit fingerprint-bound revisions preserve identity and reject stale updates", async () => fixture(async root => {
  const first = await publishGoalAgentFile(root, request());
  const inspected = await publishGoalAgentFile(root, { operation: "inspect", name: "retry-fix" });
  assert.match(inspected.sha256, /^[a-f0-9]{64}$/);
  assert.equal(inspected.content, await readFile(path.join(root, first.path), "utf8"));
  assert.equal(inspected.sha256, first.sha256);
  const update = { ...request({ outcome: "Updated policy", edit_paths: ["src/new.ts"], bash: false, verification_commands: ["Inspect src/new.ts"] }), operation: "update", expected_sha256: inspected.sha256 };
  const revised = await publishGoalAgentFile(root, update);
  assert.equal(revised.path, first.path);
  assert.notEqual(revised.sha256, inspected.sha256);
  assert.match(revised.instruction, /fresh conversation/);
  assert.deepEqual(readGoalAgentPolicy(root, "retry-fix").edit_paths, ["src/new.ts"]);
  const content = await readFile(path.join(root, first.path), "utf8");
  assert.match(content, /\n  bash: deny\n/);
  assert.equal(JSON.parse(content.match(/^options: (.*)$/m)[1]).goal.runtime, "persistent-worker-v1");
  await assert.rejects(publishGoalAgentFile(root, update), /changed since inspection/);
  assert.equal(await readFile(path.join(root, first.path), "utf8"), content);
  await assert.rejects(publishGoalAgentFile(root, { ...update, expected_sha256: undefined }), /expected_sha256/);
}));

test("concurrent revisions permit one winner and preserve collisions and symlink checks", async () => fixture(async root => {
  const first = await publishGoalAgentFile(root, request());
  const inspected = await publishGoalAgentFile(root, { operation: "inspect", name: "retry-fix" });
  const update = { ...request({ outcome: "New outcome" }), operation: "update", expected_sha256: inspected.sha256 };
  const results = await Promise.allSettled([publishGoalAgentFile(root, update), publishGoalAgentFile(root, update)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const fresh = await publishGoalAgentFile(root, { operation: "inspect", name: "retry-fix" });
  const collision = path.join(root, ".opencode/agents/other.md");
  await writeFile(collision, "---\nname: retry-fix\n---\nother");
  await assert.rejects(publishGoalAgentFile(root, { ...update, expected_sha256: fresh.sha256 }), /already exists/);
  await rm(collision);
  const target = path.join(root, first.path);
  await rm(target);
  await symlink(path.join(root, "missing"), target);
  await assert.rejects(publishGoalAgentFile(root, { ...update, expected_sha256: fresh.sha256 }), /symlink/);
}));

test("publisher rejects a symlinked generated parent", async () => fixture(async root => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "goal-agent-outside-"));
  try {
    const agents = path.join(root, ".opencode", "agents");
    await mkdir(agents, { recursive: true });
    await symlink(outside, path.join(agents, "generated"), "dir");
    await assert.rejects(publishGoalAgentFile(root, request()), /symlink/);
    await assert.rejects(lstat(path.join(outside, "retry-fix.md")), { code: "ENOENT" });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
}));

test("tool publishes from the active worktree", async () => fixture(async root => {
  const result = JSON.parse(await publishGoalAgent.execute(request(), { directory: root, worktree: root }));
  assert.equal(result.name, "retry-fix");
  await statPolicy(root, "retry-fix");
}));

test("Prometheus remains a read-only publisher for persistent workers and fresh evaluators", async () => {
  const content = await readFile(new URL("../../agents/prometheus.md", import.meta.url), "utf8");
  const header = parseYaml(content.match(/^---\n([\s\S]*?)\n---\n/)[1]);
  assert.equal(header.permission.edit, "deny");
  assert.equal(header.permission.write, "deny");
  assert.equal(header.permission.bash, "deny");
  assert.equal(header.permission.publish_goal_agent, "allow");
  assert.deepEqual(header.permission.task, { "*": "deny", grounder: "allow" });
  assert.match(content, /first productive obligation/);
  assert.match(content, /persistent named worker/);
  assert.match(content, /model selected in its root session/);
  assert.match(content, /validator_model/);
  assert.match(content, /Do not invent cycle, stall, time, batch, or resource limits/);
  assert.match(content, /ordinary outcome-and-authority/);
  assert.match(content, /worker-repairable within authority/);
  assert.match(content, /proving feasibility is not a gate/);
  assert.match(content, /do not duplicate an orchestration manual/);
  assert.doesNotMatch(content, /goal_cycle|goal_handoff|builder_model|max_cycles|max_stalled_cycles|fresh bounded builder|coordinator/);
});

async function statPolicy(root, name) {
  assert.deepEqual(readGoalAgentPolicy(root, name).edit_paths, ["src/retry.ts", "tests/retry.test.mjs"]);
}
