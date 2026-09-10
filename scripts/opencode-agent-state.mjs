#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LEGACY_AGENTS = {
  "out-of-the-box-thinker.md": {
    source: "agents/out-of-the-box-thinker.md",
    mode: "copy",
    sha256: "70b80d5bf5932b38868e08dc76f58c6b8c74560da2e05e0ac7b193d4c8ab614c",
  },
  "autonomous.md": {
    source: "agents/autonomous.md",
    mode: "copy",
    sha256: "1fcd6d4fb7ad95f93010d614b63368fe993e16f3a09288866f41dcb01749095d",
  },
  "karpathy.md": {
    source: "agents/karpathy.md",
    mode: "copy",
    sha256: "2fe1bc8c3dc7a04e6d09b827f39718d09a0871f87c6320164b6abb5400d2b00e",
  },
  "implementation-validator.md": {
    source: "agents/implementation-validator.md",
    mode: "copy",
    sha256: "4be445cff2f6f1a232a69e65a6b2ce9be7f848724c0649a36a089fa196c7afb7",
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
    const value = args[index + 1];
    if (key === "--source") {
      if (!value) die("--source requires a path");
      values.sources.push(value);
      index += 1;
    } else if (key === "--state" || key === "--mode") {
      if (!value) die(`${key} requires a value`);
      values[key.slice(2)] = value;
      index += 1;
    }
    else die(`unknown argument: ${key}`);
  }
  return values;
}

function managedAgentNames(sources) {
  const names = new Set(Object.keys(LEGACY_AGENTS));
  for (const source of sources) {
    const name = path.basename(source);
    if (!name || name === "." || name === ".." || name !== path.posix.basename(name) || name !== path.win32.basename(name)) {
      die(`invalid managed agent source basename: ${source}`);
    }
    names.add(name);
  }
  return names;
}

function agentDestination(agentsDir, name, knownNames) {
  const destination = path.resolve(agentsDir, name);
  const relative = path.relative(path.resolve(agentsDir), destination);
  if (
    !knownNames.has(name) ||
    !name ||
    name === "." ||
    name === ".." ||
    name !== path.posix.basename(name) ||
    name !== path.win32.basename(name) ||
    relative !== name
  ) {
    die(`invalid managed agent name: ${name || "(empty name)"}`);
  }
  return destination;
}

function resolvedLegacyAgents() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  return Object.fromEntries(Object.entries(LEGACY_AGENTS).map(([name, entry]) => [
    name,
    { ...entry, source: path.join(repoRoot, entry.source) },
  ]));
}

function loadState(file, sources, fail = die) {
  const knownNames = managedAgentNames(sources);
  const agentsDir = path.dirname(file);
  if (!existsSync(file)) {
    return {
      schema_version: 1,
      agents: resolvedLegacyAgents(),
    };
  }
  let state;
  try {
    state = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    fail(`managed agent state is invalid: ${file}`);
    return;
  }
  if (
    state?.schema_version !== 1 ||
    !state.agents ||
    typeof state.agents !== "object" ||
    Array.isArray(state.agents)
  ) {
    fail(`managed agent state has an unsupported schema: ${file}`);
    return;
  }
  for (const [name, entry] of Object.entries(state.agents)) {
    agentDestination(agentsDir, name, knownNames);
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.source !== "string" ||
      !entry.source ||
      /[\t\r\n]/.test(entry.source) ||
      !["copy", "symlink"].includes(entry.mode) ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      fail(`managed agent state has an invalid entry for ${name || "(empty name)"}: ${file}`);
      return;
    }
  }
  return state;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
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

const [action, ...rest] = process.argv.slice(2);
const options = parseArgs(rest);
if (!options.state) die("--state is required");

if (action === "status") {
  if (!existsSync(options.state)) {
    process.stdout.write("Managed agent state: missing\n");
    process.exit(1);
  }
  const stateStat = lstatSync(options.state);
  if (!stateStat.isFile() || stateStat.isSymbolicLink()) {
    process.stdout.write("Managed agent state: modified (expected a regular file)\n");
    process.exit(1);
  }
  const state = loadState(options.state, options.sources);
  const agentsDir = path.dirname(options.state);
  const knownNames = managedAgentNames(options.sources);
  const currentNames = new Set(options.sources.map(source => path.basename(source)));
  let current = true;
  if ((stateStat.mode & 0o777) !== 0o600) {
    process.stdout.write("Managed agent state: modified (expected mode 600)\n");
    current = false;
  }
  for (const source of options.sources) {
    const name = path.basename(source);
    const entry = state.agents[name];
    let destinationMode = "missing";
    try {
      destinationMode = lstatSync(agentDestination(agentsDir, name, knownNames)).isSymbolicLink() ? "symlink" : "copy";
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (
      !entry ||
      path.resolve(entry.source) !== path.resolve(source) ||
      entry.sha256 !== sha256(source) ||
      entry.mode !== destinationMode
    ) {
      process.stdout.write(`Managed agent state: modified entry for ${name}\n`);
      current = false;
    }
  }
  for (const name of Object.keys(state.agents)) {
    if (currentNames.has(name)) continue;
    try {
      lstatSync(agentDestination(agentsDir, name, knownNames));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      process.stdout.write(`Managed agent state: stale retired entry for ${name}\n`);
      current = false;
    }
  }
  if (current) process.stdout.write("Managed agent state: current\n");
  process.exit(current ? 0 : 1);
} else if (action === "retired") {
  let state;
  let stateError;
  try {
    state = loadState(options.state, options.sources, message => { throw new Error(message); });
  } catch (error) {
    stateError = error;
  }
  const agents = { ...resolvedLegacyAgents(), ...(state?.agents ?? {}) };
  for (const [name, entry] of Object.entries(agents)) {
    if (options.sources.some(source => path.basename(source) === name)) continue;
    process.stdout.write(`${name}\t${entry.source}\t${entry.sha256}\n`);
  }
  if (stateError) die(stateError.message);
} else if (action === "record") {
  if (!options.mode || !["copy", "symlink"].includes(options.mode)) die("--mode must be copy or symlink");
  const state = loadState(options.state, options.sources);
  const agentsDir = path.dirname(options.state);
  const knownNames = managedAgentNames(options.sources);
  const agents = {};
  for (const [name, entry] of Object.entries(state.agents)) {
    if (lexicallyExists(agentDestination(agentsDir, name, knownNames))) agents[name] = entry;
  }
  for (const source of options.sources) {
    agents[path.basename(source)] = { source, mode: options.mode, sha256: sha256(source) };
  }
  const temporary = `${options.state}.tmp.${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify({ schema_version: 1, agents }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, options.state);
} else {
  die("action must be status, retired, or record");
}
