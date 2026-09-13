#!/usr/bin/env node
// Captures a browser login session for headless Obscura reuse. Obscura has no
// visible window, so it cannot perform an interactive login (MFA, SSO, CAPTCHA).
// This helper opens the browser the user already has (Chrome, Edge, or Brave),
// lets a human log in in that visible window, then reads the resulting cookies
// over the Chrome DevTools Protocol using Node's built-in WebSocket/fetch — no
// Playwright, no downloaded browser. It writes an Obscura-shaped storage state
// plus the browser User-Agent to a mode-0600 session file the credential
// wrapper (opencode-browser-mcp.mjs) hydrates per Obscura process.
//
// Only cookies are captured. An earlier probe proved Obscura restores cookies
// through browser_set_storage_state but discards localStorage on navigation, so
// a login that lives in localStorage or IndexedDB cannot be bridged and is out
// of scope. The captured value never enters the model's context: it lives in
// the session file, and the wrapper injects it through a filtered-out call.
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ACTIONS = new Set(["capture", "status", "remove"]);
const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const DEFAULT_TIMEOUT_MS = 180_000;
const POLL_MS = 2_000;

function die(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function usage() {
  process.stderr.write(
    "Usage: opencode-browser-session.mjs <capture|status|remove> --config-dir <dir> --name <name>\n" +
      "  capture: --url <https login URL> --origin <https-origin> [--origin ...]\n" +
      "           (--cookie <name> | --complete-url <https-prefix>) [--browser chrome|edge|brave] [--timeout <seconds>]\n",
  );
}

function parseArgs(argv) {
  const [action, ...rest] = argv;
  if (!ACTIONS.has(action)) {
    usage();
    die(`unknown action: ${action ?? "(missing)"}`);
  }
  const options = { action, configDir: "", name: "", url: "", origins: [], cookie: "", completeUrl: "", browser: "", timeout: "" };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (key === "--config-dir") options.configDir = rest[++index] ?? "";
    else if (key === "--name") options.name = rest[++index] ?? "";
    else if (key === "--url") options.url = rest[++index] ?? "";
    else if (key === "--origin") options.origins.push(rest[++index] ?? "");
    else if (key === "--cookie") options.cookie = rest[++index] ?? "";
    else if (key === "--complete-url") options.completeUrl = rest[++index] ?? "";
    else if (key === "--browser") options.browser = rest[++index] ?? "";
    else if (key === "--timeout") options.timeout = rest[++index] ?? "";
    else die(`unknown argument: ${key}`);
  }
  if (!options.configDir) die("--config-dir is required");
  // status without --name lists every captured session; capture and remove act
  // on one named session. A provided name is always validated.
  if (options.name) {
    if (!NAME_PATTERN.test(options.name)) die("--name of letters, digits, dot, dash, or underscore is required");
  } else if (action !== "status") {
    die("--name of letters, digits, dot, dash, or underscore is required");
  }
  return options;
}

function sessionsDir(configDir) {
  return path.join(path.resolve(configDir), "cuddly-winner-sessions");
}
function sessionPath(configDir, name) {
  return path.join(sessionsDir(configDir), `${name}.json`);
}

function canonicalOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return die(`--origin is not a valid URL: ${origin}`);
  }
  if (url.protocol !== "https:") die(`--origin must be https: ${origin}`);
  if (url.origin !== origin) die(`--origin must be a bare origin (no path or trailing slash): ${origin}`);
  return origin;
}

function parseHttps(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return die(`${label} must be an absolute https URL: ${value}`);
  }
  if (url.protocol !== "https:") die(`${label} must be https: ${value}`);
  return url;
}

// A cookie belongs to a configured origin when its domain equals or is a parent
// of the origin host. Login flows cross origins (chatgpt.com -> auth.openai.com),
// so every configured origin is checked and a shared parent domain (.openai.com)
// matches the child host.
function cookieMatchesOrigins(cookieDomain, originHosts) {
  const bare = cookieDomain.replace(/^\./, "");
  return originHosts.some((host) => host === bare || host.endsWith(`.${bare}`) || bare.endsWith(`.${host}`));
}

function toStorageStateCookie(cookie) {
  const out = { name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path || "/", secure: !!cookie.secure, httpOnly: !!cookie.httpOnly };
  if (typeof cookie.sameSite === "string" && ["Strict", "Lax", "None"].includes(cookie.sameSite)) out.sameSite = cookie.sameSite;
  if (!cookie.session && typeof cookie.expires === "number" && cookie.expires > 0) out.expires = cookie.expires;
  return out;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function cdpVersion(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!response.ok) throw new Error(`CDP /json/version returned ${response.status}`);
  return response.json();
}

async function cdpTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  if (!response.ok) throw new Error(`CDP /json returned ${response.status}`);
  return response.json();
}

// One request/response exchange on the browser-level CDP WebSocket.
function cdpCall(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const id = 1;
    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* already closed */ }
      reject(new Error(`CDP ${method} timed out`));
    }, 10_000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id, method, params })));
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(typeof event.data === "string" ? event.data : ""); } catch { return; }
      if (message.id !== id) return;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      if (message.error) reject(new Error(`CDP ${method}: ${message.error.message ?? "error"}`));
      else resolve(message.result);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`CDP ${method}: websocket error`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCdp(port, deadline) {
  for (;;) {
    try {
      return await cdpVersion(port);
    } catch (error) {
      if (Date.now() > deadline) throw new Error(`browser DevTools endpoint never came up: ${error.message}`);
      await sleep(300);
    }
  }
}

// Standard install locations per OS. A bare command name is resolved against
// PATH; an absolute path is checked directly. Linux browsers are usually PATH
// shims or symlinks, so existence — not file type — is what matters. Windows
// roots are read from the environment at call time so the resolver stays
// testable from any host.
export function browserCandidates(platform) {
  if (platform === "darwin") {
    return {
      chrome: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
      edge: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
      brave: ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
    };
  }
  if (platform === "linux") {
    return {
      chrome: ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser",
        "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium",
        "/usr/bin/chromium-browser", "/snap/bin/chromium"],
      edge: ["microsoft-edge-stable", "microsoft-edge",
        "/usr/bin/microsoft-edge-stable", "/usr/bin/microsoft-edge", "/opt/microsoft/msedge/msedge"],
      brave: ["brave-browser", "brave",
        "/usr/bin/brave-browser", "/opt/brave.com/brave/brave-browser"],
    };
  }
  if (platform === "win32") {
    const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA || programFiles;
    return {
      chrome: [
        `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
        `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
        `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
      ],
      edge: [
        `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      ],
      brave: [
        `${programFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        `${programFilesX86}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
      ],
    };
  }
  return null;
}

function existsExecutable(candidate, pathValue) {
  if (candidate.includes("/") || candidate.includes("\\")) return existsSync(candidate) ? candidate : null;
  for (const dir of (pathValue || "").split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, candidate);
    if (existsSync(full)) return full;
  }
  return null;
}

// Pure, testable browser resolution across macOS, Linux, and Windows. Returns
// { name, binary } on success or { error } otherwise. platform and PATH are
// injectable so every OS can be exercised from any host.
export function findBrowser(choice, { platform = process.platform, pathValue = process.env.PATH } = {}) {
  const table = browserCandidates(platform);
  if (!table) return { error: `unsupported platform: ${platform}` };
  if (choice && !table[choice]) return { error: `unsupported --browser: ${choice} (chrome, edge, or brave)` };
  for (const name of choice ? [choice] : ["chrome", "edge", "brave"]) {
    for (const candidate of table[name]) {
      const binary = existsExecutable(candidate, pathValue);
      if (binary) return { name, binary };
    }
  }
  return {
    error: choice
      ? `selected browser is not installed: ${choice}`
      : "no supported browser found (Chrome, Edge, or Brave). Pass --browser or install one.",
  };
}

function resolveBrowser(choice) {
  const result = findBrowser(choice);
  if (result.error) die(result.error);
  return result;
}

async function capture(options) {
  if (!options.url) die("capture requires --url (the login start page)");
  const loginUrl = parseHttps(options.url, "--url");
  if (options.origins.length === 0) die("capture requires at least one --origin");
  const origins = [...new Set(options.origins.map(canonicalOrigin))];
  const originHosts = origins.map((origin) => new URL(origin).host);
  if (!originHosts.includes(loginUrl.host)) die("--url host must be one of the configured --origin hosts");
  if (!options.cookie && !options.completeUrl) die("capture requires --cookie <name> or --complete-url <https-prefix> to detect login completion");
  if (options.completeUrl) parseHttps(options.completeUrl, "--complete-url");
  const timeoutMs = options.timeout ? Number(options.timeout) * 1000 : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) die("--timeout must be a positive number of seconds");

  const browser = resolveBrowser(options.browser);
  const port = await freePort();
  const profileDir = mkdtempSync(path.join(os.tmpdir(), "cuddly-winner-capture-"));
  const child = spawn(browser.binary, [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    loginUrl.toString(),
  ], { stdio: "ignore", detached: false });

  process.stderr.write(
    `A ${browser.name} window is opening at ${loginUrl.origin}. Log in there (MFA and SSO work — you are driving it).\n` +
      `Waiting up to ${Math.round(timeoutMs / 1000)}s for ${options.cookie ? `cookie "${options.cookie}"` : `URL ${options.completeUrl}`}.\n`,
  );

  let exited = false;
  child.on("exit", () => { exited = true; });

  try {
    const deadline = Date.now() + timeoutMs;
    const version = await waitForCdp(port, deadline);
    const wsUrl = version.webSocketDebuggerUrl;
    const userAgent = version["User-Agent"] || "";
    if (!wsUrl) throw new Error("DevTools endpoint did not expose a browser WebSocket URL");

    let done = false;
    while (!done) {
      if (exited) throw new Error("browser was closed before login completion was detected");
      if (Date.now() > deadline) throw new Error("timed out waiting for login completion");
      if (options.cookie) {
        const { cookies } = await cdpCall(wsUrl, "Storage.getCookies");
        done = cookies.some((cookie) => cookie.name === options.cookie && cookieMatchesOrigins(cookie.domain, originHosts));
      } else {
        const targets = await cdpTargets(port);
        done = targets.some((target) => target.type === "page" && typeof target.url === "string" && target.url.startsWith(options.completeUrl));
      }
      if (!done) await sleep(POLL_MS);
    }

    const { cookies } = await cdpCall(wsUrl, "Storage.getCookies");
    const kept = cookies
      .filter((cookie) => cookieMatchesOrigins(cookie.domain, originHosts))
      .map(toStorageStateCookie);
    if (kept.length === 0) throw new Error("no cookies matched the configured origins; nothing captured");

    const dir = sessionsDir(options.configDir);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = sessionPath(options.configDir, options.name);
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) die(`session file is a symlink: ${file}`);
    const record = {
      schema_version: 1,
      name: options.name,
      origins,
      user_agent: userAgent,
      captured_at: new Date().toISOString(),
      state: { cookies: kept, origins: [] },
    };
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    process.stdout.write(
      `Captured session "${options.name}": ${kept.length} cookie${kept.length === 1 ? "" : "s"} for ${origins.join(", ")}. ` +
        `Restart OpenCode; the wrapper hydrates it on first navigation. Cookie values were never printed.\n`,
    );
  } finally {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
    rmSync(profileDir, { recursive: true, force: true });
  }
}

function loadSession(file) {
  if (lstatSync(file).isSymbolicLink()) die(`session file is a symlink: ${file}`);
  let value;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return die(`${file} is not valid JSON (${error.message})`);
  }
  if (!value || typeof value !== "object" || value.schema_version !== 1 || !value.state || !Array.isArray(value.state.cookies)) {
    return die(`${file} is not a supported schema-version-1 session file`);
  }
  return value;
}

function status(options) {
  const dir = sessionsDir(options.configDir);
  const names = options.name
    ? [options.name]
    : (existsSync(dir) ? readdirSync(dir).filter((entry) => entry.endsWith(".json")).map((entry) => entry.slice(0, -5)).sort() : []);
  if (names.length === 0) {
    process.stdout.write(`No captured sessions under ${dir}\n`);
    return;
  }
  for (const name of names) {
    const file = sessionPath(options.configDir, name);
    if (!existsSync(file)) {
      process.stdout.write(`[missing] ${name}\n`);
      continue;
    }
    const record = loadSession(file);
    process.stdout.write(
      `[${name}] cookies=${record.state.cookies.length} origins=${(record.origins || []).join(", ")} captured=${record.captured_at || "?"}\n`,
    );
  }
}

function remove(options) {
  if (!options.name) die("remove requires --name");
  const file = sessionPath(options.configDir, options.name);
  if (!existsSync(file)) {
    process.stdout.write(`No captured session "${options.name}".\n`);
    return;
  }
  if (lstatSync(file).isSymbolicLink()) die(`session file is a symlink: ${file}`);
  rmSync(file, { force: true });
  process.stdout.write(`Removed captured session "${options.name}". Restart OpenCode to drop it.\n`);
}

// Only run the CLI when invoked directly, so a test can import findBrowser and
// exercise Linux/Windows resolution from any host without triggering parseArgs.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  if (options.action === "capture") await capture(options);
  else if (options.action === "status") status(options);
  else remove(options);
}
