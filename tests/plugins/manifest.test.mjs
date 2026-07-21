import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
