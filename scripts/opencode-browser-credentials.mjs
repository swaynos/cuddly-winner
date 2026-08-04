#!/usr/bin/env node
// Explicit credential-mode manager for provider-specific image browser profiles.
import { copyFileSync, existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig, sameJson } from "./opencode-mcp-config.mjs";

const PROVIDERS = new Set(["chatgpt", "gemini"]);
const MODES = new Set(["ephemeral", "auth", "persistent-headless"]);

function die(message) { process.stderr.write(`Error: ${message}\n`); process.exit(1); }
function usage() { process.stderr.write("Usage: opencode-browser-credentials.mjs <status|set|flush> --config <path> --provider <chatgpt|gemini> [--mode <ephemeral|auth|persistent-headless>] [--confirm]\n"); }
function parse(argv) {
  const [action, ...rest] = argv;
  if (!new Set(["status", "set", "flush"]).has(action)) { usage(); die("invalid action"); }
  const values = { action, config: "", provider: "", mode: "", confirm: false };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (key === "--confirm") values.confirm = true;
    else if (["--config", "--provider", "--mode"].includes(key)) values[key.slice(2)] = rest[++index] ?? "";
    else die(`unknown argument: ${key}`);
  }
  if (!values.config || !PROVIDERS.has(values.provider)) die("--config and a supported --provider are required");
  if (action === "set" && !MODES.has(values.mode)) die("set requires a supported --mode");
  return values;
}

function key(provider) { return `cuddly-winner-image-${provider}`; }
function profile(configPath, provider) { return path.join(path.dirname(configPath), "cuddly-winner-profiles", provider); }
function assertSafeProfile(profilePath, configPath) {
  const root = path.resolve(path.dirname(configPath), "cuddly-winner-profiles");
  const resolved = path.resolve(profilePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("managed profile escapes configuration root");
  if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) throw new Error("managed profile is a symlink");
  return resolved;
}
function desired(configPath, provider, mode) {
  const profilePath = assertSafeProfile(profile(configPath, provider), configPath);
  const command = ["npx", "-y", "@playwright/mcp@0.0.78"];
  if (mode === "ephemeral") command.push("--headless", "--isolated");
  else if (mode === "auth") command.push("--user-data-dir", profilePath);
  else command.push("--headless", "--user-data-dir", profilePath);
  return { type: "local", command, enabled: true };
}
function backup(configPath) {
  if (!existsSync(configPath)) return;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
  const destination = `${configPath}.bak.${stamp}.${process.pid}`;
  copyFileSync(configPath, destination);
  process.stdout.write(`Backed up: ${configPath} -> ${destination}\n`);
}
function save(configPath, config) { writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 }); }
function modeFor(entry) {
  const command = Array.isArray(entry?.command) ? entry.command.map(String) : [];
  if (command.includes("--isolated")) return "ephemeral";
  if (command.includes("--headless")) return "persistent-headless";
  return entry ? "auth" : "not configured";
}
function status(configPath, provider) {
  const config = loadConfig(configPath);
  const entry = config.mcp?.[key(provider)];
  const profilePath = assertSafeProfile(profile(configPath, provider), configPath);
  process.stdout.write(`provider=${provider} mode=${modeFor(entry)} profile=${existsSync(profilePath) ? "present" : "absent"}\n`);
}
function setMode(configPath, provider, mode, confirmed) {
  if (mode === "auth" && !confirmed) die("auth mode can open a visible browser; rerun with --confirm after notifying the user");
  const config = loadConfig(configPath);
  const mcp = { ...(config.mcp ?? {}) };
  const entry = desired(configPath, provider, mode);
  if (sameJson(mcp[key(provider)], entry)) return process.stdout.write("Credential mode unchanged.\n");
  if (mode !== "ephemeral") mkdirSync(assertSafeProfile(profile(configPath, provider), configPath), { recursive: true, mode: 0o700 });
  backup(configPath);
  mcp[key(provider)] = entry;
  config.mcp = mcp;
  save(configPath, config);
  process.stdout.write(`Set ${provider} credential mode to ${mode}. Restart OpenCode before using it.\n`);
}
function flush(configPath, provider, confirmed) {
  if (!confirmed) die("flush deletes the managed provider profile; rerun with --confirm");
  const config = loadConfig(configPath);
  const mcp = { ...(config.mcp ?? {}) };
  const entry = desired(configPath, provider, "ephemeral");
  const profilePath = assertSafeProfile(profile(configPath, provider), configPath);
  const changedEntry = !sameJson(mcp[key(provider)], entry);
  const hadProfile = existsSync(profilePath);
  if (!changedEntry && !hadProfile) return process.stdout.write("No managed credentials to flush.\n");
  backup(configPath);
  if (changedEntry) {
    mcp[key(provider)] = entry;
    config.mcp = mcp;
    save(configPath, config);
  }
  if (hadProfile) rmSync(profilePath, { recursive: true, force: true });
  process.stdout.write(`Flushed managed ${provider} credentials and restored ephemeral mode. Restart OpenCode before using it.\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const values = parse(process.argv.slice(2));
    if (values.action === "status") status(values.config, values.provider);
    else if (values.action === "set") setMode(values.config, values.provider, values.mode, values.confirm);
    else flush(values.config, values.provider, values.confirm);
  } catch (error) { die(error.message); }
}
