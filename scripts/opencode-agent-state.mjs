#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const LEGACY_AGENTS = {
  "out-of-the-box-thinker.md": {
    source: "agents/out-of-the-box-thinker.md",
    mode: "copy",
    sha256: "70b80d5bf5932b38868e08dc76f58c6b8c74560da2e05e0ac7b193d4c8ab614c",
  },
};

function die(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function parseArgs(args) {
  const values = { sources: [] };
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--source") values.sources.push(args[++index]);
    else if (key === "--state" || key === "--mode") values[key.slice(2)] = args[++index];
    else die(`unknown argument: ${key}`);
  }
  return values;
}

function loadState(file) {
  if (!existsSync(file)) return { agents: { ...LEGACY_AGENTS } };
  let state;
  try {
    state = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    die(`managed agent state is invalid: ${file}`);
  }
  if (state?.schema_version !== 1 || !state.agents || Array.isArray(state.agents)) {
    die(`managed agent state has an unsupported schema: ${file}`);
  }
  return state;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const [action, ...rest] = process.argv.slice(2);
const options = parseArgs(rest);
if (!options.state) die("--state is required");

if (action === "retired") {
  const state = loadState(options.state);
  for (const [name, entry] of Object.entries(state.agents)) {
    if (options.sources.some(source => path.basename(source) === name)) continue;
    if (typeof entry?.source !== "string" || typeof entry?.sha256 !== "string") continue;
    process.stdout.write(`${name}\t${entry.source}\t${entry.sha256}\n`);
  }
} else if (action === "record") {
  if (!options.mode || !["copy", "symlink"].includes(options.mode)) die("--mode must be copy or symlink");
  const state = loadState(options.state);
  const agentsDir = path.dirname(options.state);
  const agents = {};
  for (const [name, entry] of Object.entries(state.agents)) {
    if (existsSync(path.join(agentsDir, name))) agents[name] = entry;
  }
  for (const source of options.sources) {
    agents[path.basename(source)] = { source, mode: options.mode, sha256: sha256(source) };
  }
  const temporary = `${options.state}.tmp.${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify({ schema_version: 1, agents }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, options.state);
} else {
  die("action must be retired or record");
}
