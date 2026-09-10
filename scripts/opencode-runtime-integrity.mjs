#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OWNER = "cuddly-winner-runtime";

function die(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const [action, ...rest] = argv;
  if (!new Set(["compare", "record", "status", "remove"]).has(action)) die(`unknown action: ${action ?? "(missing)"}`);
  const options = { action, root: "", state: "", expectedRoot: "" };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    const value = rest[index + 1];
    if ((key === "--root" || key === "--state" || key === "--expected-root") && value) {
      if (key === "--expected-root") options.expectedRoot = value;
      else options[key.slice(2)] = value;
      index += 1;
    } else {
      die(`${key} requires a value`);
    }
  }
  if (!options.root) die("--root is required");
  if (!options.state) die("--state is required");
  if (action === "compare" && !options.expectedRoot) die("--expected-root is required");
  return options;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function lexicallyExists(file) {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function hashTree(root, stateFile) {
  const resolvedRoot = path.resolve(root);
  const excluded = path.resolve(stateFile);
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`runtime root is not a regular directory: ${root}`);
  const hash = createHash("sha256");
  let entryCount = 0;
  let fileCount = 0;
  let symlinkCount = 0;

  function visit(directory, relativeDirectory) {
    const entries = readdirSync(directory).sort();
    for (const name of entries) {
      const absolute = path.join(directory, name);
      if (path.resolve(absolute) === excluded) continue;
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const stat = lstatSync(absolute);
      entryCount += 1;
      if (stat.isSymbolicLink()) {
        hash.update(`symlink\0${relative}\0${readlinkSync(absolute)}\0`);
        symlinkCount += 1;
      } else if (stat.isDirectory()) {
        hash.update(`directory\0${relative}\0`);
        visit(absolute, relative);
      } else if (stat.isFile()) {
        const content = readFileSync(absolute);
        hash.update(`file\0${relative}\0${stat.mode & 0o111}\0${content.length}\0`);
        hash.update(content);
        fileCount += 1;
      } else {
        throw new Error(`runtime root contains an unsupported entry: ${relative}`);
      }
    }
  }

  visit(resolvedRoot, "");
  return { sha256: hash.digest("hex"), entry_count: entryCount, file_count: fileCount, symlink_count: symlinkCount };
}

function payload(tree) {
  return { schema_version: 1, owner: OWNER, tree };
}

function stateChecksum(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function createState(root, stateFile) {
  const owned = payload(hashTree(root, stateFile));
  return { ...owned, state_sha256: stateChecksum(owned) };
}

function sameTree(left, right) {
  return left.sha256 === right.sha256 &&
    left.entry_count === right.entry_count &&
    left.file_count === right.file_count &&
    left.symlink_count === right.symlink_count;
}

function loadOwnedState(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) throw new Error("expected a mode-600 regular file");
  const state = JSON.parse(readFileSync(file, "utf8"));
  if (!exactKeys(state, ["schema_version", "owner", "tree", "state_sha256"])) throw new Error("unexpected state fields");
  if (state.schema_version !== 1 || state.owner !== OWNER || !/^[a-f0-9]{64}$/.test(state.state_sha256)) throw new Error("unsupported state identity");
  if (
    !exactKeys(state.tree, ["sha256", "entry_count", "file_count", "symlink_count"]) ||
    !/^[a-f0-9]{64}$/.test(state.tree.sha256) ||
    !Number.isInteger(state.tree.entry_count) || state.tree.entry_count <= 0 ||
    !Number.isInteger(state.tree.file_count) || state.tree.file_count <= 0 ||
    !Number.isInteger(state.tree.symlink_count) || state.tree.symlink_count < 0
  ) {
    throw new Error("invalid runtime tree state");
  }
  const tree = {
    sha256: state.tree.sha256,
    entry_count: state.tree.entry_count,
    file_count: state.tree.file_count,
    symlink_count: state.tree.symlink_count,
  };
  const owned = payload(tree);
  if (state.state_sha256 !== stateChecksum(owned)) throw new Error("state checksum mismatch");
  return { ...owned, state_sha256: state.state_sha256 };
}

function record(root, stateFile) {
  const state = createState(root, stateFile);
  if (lexicallyExists(stateFile)) {
    try {
      loadOwnedState(stateFile);
    } catch {
      die(`runtime integrity state ownership is not proven; preserved: ${stateFile}`);
    }
  }
  const temporary = `${stateFile}.tmp.${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, stateFile);
  process.stdout.write("Runtime integrity state: recorded\n");
}

function status(root, stateFile) {
  if (!lexicallyExists(stateFile)) {
    process.stdout.write("Runtime integrity state: missing\n");
    process.exitCode = 1;
    return;
  }
  let state;
  try {
    state = loadOwnedState(stateFile);
  } catch {
    process.stdout.write("Runtime integrity state: modified\n");
    process.exitCode = 1;
    return;
  }
  try {
    const actual = hashTree(root, stateFile);
    if (sameTree(actual, state.tree)) {
      process.stdout.write("  [current] runtime content: node_modules\n");
      return;
    }
    process.stdout.write("  [modified] runtime content: node_modules\n");
  } catch {
    process.stdout.write("  [missing or unsafe] runtime content: node_modules\n");
  }
  process.exitCode = 1;
}

function compare(root, stateFile, expectedRoot) {
  try {
    if (sameTree(hashTree(root, stateFile), hashTree(expectedRoot, stateFile))) return;
  } catch {}
  process.exitCode = 1;
}

function remove(stateFile) {
  if (!lexicallyExists(stateFile)) {
    process.stdout.write("Runtime integrity state: missing\n");
    return;
  }
  try {
    loadOwnedState(stateFile);
  } catch {
    process.stdout.write("Runtime integrity state: modified; preserved\n");
    return;
  }
  unlinkSync(stateFile);
  process.stdout.write("Runtime integrity state: removed\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  if (options.action === "compare") compare(options.root, options.state, options.expectedRoot);
  else if (options.action === "record") record(options.root, options.state);
  else if (options.action === "status") status(options.root, options.state);
  else remove(options.state);
}
