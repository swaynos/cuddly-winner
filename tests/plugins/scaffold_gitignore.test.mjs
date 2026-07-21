import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, readFile, writeFile, symlink, chmod, stat } from "node:fs/promises";
import { applyScaffoldGitignore, MANAGED_BLOCK, __testing } from "../../tools/scaffold_gitignore.ts";

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "scaffold-gi-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const gi = (root) => path.join(root, ".gitignore");

test("creates .gitignore with the exact canonical block when absent", async () => fixture(async (root) => {
  const result = await applyScaffoldGitignore(root);
  assert.equal(result.changed, true);
  const content = await readFile(gi(root), "utf8");
  assert.ok(content.includes(MANAGED_BLOCK));
  assert.equal(result.managed_paths.length, 8);
}));

test("is byte-idempotent on repeated calls", async () => fixture(async (root) => {
  await applyScaffoldGitignore(root);
  const first = await readFile(gi(root), "utf8");
  const second = await applyScaffoldGitignore(root);
  assert.equal(second.changed, false);
  assert.equal(await readFile(gi(root), "utf8"), first);
}));

test("preserves unrelated content and replaces only the managed block", async () => fixture(async (root) => {
  await writeFile(gi(root), "node_modules/\n*.log\n");
  await applyScaffoldGitignore(root);
  const content = await readFile(gi(root), "utf8");
  assert.ok(content.includes("node_modules/"));
  assert.ok(content.includes("*.log"));
  assert.ok(content.includes(MANAGED_BLOCK));
  // Re-running must not duplicate the block.
  await applyScaffoldGitignore(root);
  const again = await readFile(gi(root), "utf8");
  assert.equal(again.match(/BEGIN OpenCode Autonomous artifacts/g).length, 1);
}));

test("preserves CRLF and trailing whitespace outside the managed block", async () => fixture(async (root) => {
  const prefix = "node_modules/  \r\nkeep\t\r\n\r\n";
  const suffix = "\r\n*.log  \r\n";
  await writeFile(gi(root), `${prefix}${MANAGED_BLOCK.replace(/\n/g, "\r\n")}\r\n${suffix}`);
  await applyScaffoldGitignore(root);
  const content = await readFile(gi(root), "utf8");
  assert.equal(content, `${prefix}${MANAGED_BLOCK.replace(/\n/g, "\r\n")}\r\n${suffix}`);
}));

test("does not normalize trailing whitespace when appending the block", async () => fixture(async (root) => {
  const existing = "keep\t  ";
  await writeFile(gi(root), existing);
  await applyScaffoldGitignore(root);
  assert.equal(await readFile(gi(root), "utf8"), `${existing}\n\n${MANAGED_BLOCK}\n`);
}));

test("preserves file permissions", async () => fixture(async (root) => {
  await writeFile(gi(root), "keep\n");
  await chmod(gi(root), 0o640);
  await applyScaffoldGitignore(root);
  assert.equal((await stat(gi(root))).mode & 0o777, 0o640);
}));

test("rejects a symlinked .gitignore", async () => fixture(async (root) => {
  await writeFile(path.join(root, "real"), "x");
  await symlink(path.join(root, "real"), gi(root));
  await assert.rejects(applyScaffoldGitignore(root), /symlink/);
}));

test("rejects duplicate managed markers without writing", async () => fixture(async (root) => {
  await writeFile(gi(root), `${MANAGED_BLOCK}\n${MANAGED_BLOCK}\n`);
  await assert.rejects(applyScaffoldGitignore(root), /duplicate or malformed/);
}));

for (const [name, content, error] of [
  ["an indented marker", ` # BEGIN OpenCode Autonomous artifacts\n${MANAGED_BLOCK}\n`, /malformed/],
  ["a marker with trailing whitespace", `${MANAGED_BLOCK}\n# END OpenCode Autonomous artifacts \n`, /malformed/],
  ["reversed markers", `${__testing.MANAGED_BLOCK.split("\n").at(-1)}\n${__testing.MANAGED_BLOCK.split("\n")[0]}\n`, /precedes/],
  ["an unpaired begin marker", "# BEGIN OpenCode Autonomous artifacts\n", /malformed/],
  ["an unpaired end marker", "# END OpenCode Autonomous artifacts\n", /malformed/],
]) {
  test(`rejects ${name} without writing`, async () => fixture(async (root) => {
    await writeFile(gi(root), content);
    await assert.rejects(applyScaffoldGitignore(root), error);
    assert.equal(await readFile(gi(root), "utf8"), content);
  }));
}

test("stripManagedBlock leaves content without markers untouched", () => {
  const input = "a\nb\nc\n";
  assert.equal(__testing.stripManagedBlock(input), input);
});
