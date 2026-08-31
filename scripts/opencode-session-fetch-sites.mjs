#!/usr/bin/env node
// Manages named, non-secret site profiles for the session_fetch workflow tool.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = 1;
const HEADER_NAME = /^[a-z0-9-]+$/;

function die(message) { process.stderr.write(`Error: ${message}\n`); process.exit(1); }
function profilePath(configDir) { return path.join(path.resolve(configDir), "session-fetch-sites.json"); }
function parseURL(value, label) {
  let url;
  try { url = new URL(value); } catch { die(`${label} must be an absolute HTTPS URL`); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) die(`${label} must be an origin or path-only HTTPS URL`);
  return url;
}
function parse(argv) {
  const [action, ...rest] = argv;
  if (!new Set(["set", "remove", "status"]).has(action)) die("usage: opencode-session-fetch-sites.mjs <set|remove|status> --config-dir <path> [--name <name>]");
  const values = { action, configDir: "", name: "", origins: [], loginURL: "", completeURL: "", completeSelector: "", tokenHeaders: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (key === "--config-dir") values.configDir = rest[++index] ?? "";
    else if (key === "--name") values.name = rest[++index] ?? "";
    else if (key === "--origin") values.origins.push(rest[++index] ?? "");
    else if (key === "--login-url") values.loginURL = rest[++index] ?? "";
    else if (key === "--complete-url") values.completeURL = rest[++index] ?? "";
    else if (key === "--complete-selector") values.completeSelector = rest[++index] ?? "";
    else if (key === "--token-header") values.tokenHeaders.push(rest[++index] ?? "");
    else die(`unknown argument: ${key}`);
  }
  if (!values.configDir || (action !== "status" && !/^[a-z][a-z0-9-]{0,63}$/.test(values.name))) die("--config-dir and a lowercase --name are required");
  return values;
}
function load(file) {
  if (!existsSync(file)) return { schema_version: SCHEMA_VERSION, sites: {} };
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (value.schema_version !== SCHEMA_VERSION || !value.sites || typeof value.sites !== "object" || Array.isArray(value.sites)) throw new Error("unsupported profile shape");
    return value;
  } catch (error) { die(`${file} is not a valid session-fetch profile file (${error.message})`); }
}
function save(file, value) { mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); }
function backup(file) {
  if (!existsSync(file)) return;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
  copyFileSync(file, `${file}.bak.${stamp}.${process.pid}`);
}
function site(values) {
  if (!values.origins.length || !values.loginURL || (!values.completeURL && !values.completeSelector)) die("set requires --origin, --login-url, and --complete-url or --complete-selector");
  const origins = [...new Set(values.origins.map(origin => {
    const url = parseURL(origin, "--origin");
    if (url.pathname !== "/") die("--origin must not include a path");
    return url.origin;
  }))];
  const loginURL = parseURL(values.loginURL, "--login-url").toString();
  const completeURL = values.completeURL ? parseURL(values.completeURL, "--complete-url").toString() : undefined;
  if (!origins.includes(new URL(loginURL).origin) || (completeURL && !origins.includes(new URL(completeURL).origin))) die("login and completion URLs must use a configured origin");
  const token_headers = {};
  for (const value of values.tokenHeaders) {
    const [header, storageKey, ...extra] = value.split("=");
    if (extra.length || !HEADER_NAME.test(header ?? "") || !storageKey || /^(cookie|authorization|host)$/i.test(header)) die("--token-header must be a safe header=storage-key pair");
    token_headers[header] = storageKey;
  }
  return { origins, login_url: loginURL, ...(completeURL ? { complete_url: completeURL } : {}), ...(values.completeSelector ? { complete_selector: values.completeSelector } : {}), ...(Object.keys(token_headers).length ? { token_headers } : {}) };
}

try {
  const values = parse(process.argv.slice(2));
  const file = profilePath(values.configDir);
  const config = load(file);
  if (values.action === "status") {
    process.stdout.write(`profiles=${Object.keys(config.sites).sort().join(",") || "none"}\n`);
  } else if (values.action === "remove") {
    if (!(values.name in config.sites)) process.stdout.write("Profile not found.\n");
    else { backup(file); delete config.sites[values.name]; save(file, config); process.stdout.write(`Removed profile: ${values.name}\n`); }
  } else {
    backup(file);
    config.sites[values.name] = site(values);
    save(file, config);
    process.stdout.write(`Set profile: ${values.name}\n`);
  }
} catch (error) { die(error.message); }
