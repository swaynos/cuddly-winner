#!/usr/bin/env node
// Manages entries in the `instructions` array of an OpenCode opencode.json.
// Used by deploy-opencode-agents.sh to keep global rule files wired up without
// hand-editing opencode.json. Never touches unrelated keys.

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";

function die(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function usage() {
  process.stdout.write(
    "Usage: opencode-instructions.mjs <add|remove|status> --config <path> <entry-path>...\n"
  );
}

const args = process.argv.slice(2);
const mode = args.shift();
if (!["add", "remove", "status"].includes(mode)) {
  usage();
  die(`Unknown mode: ${mode ?? "(none)"}`);
}

let configPath = "";
const entries = [];
while (args.length > 0) {
  const arg = args.shift();
  if (arg === "--config") {
    configPath = args.shift();
    if (!configPath) die("--config requires a path");
  } else {
    entries.push(arg);
  }
}
if (!configPath) die("--config is required");
if (mode !== "status" && entries.length === 0) die("at least one entry path is required");

function loadConfig(path) {
  if (!existsSync(path)) {
    return { $schema: "https://opencode.ai/config.json" };
  }
  const raw = readFileSync(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    die(`${path} is not valid JSON, refusing to modify it (${err.message})`);
  }
}

function backup(path) {
  if (!existsSync(path)) return;
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "");
  const dest = `${path}.bak.${stamp}.${process.pid}`;
  copyFileSync(path, dest);
  process.stdout.write(`Backed up: ${path} -> ${dest}\n`);
}

function save(path, config) {
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

if (mode === "status") {
  const config = loadConfig(configPath);
  const list = Array.isArray(config.instructions) ? config.instructions : [];
  for (const entry of entries) {
    process.stdout.write(
      `  [${list.includes(entry) ? "present" : "absent"}] instructions: ${entry}\n`
    );
  }
  process.exit(0);
}

const config = loadConfig(configPath);
const list = Array.isArray(config.instructions) ? [...config.instructions] : [];

if (mode === "add") {
  let changed = false;
  for (const entry of entries) {
    if (!list.includes(entry)) {
      list.push(entry);
      changed = true;
      process.stdout.write(`Added instruction: ${entry}\n`);
    } else {
      process.stdout.write(`Already present: ${entry}\n`);
    }
  }
  if (!changed) process.exit(0);
  backup(configPath);
  config.instructions = list;
  save(configPath, config);
  process.exit(0);
}

if (mode === "remove") {
  const remaining = list.filter((entry) => !entries.includes(entry));
  if (remaining.length === list.length) {
    for (const entry of entries) process.stdout.write(`Not present: ${entry}\n`);
    process.exit(0);
  }
  backup(configPath);
  for (const entry of entries) {
    if (list.includes(entry)) process.stdout.write(`Removed instruction: ${entry}\n`);
  }
  if (remaining.length === 0) {
    delete config.instructions;
  } else {
    config.instructions = remaining;
  }
  save(configPath, config);
  process.exit(0);
}
