import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "../../tools/manifest.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "..", "fixtures", "manifests");
const load = (name) => JSON.parse(readFileSync(path.join(fixtures, name), "utf8"));

// Expected verdicts mirror tests/fixtures/manifests/README.md.
const EXPECT = {
  "valid-ralph.json": true,
  "valid-karpathy.json": true,
  "invalid-unknown-version.json": false,
  "invalid-ralph-empty-scope.json": false,
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
  const m = load("invalid-ralph-nonempty-evaluator-uninventoried.json");
  // Without a root, path-only validation passes (file existence not checked).
  assert.equal(validateManifest(m).valid, true);
  // With a root, the missing inventoried file is detected.
  const withRoot = validateManifest(m, { root: fixtures });
  assert.equal(withRoot.valid, false);
  assert.match(withRoot.errors.join("; "), /missing/);
});

test("valid ralph reports ralph strategy; valid karpathy reports karpathy", () => {
  assert.equal(validateManifest(load("valid-ralph.json")).strategy, "ralph");
  assert.equal(validateManifest(load("valid-karpathy.json")).strategy, "karpathy");
});

test("non-object manifest fails closed", () => {
  assert.equal(validateManifest(null).valid, false);
  assert.equal(validateManifest([]).valid, false);
  assert.equal(validateManifest("nope").valid, false);
});

test("rejects noncanonical paths in every path field", () => {
  const invalidPaths = ["", ".", "..", "model//config.json", "model\\config.json", "/model/config.json", "C:/model/config.json", "C:model/config.json"];
  for (const invalidPath of invalidPaths) {
    const scope = load("valid-ralph.json");
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
  const verification = load("valid-ralph.json");
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

  const fractionalTopLevelCount = load("valid-ralph.json");
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
