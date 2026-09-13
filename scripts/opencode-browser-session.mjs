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
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
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
const STOP_TIMEOUT_MS = 1_000;
const CDP_OPERATION_TIMEOUT_MS = 10_000;

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

function lstatIfPresent(file) {
  try {
    return lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function assertSafeSessionsDirectory(configDir) {
  const dir = sessionsDir(configDir);
  const directoryEntry = lstatIfPresent(dir);
  if (directoryEntry) {
    if (directoryEntry.isSymbolicLink()) throw new Error(`sessions directory is a symlink: ${dir}`);
    if (!directoryEntry.isDirectory()) throw new Error(`sessions path is not a directory: ${dir}`);
  }
  return dir;
}

function assertSafeSessionDestination(configDir, name) {
  const dir = assertSafeSessionsDirectory(configDir);
  const file = sessionPath(configDir, name);
  if (lstatIfPresent(file)?.isSymbolicLink()) throw new Error(`session file is a symlink: ${file}`);
  return { dir, file };
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

function cdpTimeout(deadline, label) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(`${label} timed out`);
  return Math.min(remaining, CDP_OPERATION_TIMEOUT_MS);
}

async function cdpJson(url, label, deadline) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(cdpTimeout(deadline, label)) });
    if (!response.ok) throw new Error(`${label} returned ${response.status}`);
    return await response.json();
  } catch (error) {
    if (Date.now() >= deadline || error.name === "TimeoutError") throw new Error(`${label} timed out`);
    throw error;
  }
}

async function cdpVersion(port, deadline) {
  return cdpJson(`http://127.0.0.1:${port}/json/version`, "CDP /json/version", deadline);
}

async function cdpTargets(port, deadline) {
  return cdpJson(`http://127.0.0.1:${port}/json`, "CDP /json", deadline);
}

// One request/response exchange on the browser-level CDP WebSocket.
function cdpCall(wsUrl, method, params, deadline) {
  const timeoutMs = cdpTimeout(deadline, `CDP ${method}`);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const id = 1;
    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* already closed */ }
      reject(new Error(`CDP ${method} timed out`));
    }, timeoutMs);
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
    socket.addEventListener("close", () => {
      clearTimeout(timer);
      reject(new Error(`CDP ${method}: websocket closed`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertBrowserRunning(state, phase) {
  if (state.spawnError) throw new Error(`browser failed to start before ${phase}: ${state.spawnError.message}`);
  if (state.exited || state.closed) {
    const detail = state.signal ? `signal ${state.signal}` : `exit code ${state.code ?? "unknown"}`;
    throw new Error(`browser exited before ${phase} (${detail})`);
  }
  if (state.processError) throw new Error(`browser process error before ${phase}: ${state.processError.message}`);
}

function monitorBrowser(child) {
  let notifyStopped;
  const state = {
    spawned: false,
    spawnError: null,
    processError: null,
    exited: false,
    closed: false,
    code: null,
    signal: null,
    stopped: new Promise((resolve) => { notifyStopped = resolve; }),
  };
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    notifyStopped();
  };
  child.once("spawn", () => { state.spawned = true; });
  child.on("error", (error) => {
    if (!state.spawned) {
      state.spawnError = error;
      stop();
    } else {
      state.processError = error;
    }
  });
  child.once("exit", (code, signal) => {
    state.exited = true;
    state.code = code;
    state.signal = signal;
    stop();
  });
  child.once("close", () => {
    state.closed = true;
    stop();
  });
  return state;
}

async function runCdpOperation(operation, browserState, phase) {
  assertBrowserRunning(browserState, phase);
  try {
    const result = await Promise.race([
      operation,
      browserState.stopped.then(() => {
        assertBrowserRunning(browserState, phase);
        throw new Error(`browser stopped before ${phase}`);
      }),
    ]);
    assertBrowserRunning(browserState, phase);
    return result;
  } catch (error) {
    if (!browserState.spawnError && !browserState.exited && !browserState.closed) {
      await Promise.race([browserState.stopped, sleep(100)]);
    }
    assertBrowserRunning(browserState, phase);
    throw error;
  }
}

function waitForBrowserExit(child, state, timeoutMs) {
  if ((!state.spawned && state.spawnError) || state.exited || state.closed) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      child.off("exit", finish);
      child.off("close", finish);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off("exit", finish);
      child.off("close", finish);
      resolve(state.exited || state.closed);
    }, timeoutMs);
    child.once("exit", finish);
    child.once("close", finish);
  });
}

async function stopBrowser(child, state) {
  if ((!state.spawned && state.spawnError) || state.exited || state.closed) return true;
  try { child.kill("SIGTERM"); } catch { /* Check state below. */ }
  if (await waitForBrowserExit(child, state, STOP_TIMEOUT_MS)) return true;
  try { child.kill("SIGKILL"); } catch { /* Check state below. */ }
  return waitForBrowserExit(child, state, STOP_TIMEOUT_MS);
}

async function waitForCdp(port, deadline, browserState) {
  for (;;) {
    assertBrowserRunning(browserState, "its DevTools endpoint started");
    try {
      return await cdpVersion(port, deadline);
    } catch (error) {
      assertBrowserRunning(browserState, "its DevTools endpoint started");
      if (Date.now() >= deadline) throw new Error(`browser DevTools endpoint never came up: ${error.message}`);
      await sleep(Math.min(300, deadline - Date.now()));
    }
  }
}

// Standard install locations per OS. A bare command name is resolved against
// PATH; an absolute path is checked directly. Symlinks may resolve to a regular
// executable file. Windows roots are read from the environment at call time so
// the resolver stays testable from any host.
export function browserCandidates(platform) {
  if (platform === "darwin") {
    return {
      chrome: ["google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
      edge: ["microsoft-edge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
      brave: ["brave-browser", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
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

function existingExecutable(candidate, pathValue, platform) {
  const paths = candidate.includes("/") || candidate.includes("\\")
    ? [candidate]
    : (pathValue || "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, candidate));
  for (const full of paths) {
    try {
      if (!statSync(full).isFile()) continue;
      if (platform !== "win32") accessSync(full, constants.X_OK);
      return full;
    } catch {
      // Try the next standard location.
    }
  }
  return null;
}

export function graphicalSessionAvailable({ platform = process.platform, env = process.env } = {}) {
  if (platform !== "linux") return true;
  return Boolean(env.DISPLAY?.trim() || env.WAYLAND_DISPLAY?.trim());
}

function guiUnavailableMessage(platform = process.platform) {
  return platform === "linux"
    ? "no graphical session is available (DISPLAY and WAYLAND_DISPLAY are unset); cannot open the user's browser"
    : "no graphical session is available; cannot open the user's browser";
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
      const binary = existingExecutable(candidate, pathValue, platform);
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
  const destination = assertSafeSessionDestination(options.configDir, options.name);
  if (!graphicalSessionAvailable()) die(guiUnavailableMessage());

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

  const browserState = monitorBrowser(child);

  process.stderr.write(
    `A ${browser.name} window is opening at ${loginUrl.origin}. Log in there (MFA and SSO work — you are driving it).\n` +
      `Waiting up to ${Math.round(timeoutMs / 1000)}s for ${options.cookie ? `cookie "${options.cookie}"` : `URL ${options.completeUrl}`}.\n`,
  );

  let successMessage = "";
  try {
    const deadline = Date.now() + timeoutMs;
    const version = await waitForCdp(port, deadline, browserState);
    const wsUrl = version.webSocketDebuggerUrl;
    const userAgent = version["User-Agent"] || "";
    if (!wsUrl) throw new Error("DevTools endpoint did not expose a browser WebSocket URL");

    let done = false;
    while (!done) {
      assertBrowserRunning(browserState, "login completion was detected");
      if (Date.now() >= deadline) throw new Error("timed out waiting for login completion");
      if (options.cookie) {
        const { cookies } = await runCdpOperation(
          cdpCall(wsUrl, "Storage.getCookies", {}, deadline),
          browserState,
          "login completion was detected",
        );
        done = cookies.some((cookie) => cookie.name === options.cookie && cookieMatchesOrigins(cookie.domain, originHosts));
      } else {
        const targets = await runCdpOperation(
          cdpTargets(port, deadline),
          browserState,
          "login completion was detected",
        );
        done = targets.some((target) => target.type === "page" && typeof target.url === "string" && target.url.startsWith(options.completeUrl));
      }
      if (!done) await sleep(Math.min(POLL_MS, deadline - Date.now()));
    }

    const { cookies } = await runCdpOperation(
      cdpCall(wsUrl, "Storage.getCookies", {}, deadline),
      browserState,
      "session cookies were captured",
    );
    const kept = cookies
      .filter((cookie) => cookieMatchesOrigins(cookie.domain, originHosts))
      .map(toStorageStateCookie);
    if (kept.length === 0) throw new Error("no cookies matched the configured origins; nothing captured");

    mkdirSync(destination.dir, { recursive: true, mode: 0o700 });
    assertSafeSessionDestination(options.configDir, options.name);
    const record = {
      schema_version: 1,
      name: options.name,
      origins,
      user_agent: userAgent,
      captured_at: new Date().toISOString(),
      state: { cookies: kept, origins: [] },
    };
    writeFileSync(destination.file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    chmodSync(destination.file, 0o600);
    successMessage =
      `Captured session "${options.name}": ${kept.length} cookie${kept.length === 1 ? "" : "s"} for ${origins.join(", ")}. ` +
      `Restart OpenCode; the wrapper hydrates it on first navigation. Cookie values were never printed.\n`;
  } finally {
    const stopped = await stopBrowser(child, browserState);
    if (!stopped) throw new Error(`browser did not stop; temporary profile retained at ${profileDir}`);
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch (error) {
      throw new Error(`temporary browser profile cleanup failed at ${profileDir}: ${error.message}`);
    }
  }
  process.stdout.write(successMessage);
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
  const dir = assertSafeSessionsDirectory(options.configDir);
  const names = options.name
    ? [options.name]
    : (existsSync(dir) ? readdirSync(dir).filter((entry) => entry.endsWith(".json")).map((entry) => entry.slice(0, -5)).sort() : []);
  if (names.length === 0) {
    process.stdout.write(`No captured sessions under ${dir}\n`);
    return;
  }
  for (const name of names) {
    const file = sessionPath(options.configDir, name);
    if (!lstatIfPresent(file)) {
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
  const { file } = assertSafeSessionDestination(options.configDir, options.name);
  if (!lstatIfPresent(file)) {
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
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.action === "capture") await capture(options);
    else if (options.action === "status") status(options);
    else remove(options);
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }
}
