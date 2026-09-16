#!/usr/bin/env node
// opencode-browser-login.mjs
//
// Headed Playwright login helper. This is the ONLY place a visible browser
// window opens in the Playwright-only browser stack. A person completes a
// required login here; the approved Playwright storage state is saved through
// opencode-browser-state.mjs (owner-only, origin-scoped) and later loaded
// privately by the headless MCP server. This helper never performs task work
// and never prints state values.
//
// Flow (see docs/RESOURCE-SELECTION.md "Browser actions and login"):
//   1. Validate all arguments before launching anything.
//   2. On Linux, require a graphical session (DISPLAY or WAYLAND_DISPLAY).
//   3. Open headed Playwright with a dedicated throwaway profile.
//   4. Wait, with a bounded deadline, for a completion cookie or completion URL.
//   5. Save storage state (and optional session storage) for the approved
//      origins, then close the browser before removing the temporary profile.
//
// CLI:
//   capture --config-dir <dir> --name <name> --url <https-login-url>
//           --origin <https-origin> [--origin ...]
//           (--cookie <name> | --complete-url <https-prefix>)
//           [--session-storage] [--timeout <seconds>]
//   status  --config-dir <dir> [--name <name>]   (metadata only)
//   remove  --config-dir <dir> --name <name>

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertValidName,
  assertSafeSessionsDir,
  saveState,
  statMetadata,
  listStates,
  removeState,
} from "./opencode-browser-state.mjs";

const DEFAULT_TIMEOUT_SECONDS = 180;
const POLL_MS = 500;

class LoginError extends Error {}

// --- argument parsing (repeatable --origin) --------------------------------

function parseArgs(argv) {
  const out = { _: [], origin: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    const value = next === undefined || next.startsWith("--") ? true : (i++, next);
    if (key === "origin") {
      if (value === true) throw new LoginError("--origin requires a value");
      out.origin.push(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function requireConfigDir(args) {
  const dir = args["config-dir"] || process.env.OPENCODE_DEPLOY_CONFIG_DIR;
  if (!dir || dir === true) throw new LoginError("--config-dir is required");
  return dir;
}

// Validate capture arguments fully, BEFORE any browser launch. Returns a
// normalised option object.
function validateCaptureArgs(args) {
  const configDir = requireConfigDir(args);
  if (!args.name || args.name === true) throw new LoginError("--name is required");
  try {
    assertValidName(args.name);
  } catch (err) {
    throw new LoginError(err instanceof Error ? err.message : String(err));
  }
  if (!args.url || args.url === true) throw new LoginError("capture requires --url");
  if (!args.origin.length) throw new LoginError("capture requires at least one --origin");

  let loginUrl;
  try {
    loginUrl = new URL(args.url);
  } catch {
    throw new LoginError("--url must be an https URL");
  }
  if (loginUrl.protocol !== "https:") throw new LoginError("--url must be https");

  const origins = [];
  for (const raw of args.origin) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new LoginError(`--origin must be a bare https origin: ${raw}`);
    }
    if (url.protocol !== "https:") throw new LoginError(`--origin must be https: ${raw}`);
    // Compare against the raw string: new URL() normalises "https://host" and
    // "https://host/" to the same origin, so a trailing slash or any path is
    // only detectable before normalisation.
    if (raw !== url.origin) {
      throw new LoginError(`--origin must be a bare origin (no path): ${raw}`);
    }
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }

  const originHosts = new Set(origins.map((o) => new URL(o).host));
  if (!originHosts.has(loginUrl.host)) {
    throw new LoginError("--url host must be one of the configured --origin hosts");
  }

  const cookie = args.cookie && args.cookie !== true ? args.cookie : null;
  let completeUrl = null;
  if (args["complete-url"] && args["complete-url"] !== true) {
    completeUrl = args["complete-url"];
    let cu;
    try {
      cu = new URL(completeUrl);
    } catch {
      throw new LoginError("--complete-url must be an https URL");
    }
    if (cu.protocol !== "https:") throw new LoginError("--complete-url must be https");
    if (!origins.includes(cu.origin)) throw new LoginError("--complete-url origin must be approved by --origin");
  }
  if (!cookie && !completeUrl) throw new LoginError("capture requires --cookie or --complete-url");

  let timeout = DEFAULT_TIMEOUT_SECONDS;
  if (args.timeout && args.timeout !== true) {
    timeout = Number(args.timeout);
    if (!Number.isFinite(timeout) || timeout <= 0) throw new LoginError("--timeout must be a positive number of seconds");
  }

  return {
    configDir,
    name: args.name,
    url: args.url,
    origins,
    cookie,
    completeUrl,
    captureSessionStorage: Boolean(args["session-storage"]),
    timeout,
  };
}

// --- headed capture --------------------------------------------------------

function assertGraphicalSession() {
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new LoginError("headed login requires a graphical session (DISPLAY or WAYLAND_DISPLAY)");
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cookieMatchesOrigins(cookie, origins) {
  const domain = String(cookie.domain || "").replace(/^\./, "");
  return origins.some((origin) => {
    const host = new URL(origin).hostname;
    return host === domain || host.endsWith(`.${domain}`);
  });
}

function storageFingerprint(storageState, origins) {
  const cookies = (storageState?.cookies || [])
    .filter((cookie) => cookieMatchesOrigins(cookie, origins))
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
    }))
    .sort((a, b) => `${a.domain}\0${a.path}\0${a.name}`.localeCompare(`${b.domain}\0${b.path}\0${b.name}`));
  const approved = new Set(origins);
  const originState = (storageState?.origins || [])
    .filter((entry) => approved.has(entry.origin))
    .map((entry) => ({
      origin: entry.origin,
      localStorage: [...(entry.localStorage || [])].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.origin.localeCompare(b.origin));
  return JSON.stringify({ cookies, origins: originState });
}

function completionSatisfied({ baselineFingerprint, currentFingerprint, currentUrl, cookies, cookie, completeUrl }) {
  if (currentFingerprint === baselineFingerprint) return false;
  if (completeUrl && !currentUrl.startsWith(completeUrl)) return false;
  if (cookie && !cookies.some((entry) => entry.name === cookie && entry.value)) return false;
  return true;
}

async function waitForCompletion(context, page, opts, baselineFingerprint, deadline) {
  while (Date.now() < deadline) {
    try {
      const currentState = await context.storageState();
      if (completionSatisfied({
        baselineFingerprint,
        currentFingerprint: storageFingerprint(currentState, opts.origins),
        currentUrl: page.url(),
        cookies: (currentState.cookies || []).filter((entry) => cookieMatchesOrigins(entry, opts.origins)),
        cookie: opts.cookie,
        completeUrl: opts.completeUrl,
      })) return;
    } catch {
      /* page or context may be mid-navigation */
    }
    await sleep(POLL_MS);
  }
  throw new LoginError(`login did not complete within ${opts.timeout}s`);
}

// Capture session storage per approved origin, only when explicitly requested.
async function captureSessionStorage(page, origins) {
  const result = {};
  let origin;
  try {
    origin = new URL(page.url()).origin;
  } catch {
    return undefined;
  }
  if (!origins.includes(origin)) return undefined;
  const entries = await page.evaluate(() => Object.fromEntries(Object.keys(window.sessionStorage).map((key) => [key, window.sessionStorage.getItem(key)])));
  if (entries && Object.keys(entries).length) result[origin] = entries;
  return Object.keys(result).length ? result : undefined;
}

async function capture(args) {
  const opts = validateCaptureArgs(args);
  assertGraphicalSession();
  assertSafeSessionsDir(opts.configDir);

  const { chromium } = await import("playwright");
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "cuddly-winner-login-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(opts.url);
    const baselineFingerprint = storageFingerprint(await context.storageState(), opts.origins);
    process.stderr.write(`Waiting for login to complete (up to ${opts.timeout}s)...\n`);
    await waitForCompletion(context, page, opts, baselineFingerprint, Date.now() + opts.timeout * 1000);

    const storageState = await context.storageState();
    const sessionStorage = opts.captureSessionStorage ? await captureSessionStorage(page, opts.origins) : undefined;
    saveState({ configDir: opts.configDir, name: opts.name, origins: opts.origins, storageState, sessionStorage });
    // Never print state values; only metadata.
    process.stdout.write(
      `Saved login state "${opts.name}" for ${opts.origins.join(", ")}${sessionStorage ? " (with session storage)" : ""}\n`,
    );
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {
        /* already gone */
      }
    }
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
  return 0;
}

// --- metadata-only status / remove -----------------------------------------

function status(args) {
  const configDir = requireConfigDir(args);
  if (args.name && args.name !== true) {
    const meta = statMetadata(configDir, args.name);
    if (!meta) {
      // The lookup itself succeeded: it correctly reports that no record
      // exists. That is a normal, successful query, not an error.
      process.stdout.write(`[missing] ${args.name}\n`);
      return 0;
    }
    process.stdout.write(`[${meta.name}] origins=${meta.origins.join(",")} capturedAt=${meta.capturedAt}\n`);
    return 0;
  }
  const rows = listStates(configDir);
  if (!rows.length) {
    process.stdout.write("No captured sessions\n");
    return 0;
  }
  for (const meta of rows) {
    process.stdout.write(`[${meta.name}] origins=${(meta.origins || []).join(",")} capturedAt=${meta.capturedAt ?? "?"}\n`);
  }
  return 0;
}

function remove(args) {
  const configDir = requireConfigDir(args);
  if (!args.name || args.name === true) throw new LoginError("--name is required for remove");
  const removed = removeState(configDir, args.name);
  process.stdout.write(removed ? `Removed captured session "${args.name}"\n` : `No captured session "${args.name}"\n`);
  return 0;
}

// --- CLI -------------------------------------------------------------------

async function main(argv) {
  const args = parseArgs(argv);
  const action = args._[0];
  switch (action) {
    case "capture":
      return capture(args);
    case "status":
      return status(args);
    case "remove":
      return remove(args);
    default:
      process.stderr.write(
        "usage: opencode-browser-login.mjs <capture|status|remove> --config-dir <dir> [--name <name>] ...\n",
      );
      throw new LoginError(action ? `unknown action: ${action}` : "no action given");
  }
}

// Compare canonical (symlink-resolved) paths with fileURLToPath rather than
// path.resolve(...pathname): on macOS the config dir is a /var -> /private/var
// symlink and paths may contain spaces, either of which breaks a lexical match
// and silently skips the CLI body.
const invokedDirectly =
  process.argv[1] && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code ?? 0))
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}

export { validateCaptureArgs, parseArgs, LoginError, completionSatisfied, storageFingerprint };
