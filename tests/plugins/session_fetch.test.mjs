import test from "node:test";
import assert from "node:assert/strict";
import { SessionFetchService, validateProfile } from "../../tools/session_fetch.ts";

const profile = {
  origins: ["https://owned.example"],
  login_url: "https://owned.example/login",
  complete_url: "https://owned.example/app",
  token_headers: { "x-csrf-token": "csrf" },
};

function browser() {
  const page = {
    url: () => "https://owned.example/app",
    goto: async () => undefined,
    locator: () => ({ count: async () => 1 }),
    evaluate: async (_callback, keys) => keys.length ? { csrf: "private-token" } : "Test Browser",
  };
  const context = {
    pages: () => [page],
    newPage: async () => page,
    cookies: async () => [{ name: "sid", value: "private-cookie", domain: "owned.example", path: "/", secure: true }],
    close: async () => undefined,
  };
  return { launchPersistentContext: async () => context };
}

test("profile validation rejects non-HTTPS and malformed profiles", () => {
  assert.deepEqual(validateProfile(profile), profile);
  assert.throws(() => validateProfile({ ...profile, origins: ["http://owned.example"] }), /HTTPS/);
  assert.throws(() => validateProfile({ ...profile, token_headers: { Cookie: "csrf" } }), /forbidden/);
});

test("bootstrap requires approval and returns no credentials", async () => {
  const service = new SessionFetchService({ browser: browser(), fetch: async () => { throw new Error("unused"); } });
  await assert.rejects(service.bootstrap({ profile, sessionID: "one", interactive_approved: false }), /approval/);
  const result = await service.bootstrap({ profile, sessionID: "one", interactive_approved: true });
  assert.match(result.handle, /^[a-f0-9]{32}$/);
  assert.doesNotMatch(JSON.stringify(result), /cookie|token|sid/i);
});

test("complete keeps session material private and native request forwards it", async () => {
  const requests = [];
  const service = new SessionFetchService({
    browser: browser(),
    fetch: async (url, init) => {
      requests.push({ url, init });
      return new Response("ok", { headers: { "set-cookie": "fresh=value; Path=/; Secure" } });
    },
  });
  const { handle } = await service.bootstrap({ profile, sessionID: "one", interactive_approved: true });
  const complete = await service.complete({ handle, sessionID: "one" });
  assert.doesNotMatch(JSON.stringify(complete), /private-cookie|private-token/);
  const result = await service.request({ handle, sessionID: "one", url: "https://owned.example/data", method: "GET" });
  assert.equal(result.body, "ok");
  assert.doesNotMatch(JSON.stringify(result), /fresh=value/);
  assert.match(requests[0].init.headers.cookie, /sid=private-cookie/);
  assert.equal(requests[0].init.headers["x-csrf-token"], "private-token");
  await service.request({ handle, sessionID: "one", url: "https://owned.example/data", method: "GET" });
  assert.match(requests[1].init.headers.cookie, /fresh=value/);
});

test("request rejects a response beyond the bounded body size", async () => {
  const service = new SessionFetchService({ browser: browser(), fetch: async () => new Response("x".repeat(1024 * 1024 + 1)) });
  const { handle } = await service.bootstrap({ profile, sessionID: "one", interactive_approved: true });
  await service.complete({ handle, sessionID: "one" });
  await assert.rejects(service.request({ handle, sessionID: "one", url: "https://owned.example/data", method: "GET" }), /1 MiB/);
});

test("request rejects foreign origins, foreign redirects, expiry, and cross-session use", async () => {
  let now = 0;
  const service = new SessionFetchService({ browser: browser(), now: () => now, idleMs: 10, fetch: async () => new Response("", { status: 302, headers: { location: "https://other.example" } }) });
  const { handle } = await service.bootstrap({ profile, sessionID: "one", interactive_approved: true });
  await service.complete({ handle, sessionID: "one" });
  await assert.rejects(service.request({ handle, sessionID: "two", url: "https://owned.example/data", method: "GET" }), /belongs/);
  await assert.rejects(service.request({ handle, sessionID: "one", url: "https://other.example", method: "GET" }), /not configured/);
  await assert.rejects(service.request({ handle, sessionID: "one", url: "https://owned.example/data", method: "GET" }), /redirect/);
  now = 20;
  await assert.rejects(service.request({ handle, sessionID: "one", url: "https://owned.example/data", method: "GET" }), /expired/);
});

test("close removes the opaque session", async () => {
  const service = new SessionFetchService({ browser: browser(), fetch: async () => new Response("ok") });
  const { handle } = await service.bootstrap({ profile, sessionID: "one", interactive_approved: true });
  await service.close({ handle, sessionID: "one" });
  await assert.rejects(service.complete({ handle, sessionID: "one" }), /Unknown session/);
});
