/**
 * immutability.test.mjs
 *
 * Unit tests for plugins/immutability.ts.
 *
 * Run with:
 *   node --experimental-strip-types --test tests/plugins/immutability.test.mjs
 *
 * Covers:
 *   1. readonly — always blocked regardless of identity
 *   2. prometheus_only — allowed for prometheus, denied for others
 *   3. write_allowlist — known agent enforced, unknown identity on covered file denied
 *   4. C1 policy — unknown identity on UNCOVERED file is ALLOWED (no total lockout)
 *   5. SDK path key bug regression — cache-miss uses path: { id } not path: { sessionID }
 *   6. Parent-session identity inheritance for child/subagent sessions
 *   7. chat.params cache — populates and is used in preference to API fallback
 *   8. Case-variant protection
 *   9. Non-mutating tools pass through untouched
 *  10. No immutable.json → file immutability no-op
 *  11. Prometheus bash-write guard blocks interpreter/redirection bypasses
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";

// Node 24 can strip TypeScript directly.
import { ImmutabilityGuard } from "../../plugins/immutability.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "immutability-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Write .opencode/immutable.json in dir and return the dir.
 */
async function setupImmutable(dir, cfg) {
  const oc = path.join(dir, ".opencode");
  await mkdir(oc, { recursive: true });
  await writeFile(path.join(oc, "immutable.json"), JSON.stringify(cfg), "utf-8");
  return dir;
}

/**
 * Build a minimal client mock.
 * messagesBySession: { [sessionID]: [{ info: { role, agent }, parts: [] }] }
 * sessionMeta:       { [sessionID]: { parentID? } }
 */
function makeClient({ messagesBySession = {}, sessionMeta = {} } = {}) {
  return {
    app: { log: async () => {} },
    session: {
      messages: async ({ path: p }) => {
        const id = p?.id;
        const msgs = messagesBySession[id] ?? [];
        return { data: msgs };
      },
      get: async ({ path: p }) => {
        const id = p?.id;
        const meta = sessionMeta[id] ?? {};
        return { data: meta };
      },
    },
  };
}

/**
 * Invoke tool.execute.before for an edit/write call targeting `filename` in `dir`.
 * Returns the error thrown, or null if allowed.
 */
async function attempt(hooks, { tool = "edit", sessionID = "s1", filename, dir }) {
  try {
    await hooks["tool.execute.before"](
      { tool, sessionID, callID: "c1" },
      { args: { filePath: path.join(dir, filename) } }
    );
    return null;
  } catch (err) {
    return err;
  }
}

async function attemptBash(hooks, { sessionID = "s1", command }) {
  try {
    await hooks["tool.execute.before"](
      { tool: "bash", sessionID, callID: "c1" },
      { args: { command } }
    );
    return null;
  } catch (err) {
    return err;
  }
}

/**
 * Fire chat.params to populate the agent cache.
 */
async function cacheAgent(hooks, sessionID, agent) {
  await hooks["chat.params"]({ sessionID, agent }, {});
}

// ---------------------------------------------------------------------------
// 1. readonly — always blocked regardless of identity
// ---------------------------------------------------------------------------

test("readonly: blocks all agents including prometheus", async () => {
  await withTempDir(async (dir) => {
    await setupImmutable(dir, { readonly: ["locked.txt"] });
    const client = makeClient({
      messagesBySession: { s1: [{ info: { role: "user", agent: "prometheus" }, parts: [] }] },
    });
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    // Even prometheus cannot write a readonly file.
    const err = await attempt(hooks, { filename: "locked.txt", dir });
    assert.ok(err, "expected error for readonly write");
    assert.match(err.message, /readonly/);
    assert.match(err.message, /ImmutabilityGuard/);
  });
});

test("readonly: blocks unknown-identity agent", async () => {
  await withTempDir(async (dir) => {
    await setupImmutable(dir, { readonly: ["locked.txt"] });
    const client = makeClient(); // no messages — identity unknown
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    const err = await attempt(hooks, { filename: "locked.txt", dir });
    assert.ok(err, "expected error for readonly write without identity");
    assert.match(err.message, /ImmutabilityGuard/);
  });
});

test("readonly: non-readonly file is not affected", async () => {
  await withTempDir(async (dir) => {
    await setupImmutable(dir, { readonly: ["locked.txt"] });
    const client = makeClient({
      messagesBySession: { s1: [{ info: { role: "user", agent: "autonomous" }, parts: [] }] },
    });
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    const err = await attempt(hooks, { filename: "other.py", dir });
    assert.equal(err, null, "should allow write to non-readonly file");
  });
});

// ---------------------------------------------------------------------------
// 2. prometheus_only — allowed for prometheus, denied for others
// ---------------------------------------------------------------------------

test("prometheus_only: prometheus is allowed (via chat.params cache)", async () => {
  await withTempDir(async (dir) => {
    await setupImmutable(dir, { prometheus_only: ["SPEC.md"] });
    const client = makeClient();
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    await cacheAgent(hooks, "s1", "prometheus");
    const err = await attempt(hooks, { filename: "SPEC.md", dir });
    assert.equal(err, null, "prometheus should be allowed to write SPEC.md");
  });
});

test("prometheus_only: non-prometheus agent is blocked", async () => {
  await withTempDir(async (dir) => {
    await setupImmutable(dir, { prometheus_only: ["SPEC.md"] });
    const client = makeClient();
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    await cacheAgent(hooks, "s1", "autonomous");
    const err = await attempt(hooks, { filename: "SPEC.md", dir });
    assert.ok(err, "non-prometheus should be blocked");
    assert.match(err.message, /prometheus/);
  });
});

test("prometheus_only: unknown identity is blocked (file is explicitly protected)", async () => {
  await withTempDir(async (dir) => {
    await setupImmutable(dir, { prometheus_only: ["SPEC.md"] });
    const client = makeClient(); // no messages — identity unknown
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    const err = await attempt(hooks, { filename: "SPEC.md", dir });
    assert.ok(err, "unknown identity should be blocked on prometheus_only file");
    assert.match(err.message, /could not be resolved/);
  });
});

// ---------------------------------------------------------------------------
// 3. write_allowlist — known agent enforced
// ---------------------------------------------------------------------------

test("write_allowlist: agent writing an allowlisted file is permitted", async () => {
  await withTempDir(async (dir) => {
    await setupImmutable(dir, { write_allowlist: { prometheus: ["SPEC.md", "program.md"] } });
    const client = makeClient();
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    await cacheAgent(hooks, "s1", "prometheus");
    const err = await attempt(hooks, { filename: "SPEC.md", dir });
    assert.equal(err, null, "prometheus should be allowed its allowlisted file");
  });
});

test("write_allowlist: agent writing a non-allowlisted file is blocked", async () => {
  await withTempDir(async (dir) => {
    await setupImmutable(dir, { write_allowlist: { prometheus: ["SPEC.md"] } });
    const client = makeClient();
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    await cacheAgent(hooks, "s1", "prometheus");
    const err = await attempt(hooks, { filename: "notes.md", dir });
    assert.ok(err, "prometheus should be blocked from writing outside its allowlist");
    assert.match(err.message, /restricted to writing/);
  });
});

// ---------------------------------------------------------------------------
// 4. C1 policy — unknown identity on UNCOVERED file is ALLOWED (no total lockout)
// ---------------------------------------------------------------------------

test("C1: unknown identity + file NOT in any allowlist → ALLOWED", async () => {
  await withTempDir(async (dir) => {
    // Only prometheus is restricted; autonomous has no allowlist entry.
    await setupImmutable(dir, {
      write_allowlist: { prometheus: ["SPEC.md"] },
    });
    const client = makeClient(); // identity unknown
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    // autonomous (identity unknown) writes a file that appears in no allowlist.
    const err = await attempt(hooks, { filename: "experiments.py", dir, sessionID: "s-unknown" });
    assert.equal(err, null, "unknown identity should be allowed to write uncovered files (C1)");
  });
});

test("C1: unknown identity + file IN an allowlist → DENIED", async () => {
  await withTempDir(async (dir) => {
    await setupImmutable(dir, {
      write_allowlist: { prometheus: ["SPEC.md"] },
    });
    const client = makeClient(); // identity unknown
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    // SPEC.md is in prometheus's allowlist — unknown agent is denied.
    const err = await attempt(hooks, { filename: "SPEC.md", dir, sessionID: "s-unknown" });
    assert.ok(err, "unknown identity should be denied for a covered allowlist file");
    assert.match(err.message, /could not be resolved/);
  });
});

// ---------------------------------------------------------------------------
// 5. SDK path key regression — cache-miss uses path: { id }
// ---------------------------------------------------------------------------

test("fallback: resolves identity via messages API using path: { id }", async () => {
  await withTempDir(async (dir) => {
    await setupImmutable(dir, { prometheus_only: ["SPEC.md"] });

    // Client returns messages keyed by the correct `id` field.
    const client = makeClient({
      messagesBySession: {
        "sess-abc": [{ info: { role: "user", agent: "prometheus" }, parts: [] }],
      },
    });

    // Track what path key was actually used in the API call.
    const callLog = [];
    const origMessages = client.session.messages.bind(client.session);
    client.session.messages = async (opts) => {
      callLog.push(opts?.path);
      return origMessages(opts);
    };

    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    // No chat.params — identity must come from the messages fallback.
    const err = await attempt(hooks, { filename: "SPEC.md", dir, sessionID: "sess-abc" });
    assert.equal(err, null, "prometheus should be allowed via messages fallback");

    // Confirm the SDK was called with { id } not { sessionID }.
    assert.ok(callLog.length > 0, "messages API should have been called");
    assert.ok(callLog[0]?.id === "sess-abc", "messages must be called with path: { id }");
    assert.equal(callLog[0]?.sessionID, undefined, "must NOT use path: { sessionID }");
  });
});

test("fallback: non-prometheus identity via messages API is blocked", async () => {
  await withTempDir(async (dir) => {
    await setupImmutable(dir, { prometheus_only: ["SPEC.md"] });

    const client = makeClient({
      messagesBySession: {
        "sess-xyz": [{ info: { role: "user", agent: "autonomous" }, parts: [] }],
      },
    });
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    const err = await attempt(hooks, { filename: "SPEC.md", dir, sessionID: "sess-xyz" });
    assert.ok(err, "autonomous should be blocked via messages fallback");
    assert.match(err.message, /prometheus/);
  });
});

// ---------------------------------------------------------------------------
// 6. Parent-session identity inheritance
// ---------------------------------------------------------------------------

test("parent session: child inherits parent agent identity", async () => {
  await withTempDir(async (dir) => {
    await setupImmutable(dir, { prometheus_only: ["SPEC.md"] });

    // Child session has no messages; parent session has prometheus.
    const client = makeClient({
      messagesBySession: {
        "parent-sess": [{ info: { role: "user", agent: "prometheus" }, parts: [] }],
        "child-sess": [], // empty — must fall back to parent
      },
      sessionMeta: {
        "child-sess": { parentID: "parent-sess" },
      },
    });
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    const err = await attempt(hooks, { filename: "SPEC.md", dir, sessionID: "child-sess" });
    assert.equal(err, null, "child session should inherit parent prometheus identity");
  });
});

test("parent session: child with non-prometheus parent is blocked", async () => {
  await withTempDir(async (dir) => {
    await setupImmutable(dir, { prometheus_only: ["SPEC.md"] });

    const client = makeClient({
      messagesBySession: {
        "parent-sess": [{ info: { role: "user", agent: "autonomous" }, parts: [] }],
        "child-sess": [],
      },
      sessionMeta: {
        "child-sess": { parentID: "parent-sess" },
      },
    });
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    const err = await attempt(hooks, { filename: "SPEC.md", dir, sessionID: "child-sess" });
    assert.ok(err, "child session with autonomous parent should be blocked");
    assert.match(err.message, /prometheus/);
  });
});

// ---------------------------------------------------------------------------
// 7. chat.params cache takes priority over API fallback
// ---------------------------------------------------------------------------

test("chat.params cache: used in preference to messages API", async () => {
  await withTempDir(async (dir) => {
    await setupImmutable(dir, { prometheus_only: ["SPEC.md"] });

    // Messages API would return "autonomous" — but cache says "prometheus".
    const client = makeClient({
      messagesBySession: {
        "s-cache": [{ info: { role: "user", agent: "autonomous" }, parts: [] }],
      },
    });

    let messagesCalled = false;
    const origMessages = client.session.messages.bind(client.session);
    client.session.messages = async (opts) => {
      messagesCalled = true;
      return origMessages(opts);
    };

    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });
    await cacheAgent(hooks, "s-cache", "prometheus");

    const err = await attempt(hooks, { filename: "SPEC.md", dir, sessionID: "s-cache" });
    assert.equal(err, null, "cache hit for prometheus should allow write");
    assert.equal(messagesCalled, false, "messages API should not be called on cache hit");
  });
});

// ---------------------------------------------------------------------------
// 8. Case-variant protection
// ---------------------------------------------------------------------------

test("case-variant: spec.md blocked when SPEC.md is protected", async () => {
  await withTempDir(async (dir) => {
    await setupImmutable(dir, { prometheus_only: ["SPEC.md"] });
    const client = makeClient();
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    await cacheAgent(hooks, "s1", "autonomous");
    const err = await attempt(hooks, { filename: "spec.md", dir });
    assert.ok(err, "case variant should be blocked");
    assert.match(err.message, /case variant/);
  });
});

// ---------------------------------------------------------------------------
// 9. Non-mutating tools pass through untouched
// ---------------------------------------------------------------------------

test("non-mutating tools: read is not intercepted", async () => {
  await withTempDir(async (dir) => {
    await setupImmutable(dir, { readonly: ["locked.txt"] });
    const client = makeClient();
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    // 'read' is not in MUTATING_TOOLS — should never throw.
    try {
      await hooks["tool.execute.before"](
        { tool: "read", sessionID: "s1", callID: "c1" },
        { args: { filePath: path.join(dir, "locked.txt") } }
      );
    } catch (err) {
      assert.fail(`read tool should not be intercepted: ${err.message}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. No immutable.json → file immutability no-op
// ---------------------------------------------------------------------------

test("file immutability no-op: no immutable.json means edit/write restrictions pass through", async () => {
  await withTempDir(async (dir) => {
    // No .opencode/immutable.json created.
    const client = makeClient();
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });

    const err = await attempt(hooks, { filename: "anything.md", dir });
    assert.equal(err, null, "no config means no restrictions");
  });
});

// ---------------------------------------------------------------------------
// 11. Prometheus bash-write guard
// ---------------------------------------------------------------------------

test("prometheus bash guard: blocks Python heredoc project writes", async () => {
  await withTempDir(async (dir) => {
    const client = makeClient();
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });
    await cacheAgent(hooks, "s1", "prometheus");

    const err = await attemptBash(hooks, {
      command: "python3 - << 'PYEOF'\nfrom pathlib import Path\nPath('tests/verify_opencode.py').write_text('oops')\nPYEOF",
    });

    assert.ok(err, "prometheus Python heredoc write must be blocked");
    assert.match(err.message, /PrometheusBashGuard/);
  });
});

test("prometheus bash guard: blocks shell redirection project writes", async () => {
  await withTempDir(async (dir) => {
    const client = makeClient();
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });
    await cacheAgent(hooks, "s1", "prometheus");

    const err = await attemptBash(hooks, {
      command: "cat > progress.txt << 'EOF'\nwrite\nEOF",
    });

    assert.ok(err, "prometheus redirection write must be blocked");
    assert.match(err.message, /PrometheusBashGuard/);
  });
});

test("prometheus bash guard: allows sandbox cleanup", async () => {
  await withTempDir(async (dir) => {
    const client = makeClient();
    const hooks = await ImmutabilityGuard({ directory: dir, worktree: dir, client });
    await cacheAgent(hooks, "s1", "prometheus");

    const err = await attemptBash(hooks, {
      command: "rm -rf /tmp/prometheus-spike/run-1",
    });

    assert.equal(err, null, "sandbox cleanup should remain allowed");
  });
});
