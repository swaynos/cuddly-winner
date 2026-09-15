#!/usr/bin/env node
// opencode-playwright-mcp.mjs
//
// Headless Playwright MCP stdio server. This is the project's single browser
// backend. It exposes the browser_* tool surface over newline-delimited
// JSON-RPC on stdin/stdout and drives one headless Chromium via Playwright.
//
// Design (see docs/RESOURCE-SELECTION.md "Browser policy"):
//   - Headless only. A required human login is handled out of band by
//     opencode-browser-login.mjs, which writes approved state that this server
//     loads privately. There is no headed mode and no secret-typing path here.
//   - Saved login state is loaded only for a matching approved origin, straight
//     into the browser context. State values (cookies, storage) never appear in
//     tool output, logs, or anything returned toward model context. The server
//     therefore does not expose cookie/storage export tools at all.
//   - Every wait and browser process has a bounded timeout and a cleanup path.
//
// Environment:
//   CUDDLY_WINNER_CONFIG_DIR         config root holding cuddly-winner-sessions/
//   CUDDLY_WINNER_BROWSER_STATES     optional comma list of state record names
//                                    to consider for hydration (default: all)
//   CUDDLY_WINNER_BROWSER_EXECUTABLE optional Chromium executable override
//   CUDDLY_WINNER_BROWSER_TIMEOUT_MS default per-action timeout (default 30000)

import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadStateForOrigin, listStates } from "./opencode-browser-state.mjs";

const CONFIG_DIR = process.env.CUDDLY_WINNER_CONFIG_DIR || "";
const EXECUTABLE = process.env.CUDDLY_WINNER_BROWSER_EXECUTABLE || undefined;
const DEFAULT_TIMEOUT = Number(process.env.CUDDLY_WINNER_BROWSER_TIMEOUT_MS || 30000);
const MAX_DOWNLOAD_BYTES = Number(process.env.CUDDLY_WINNER_BROWSER_MAX_DOWNLOAD_BYTES || 50 * 1024 * 1024);
const STATE_NAMES = (process.env.CUDDLY_WINNER_BROWSER_STATES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const SERVER_INFO = { name: "cuddly-winner-browser", version: "1.0.0" };
const PROTOCOL_VERSION = "2024-11-05";

// --- Tool surface ----------------------------------------------------------
// Each tool has a Playwright-backed handler. Cookie/storage export tools are
// deliberately absent: login state enters only through the private hydration
// path, never through a model-visible tool.

const TOOLS = [
  { name: "browser_navigate", description: "Navigate to a URL and wait for load.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "browser_navigate_back", description: "Go back in history.", inputSchema: { type: "object", properties: {} } },
  { name: "browser_forward", description: "Go forward in history.", inputSchema: { type: "object", properties: {} } },
  { name: "browser_reload", description: "Reload the current page.", inputSchema: { type: "object", properties: {} } },
  { name: "browser_snapshot", description: "Readable text of the current page (title, URL, body text).", inputSchema: { type: "object", properties: { max_chars: { type: "number" } } } },
  { name: "browser_markdown", description: "Current page rendered as terse Markdown-ish text.", inputSchema: { type: "object", properties: { max_chars: { type: "number" } } } },
  { name: "browser_interactive_elements", description: "List clickable/typeable elements with stable refs.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "browser_links", description: "List anchor links as {text, href}.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "browser_click", description: "Click an element by ref or selector.", inputSchema: { type: "object", properties: { ref: { type: "string" }, selector: { type: "string" } } } },
  { name: "browser_fill", description: "Set the value of an input by ref or selector.", inputSchema: { type: "object", properties: { ref: { type: "string" }, selector: { type: "string" }, value: { type: "string" } }, required: ["value"] } },
  { name: "browser_type", description: "Type text into an input (appends).", inputSchema: { type: "object", properties: { ref: { type: "string" }, selector: { type: "string" }, text: { type: "string" } }, required: ["text"] } },
  { name: "browser_fill_form", description: "Fill multiple fields, optionally submit.", inputSchema: { type: "object", properties: { fields: { type: "array" }, submit_ref: { type: "string" }, submit_selector: { type: "string" } }, required: ["fields"] } },
  { name: "browser_select_option", description: "Select an option in a <select>.", inputSchema: { type: "object", properties: { selector: { type: "string" }, value: { type: "string" } }, required: ["selector", "value"] } },
  { name: "browser_press_key", description: "Dispatch a keyboard key.", inputSchema: { type: "object", properties: { key: { type: "string" }, selector: { type: "string" } }, required: ["key"] } },
  { name: "browser_get_attribute", description: "Read an attribute of an element.", inputSchema: { type: "object", properties: { ref: { type: "string" }, selector: { type: "string" }, attribute: { type: "string" } }, required: ["attribute"] } },
  { name: "browser_count", description: "Count elements matching a selector.", inputSchema: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } },
  { name: "browser_search", description: "Find substring matches in visible page text.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
  { name: "browser_extract", description: "Extract a structured object from the page given {field: selector}.", inputSchema: { type: "object", properties: { schema: { type: "object" } }, required: ["schema"] } },
  { name: "browser_evaluate", description: "Evaluate a JavaScript expression in the page.", inputSchema: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] } },
  { name: "browser_console_messages", description: "Return console messages logged by the page.", inputSchema: { type: "object", properties: {} } },
  { name: "browser_scroll", description: "Scroll the page or an element.", inputSchema: { type: "object", properties: { direction: { type: "string" }, amount: { type: "number" }, selector: { type: "string" } } } },
  { name: "browser_wait_for", description: "Wait for a selector to appear.", inputSchema: { type: "object", properties: { selector: { type: "string" }, timeout: { type: "number" } }, required: ["selector"] } },
  { name: "browser_wait_for_text", description: "Wait for text to appear in the page.", inputSchema: { type: "object", properties: { text: { type: "string" }, timeout: { type: "number" } }, required: ["text"] } },
  { name: "browser_screenshot", description: "Capture the viewport as a PNG saved to path.", inputSchema: { type: "object", properties: { path: { type: "string" }, full_page: { type: "boolean" } }, required: ["path"] } },
  { name: "browser_download", description: "Retrieve a file through the current authenticated headless page and save it only after validation.", inputSchema: { type: "object", properties: { url: { type: "string" }, path: { type: "string" }, min_bytes: { type: "number" }, expected_sha256: { type: "string" }, expected_content_type: { type: "string" }, signature_hex: { type: "string" } }, required: ["url", "path"] } },
  { name: "browser_tab_new", description: "Open a new tab, optionally navigating to a URL.", inputSchema: { type: "object", properties: { url: { type: "string" } } } },
  { name: "browser_tab_list", description: "List open tabs.", inputSchema: { type: "object", properties: {} } },
  { name: "browser_tab_switch", description: "Switch the active tab by index.", inputSchema: { type: "object", properties: { index: { type: "number" } }, required: ["index"] } },
  { name: "browser_tab_close", description: "Close a tab by index (default active).", inputSchema: { type: "object", properties: { index: { type: "number" } } } },
  { name: "browser_close", description: "Close the browser and reset state.", inputSchema: { type: "object", properties: {} } },
];
const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

// --- Browser lifecycle -----------------------------------------------------

let chromium = null;
let browser = null;
let context = null;
let pages = []; // ordered list of Page
let activeIndex = 0;
const consoleMessages = [];
const hydratedOrigins = new Set();
let hasHydratedAuthentication = false;

async function ensureChromium() {
  if (!chromium) ({ chromium } = await import("playwright"));
  return chromium;
}

async function ensureContext() {
  if (context) return context;
  await ensureChromium();
  browser = await chromium.launch({ headless: true, executablePath: EXECUTABLE });
  context = await browser.newContext();
  context.setDefaultTimeout(DEFAULT_TIMEOUT);
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (consoleMessages.length < 500) consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });
  context.on("page", (p) => {
    if (!pages.includes(p)) pages.push(p);
  });
  pages = [page];
  activeIndex = 0;
  return context;
}

function activePage() {
  const page = pages[activeIndex];
  if (!page) throw new Error("no active page; call browser_navigate first");
  return page;
}

async function closeBrowser() {
  const toClose = browser;
  browser = null;
  context = null;
  pages = [];
  activeIndex = 0;
  hydratedOrigins.clear();
  hasHydratedAuthentication = false;
  consoleMessages.length = 0;
  if (toClose) {
    try {
      await toClose.close();
    } catch {
      /* already gone */
    }
  }
}

// Candidate state record names to consider for hydration.
function candidateStateNames() {
  if (!CONFIG_DIR) return [];
  if (STATE_NAMES.length) return STATE_NAMES;
  try {
    return listStates(CONFIG_DIR).map((m) => m.name);
  } catch {
    return [];
  }
}

// Hydrate approved login state for a target origin, once per origin per process.
// Cookies go straight onto the live context; origin localStorage and any
// explicitly-captured session storage are restored via an init script so they
// are present before the navigation's first script runs. Nothing here is ever
// returned toward the model.
async function maybeHydrate(url) {
  if (!CONFIG_DIR) return;
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return;
  }
  if (hydratedOrigins.has(origin)) return;
  hydratedOrigins.add(origin); // mark first so a failed load is not retried in a loop
  for (const name of candidateStateNames()) {
    let loaded;
    try {
      loaded = loadStateForOrigin({ configDir: CONFIG_DIR, name, origin });
    } catch {
      continue;
    }
    if (!loaded) continue;
    const cookies = Array.isArray(loaded.storageState?.cookies) ? loaded.storageState.cookies : [];
    if (cookies.length) {
      try {
        await context.addCookies(cookies);
      } catch {
        /* malformed cookie set: skip rather than abort navigation */
      }
    }
    const originStores = Array.isArray(loaded.storageState?.origins) ? loaded.storageState.origins : [];
    const sessionStores = loaded.sessionStorage && typeof loaded.sessionStorage === "object" ? loaded.sessionStorage : {};
    hasHydratedAuthentication = Boolean(cookies.length || originStores.length || Object.keys(sessionStores).length);
    if (originStores.length || Object.keys(sessionStores).length) {
      await context.addInitScript(
        ({ localStores, sessionStores: sess }) => {
          try {
            const here = location.origin;
            const marker = `__cuddly_winner_hydrated__:${here}`;
            if (window.name.includes(marker)) return;
            for (const entry of localStores) {
              if (entry.origin !== here) continue;
              for (const item of entry.localStorage || []) window.localStorage.setItem(item.name, item.value);
            }
            const s = sess[here];
            if (s) for (const [k, v] of Object.entries(s)) window.sessionStorage.setItem(k, v);
            window.name = `${window.name}${marker}`;
          } catch {
            /* storage may be unavailable on some origins */
          }
        },
        { localStores: originStores, sessionStores },
      );
    }
    return; // one matching record per origin
  }
}

// --- Element resolution ----------------------------------------------------

const REF_TAG = "data-cw-ref";
const INTERACTIVE_SELECTOR =
  "a[href], button, input, textarea, select, [role=button], [role=link], [role=textbox], [onclick], [tabindex]";

// Assign stable refs (e1, e2, ...) to interactive elements and return a compact
// list. Refs live in a page attribute so a later click/fill can target them.
async function tagInteractive(page, limit) {
  return page.evaluate(
    ({ sel, attr, cap }) => {
      const nodes = Array.from(document.querySelectorAll(sel)).slice(0, cap);
      const out = [];
      let n = 0;
      for (const el of nodes) {
        n += 1;
        const ref = `e${n}`;
        el.setAttribute(attr, ref);
        const label = (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 80);
        out.push({ ref, tag: el.tagName.toLowerCase(), type: el.getAttribute("type") || undefined, text: label });
      }
      return out;
    },
    { sel: INTERACTIVE_SELECTOR, attr: REF_TAG, cap: Number.isFinite(limit) ? limit : 200 },
  );
}

function locatorFor(page, args) {
  if (args.ref) return page.locator(`[${REF_TAG}="${String(args.ref).replace(/"/g, '\\"')}"]`);
  if (args.selector) return page.locator(args.selector);
  throw new Error("a ref or selector is required");
}

// --- Tool handlers ---------------------------------------------------------

function text(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] };
}

const HANDLERS = {
  async browser_navigate(args) {
    if (typeof args.url !== "string") throw new Error("url is required");
    await ensureContext();
    await maybeHydrate(args.url);
    const page = activePage();
    const resp = await page.goto(args.url, { waitUntil: "load" });
    return text(`navigated to ${page.url()} (status ${resp ? resp.status() : "n/a"})`);
  },
  async browser_navigate_back() {
    await activePage().goBack();
    return text(`back to ${activePage().url()}`);
  },
  async browser_forward() {
    await activePage().goForward();
    return text(`forward to ${activePage().url()}`);
  },
  async browser_reload() {
    await activePage().reload();
    return text(`reloaded ${activePage().url()}`);
  },
  async browser_snapshot(args) {
    const page = activePage();
    const cap = Number.isFinite(args.max_chars) ? args.max_chars : 4000;
    const body = await page.evaluate(() => document.body ? document.body.innerText : "");
    return text(`# ${await page.title()}\nURL: ${page.url()}\n\n${body.slice(0, cap)}`);
  },
  async browser_markdown(args) {
    const page = activePage();
    const cap = Number.isFinite(args.max_chars) ? args.max_chars : 4000;
    const md = await page.evaluate(() => {
      const parts = [];
      for (const el of document.querySelectorAll("h1,h2,h3,p,li,a")) {
        const t = (el.innerText || "").trim();
        if (!t) continue;
        const tag = el.tagName.toLowerCase();
        if (tag === "h1") parts.push(`# ${t}`);
        else if (tag === "h2") parts.push(`## ${t}`);
        else if (tag === "h3") parts.push(`### ${t}`);
        else if (tag === "li") parts.push(`- ${t}`);
        else if (tag === "a") parts.push(`[${t}](${el.getAttribute("href") || ""})`);
        else parts.push(t);
      }
      return parts.join("\n");
    });
    return text(md.slice(0, cap));
  },
  async browser_interactive_elements(args) {
    const list = await tagInteractive(activePage(), args.limit);
    return text(list.map((e) => `${e.ref} <${e.tag}${e.type ? ` type=${e.type}` : ""}> ${e.text}`).join("\n") || "(none)");
  },
  async browser_links(args) {
    const page = activePage();
    const limit = Number.isFinite(args.limit) ? args.limit : 100;
    const links = await page.evaluate((cap) => Array.from(document.querySelectorAll("a[href]")).slice(0, cap).map((a) => ({ text: (a.innerText || "").trim().slice(0, 120), href: a.href })), limit);
    return text(links.map((l) => `${l.text} -> ${l.href}`).join("\n") || "(no links)");
  },
  async browser_click(args) {
    await locatorFor(activePage(), args).first().click({ timeout: DEFAULT_TIMEOUT });
    return text("clicked");
  },
  async browser_fill(args) {
    if (typeof args.value !== "string") throw new Error("value is required");
    await locatorFor(activePage(), args).first().fill(args.value, { timeout: DEFAULT_TIMEOUT });
    return text("filled");
  },
  async browser_type(args) {
    if (typeof args.text !== "string") throw new Error("text is required");
    await locatorFor(activePage(), args).first().pressSequentially(args.text, { timeout: DEFAULT_TIMEOUT });
    return text("typed");
  },
  async browser_fill_form(args) {
    if (!Array.isArray(args.fields)) throw new Error("fields array is required");
    const page = activePage();
    for (const field of args.fields) {
      const loc = locatorFor(page, field).first();
      const type = field.type || "text";
      if (type === "check") await loc.check({ timeout: DEFAULT_TIMEOUT });
      else if (type === "uncheck") await loc.uncheck({ timeout: DEFAULT_TIMEOUT });
      else if (type === "select") await loc.selectOption(field.value, { timeout: DEFAULT_TIMEOUT });
      else await loc.fill(String(field.value ?? ""), { timeout: DEFAULT_TIMEOUT });
    }
    if (args.submit_ref || args.submit_selector) {
      await locatorFor(page, { ref: args.submit_ref, selector: args.submit_selector }).first().click({ timeout: DEFAULT_TIMEOUT });
    }
    return text(`filled ${args.fields.length} field(s)${args.submit_ref || args.submit_selector ? " and submitted" : ""}`);
  },
  async browser_select_option(args) {
    await activePage().locator(args.selector).first().selectOption(args.value, { timeout: DEFAULT_TIMEOUT });
    return text("selected");
  },
  async browser_press_key(args) {
    const page = activePage();
    if (args.selector) await page.locator(args.selector).first().press(args.key, { timeout: DEFAULT_TIMEOUT });
    else await page.keyboard.press(args.key);
    return text(`pressed ${args.key}`);
  },
  async browser_get_attribute(args) {
    const value = await locatorFor(activePage(), args).first().getAttribute(args.attribute, { timeout: DEFAULT_TIMEOUT });
    return text(value ?? "");
  },
  async browser_count(args) {
    return text(String(await activePage().locator(args.selector).count()));
  },
  async browser_search(args) {
    const page = activePage();
    const limit = Number.isFinite(args.limit) ? args.limit : 10;
    const matches = await page.evaluate(
      ({ query, cap }) => {
        const body = document.body ? document.body.innerText : "";
        const out = [];
        let from = 0;
        while (out.length < cap) {
          const idx = body.indexOf(query, from);
          if (idx === -1) break;
          out.push(body.slice(Math.max(0, idx - 40), idx + query.length + 40));
          from = idx + query.length;
        }
        return out;
      },
      { query: args.query, cap: limit },
    );
    return text(matches.length ? matches.map((m, i) => `${i + 1}. ...${m}...`).join("\n") : "(no matches)");
  },
  async browser_extract(args) {
    if (!args.schema || typeof args.schema !== "object") throw new Error("schema object is required");
    const page = activePage();
    const result = await page.evaluate((schema) => {
      const out = {};
      for (const [field, spec] of Object.entries(schema)) {
        const list = field.endsWith("[]");
        const key = list ? field.slice(0, -2) : field;
        const [sel, attr] = String(spec).split("@");
        const read = (el) => (attr ? el.getAttribute(attr) : el.innerText || "").trim();
        if (list) out[key] = Array.from(document.querySelectorAll(sel)).map(read);
        else {
          const el = document.querySelector(sel);
          out[key] = el ? read(el) : null;
        }
      }
      return out;
    }, args.schema);
    return text(result);
  },
  async browser_evaluate(args) {
    if (typeof args.expression !== "string") throw new Error("expression is required");
    if (hasHydratedAuthentication) throw new Error("browser_evaluate is unavailable while saved authentication state is loaded");
    let value;
    try {
      value = await activePage().evaluate(args.expression);
    } catch (err) {
      value = `evaluate error: ${err instanceof Error ? err.message : String(err)}`;
    }
    return text(value === undefined ? "undefined" : value);
  },
  async browser_console_messages() {
    return text(consoleMessages.join("\n") || "(no console messages)");
  },
  async browser_scroll(args) {
    const page = activePage();
    const dir = args.direction || "down";
    const amount = Number.isFinite(args.amount) ? args.amount : undefined;
    await page.evaluate(
      ({ dir, amount, selector }) => {
        const target = selector ? document.querySelector(selector) : window;
        const by = amount || (target === window ? window.innerHeight : 400);
        if (dir === "top") (target === window ? window.scrollTo(0, 0) : (target.scrollTop = 0));
        else if (dir === "bottom") (target === window ? window.scrollTo(0, document.body.scrollHeight) : (target.scrollTop = target.scrollHeight));
        else if (target === window) window.scrollBy(dir === "up" ? -by : by, dir === "left" || dir === "right" ? 0 : 0) || window.scrollBy(0, dir === "up" ? -by : by);
        else target.scrollTop += dir === "up" ? -by : by;
      },
      { dir, amount, selector: args.selector },
    );
    return text(`scrolled ${dir}`);
  },
  async browser_wait_for(args) {
    const timeout = Number.isFinite(args.timeout) ? args.timeout * 1000 : DEFAULT_TIMEOUT;
    await activePage().locator(args.selector).first().waitFor({ state: "attached", timeout });
    return text(`found ${args.selector}`);
  },
  async browser_wait_for_text(args) {
    const timeout = Number.isFinite(args.timeout) ? args.timeout * 1000 : DEFAULT_TIMEOUT;
    await activePage().getByText(args.text, { exact: false }).first().waitFor({ state: "visible", timeout });
    return text(`text appeared: ${args.text}`);
  },
  async browser_screenshot(args) {
    if (typeof args.path !== "string") throw new Error("path is required");
    await activePage().screenshot({ path: args.path, fullPage: Boolean(args.full_page) });
    return text(`screenshot saved to ${path.resolve(args.path)}`);
  },
  async browser_download(args) {
    if (typeof args.url !== "string" || typeof args.path !== "string") throw new Error("url and path are required");
    const destination = path.resolve(args.path);
    try {
      await lstat(destination);
      throw new Error(`destination already exists: ${destination}`);
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
    }
    const page = activePage();
    const fetched = await page.evaluate(async ({ url, timeoutMs, maxBytes }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { credentials: "include", signal: controller.signal });
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) throw new Error("download exceeds maximum size");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("download response has no body");
      const chunks = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) throw new Error("download exceeds maximum size");
          chunks.push(value);
        }
      } finally {
        clearTimeout(timer);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return {
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        data: btoa(binary),
      };
    }, { url: args.url, timeoutMs: DEFAULT_TIMEOUT, maxBytes: MAX_DOWNLOAD_BYTES });
    if (fetched.status < 200 || fetched.status >= 300) throw new Error(`download request failed with status ${fetched.status}`);
    const bytes = Buffer.from(fetched.data, "base64");
    if (!bytes.length) throw new Error("download is empty");
    const contentType = fetched.contentType.toLowerCase();
    if (typeof args.expected_content_type === "string" && !contentType.includes(args.expected_content_type.toLowerCase())) {
      throw new Error(`download content type mismatch: ${fetched.contentType || "(missing)"}`);
    }
    if (Number.isFinite(args.min_bytes) && bytes.length < args.min_bytes) throw new Error(`download is smaller than ${args.min_bytes} bytes`);
    if (typeof args.signature_hex === "string") {
      const expected = args.signature_hex.replace(/\s+/g, "").toLowerCase();
      if (!/^[0-9a-f]*$/.test(expected) || !bytes.subarray(0, expected.length / 2).toString("hex").startsWith(expected)) {
        throw new Error("download signature mismatch");
      }
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (typeof args.expected_sha256 === "string" && sha256 !== args.expected_sha256.toLowerCase()) throw new Error("download SHA-256 mismatch");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
    return text(`download saved to ${destination} (${bytes.length} bytes, sha256 ${sha256})`);
  },
  async browser_tab_new(args) {
    await ensureContext();
    const page = await context.newPage();
    if (!pages.includes(page)) pages.push(page);
    activeIndex = pages.indexOf(page);
    if (typeof args.url === "string") {
      await maybeHydrate(args.url);
      await page.goto(args.url, { waitUntil: "load" });
    }
    return text(`opened tab ${activeIndex}`);
  },
  async browser_tab_list() {
    const rows = await Promise.all(pages.map(async (p, i) => `${i}${i === activeIndex ? "*" : " "} ${p.url()} ${await p.title()}`));
    return text(rows.join("\n") || "(no tabs)");
  },
  async browser_tab_switch(args) {
    if (!pages[args.index]) throw new Error(`no tab at index ${args.index}`);
    activeIndex = args.index;
    return text(`active tab ${activeIndex}`);
  },
  async browser_tab_close(args) {
    const index = Number.isFinite(args.index) ? args.index : activeIndex;
    const page = pages[index];
    if (!page) throw new Error(`no tab at index ${index}`);
    await page.close();
    pages.splice(index, 1);
    if (activeIndex >= pages.length) activeIndex = Math.max(0, pages.length - 1);
    return text(`closed tab ${index}`);
  },
  async browser_close() {
    await closeBrowser();
    return text("browser closed");
  },
};

// --- JSON-RPC transport ----------------------------------------------------

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
function reply(id, result) {
  if (id === undefined || id === null) return;
  send({ jsonrpc: "2.0", id, result });
}
function replyError(id, message) {
  if (id === undefined || id === null) return;
  send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: message }], isError: true } });
}

async function handle(message) {
  const { id, method, params } = message || {};
  if (method === "initialize") {
    reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    return;
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "tools/list") {
    reply(id, { tools: TOOLS });
    return;
  }
  if (method === "ping") {
    reply(id, {});
    return;
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    if (!TOOL_NAMES.has(name)) {
      replyError(id, `unknown tool: ${name}`);
      return;
    }
    try {
      const result = await HANDLERS[name](args);
      reply(id, result);
    } catch (err) {
      replyError(id, `${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  if (id !== undefined && id !== null) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
  }
}

// Serialize handling so browser operations do not interleave.
let queue = Promise.resolve();
const reader = createInterface({ input: process.stdin });
reader.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  queue = queue.then(() => handle(message)).catch((err) => {
    process.stderr.write(`cuddly-winner-browser: handler error: ${err instanceof Error ? err.stack : String(err)}\n`);
  });
});
reader.on("close", () => {
  queue = queue.then(() => closeBrowser()).finally(() => process.exit(0));
});
