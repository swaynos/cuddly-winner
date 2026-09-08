import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateManifest, validateTaskPackage } from "../../tools/validate_scaffold.ts";

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

test("accepts a direct generated-agent manifest", () => {
  const result = validateManifest(manifest());
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.strategy, "direct");
});

test("rejects every retired manifest shape and strategy", () => {
  for (const candidate of [
    { schema_version: 3, strategy: "direct" },
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
    mkdirSync(path.join(root, ".opencode", "agents"), { recursive: true });
    mkdirSync(path.join(root, ".opencode", "tasks"), { recursive: true });
    writeFileSync(path.join(root, ".opencode", "agents", "fix-widget.md"), "---\ndescription: executor\nmode: primary\npermission:\n  edit: allow\n  bash: ask\n---\nRead the task brief.\n");
    writeFileSync(path.join(root, ".opencode", "tasks", "fix-widget.md"), "# Fix widget\n");
    writeFileSync(path.join(root, ".opencode", "tasks", "fix-widget.json"), JSON.stringify(manifest()));
    writeFileSync(path.join(root, ".opencode", "generated-agents.json"), JSON.stringify({ schema_version: 1, agents: [{ name: "fix-widget", manifest: ".opencode/tasks/fix-widget.json" }] }));
    const result = await validateTaskPackage(root, "fix-widget");
    assert.equal(result.valid, true, result.errors.join("; "));
    writeFileSync(path.join(root, ".opencode", "generated-agents.json"), JSON.stringify({ schema_version: 1, agents: [{ name: "other", manifest: ".opencode/tasks/fix-widget.json" }] }));
    assert.equal((await validateTaskPackage(root, "fix-widget")).valid, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
