import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import validateTool, { validateManifest, validateScaffold } from "../../tools/validate_scaffold.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "..", "fixtures", "manifests");
const load = (name) => JSON.parse(readFileSync(path.join(fixtures, name), "utf8"));
const spec = (command = "node --test tests/unit.test.mjs") => `# Task

## Grounding
Grounded.

## Approaches Considered
### Selected: Small change

## Acceptance Criteria
1. Works.

## Verification
- \`${command}\`

## Implementation Checklist
- [ ] Implement.
`;

// Expected verdicts mirror tests/fixtures/manifests/README.md.
const EXPECT = {
  "valid-direct.json": true,
  "valid-karpathy.json": true,
  "invalid-legacy-schema-v1.json": false,
  "invalid-legacy-ralph.json": false,
  "invalid-unknown-version.json": false,
  "invalid-direct-empty-scope.json": false,
  "invalid-karpathy-missing-optimization.json": false,
  "invalid-escaping-path.json": false,
  "invalid-unknown-limit-key.json": false,
};

for (const [name, expected] of Object.entries(EXPECT)) {
  test(`manifest fixture ${name} -> ${expected ? "ACCEPT" : "REJECT"}`, () => {
    const result = validateManifest(load(name));
    assert.equal(result.valid, expected, result.errors.join("; "));
  });
}

test("uninventoried evaluator file fails only with root filesystem check", () => {
  const m = load("invalid-direct-nonempty-evaluator-uninventoried.json");
  // Without a root, path-only validation passes (file existence not checked).
  assert.equal(validateManifest(m).valid, true);
  // With a root, the missing inventoried file is detected.
  const withRoot = validateManifest(m, { root: fixtures });
  assert.equal(withRoot.valid, false);
  assert.match(withRoot.errors.join("; "), /missing/);
});

test("valid direct reports direct strategy; valid karpathy reports karpathy strategy", () => {
  assert.equal(validateManifest(load("valid-direct.json")).strategy, "direct");
  assert.equal(validateManifest(load("valid-karpathy.json")).strategy, "karpathy");
});

test("direct strategy rejects an optimization block", () => {
  const withOptimization = load("valid-direct.json");
  withOptimization.optimization = load("valid-karpathy.json").optimization;
  assert.equal(validateManifest(withOptimization).valid, false);
});

test("non-object manifest fails closed", () => {
  assert.equal(validateManifest(null).valid, false);
  assert.equal(validateManifest([]).valid, false);
  assert.equal(validateManifest("nope").valid, false);
});

test("schema v3 keeps run KPIs disabled when the optional block is absent", () => {
  assert.equal(validateManifest(load("valid-direct.json")).valid, true);
});

test("run KPIs require every explicit enabled value and reject unknown fields", () => {
  const enabled = load("valid-direct.json");
  enabled.run_kpis = {
    enabled: true,
    unattended_runtime: { target_seconds: 3600 },
    token_burn: { target_tokens_per_active_minute: 8000, hard_budget_tokens: 500000 },
  };
  assert.equal(validateManifest(enabled).valid, true);

  const disabled = load("valid-direct.json");
  disabled.run_kpis = { enabled: false };
  assert.equal(validateManifest(disabled).valid, true);

  const missingBudget = structuredClone(enabled);
  delete missingBudget.run_kpis.token_burn.hard_budget_tokens;
  assert.equal(validateManifest(missingBudget).valid, false);

  const zeroRate = structuredClone(enabled);
  zeroRate.run_kpis.token_burn.target_tokens_per_active_minute = 0;
  assert.equal(validateManifest(zeroRate).valid, false);

  const disabledWithFields = structuredClone(disabled);
  disabledWithFields.run_kpis.unattended_runtime = { target_seconds: 60 };
  assert.equal(validateManifest(disabledWithFields).valid, false);

  const unknown = structuredClone(enabled);
  unknown.run_kpis.token_burn.unbounded = true;
  assert.equal(validateManifest(unknown).valid, false);
});

test("schema v2 is rejected under the no-legacy policy", () => {
  const retired = load("valid-direct.json");
  retired.schema_version = 2;
  assert.equal(validateManifest(retired).valid, false);
});

test("rejects noncanonical paths in every path field", () => {
  const invalidPaths = ["", ".", "..", "model//config.json", "model\\config.json", "/model/config.json", "C:/model/config.json", "C:model/config.json"];
  for (const invalidPath of invalidPaths) {
    const scope = load("valid-direct.json");
    scope.implementation_scope = [invalidPath];
    assert.equal(validateManifest(scope).valid, false, `scope: ${JSON.stringify(invalidPath)}`);

    const karpathy = load("valid-karpathy.json");
    karpathy.optimization.mutable_targets = [invalidPath];
    assert.equal(validateManifest(karpathy).valid, false, `mutable target: ${JSON.stringify(invalidPath)}`);

    const immutable = load("valid-karpathy.json");
    immutable.optimization.immutable_targets = [invalidPath];
    assert.equal(validateManifest(immutable).valid, false, `immutable target: ${JSON.stringify(invalidPath)}`);
  }
});

test("rejects unknown nested fields and invalid numeric values", () => {
  const verification = load("valid-direct.json");
  verification.verification.extra = true;
  assert.equal(validateManifest(verification).valid, false);

  const optimization = load("valid-karpathy.json");
  optimization.optimization.extra = true;
  assert.equal(validateManifest(optimization).valid, false);

  const noiseProbe = load("valid-karpathy.json");
  noiseProbe.optimization.noise_probe.extra = true;
  assert.equal(validateManifest(noiseProbe).valid, false);

  const optimizationLimits = load("valid-karpathy.json");
  optimizationLimits.optimization.limits.extra = true;
  assert.equal(validateManifest(optimizationLimits).valid, false);

  const fractionalTopLevelCount = load("valid-direct.json");
  fractionalTopLevelCount.limits = { iterations: 1.5 };
  assert.equal(validateManifest(fractionalTopLevelCount).valid, false);

  const stop = load("valid-karpathy.json");
  stop.optimization.stop.extra = true;
  assert.equal(validateManifest(stop).valid, false);

  const fractionalCount = load("valid-karpathy.json");
  fractionalCount.optimization.noise_probe.runs = 2.5;
  assert.equal(validateManifest(fractionalCount).valid, false);

  const nonFinite = load("valid-karpathy.json");
  nonFinite.optimization.baseline = Infinity;
  assert.equal(validateManifest(nonFinite).valid, false);
});

test("karpathy evaluator inventory is nonempty, unique, immutable, and disjoint", () => {
  const emptyInventory = load("valid-karpathy.json");
  emptyInventory.evaluator_inventory = [];
  assert.equal(validateManifest(emptyInventory).valid, false);

  const duplicateInventory = load("valid-karpathy.json");
  duplicateInventory.evaluator_inventory.push(".prometheus/evaluator/score.py");
  assert.equal(validateManifest(duplicateInventory).valid, false);

  const nonEvaluator = load("valid-karpathy.json");
  nonEvaluator.evaluator_inventory = ["model/score.py"];
  assert.equal(validateManifest(nonEvaluator).valid, false);

  const missingImmutable = load("valid-karpathy.json");
  missingImmutable.optimization.immutable_targets = ["model/frozen.json"];
  assert.equal(validateManifest(missingImmutable).valid, false);

  const overlap = load("valid-karpathy.json");
  overlap.optimization.immutable_targets.push("model/hyperparams.json");
  assert.equal(validateManifest(overlap).valid, false);
});

test("root checks require inventoried regular files and reject ancestor symlinks", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "manifest-test-"));
  try {
    const evaluator = path.join(root, ".prometheus", "evaluator");
    mkdirSync(evaluator, { recursive: true });
    writeFileSync(path.join(evaluator, "score.py"), "print(0)\n");
    assert.equal(validateManifest(load("valid-karpathy.json"), { root }).valid, true);

    const directoryEntry = load("valid-karpathy.json");
    directoryEntry.evaluator_inventory = [".prometheus/evaluator"];
    directoryEntry.optimization.immutable_targets = [".prometheus/evaluator"];
    assert.equal(validateManifest(directoryEntry, { root }).valid, false);

    rmSync(path.join(root, ".prometheus"), { recursive: true });
    const outside = mkdtempSync(path.join(os.tmpdir(), "manifest-outside-"));
    try {
      mkdirSync(path.join(outside, "evaluator"));
      writeFileSync(path.join(outside, "evaluator", "score.py"), "print(0)\n");
      symlinkSync(outside, path.join(root, ".prometheus"));
      assert.equal(validateManifest(load("valid-karpathy.json"), { root }).valid, false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects unsupported score_extraction enum values", () => {
  const unsupported = load("valid-karpathy.json");
  unsupported.optimization.score_extraction = "last line";
  assert.equal(validateManifest(unsupported).valid, false);

  const first = load("valid-karpathy.json");
  first.optimization.score_extraction = "first float on stdout";
  assert.equal(validateManifest(first).valid, true);

  const last = load("valid-karpathy.json");
  last.optimization.score_extraction = "last float on stdout";
  assert.equal(validateManifest(last).valid, true);
});

test("rejects wildcard segments in mutable and immutable targets", () => {
  const mutable = load("valid-karpathy.json");
  mutable.optimization.mutable_targets = ["model/*"];
  assert.equal(validateManifest(mutable).valid, false);

  const immutable = load("valid-karpathy.json");
  immutable.optimization.immutable_targets = ["model/[abc].json"];
  assert.equal(validateManifest(immutable).valid, false);
});

test("validate_scaffold tool performs static SPEC and manifest consistency checks", async () => {
  assert.match(validateTool.description, /without executing/i);
  const root = mkdtempSync(path.join(os.tmpdir(), "scaffold-validator-"));
  try {
    const manifest = load("valid-direct.json");
    const command = manifest.verification.commands[0];
    writeFileSync(path.join(root, "SPEC.md"), spec(command));
    writeFileSync(path.join(root, "opencode-autonomous.json"), JSON.stringify(manifest));
    assert.equal((await validateScaffold(root)).valid, true);
    assert.equal(JSON.parse(await validateTool.execute({}, { directory: root, worktree: "/" })).valid, true);
    writeFileSync(path.join(root, "SPEC.md"), spec("different command"));
    await assert.rejects(validateScaffold(root), /must match exactly/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
