#!/usr/bin/env node
// Credential-substituting stdio proxy between OpenCode and the Obscura browser
// MCP binary. It resolves ${name:KEY} placeholders from a local secrets file in
// a fixed set of argument slots, verifies the current page origin before
// releasing a secret, denies tools that leak session material, and blocks
// DOM-reading tools until the next navigation after a substitution. The model
// never sees a resolved value.
//
// Invocation: opencode-browser-mcp.mjs <obscura-binary> [obscura-args...]
// The real Obscura binary is spawned as a child; newline-delimited JSON-RPC is
// relayed both ways. The secrets registry is derived from the binary location as
// <dirname(dirname(binary))>/cuddly-winner-secrets.json (the configuration root).
import { spawn } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

const [, , obscuraBinary, ...childArgs] = process.argv;
if (!obscuraBinary) {
  process.stderr.write("Usage: opencode-browser-mcp.mjs <obscura-binary> [args...]\n");
  process.exit(1);
}

const CONFIG_ROOT = path.dirname(path.dirname(path.resolve(obscuraBinary)));
const REGISTRY_PATH = path.join(CONFIG_ROOT, "cuddly-winner-secrets.json");
// Captured login sessions written by opencode-browser-session.mjs. Each maps a
// set of https origins to an Obscura-shaped storage state (cookies only) and the
// browser User-Agent it was captured under. The wrapper hydrates a session into
// Obscura the first time the agent navigates to one of its origins, so a human's
// interactive login (MFA/SSO/CAPTCHA) can be reused headlessly. Import only:
// browser_storage_state and browser_get_cookies stay denied, so a session flows
// in but never back out to the model.
const SESSIONS_DIR = path.join(CONFIG_ROOT, "cuddly-winner-sessions");

// Tools removed from tools/list and rejected on call: each can hand the model
// live session material (cookies, storage, or request bodies).
const DENIED_TOOLS = new Set(["browser_get_cookies", "browser_storage_state", "browser_network_requests"]);
// Tools blocked while "dirty" (right after a substitution): each can read a
// filled secret back out of the DOM before the page moves on.
const DIRTY_TOOLS = new Set(["browser_evaluate", "browser_get_attribute", "browser_extract"]);
// Forwarding any of these clears the dirty flag: the page is moving on.
const NAVIGATION_TOOLS = new Set(["browser_navigate", "browser_back", "browser_forward", "browser_reload"]);

const PLACEHOLDER_EXACT = /^\$\{([A-Za-z0-9_.-]+):([^}]+)\}$/;
const PLACEHOLDER_ANY = /\$\{[A-Za-z0-9_.-]+:[^}]+\}/;
const ALLOWED_SLOTS = "browser_fill.value, browser_type.text, browser_fill_form.fields[].value, browser_set_cookie.value";

// A placeholder in any argument slot other than these is rejected outright, so a
// prompt-injected page cannot smuggle a secret into a URL, selector, or script.
function isAllowedSlot(tool, keys) {
  if (tool === "browser_fill") return keys.length === 1 && keys[0] === "value";
  if (tool === "browser_type") return keys.length === 1 && keys[0] === "text";
  if (tool === "browser_set_cookie") return keys.length === 1 && keys[0] === "value";
  if (tool === "browser_fill_form") {
    return keys.length === 3 && keys[0] === "fields" && typeof keys[1] === "number" && keys[2] === "value";
  }
  return false;
}

function walkStrings(node, keys, visit) {
  if (typeof node === "string") return visit(node, keys);
  if (Array.isArray(node)) return node.forEach((value, index) => walkStrings(value, [...keys, index], visit));
  if (node && typeof node === "object") for (const key of Object.keys(node)) walkStrings(node[key], [...keys, key], visit);
}

// Classify every string argument. Exact placeholders in an allowed slot become
// substitution targets; any placeholder pattern in a disallowed slot is a
// violation that rejects the whole call. A non-exact string in an allowed slot
// is left literal (never partially resolved).
function analyze(tool, args) {
  const targets = [];
  let violation = null;
  walkStrings(args, [], (value, keys) => {
    if (isAllowedSlot(tool, keys)) {
      const match = PLACEHOLDER_EXACT.exec(value);
      if (match) targets.push({ shortName: match[1], key: match[2], keys });
    } else if (violation === null && PLACEHOLDER_ANY.test(value)) {
      violation = keys.length ? keys.join(".") : "(root)";
    }
  });
  return { targets, violation };
}

function setByKeys(root, keys, value) {
  let node = root;
  for (let index = 0; index < keys.length - 1; index += 1) node = node[keys[index]];
  node[keys[keys.length - 1]] = value;
}

function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) throw new Error(`secrets registry not found: ${REGISTRY_PATH}`);
  const value = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  if (!value || typeof value !== "object" || value.schema_version !== 1 || !value.entries || typeof value.entries !== "object") {
    throw new Error("secrets registry is not a supported schema-version-1 file");
  }
  return value.entries;
}

function readSecret(filePath, key) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals === -1) continue;
    if (line.slice(0, equals).trim() === key) return line.slice(equals + 1);
  }
  return undefined;
}

// Obscura returns the evaluated value as text content; accept the raw string, a
// trimmed form, or a JSON-encoded string, so origin comparison is exact.
function originMatches(text, origins) {
  if (typeof text !== "string") return false;
  const candidates = new Set([text, text.trim()]);
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") candidates.add(parsed);
  } catch {
    // not JSON; the raw forms above still apply
  }
  return origins.some((origin) => candidates.has(origin));
}

function firstText(message) {
  const content = message?.result?.content;
  if (Array.isArray(content)) {
    for (const item of content) if (item && item.type === "text" && typeof item.text === "string") return item.text;
  }
  return null;
}

// --- Captured login sessions (import-only hydration) -----------------------

// Load every captured session from SESSIONS_DIR. Each file is trusted,
// helper-written, mode-0600 control-plane state; a malformed or symlinked file
// is skipped with a warning rather than aborting the proxy.
function loadSessions() {
  if (!existsSync(SESSIONS_DIR)) return [];
  let names;
  try {
    names = readdirSync(SESSIONS_DIR);
  } catch {
    return [];
  }
  const loaded = [];
  for (const fileName of names) {
    if (!fileName.endsWith(".json")) continue;
    const full = path.join(SESSIONS_DIR, fileName);
    try {
      if (lstatSync(full).isSymbolicLink()) throw new Error("symlink");
      const value = JSON.parse(readFileSync(full, "utf8"));
      if (!value || typeof value !== "object" || value.schema_version !== 1) throw new Error("unsupported schema");
      if (!Array.isArray(value.origins) || !value.origins.length) throw new Error("missing origins");
      const state = value.state;
      if (!state || typeof state !== "object" || !Array.isArray(state.cookies)) throw new Error("missing storage state");
      loaded.push({
        name: typeof value.name === "string" && value.name ? value.name : path.basename(fileName, ".json"),
        origins: value.origins.filter((origin) => typeof origin === "string"),
        userAgent: typeof value.user_agent === "string" ? value.user_agent : "",
        state,
      });
    } catch (error) {
      process.stderr.write(`cuddly-winner session skipped (${error.message}): ${full}\n`);
    }
  }
  return loaded;
}

const sessions = loadSessions();
// origin -> owning session, so a navigation to any registered origin hydrates
// that session's cookies once per process.
const sessionByOrigin = new Map();
for (const session of sessions) {
  for (const origin of session.origins) if (!sessionByOrigin.has(origin)) sessionByOrigin.set(origin, session);
}
const hydratedSessions = new Set();

// One Obscura process serves every site, so it carries a single User-Agent.
// Captures normally come from the same browser and agree; if they diverge, warn
// and inject none rather than force a wrong fingerprint on a site that depends
// on it (e.g. a cf_clearance cookie bound to the capture User-Agent).
const distinctUserAgents = [...new Set(sessions.map((session) => session.userAgent).filter(Boolean))];
const spawnArgs = [...childArgs];
if (distinctUserAgents.length === 1 && !spawnArgs.includes("--user-agent")) {
  spawnArgs.push("--user-agent", distinctUserAgents[0]);
} else if (distinctUserAgents.length > 1) {
  process.stderr.write(`cuddly-winner: captured sessions disagree on User-Agent; none injected. Sessions: ${sessions.map((session) => session.name).join(", ")}\n`);
}

let clientClosed = false;
let lastExternalTool = null;
let child = null;
let initializeMessage = null;
let initializedMessage = null;
let recoveryAttempted = false;
let recovery = Promise.resolve();

function sendToChild(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function forwardExternalTool(message) {
  lastExternalTool = message.params?.name ?? "unknown browser tool";
  if (message.id !== undefined && message.id !== null) pendingExternal.set(message.id, lastExternalTool);
  sendToChild(message);
}
function sendToClient(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
function rejectCall(id, text) {
  if (id === undefined || id === null) return;
  sendToClient({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: true } });
}

const pendingToolsList = new Set(); // model request ids whose responses need denied-tool filtering
const pendingInternal = new Map(); // wrapper-issued request ids whose responses are swallowed
const pendingExternal = new Map(); // forwarded tool ids awaiting an Obscura response
let internalCounter = 0;
let dirty = false;

// Issue a wrapper-owned tool call whose request id is namespaced and whose
// response is filtered out of the client stream, so the model never sees the
// wrapper's own probes or its session hydration. Resolves with the raw response
// message, or null on timeout.
function internalCall(name, args) {
  return new Promise((resolve) => {
    const id = `__cwmcp_${(internalCounter += 1)}`;
    const timer = setTimeout(() => {
      if (pendingInternal.delete(id)) resolve(null);
    }, 15000);
    pendingInternal.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    sendToChild({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  });
}

function handleChildLine(line) {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(`${line}\n`);
    return;
  }
  const id = message?.id;
  if (id !== undefined && pendingInternal.has(id)) {
    const resolve = pendingInternal.get(id);
    pendingInternal.delete(id);
    resolve(message); // swallow: the model never sees the wrapper's own probe
    return;
  }
  if (id !== undefined) pendingExternal.delete(id);
  if (id !== undefined && pendingToolsList.has(id)) {
    pendingToolsList.delete(id);
    if (message.result && Array.isArray(message.result.tools)) {
      message.result.tools = message.result.tools.filter((tool) => !DENIED_TOOLS.has(tool?.name));
    }
  }
  sendToClient(message);
}

function startChild() {
  const instance = spawn(obscuraBinary, spawnArgs, { stdio: ["pipe", "pipe", "inherit"] });
  child = instance;
  createInterface({ input: instance.stdout }).on("line", handleChildLine);
  instance.on("error", (error) => {
    process.stderr.write(`obscura spawn failed: ${error.message}\n`);
  });
  instance.on("exit", (code, signal) => {
    if (instance !== child) return;
    if (clientClosed) {
      process.exit(code ?? (signal ? 1 : 0));
      return;
    }
    const status = code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
    process.stderr.write(`cuddly-winner-browser: Obscura MCP exited unexpectedly (${status}) while ${lastExternalTool ?? "idle"}.\n`);
    for (const [id, tool] of pendingExternal) {
      sendToClient({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: `Obscura exited while ${tool}; the tool outcome is unknown and was not replayed.` },
      });
    }
    pendingExternal.clear();
    pendingToolsList.clear();
    for (const resolve of pendingInternal.values()) resolve(null);
    pendingInternal.clear();
    if (recoveryAttempted || !initializeMessage) {
      process.stderr.write("cuddly-winner-browser: automatic recovery unavailable; restart OpenCode before retrying.\n");
      process.exit(code ?? (signal ? 1 : 0));
      return;
    }
    recoveryAttempted = true;
    recovery = restartChild().catch((error) => {
      process.stderr.write(`cuddly-winner-browser: recovery failed: ${error.message}; restart OpenCode before retrying.\n`);
      process.exit(1);
    });
  });
  return instance;
}

async function restartChild() {
  hydratedSessions.clear();
  startChild();
  const id = `__cwmcp_${(internalCounter += 1)}`;
  const response = new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingInternal.delete(id)) resolve(null);
    }, 15000);
    pendingInternal.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
  sendToChild({ ...initializeMessage, id });
  const initialized = await response;
  if (!initialized || initialized.error) throw new Error("replacement Obscura did not initialize");
  if (initializedMessage) sendToChild(initializedMessage);
  process.stderr.write("cuddly-winner-browser: Obscura restarted once; interrupted tools were not replayed.\n");
}

// Ask the child for the current page origin, using an internal call whose
// response is filtered out of the client stream.
async function currentOrigin() {
  return firstText(await internalCall("browser_evaluate", { expression: "location.origin" }));
}

// Parse the origin of a navigate target without throwing on a malformed URL.
function urlOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// Hydrate a captured session's cookies into Obscura the first time the agent
// navigates to one of its origins. The import goes through an internal
// browser_set_storage_state whose response is swallowed, so the model never
// sees the cookies and never learns a session was injected. Import only: the
// export tools stay denied, so a session flows in but never back out.
async function hydrateForUrl(url) {
  const origin = urlOrigin(url);
  if (!origin) return;
  const session = sessionByOrigin.get(origin);
  if (!session || hydratedSessions.has(session.name)) return;
  hydratedSessions.add(session.name); // mark first, so a failed probe is not retried in a tight loop
  await internalCall("browser_set_storage_state", { state: session.state });
}

async function handleClientLine(line) {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    child.stdin.write(`${line}\n`);
    return;
  }

  await recovery;

  if (message?.method === "initialize") initializeMessage = structuredClone(message);
  if (message?.method === "notifications/initialized") initializedMessage = structuredClone(message);

  if (message?.method === "tools/list") {
    if (message.id !== undefined) {
      pendingToolsList.add(message.id);
      pendingExternal.set(message.id, "tools/list");
    }
    sendToChild(message);
    return;
  }

  if (message?.method !== "tools/call") {
    sendToChild(message);
    return;
  }

  const params = message.params || {};
  const name = params.name;
  const id = message.id;

  if (DENIED_TOOLS.has(name)) {
    rejectCall(id, `Tool ${name} is disabled by the credential wrapper: it can hand live session material to the model.`);
    return;
  }
  if (dirty && DIRTY_TOOLS.has(name)) {
    rejectCall(id, `Tool ${name} is blocked until the next navigation: a credential was just filled and may still be readable in the DOM.`);
    return;
  }

  const args = params.arguments || {};
  const { targets, violation } = analyze(name, args);
  if (violation !== null) {
    rejectCall(id, `Credential placeholder rejected at ${name} argument "${violation}". Placeholders are only allowed in ${ALLOWED_SLOTS}.`);
    return;
  }

  // Obscura 0.2.2 fills .value even on contenteditable elements and hidden
  // fallback controls. Check every text target before any batch mutation or
  // credential resolution. Only return a classification, never field contents.
  const textFields = name === "browser_fill" || name === "browser_type"
    ? [args]
    : name === "browser_fill_form" && Array.isArray(args.fields)
      ? args.fields.filter((field) => !field.type || field.type === "text")
      : [];
  if (textFields.length) {
    const selectors = textFields.map((field) => typeof field.ref === "string"
      ? `[data-obscura-ref=${JSON.stringify(field.ref)}]`
      : field.selector);
    if (selectors.some((selector) => typeof selector !== "string")) {
      rejectCall(id, "Text input requires a ref or selector for every field.");
      return;
    }
    const expression = `(() => {
      try {
        for (const selector of ${JSON.stringify(selectors)}) {
          const el = document.querySelector(selector);
          if (!el) return 'cw-input:missing';
          if (el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') return 'cw-input:contenteditable';
          if (!['INPUT', 'TEXTAREA'].includes(el.tagName)) return 'cw-input:unsupported';
          if (el.disabled || el.readOnly) return 'cw-input:disabled';
          if (el.type === 'hidden') return 'cw-input:hidden';
          for (let node = el; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (node.hidden || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return 'cw-input:hidden';
          }
        }
        return 'cw-input:ok';
      } catch { return 'cw-input:probe-failed'; }
    })()`;
    const result = firstText(await internalCall("browser_evaluate", { expression }));
    if (result !== "cw-input:ok") {
      const reason = new Set(["cw-input:missing", "cw-input:contenteditable", "cw-input:unsupported", "cw-input:disabled", "cw-input:hidden"]).has(result)
        ? result.slice("cw-input:".length) : "probe-failed";
      rejectCall(id, `Text input rejected (${reason}). Obscura supports visible, enabled input/textarea controls; contenteditable input is unsupported. No fields were filled and no submit was attempted.`);
      return;
    }
  }

  if (targets.length === 0) {
    if (NAVIGATION_TOOLS.has(name)) dirty = false;
    // Hydrate a captured session before the page loads, so its cookies are
    // present for the very first request of the navigation. The probe confirmed
    // cookies set through browser_set_storage_state survive a navigation.
    if (name === "browser_navigate" && typeof args.url === "string") await hydrateForUrl(args.url);
    forwardExternalTool(message);
    return;
  }

  let entries;
  try {
    entries = loadRegistry();
  } catch (error) {
    rejectCall(id, `Credential substitution failed: ${error.message}`);
    return;
  }

  const origin = await currentOrigin();
  for (const target of targets) {
    const entry = entries[target.shortName];
    if (!entry || typeof entry.path !== "string" || !Array.isArray(entry.origins)) {
      rejectCall(id, `Unknown secrets entry "${target.shortName}".`);
      return;
    }
    if (!originMatches(origin, entry.origins)) {
      rejectCall(id, `Refused to release a secret for "${target.shortName}": the current page origin is not in its allowed origins.`);
      return;
    }
    let secret;
    try {
      secret = readSecret(entry.path, target.key);
    } catch (error) {
      rejectCall(id, `Could not read the secrets file for "${target.shortName}": ${error.message}`);
      return;
    }
    if (secret === undefined) {
      rejectCall(id, `The secrets file for "${target.shortName}" has no key "${target.key}".`);
      return;
    }
    setByKeys(args, target.keys, secret);
  }
  params.arguments = args;
  dirty = true; // a resolved secret is now potentially readable in the DOM
  forwardExternalTool(message);
}

let queue = Promise.resolve();
startChild();
const clientReader = createInterface({ input: process.stdin });
clientReader.on("line", (line) => {
  queue = queue.then(() => handleClientLine(line)).catch((error) => {
    process.stderr.write(`wrapper error: ${error.stack || error}\n`);
  });
});
clientReader.on("close", () => {
  clientClosed = true;
  queue = queue.then(() => {
    try {
      child.stdin.end();
    } catch {
      // child already gone
    }
  });
});
