import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";

const repo = path.resolve(import.meta.dirname, "../..");

test("deployed rule defines the Obscura-first browser decision flow", async () => {
  const text = (await readFile(path.join(repo, "rules", "resource-selection.md"), "utf8"))
    .toLowerCase()
    .replace(/\s+/g, " ");
  const orderedSteps = [
    "project instructions override",
    "use `cuddly-winner-browser`",
    "check whether login is required",
    "already signed in",
    "user's browser",
    "no gui",
    "allowed alternative",
  ];

  let previous = -1;
  for (const step of orderedSteps) {
    const current = text.indexOf(step);
    assert.ok(current > previous, `missing or out-of-order browser rule: ${step}`);
    previous = current;
  }
});

test("image-generation skill follows the default browser rule", async () => {
  const text = (await readFile(path.join(repo, "skills", "playwright-image-generation", "SKILL.md"), "utf8")).toLowerCase();
  assert.match(text, /use `cuddly-winner-browser` by default/);
  assert.match(text, /project instructions.*override/);
  assert.match(text, /check whether login is required/);
  assert.match(text, /playwright.*only.*override|last-resort fallback gate/);
});

test("browser rules and image skill require evidence before a last-resort pivot", async () => {
  for (const file of ["rules/resource-selection.md", "skills/playwright-image-generation/SKILL.md"]) {
    const text = (await readFile(path.join(repo, file), "utf8")).toLowerCase().replace(/\s+/g, " ");
    for (const clause of [
      "a single timeout or disconnect is not grounds to switch",
      "correct the call",
      "bounded recovery",
      "restart opencode",
      "no supported obscura path remains",
      "check whether the submitted action completed",
      "do not describe playwright as a reconnected obscura session",
    ]) assert.ok(text.includes(clause), `${file}: missing fallback safeguard: ${clause}`);
  }
});

test("durable skill documentation records the browser-selection contract", async () => {
  const text = (await readFile(path.join(repo, "docs", "SKILLS.md"), "utf8"))
    .toLowerCase()
    .replace(/\s+/g, " ");
  assert.match(text, /`cuddly-winner-browser` by default/);
  assert.match(text, /project.*override/);
  assert.match(text, /check whether login is required/);
  assert.match(text, /playwright\/cdp only/);
});

test("browser documentation requires an explicit fallback policy and verified image output", async () => {
  for (const file of ["docs/RESOURCE-SELECTION.md", "docs/ARCHITECTURE.md", "docs/REQUIREMENTS.md"]) {
    const text = (await readFile(path.join(repo, file), "utf8")).toLowerCase().replace(/\s+/g, " ");
    assert.match(text, /cuddly_winner_browser_fallback=playwright/);
    assert.match(text, /never automatically replay.*generation/);
    assert.match(text, /verify.*prompt.*after.*image mode/);
    assert.match(text, /new.*output image/);
  }
});
