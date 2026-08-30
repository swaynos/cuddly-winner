#!/usr/bin/env node
// Manages only Cuddly-Winner-owned MCP entries in an OpenCode config.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

export function buildManagedMcp() {
  return {
    "cuddly-winner-research-browser": {
      type: "local",
      command: ["npx", "-y", "@playwright/mcp@0.0.78", "--headless", "--isolated"],
      enabled: true,
    },
  };
}

// MCP entries this project used to manage. Install prunes any that linger in a
// config from an earlier profile, so upgrading removes them without a manual edit.
const RETIRED_MANAGED_MCP_KEYS = ["cuddly-winner-notebooklm"];
const RETIRED_LEGACY_MCP_KEYS = ["notebooklm"];

function usage() {
  process.stderr.write("Usage: opencode-mcp-config.mjs <install|status|remove|diagnose|cleanup-retired> --config <path>\n");
}

function die(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const [action, ...rest] = argv;
  if (!new Set(["install", "status", "remove", "diagnose", "cleanup-retired"]).has(action)) {
    usage();
    die(`unknown action: ${action ?? "(missing)"}`);
  }
  let configPath = "";
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--config") configPath = rest[++index] ?? "";
    else die(`unknown argument: ${rest[index]}`);
  }
  if (!configPath) die("--config is required");
  return { action, configPath };
}

export function loadConfig(configPath) {
  if (!existsSync(configPath)) return { $schema: "https://opencode.ai/config.json" };
  try {
    const value = JSON.parse(readFileSync(configPath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("root must be an object");
    if (value.mcp !== undefined && (!value.mcp || typeof value.mcp !== "object" || Array.isArray(value.mcp))) throw new Error("mcp must be an object");
    return value;
  } catch (error) {
    throw new Error(`${configPath} is not valid supported JSON (${error.message})`);
  }
}

export function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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

export function modeOf(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "unknown";
  const command = Array.isArray(entry.command) ? entry.command.map(String) : [];
  if (command.includes("--headless") || entry.environment?.HEADLESS === "true") return "headless";
  if (command.some((value) => value === "--headed" || value === "--no-headless") || entry.environment?.HEADLESS === "false") return "headed";
  return "unknown";
}

function printStatus(config) {
  const managed = buildManagedMcp();
  const entries = config.mcp ?? {};
  for (const [name, desired] of Object.entries(managed)) {
    const current = entries[name];
    const state = current === undefined ? "none" : sameJson(current, desired) ? "managed" : "modified";
    process.stdout.write(`[${state}] ${name} mode=${modeOf(current)}\n`);
  }
}

function diagnose(config) {
  const managedNames = new Set(Object.keys(buildManagedMcp()));
  const entries = config.mcp ?? {};
  for (const [name, entry] of Object.entries(entries)) {
    const owner = managedNames.has(name) ? "managed" : "unmanaged";
    process.stdout.write(`${owner} ${name} mode=${modeOf(entry)}\n`);
  }
}

export function apply(action, configPath) {
  const config = loadConfig(configPath);
  if (action === "status") return printStatus(config);
  if (action === "diagnose") return diagnose(config);
  const managed = buildManagedMcp();
  const mcp = { ...(config.mcp ?? {}) };
  let changed = false;
  if (action === "install") {
    for (const [name, entry] of Object.entries(managed)) {
      if (!sameJson(mcp[name], entry)) {
        mcp[name] = entry;
        changed = true;
      }
    }
    for (const name of RETIRED_MANAGED_MCP_KEYS) {
      if (mcp[name] !== undefined) {
        delete mcp[name];
        changed = true;
        process.stdout.write(`Removed retired managed entry: ${name}\n`);
      }
    }
  } else if (action === "cleanup-retired") {
    for (const name of RETIRED_LEGACY_MCP_KEYS) {
      if (mcp[name] !== undefined) {
        delete mcp[name];
        changed = true;
        process.stdout.write(`Removed retired managed entry: ${name}\n`);
      }
    }
  } else {
    for (const [name, entry] of Object.entries(managed)) {
      if (sameJson(mcp[name], entry)) {
        delete mcp[name];
        changed = true;
      } else if (mcp[name] !== undefined) {
        process.stdout.write(`Skipped modified managed entry: ${name}\n`);
      }
    }
  }
  if (!changed) return process.stdout.write(`${action === "cleanup-retired" ? "No retired MCP entries found." : "Unchanged managed MCP entries."}\n`);
  backup(configPath);
  if (Object.keys(mcp).length) config.mcp = mcp;
  else delete config.mcp;
  save(configPath, config);
  const result = action === "install" ? "Installed managed MCP entries." : action === "cleanup-retired" ? "Removed retired MCP entries." : "Removed managed MCP entries.";
  process.stdout.write(`${result}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { action, configPath } = parseArgs(process.argv.slice(2));
    apply(action, configPath);
  } catch (error) {
    die(error.message);
  }
}
