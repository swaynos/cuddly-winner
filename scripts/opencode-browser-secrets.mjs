#!/usr/bin/env node
// Manages the credential registry read by opencode-browser-mcp.mjs. The registry
// maps a short name to a local KEY=VALUE secrets file and the https origins on
// which its keys may be released. Secret values live only in the referenced
// files; this registry never stores them and this CLI never prints them.
import { chmodSync, existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ACTIONS = new Set(["add", "status", "remove"]);
const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

function die(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function usage() {
  process.stderr.write(
    "Usage: opencode-browser-secrets.mjs <add|status|remove> --config-dir <dir> " +
      "[--name <short-name>] [--path <abs secrets file>] [--origin <https-origin> ...]\n",
  );
}

function parseArgs(argv) {
  const [action, ...rest] = argv;
  if (!ACTIONS.has(action)) {
    usage();
    die(`unknown action: ${action ?? "(missing)"}`);
  }
  const options = { action, configDir: "", name: "", path: "", origins: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (key === "--config-dir") options.configDir = rest[++index] ?? "";
    else if (key === "--name") options.name = rest[++index] ?? "";
    else if (key === "--path") options.path = rest[++index] ?? "";
    else if (key === "--origin") options.origins.push(rest[++index] ?? "");
    else die(`unknown argument: ${key}`);
  }
  if (!options.configDir) die("--config-dir is required");
  return options;
}

function registryPath(configDir) {
  return path.join(path.resolve(configDir), "cuddly-winner-secrets.json");
}

function loadRegistry(file) {
  if (!existsSync(file)) return { schema_version: 1, entries: {} };
  if (lstatSync(file).isSymbolicLink()) die(`secrets registry is a symlink: ${file}`);
  let value;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    die(`${file} is not valid JSON (${error.message})`);
  }
  if (!value || typeof value !== "object" || value.schema_version !== 1 || !value.entries || typeof value.entries !== "object") {
    die(`${file} is not a supported schema-version-1 secrets registry`);
  }
  return value;
}

function save(file, registry) {
  writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600); // enforce 0600 even when the file already existed
}

function canonicalOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    die(`--origin is not a valid URL: ${origin}`);
  }
  if (url.protocol !== "https:") die(`--origin must be https: ${origin}`);
  if (url.origin !== origin) die(`--origin must be a bare origin (no path or trailing slash): ${origin}`);
  return origin;
}

function add(options) {
  if (!NAME_PATTERN.test(options.name)) die("add requires a --name of letters, digits, dot, dash, or underscore");
  if (!options.path) die("add requires --path to a KEY=VALUE secrets file");
  if (!path.isAbsolute(options.path)) die(`--path must be absolute: ${options.path}`);
  if (!existsSync(options.path)) die(`secrets file not found: ${options.path}`);
  if (lstatSync(options.path).isSymbolicLink()) die(`secrets file is a symlink: ${options.path}`);
  if (!lstatSync(options.path).isFile()) die(`secrets file is not a regular file: ${options.path}`);
  if (options.origins.length === 0) die("add requires at least one --origin");
  const origins = [...new Set(options.origins.map(canonicalOrigin))];

  const file = registryPath(options.configDir);
  const registry = loadRegistry(file);
  const existed = registry.entries[options.name] !== undefined;
  registry.entries[options.name] = { path: path.resolve(options.path), origins };
  save(file, registry);
  process.stdout.write(`${existed ? "Updated" : "Added"} secrets entry "${options.name}" (${origins.length} origin${origins.length === 1 ? "" : "s"}).\n`);
}

function status(options) {
  const file = registryPath(options.configDir);
  if (!existsSync(file)) {
    process.stdout.write(`No secrets registry at ${file}\n`);
    return;
  }
  const registry = loadRegistry(file);
  const names = options.name ? [options.name] : Object.keys(registry.entries).sort();
  if (names.length === 0) {
    process.stdout.write("Secrets registry has no entries.\n");
    return;
  }
  for (const name of names) {
    const entry = registry.entries[name];
    if (!entry) {
      process.stdout.write(`[missing] ${name}\n`);
      continue;
    }
    const present = existsSync(entry.path) ? "present" : "absent";
    process.stdout.write(`[${name}] file=${entry.path} (${present}) origins=${entry.origins.join(", ")}\n`);
  }
}

function remove(options) {
  if (!options.name) die("remove requires --name");
  const file = registryPath(options.configDir);
  const registry = loadRegistry(file);
  if (registry.entries[options.name] === undefined) {
    process.stdout.write(`No secrets entry "${options.name}".\n`);
    return;
  }
  delete registry.entries[options.name];
  save(file, registry);
  process.stdout.write(`Removed secrets entry "${options.name}".\n`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.action === "add") add(options);
  else if (options.action === "status") status(options);
  else remove(options);
} catch (error) {
  die(error.message);
}
