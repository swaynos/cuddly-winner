/** Interactive browser bootstrap with private, read-only HTTP session replay. */
import { tool } from "@opencode-ai/plugin";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_SESSIONS = 3;
const DEFAULT_IDLE_MS = 15 * 60 * 1000;
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const FORBIDDEN_HEADERS = new Set(["cookie", "authorization", "host"]);

export interface SiteProfile {
  origins: string[];
  login_url: string;
  complete_url?: string;
  complete_selector?: string;
  token_headers?: Record<string, string>;
}

interface Cookie { name: string; value: string; domain: string; path: string; secure?: boolean; expires?: number; }
interface Page { goto(url: string): Promise<unknown>; url(): string; locator(selector: string): { count(): Promise<number> }; evaluate<T>(callback: (keys: string[]) => T, keys: string[]): Promise<T>; }
interface BrowserContext { pages(): Page[]; newPage(): Promise<Page>; cookies(urls?: string[]): Promise<Cookie[]>; close(): Promise<void>; }
interface Browser { launchPersistentContext(directory: string, options: { headless: boolean }): Promise<BrowserContext>; }
interface StoredSession { sessionID: string; profile: SiteProfile; context: BrowserContext; directory: string; cookies: Cookie[]; tokens: Record<string, string>; userAgent: string; lastUsed: number; complete: boolean; }

export function validateProfile(value: unknown): SiteProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("site profile must be an object");
  const profile = value as SiteProfile;
  if (!Array.isArray(profile.origins) || !profile.origins.length) throw new Error("site profile requires origins");
  const origins = profile.origins.map(origin => {
    const url = parseHTTPS(origin, "profile origin");
    if (url.pathname !== "/" || url.search || url.hash) throw new Error("profile origins must be exact origins");
    return url.origin;
  });
  if (!profile.login_url) throw new Error("site profile requires login_url");
  const loginURL = parseHTTPS(profile.login_url, "login_url");
  if (!origins.includes(loginURL.origin)) throw new Error("login_url must use a configured origin");
  if (!profile.complete_url && !profile.complete_selector) throw new Error("site profile requires complete_url or complete_selector");
  if (profile.complete_url && !origins.includes(parseHTTPS(profile.complete_url, "complete_url").origin)) throw new Error("complete_url must use a configured origin");
  for (const [header, key] of Object.entries(profile.token_headers ?? {})) {
    if (!/^[a-z0-9-]+$/.test(header) || FORBIDDEN_HEADERS.has(header) || !key) throw new Error("token_headers contains a forbidden or invalid header");
  }
  return { ...profile, origins };
}

function parseHTTPS(value: string, label: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an absolute HTTPS URL`); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${label} must be HTTPS without credentials`);
  return url;
}

function matchesOrigin(profile: SiteProfile, value: string): URL {
  const url = parseHTTPS(value, "request URL");
  if (!profile.origins.includes(url.origin)) throw new Error("request URL origin is not configured for this session");
  return url;
}

function cookieHeader(cookies: Cookie[], url: URL, now: number): string {
  return cookies.filter(cookie => {
    const domain = cookie.domain.replace(/^\./, "");
    return (!cookie.expires || cookie.expires * 1000 > now) && (!cookie.secure || url.protocol === "https:") &&
      (url.hostname === domain || url.hostname.endsWith(`.${domain}`)) && url.pathname.startsWith(cookie.path || "/");
  }).map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
}

function mergeSetCookies(cookies: Cookie[], response: Response, origin: URL): Cookie[] {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const value of values) {
    const [pair, ...attributes] = value.split(";").map(part => part.trim());
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const cookie: Cookie = { name: pair.slice(0, separator), value: pair.slice(separator + 1), domain: origin.hostname, path: "/" };
    for (const attribute of attributes) {
      const [name, raw = ""] = attribute.split("=", 2);
      if (/^domain$/i.test(name)) cookie.domain = raw.replace(/^\./, "");
      else if (/^path$/i.test(name)) cookie.path = raw || "/";
      else if (/^secure$/i.test(name)) cookie.secure = true;
      else if (/^max-age$/i.test(name) && Number.isFinite(Number(raw))) cookie.expires = Math.floor(Date.now() / 1000) + Number(raw);
    }
    if (origin.hostname !== cookie.domain && !origin.hostname.endsWith(`.${cookie.domain}`)) continue;
    const index = cookies.findIndex(existing => existing.name === cookie.name && existing.domain === cookie.domain && existing.path === cookie.path);
    if (index >= 0) cookies[index] = cookie; else cookies.push(cookie);
  }
  return cookies;
}

async function body(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("response body exceeds 1 MiB limit");
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export class SessionFetchService {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly now: () => number;
  private readonly idleMs: number;
  private readonly browser: Browser;
  private readonly fetcher: typeof fetch;

  constructor(options: { browser: Browser; fetch?: typeof fetch; now?: () => number; idleMs?: number }) {
    this.browser = options.browser;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  }

  async bootstrap(input: { profile: SiteProfile; sessionID: string; interactive_approved: boolean }): Promise<{ handle: string; state: "awaiting_login" }> {
    if (!input.interactive_approved) throw new Error("interactive browser approval is required before bootstrap");
    await this.pruneExpired();
    if (this.sessions.size >= MAX_SESSIONS) throw new Error(`too many active sessions (max ${MAX_SESSIONS})`);
    const profile = validateProfile(input.profile);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cuddly-winner-session-fetch-"));
    let context: BrowserContext | undefined;
    try {
      context = await this.browser.launchPersistentContext(directory, { headless: false });
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto(profile.login_url);
    } catch (error) {
      await context?.close();
      await fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
    const handle = crypto.randomBytes(16).toString("hex");
    this.sessions.set(handle, { sessionID: input.sessionID, profile, context, directory, cookies: [], tokens: {}, userAgent: "", lastUsed: this.now(), complete: false });
    return { handle, state: "awaiting_login" };
  }

  async complete(input: { handle: string; sessionID: string }): Promise<{ handle: string; state: "ready" }> {
    const session = this.access(input.handle, input.sessionID);
    const page = session.context.pages()[0] ?? await session.context.newPage();
    if (session.profile.complete_url && page.url() !== session.profile.complete_url) throw new Error("browser session has not reached the configured completion URL");
    if (session.profile.complete_selector && !(await page.locator(session.profile.complete_selector).count())) throw new Error("browser session has not reached the configured completion selector");
    const tokenKeys = Object.values(session.profile.token_headers ?? {});
    session.tokens = tokenKeys.length ? await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key) ?? ""])), tokenKeys) : {};
    session.cookies = await session.context.cookies(session.profile.origins);
    session.userAgent = await page.evaluate(() => navigator.userAgent, []);
    session.complete = true;
    session.lastUsed = this.now();
    return { handle: input.handle, state: "ready" };
  }

  async request(input: { handle: string; sessionID: string; url: string; method: "GET" | "HEAD" }): Promise<{ status: number; url: string; content_type: string; body: string }> {
    if (input.method !== "GET" && input.method !== "HEAD") throw new Error("session_fetch supports only GET and HEAD");
    const session = this.access(input.handle, input.sessionID);
    if (!session.complete) throw new Error("browser session is awaiting completion");
    let current = matchesOrigin(session.profile, input.url);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const headers: Record<string, string> = { accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", "user-agent": session.userAgent };
      const cookies = cookieHeader(session.cookies, current, this.now());
      if (cookies) headers.cookie = cookies;
      for (const [header, key] of Object.entries(session.profile.token_headers ?? {})) if (session.tokens[key]) headers[header] = session.tokens[key];
      const response = await this.fetcher(current, { method: input.method, headers, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      session.cookies = mergeSetCookies(session.cookies, response, current);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("redirect response has no location");
        if (redirects === MAX_REDIRECTS) throw new Error("too many redirects");
        const next = new URL(location, current);
        try { current = matchesOrigin(session.profile, next.toString()); } catch { throw new Error("redirect leaves the configured site origins"); }
        continue;
      }
      session.lastUsed = this.now();
      return { status: response.status, url: current.toString(), content_type: response.headers.get("content-type") ?? "", body: input.method === "HEAD" ? "" : await body(response) };
    }
    throw new Error("too many redirects");
  }

  async close(input: { handle: string; sessionID: string }): Promise<{ closed: true }> {
    const session = this.access(input.handle, input.sessionID);
    await this.dispose(input.handle, session);
    return { closed: true };
  }

  private async pruneExpired(): Promise<void> {
    const expired = [...this.sessions.entries()].filter(([, session]) => this.now() - session.lastUsed > this.idleMs);
    await Promise.all(expired.map(async ([handle, session]) => {
      try { await this.dispose(handle, session); } catch { /* Expiry must not keep a dead slot. */ }
    }));
  }

  private async dispose(handle: string, session: StoredSession): Promise<void> {
    this.sessions.delete(handle);
    let closeError: unknown;
    try { await session.context.close(); } catch (error) { closeError = error; }
    try { await fs.rm(session.directory, { recursive: true, force: true }); } catch (error) { if (!closeError) closeError = error; }
    if (closeError) throw closeError;
  }

  private access(handle: string, sessionID: string): StoredSession {
    const session = this.sessions.get(handle);
    if (!session) throw new Error("Unknown session handle");
    if (session.sessionID !== sessionID) throw new Error("session handle belongs to another OpenCode session");
    if (this.now() - session.lastUsed > this.idleMs) { void this.dispose(handle, session); throw new Error("session has expired; bootstrap again"); }
    return session;
  }
}

async function installedProfile(name: string): Promise<SiteProfile> {
  const toolDir = path.dirname(fileURLToPath(import.meta.url));
  const config = JSON.parse(await fs.readFile(path.join(path.dirname(toolDir), "session-fetch-sites.json"), "utf8")) as { schema_version?: number; sites?: Record<string, unknown> };
  if (config.schema_version !== 1 || !config.sites || !(name in config.sites)) throw new Error(`Unknown configured site profile: ${name}`);
  return validateProfile(config.sites[name]);
}

let liveService: SessionFetchService | undefined;
async function service(): Promise<SessionFetchService> {
  if (liveService) return liveService;
  const { chromium } = await import("playwright");
  liveService = new SessionFetchService({ browser: chromium });
  return liveService;
}

export default tool({
  description: "Establish an approved interactive browser session for a configured site, then make private read-only authenticated requests. The tool promises authenticated session continuity.",
  args: {
    operation: tool.schema.enum(["bootstrap", "complete", "request", "close"]),
    site: tool.schema.string().optional(),
    handle: tool.schema.string().optional(),
    url: tool.schema.string().url().optional(),
    method: tool.schema.enum(["GET", "HEAD"]).optional(),
    interactive_approved: tool.schema.boolean().optional(),
  },
  async execute(args, context) {
    const sessionID = context.sessionID ?? "unknown";
    const current = await service();
    if (args.operation === "bootstrap") return JSON.stringify(await current.bootstrap({ profile: await installedProfile(args.site ?? ""), sessionID, interactive_approved: args.interactive_approved === true }));
    if (args.operation === "complete") return JSON.stringify(await current.complete({ handle: args.handle ?? "", sessionID }));
    if (args.operation === "close") return JSON.stringify(await current.close({ handle: args.handle ?? "", sessionID }));
    return JSON.stringify(await current.request({ handle: args.handle ?? "", sessionID, url: args.url ?? "", method: args.method ?? "GET" }));
  },
});
