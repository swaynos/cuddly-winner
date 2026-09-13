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
  assert.match(text, /playwright.*only.*override/);
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
