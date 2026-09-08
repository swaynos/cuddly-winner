import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { MANAGED_BLOCK, MANAGED_PATHS, applyScaffoldGitignore } from "../../tools/scaffold_gitignore.ts";

async function fixture(fn) { const root = await mkdtemp(path.join(os.tmpdir(), "gitignore-")); try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); } }
function git(root, ...args) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }); }

test("does not create .gitignore outside a Git worktree", async () => fixture(async root => {
  const result = await applyScaffoldGitignore(root);
  assert.equal(result.skipped, "not a Git worktree");
}));

test("writes the generated-task block in a Git worktree", async () => fixture(async root => {
  git(root, "init");
  const result = await applyScaffoldGitignore(root);
  assert.deepEqual(result.managed_paths, MANAGED_PATHS);
  assert.equal(await readFile(path.join(root, ".gitignore"), "utf8"), `${MANAGED_BLOCK}\n`);
}));

test("replaces its own current block and preserves unrelated content", async () => fixture(async root => {
  git(root, "init");
  await writeFile(path.join(root, ".gitignore"), `node_modules/\n${MANAGED_BLOCK}\n*.log\n`);
  const result = await applyScaffoldGitignore(root);
  assert.equal(result.changed, false);
  assert.equal(await readFile(path.join(root, ".gitignore"), "utf8"), `node_modules/\n${MANAGED_BLOCK}\n*.log\n`);
}));

test("rejects malformed current markers", async () => fixture(async root => {
  git(root, "init");
  await writeFile(path.join(root, ".gitignore"), "# BEGIN OpenCode generated task artifacts extra\n");
  await assert.rejects(applyScaffoldGitignore(root), /malformed/);
}));
