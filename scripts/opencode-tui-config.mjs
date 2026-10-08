import { readFileSync, writeFileSync, existsSync, lstatSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const entry = "./plugins/tui/goal-progress.tsx";

function assertPath(root, file) {
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("TUI path escapes configuration root");
  let current = root;
  for (const part of ["", ...relative.split(path.sep)]) {
    if (part) current = path.join(current, part);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("Symlinked TUI configuration path");
  }
}

function sameTarget(spec, root) {
  if (typeof spec !== "string") return false;
  if (!spec.startsWith(".") && !path.isAbsolute(spec) && !spec.startsWith("file://")) return false;
  const target = spec.startsWith("file://") ? fileURLToPath(spec) : path.resolve(root, spec);
  return target === path.resolve(root, entry);
}

export function manageTuiConfig(action, configDir, sources = []) {
  const root = path.resolve(configDir);
  let parser;
  try { parser = createRequire(import.meta.url)("jsonc-parser"); }
  catch { parser = createRequire(path.join(root, "package.json"))("jsonc-parser"); }
  const { parse, modify, applyEdits } = parser;
  const candidates = ["tui.json", "tui.jsonc"].map(name => path.join(root, name));
  for (const file of candidates) assertPath(root, file);
  const present = candidates.filter(existsSync);
  if (present.length > 1) throw new Error("Both tui.json and tui.jsonc exist; resolve their registration ownership before installation");
  const file = present[0] ?? candidates[0];
  let text = present.length ? readFileSync(file, "utf8") : "{}\n";
  const errors = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid TUI JSON/JSONC configuration");
  if (value.plugin !== undefined && !Array.isArray(value.plugin)) throw new Error("TUI plugin must be an array");
  const plugins = value.plugin ?? [];
  const matches = plugins.map((item, index) => ({ item, index })).filter(x => sameTarget(Array.isArray(x.item) ? x.item[0] : x.item, root));
  const customized = matches.some(x => Array.isArray(x.item));
  if (action === "status") {
    if (!matches.length) throw new Error("Goal TUI plugin registration missing");
    return value.plugin_enabled?.["cuddly-winner-goal-progress"] === false || matches.some(x => Array.isArray(x.item) && x.item[1]?.enabled === false)
      ? "Goal TUI plugin: disabled by user (preserved)" : "Goal TUI plugin registration: current";
  }
  if (action === "can-remove") {
    if (customized) throw new Error("Customized TUI plugin registration preserved");
    for (const source of sources) {
      const destination = path.join(root, "plugins/tui", path.basename(source));
      assertPath(root, destination);
      if (existsSync(destination) && (!lstatSync(destination).isFile() || !readFileSync(destination).equals(readFileSync(source)))) {
        throw new Error("Modified or unrelated TUI asset preserved with its registration");
      }
    }
    return "Goal TUI plugin removal ownership: verified";
  }
  const format = { insertSpaces: true, tabSize: 2, eol: text.includes("\r\n") ? "\r\n" : "\n" };
  const edit = (location, next, insertion = false) => {
    text = applyEdits(text, modify(text, location, next, { formattingOptions: format, isArrayInsertion: insertion }));
  };
  if (action === "install") {
    if (matches.length) return "Existing Goal TUI plugin registration/preferences preserved";
    if (!present.length) edit(["$schema"], "https://opencode.ai/tui.json");
    if (value.plugin === undefined) edit(["plugin"], [entry]);
    else edit(["plugin", plugins.length], entry, true);
  } else if (action === "remove") {
    if (customized) throw new Error("Customized TUI plugin registration preserved");
    if (!matches.length) return "Goal TUI plugin registration: absent";
    for (const match of matches.reverse()) edit(["plugin", match.index], undefined);
  } else throw new Error("Unknown TUI config action");
  if (present.length) copyFileSync(file, `${file}.bak.${Date.now()}.${process.pid}`);
  writeFileSync(file, text, { mode: 0o600 });
  return `Goal TUI plugin registration: ${action === "install" ? "installed" : "removed"}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, option, root, ...sources] = process.argv.slice(2);
    if (option !== "--config-dir" || !root) throw new Error("Expected ACTION --config-dir PATH [managed source files]");
    console.log(manageTuiConfig(action, root, sources));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
