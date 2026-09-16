import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";

const repo = path.resolve(import.meta.dirname, "../..");

function normalize(text) {
  return text.toLowerCase().replace(/\s+/g, " ");
}

test("deployed rule defines the Playwright-only headless/headed decision flow", async () => {
  const text = normalize(await readFile(path.join(repo, "rules", "resource-selection.md"), "utf8"));
  const orderedSteps = [
    "playwright is the project's only browser backend",
    "headless playwright performs all normal work",
    "headed playwright opens only for a person to complete a required login",
    "ask for approval",
    "new headless context",
    "report the blocker",
  ];

  let previous = -1;
  for (const step of orderedSteps) {
    const current = text.indexOf(step);
    assert.ok(current > previous, `missing or out-of-order browser rule: ${step}`);
    previous = current;
  }
});

test("deployed rule keeps the Playwright login-state and safety safeguards", async () => {
  const text = normalize(await readFile(path.join(repo, "rules", "resource-selection.md"), "utf8"));
  for (const clause of [
    "mode 0600",
    "state values must not appear in model context",
    "a page preview is not a delivered file",
    "mark the outcome unknown",
    "never repeat an unknown non-idempotent action automatically",
  ]) {
    assert.ok(text.includes(clause), `rule missing safeguard: ${clause}`);
  }
});

test("deployed rule no longer references the retired fallback gate or image skill", async () => {
  const text = normalize(await readFile(path.join(repo, "rules", "resource-selection.md"), "utf8"));
  assert.doesNotMatch(text, /cuddly_winner_browser_fallback/, "rule still names the retired fallback env gate");
  assert.doesNotMatch(text, /playwright-image-generation/, "rule still references the retired image-generation skill");
});

test("durable browser documentation records the Playwright-only backend", async () => {
  for (const file of ["docs/RESOURCE-SELECTION.md", "docs/ARCHITECTURE.md", "docs/REQUIREMENTS.md"]) {
    const text = normalize(await readFile(path.join(repo, file), "utf8"));
    assert.match(text, /playwright/, `${file}: missing Playwright backend`);
    assert.match(text, /headless/, `${file}: missing headless mode`);
    assert.match(text, /headed/, `${file}: missing headed login mode`);
    assert.doesNotMatch(text, /cuddly_winner_browser_fallback/, `${file}: still references the retired fallback env gate`);
  }
});

test("durable documentation keeps the image-generation and no-auto-replay safeguards", async () => {
  const requirements = normalize(await readFile(path.join(repo, "docs", "REQUIREMENTS.md"), "utf8"));
  assert.match(requirements, /never automatically replay/, "REQUIREMENTS lost the no-auto-replay safeguard");

  for (const file of ["docs/RESOURCE-SELECTION.md", "docs/REQUIREMENTS.md"]) {
    const text = normalize(await readFile(path.join(repo, file), "utf8"));
    assert.match(text, /existing.*image is not success|existing page image|not an image\s*already present on the page/, `${file}: lost the new-output-image safeguard`);
  }
});
