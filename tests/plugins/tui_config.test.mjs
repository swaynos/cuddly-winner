import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "jsonc-parser";
import { manageTuiConfig } from "../../scripts/opencode-tui-config.mjs";

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "goal-tui-config-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("TUI registration preserves JSONC comments, tuples, settings and disabled preferences", async () => fixture(async root => {
  const file = path.join(root, "tui.jsonc");
  const original = '{\n // user theme\n "theme":"mine",\n "plugin":[\n // existing plugin\n ["some-plugin", {"option":42}],\n ],\n "plugin_enabled":{"cuddly-winner-goal-progress":false},\n}\n';
  await writeFile(file, original);
  manageTuiConfig("install", root);
  const installed = await readFile(file, "utf8");
  assert.match(installed, /user theme/);
  assert.match(installed, /existing plugin/);
  const value = parse(installed);
  assert.equal(value.theme, "mine");
  assert.deepEqual(value.plugin[0], ["some-plugin", { option: 42 }]);
  assert.equal(value.plugin_enabled["cuddly-winner-goal-progress"], false);
  assert.match(manageTuiConfig("status", root), /disabled by user/);
  manageTuiConfig("install", root);
  assert.equal(await readFile(file, "utf8"), installed, "install is idempotent");
  manageTuiConfig("remove", root);
  assert.deepEqual(parse(await readFile(file, "utf8")).plugin, [["some-plugin", { option: 42 }]]);
}));

test("TUI management rejects ambiguous, malformed and symlinked configs", async () => fixture(async root => {
  await writeFile(path.join(root, "tui.json"), "not JSON");
  assert.throws(() => manageTuiConfig("install", root), /Invalid/);
  await writeFile(path.join(root, "tui.json"), "{}");
  await writeFile(path.join(root, "tui.jsonc"), "{}");
  assert.throws(() => manageTuiConfig("install", root), /Both/);
  await rm(path.join(root, "tui.jsonc"));
  await rm(path.join(root, "tui.json"));
  await symlink(path.join(root, "absent"), path.join(root, "tui.json"));
  assert.throws(() => manageTuiConfig("install", root), /Symlinked/);
}));

test("customized registration and modified nested assets survive removal", async () => fixture(async root => {
  await writeFile(path.join(root, "tui.json"), JSON.stringify({ plugin: [["./plugins/tui/goal-progress.tsx", { enabled: false }]] }));
  assert.throws(() => manageTuiConfig("can-remove", root), /Customized/);
  assert.throws(() => manageTuiConfig("remove", root), /Customized/);
  await writeFile(path.join(root, "tui.json"), JSON.stringify({ plugin: ["./plugins/tui/goal-progress.tsx"] }));
  const source = path.join(root, "source", "goal-progress.tsx");
  await mkdir(path.dirname(source));
  await writeFile(source, "managed");
  await mkdir(path.join(root, "plugins/tui"), { recursive: true });
  await writeFile(path.join(root, "plugins/tui/goal-progress.tsx"), "user custom");
  assert.throws(() => manageTuiConfig("can-remove", root, [source]), /Modified/);
}));
