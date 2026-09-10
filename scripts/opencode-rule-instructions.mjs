#!/usr/bin/env node
// Manages only Cuddly-Winner rule paths in an OpenCode instructions array.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

function die(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function usage() {
  process.stdout.write(
    "Usage: opencode-rule-instructions.mjs <add|remove|status> --config <path> <entry-path>...\n",
  );
}

function parseArgs(argv) {
  const [mode, ...args] = argv;
  if (!["add", "remove", "status"].includes(mode)) {
    usage();
    die(`Unknown mode: ${mode ?? "(none)"}`);
  }
  let configPath = "";
  const entries = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--config") configPath = args[++index] ?? "";
    else entries.push(args[index]);
  }
  if (!configPath) die("--config is required");
  if (mode !== "status" && entries.length === 0) die("at least one entry path is required");
  return { mode, configPath, entries };
}

function loadConfig(configPath) {
  if (!existsSync(configPath)) return { $schema: "https://opencode.ai/config.json" };
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    die(`${configPath} is not valid JSON, refusing to modify it (${error.message})`);
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    die(`${configPath} must contain a JSON object`);
  }
  if (config.instructions !== undefined && (
    !Array.isArray(config.instructions) ||
    !config.instructions.every(entry => typeof entry === "string")
  )) {
    die(`${configPath} instructions must be an array of strings`);
  }
  return config;
}

function backup(configPath) {
  if (!existsSync(configPath)) return;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
  const destination = `${configPath}.bak.${stamp}.${process.pid}`;
  copyFileSync(configPath, destination);
  process.stdout.write(`Backed up: ${configPath} -> ${destination}\n`);
}

function save(configPath, config) {
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

const { mode, configPath, entries } = parseArgs(process.argv.slice(2));
const config = loadConfig(configPath);
const instructions = config.instructions === undefined ? [] : [...config.instructions];

if (mode === "status") {
  let drifted = false;
  for (const entry of entries) {
    const present = instructions.includes(entry);
    process.stdout.write(`  [${present ? "present" : "absent"}] instructions: ${entry}\n`);
    if (!present) drifted = true;
  }
  process.exit(drifted ? 1 : 0);
}

if (mode === "add") {
  let changed = false;
  for (const entry of entries) {
    if (instructions.includes(entry)) {
      process.stdout.write(`Already present: ${entry}\n`);
    } else {
      instructions.push(entry);
      changed = true;
      process.stdout.write(`Added instruction: ${entry}\n`);
    }
  }
  if (changed) {
    backup(configPath);
    config.instructions = instructions;
    save(configPath, config);
  }
  process.exit(0);
}

const remaining = instructions.filter(entry => !entries.includes(entry));
if (remaining.length === instructions.length) {
  for (const entry of entries) process.stdout.write(`Not present: ${entry}\n`);
  process.exit(0);
}
backup(configPath);
for (const entry of entries) {
  if (instructions.includes(entry)) process.stdout.write(`Removed instruction: ${entry}\n`);
}
if (remaining.length === 0) delete config.instructions;
else config.instructions = remaining;
save(configPath, config);
