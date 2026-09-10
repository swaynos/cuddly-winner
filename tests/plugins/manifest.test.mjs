import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import validateScaffold, { validateManifest, validateTaskPackage } from "../../tools/validate_scaffold.ts";

function manifest(overrides = {}) {
  return {
    schema_version: 1,
    task_id: "fix-widget",
    agent_name: "fix-widget",
    agent_definition: ".opencode/agents/fix-widget.md",
    task_brief: ".opencode/tasks/fix-widget.md",
    strategy: "direct",
    permissions: { edit_paths: ["src/widget.ts"], bash: true },
    implementation_scope: ["src/widget.ts", "tests/widget.test.mjs"],
    durable_context: ["README.md"],
    verification: {
      commands: ["node --test tests/widget.test.mjs"],
      success_evidence: ["Fresh passing test output."],
      freshness: "Run after the final edit.",
      failure_conditions: ["A required command fails."],
      independent_review: null,
    },
    limits: { stop_conditions: ["Scope must expand."] },
    escalation_triggers: ["Acceptance is materially ambiguous."],
    strategy_config: { work_selection: "Complete brief items in dependency order." },
    ...overrides,
  };
}

function writePackage(root, name) {
  mkdirSync(path.join(root, ".opencode", "agents"), { recursive: true });
  mkdirSync(path.join(root, ".opencode", "tasks"), { recursive: true });
  writeFileSync(path.join(root, ".opencode", "agents", `${name}.md`), "---\ndescription: executor\nmode: primary\npermission:\n  edit: allow\n  bash: ask\n---\nRead the task brief.\n");
  writeFileSync(path.join(root, ".opencode", "tasks", `${name}.md`), `# ${name}\n`);
  writeFileSync(path.join(root, ".opencode", "tasks", `${name}.json`), JSON.stringify(manifest({
    task_id: name,
    agent_name: name,
    agent_definition: `.opencode/agents/${name}.md`,
    task_brief: `.opencode/tasks/${name}.md`,
  })));
  return { name, manifest: `.opencode/tasks/${name}.json` };
}

test("accepts a direct generated-agent manifest", () => {
  const result = validateManifest(manifest());
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.strategy, "direct");
});

test("rejects every retired manifest shape and strategy", () => {
  for (const candidate of [
    manifest({ schema_version: 3 }),
    { ...manifest(), strategy: "karpathy" },
    { ...manifest(), strategy: "unknown" },
  ]) {
    assert.equal(validateManifest(candidate).valid, false);
  }
});

test("requires a canonical task identity and matching package paths", () => {
  for (const candidate of [
    manifest({ task_id: "Fix Widget" }),
    manifest({ agent_name: "other" }),
    manifest({ agent_definition: ".opencode/agents/other.md" }),
    manifest({ task_brief: "../brief.md" }),
  ]) assert.equal(validateManifest(candidate).valid, false);
});

test("rejects built-in and shipped agent identities", () => {
  for (const name of ["build", "plan", "general", "explore", "compaction", "title", "summary", "ask", "grounder", "prometheus", "reviewer"]) {
    const result = validateManifest(manifest({
      task_id: name,
      agent_name: name,
      agent_definition: `.opencode/agents/${name}.md`,
      task_brief: `.opencode/tasks/${name}.md`,
    }));
    assert.deepEqual(result.errors, [`task_id must not use reserved agent identity "${name}"`]);
  }
});

test("fails closed on unknown fields and edit paths outside scope", () => {
  const unknown = manifest({ extra: true });
  assert.equal(validateManifest(unknown).valid, false);
  const outside = manifest({ permissions: { edit_paths: ["README.md"], bash: true } });
  assert.equal(validateManifest(outside).valid, false);
});

test("requires the complete Ralph loop contract", () => {
  const ralph = manifest({
    strategy: "ralph",
    strategy_config: {
      work_selection: "Choose the next useful pass.",
      pass_budget: 3,
      state_paths: ["state.json"],
      progress_evidence_before: ["node state.mjs"],
      progress_evidence_after: ["node state.mjs"],
      pass_failure_treatment: "Record and continue.",
      run_stop_conditions: ["Target is reached."],
      later_pass_starter: "scripts/task-loop.mjs",
    },
  });
  assert.equal(validateManifest(ralph).valid, true);
  delete ralph.strategy_config.later_pass_starter;
  assert.equal(validateManifest(ralph).valid, false);
});

test("requires a complete optimization contract without a Karpathy agent", () => {
  const optimization = manifest({
    strategy: "optimization",
    strategy_config: {
      work_selection: "Change one lever.",
      objective: "score",
      direction: "maximize",
      evaluator: "tools/score.mjs",
      score_extraction: "last float on stdout",
      noise_policy: "Run three times and use the median.",
      mutable_targets: ["src/widget.ts"],
      immutable_targets: ["tools/score.mjs"],
      experiment_budget: 5,
      keep_revert_rule: "Keep only an improved score.",
      stop_conditions: ["Budget exhausted."],
    },
  });
  assert.equal(validateManifest(optimization).valid, true);
  optimization.strategy_config.mutable_targets = ["src/*"];
  assert.equal(validateManifest(optimization).valid, false);
});

test("validates a registered task package and rejects registry mismatches", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "task-package-"));
  try {
    const entry = writePackage(root, "fix-widget");
    writeFileSync(path.join(root, ".opencode", "generated-agents.json"), JSON.stringify({ schema_version: 1, agents: [entry] }));
    const result = await validateTaskPackage(root, "fix-widget");
    assert.equal(result.valid, true, result.errors.join("; "));
    writeFileSync(path.join(root, ".opencode", "generated-agents.json"), JSON.stringify({ schema_version: 1, agents: [{ name: "other", manifest: ".opencode/tasks/fix-widget.json" }] }));
    assert.equal((await validateTaskPackage(root, "fix-widget")).valid, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects symlinked parents for every managed package artifact", async () => {
  for (const component of [".opencode", "tasks", "agents"]) {
    const root = mkdtempSync(path.join(os.tmpdir(), "task-package-link-"));
    const outside = mkdtempSync(path.join(os.tmpdir(), "task-package-outside-"));
    try {
      const entry = writePackage(root, "fix-widget");
      writeFileSync(path.join(root, ".opencode", "generated-agents.json"), JSON.stringify({ schema_version: 1, agents: [entry] }));
      const source = component === ".opencode" ? path.join(root, component) : path.join(root, ".opencode", component);
      const target = path.join(outside, component === ".opencode" ? "opencode" : component);
      renameSync(source, target);
      symlinkSync(target, source, "dir");

      const result = await validateTaskPackage(root, "fix-widget");
      assert.equal(result.valid, false, `${component} symlink was accepted`);
      assert.match(result.errors.join("; "), /symlink/, component);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  }
});

test("selects one named package from a multi-entry registry", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "task-package-multi-"));
  try {
    const entries = [writePackage(root, "fix-widget"), writePackage(root, "fix-gadget")];
    writeFileSync(path.join(root, ".opencode", "generated-agents.json"), JSON.stringify({ schema_version: 1, agents: entries }));
    const context = { directory: root, worktree: root };

    const named = JSON.parse(await validateScaffold.execute({ agent_name: "fix-gadget" }, context));
    assert.equal(named.valid, true, named.errors.join("; "));

    const unnamed = JSON.parse(await validateScaffold.execute({}, context));
    assert.equal(unnamed.valid, false);
    assert.ok(unnamed.errors.includes("generated-agent registry contains 2 entries; agent_name is required"));

    const missing = await validateTaskPackage(root, "missing-agent");
    assert.equal(missing.valid, false);
    assert.ok(missing.errors.includes('generated-agent registry has no entry named "missing-agent"'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
