#!/usr/bin/env node
// Manages only Cuddly-Winner-owned MCP entries in an OpenCode config.
import { copyFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { binaryPath } from "./opencode-browser-engine.mjs";

// The managed browser MCP entry runs the Obscura engine binary installed under
// the OpenCode config root by opencode-browser-engine.mjs. Obscura is
// headless-only and has no --headless flag, so the HEADLESS environment marker
// lets modeOf classify it as headless without engine-specific knowledge.
export function buildManagedMcp(configPath) {
  return {
    "cuddly-winner-browser": {
      type: "local",
      command: [binaryPath(path.dirname(configPath)), "mcp"],
      environment: { HEADLESS: "true" },
      enabled: true,
    },
  };
}

// MCP entries this project used to manage. Install prunes any that linger in a
// config from an earlier profile, so upgrading removes them without a manual edit.
const RETIRED_MANAGED_MCP_KEYS = ["cuddly-winner-notebooklm", "cuddly-winner-research-browser"];
const RETIRED_LEGACY_MANAGED_MCP = {
  notebooklm: { type: "local", command: ["npx", "-y", "notebooklm-mcp@latest"], enabled: true },
};

function usage() {
  process.stderr.write("Usage: opencode-mcp-config.mjs <install|status|remove|diagnose|status-retired|cleanup-retired|remove-retired> --config <path>\n");
}

function die(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const [action, ...rest] = argv;
  if (!new Set(["install", "status", "remove", "diagnose", "status-retired", "cleanup-retired", "remove-retired"]).has(action)) {
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
  return isDeepStrictEqual(left, right);
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

function printStatus(config, configPath) {
  const managed = buildManagedMcp(configPath);
  const entries = config.mcp ?? {};
  let currentProfile = true;
  for (const [name, desired] of Object.entries(managed)) {
    const current = entries[name];
    const state = current === undefined ? "none" : sameJson(current, desired) ? "managed" : "modified";
    process.stdout.write(`[${state}] ${name} mode=${modeOf(current)}\n`);
    if (state !== "managed") currentProfile = false;
  }
  for (const name of RETIRED_MANAGED_MCP_KEYS) {
    if (entries[name] === undefined) continue;
    process.stdout.write(`[retired] ${name} mode=${modeOf(entries[name])}\n`);
    currentProfile = false;
  }
  return currentProfile;
}

function diagnose(config, configPath) {
  const managedNames = new Set(Object.keys(buildManagedMcp(configPath)));
  const entries = config.mcp ?? {};
  for (const [name, entry] of Object.entries(entries)) {
    const owner = managedNames.has(name) ? "managed" : "unmanaged";
    process.stdout.write(`${owner} ${name} mode=${modeOf(entry)}\n`);
  }
}

function printRetiredStatus(config) {
  const entries = config.mcp ?? {};
  let currentProfile = true;
  for (const [name, legacyManagedEntry] of Object.entries(RETIRED_LEGACY_MANAGED_MCP)) {
    if (sameJson(entries[name], legacyManagedEntry)) {
      process.stdout.write(`[retired] ${name} mode=${modeOf(entries[name])}\n`);
      currentProfile = false;
    } else if (entries[name] !== undefined) {
      process.stdout.write(`[unmanaged] ${name} mode=${modeOf(entries[name])} (retired name; preserved)\n`);
    }
  }
  return currentProfile;
}

export function apply(action, configPath) {
  const config = loadConfig(configPath);
  if (action === "status") {
    if (!printStatus(config, configPath)) process.exitCode = 1;
    return;
  }
  if (action === "status-retired") {
    if (!printRetiredStatus(config)) process.exitCode = 1;
    return;
  }
  if (action === "diagnose") return diagnose(config, configPath);
  const managed = buildManagedMcp(configPath);
  const mcp = { ...(config.mcp ?? {}) };
  let changed = false;
  let conflict = false;
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
  } else if (action === "cleanup-retired" || action === "remove-retired") {
    for (const [name, legacyManagedEntry] of Object.entries(RETIRED_LEGACY_MANAGED_MCP)) {
      if (sameJson(mcp[name], legacyManagedEntry)) {
        delete mcp[name];
        changed = true;
        process.stdout.write(`Removed retired managed entry: ${name}\n`);
      } else if (mcp[name] !== undefined) {
        conflict = true;
        process.stdout.write(`Retired MCP conflict: ${name} (ownership not proven; preserved)\n`);
      }
    }
    if (conflict && action === "cleanup-retired") process.exitCode = 1;
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
  if (!changed) return process.stdout.write(`${conflict ? "Retired MCP entries: conflict; no owned entry removed." : action === "cleanup-retired" || action === "remove-retired" ? "No retired MCP entries found." : "Unchanged managed MCP entries."}\n`);
  backup(configPath);
  if (Object.keys(mcp).length) config.mcp = mcp;
  else delete config.mcp;
  save(configPath, config);
  const result = action === "install" ? "Installed managed MCP entries." : action === "cleanup-retired" || action === "remove-retired" ? "Removed retired MCP entries." : "Removed managed MCP entries.";
  process.stdout.write(`${result}\n`);
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  try {
    const { action, configPath } = parseArgs(process.argv.slice(2));
    apply(action, configPath);
  } catch (error) {
    die(error.message);
  }
}
