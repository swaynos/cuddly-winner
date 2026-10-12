import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, writeFile, symlink, rm } from "node:fs/promises";
import { once } from "node:events";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { parse as parseJsonc } from "jsonc-parser";
import { publishGoalAgentFile } from "../../tools/publish_goal_agent.ts";
import { qualificationSettings, qualificationGuard, publicationCases, publicationPrompt,
  caseReadme, caseVerifier, allowedQualificationCommand, qualificationPermissionCommand } from "../helpers/publication-qualification.mjs";

const repo = path.resolve(import.meta.dirname, "../..");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const content = message => typeof message.content === "string" ? message.content : Array.isArray(message.content) ? message.content.map(part => part.text ?? JSON.stringify(part)).join("\n") : JSON.stringify(message.content);
const parts = messages => messages.flatMap(message => message.parts);
const completed = (messages, tool) => parts(messages).filter(part => part.tool === tool && part.state.status === "completed");
const outputs = (messages, tool) => completed(messages, tool).map(part => JSON.parse(part.state.output));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const readsGood = output => /^\s*\d+\s*[:|]\s*good\s*$/m.test(output);
const compactionRequest = input => input.messages?.some(message => message.role === "system" && /context summarization agent|summarizing conversations/i.test(content(message)));
const evaluatorMode = text => text.match(/^INDEPENDENT EVALUATOR mode=(feedback|final)\b/m)?.[1];

async function fixture(t, respond, { runtime = true, extraPlugin, prometheus = false, live } = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "goal-runtime-live-")));
  let child;
  let serverLog = "";
  const requests = [];
  const providerTrace = [];
  const eventTrace = [];
  const eventObservers = [];
  const errors = [];
  const brief = (value, limit = 500) => String(typeof value === "string" ? value : JSON.stringify(value)).slice(0, limit);
  const diagnostics = () => {
    if (live) return "Real-model transport details are suppressed. Inspect public qualification receipts and checkpoint state; authentication is outside the task directory.";
    const lines = serverLog.split("\n");
    return `Server ERRORs:\n${lines.filter(line => /level=ERROR|errorRef=|err_[a-f0-9]+/.test(line)).slice(-6).map(line => brief(line, 1800)).join("\n") || "(none)"}\nServer tail:\n${lines.slice(-8).map(line => brief(line, 350)).join("\n")}\nProvider trace (last ${providerTrace.length} requests):\n${providerTrace.map(trace => JSON.stringify(trace)).join("\n")}\nObserved stop events (last ${eventTrace.length}):\n${eventTrace.join("\n") || "(none)"}`;
  };
  const provider = http.createServer(async (req, res) => {
    let trace;
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      requests.push(input);
      const requestID = requests.length;
      const { user, lastUser, results } = conversation(input);
      trace = { request: requestID, model: input.model, role: compactionRequest(input) ? "compaction" : user.includes("INDEPENDENT EVALUATOR") ? "evaluator" : "root", lastUser: brief(lastUser, 140), results: results.slice(-2).map(result => ({ name: result.name, args: brief(result.args, 180), output: brief(result.output) })) };
      providerTrace.push(trace);
      if (providerTrace.length > 12) providerTrace.shift();
      const answer = await respond(input, { root, res, requests });
      trace.answer = answer?.call ? { tool: answer.call.name, args: brief(answer.call.args, 180) } : brief(answer?.text, 160);
      if (res.destroyed || answer === undefined) return;
      const call = answer.call;
      const message = call ? { tool_calls: [{ index: 0, id: `call-${requestID}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: answer.text ?? "Fixture complete." };
      if (input.stream === false) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: `chat-${requests.length}`, object: "chat.completion", created: 1, model: input.model, choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const [delta, finish_reason] of [[{ role: "assistant", ...message }, null], [{}, call ? "tool_calls" : "stop"]]) {
        res.write(`data: ${JSON.stringify({ id: `chat-${requests.length}`, object: "chat.completion.chunk", created: 1, model: input.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      }
      res.end("data: [DONE]\n\n");
    } catch (error) {
      if (trace) trace.error = brief(String(error), 500);
      errors.push(error);
      if (!res.headersSent) res.writeHead(500);
      res.end(String(error));
    }
  });
  t.after(async () => {
    for (const observer of eventObservers) observer.controller.abort();
    await Promise.all(eventObservers.map(observer => observer.task));
    if (child && child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
    provider.closeAllConnections();
    await new Promise(resolve => provider.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  await mkdir(path.join(root, ".opencode", "plugins"), { recursive: true });
  await mkdir(path.join(root, ".opencode", "tools"), { recursive: true });
  if (runtime) {
    const runtimeRoot = process.env.OPENCODE_GOAL_RUNTIME_ROOT ?? repo;
    for (const file of ["plugins/goal.ts", "plugins/immutability.ts", "tools/publish_goal_agent.ts"]) {
      await symlink(path.join(runtimeRoot, file), path.join(root, ".opencode", file));
    }
  }
  if (prometheus) {
    await mkdir(path.join(root, ".opencode", "agents"), { recursive: true });
    await writeFile(path.join(root, ".opencode", "agents", "prometheus.md"),
      await readFile(path.join(process.env.OPENCODE_GOAL_RUNTIME_ROOT ?? repo, "agents", "prometheus.md")));
  }
  await symlink(path.join(repo, "node_modules"), path.join(root, ".opencode", "node_modules"));
  if (extraPlugin) await writeFile(path.join(root, ".opencode", "plugins", "interruption.ts"), extraPlugin);
  await writeFile(path.join(root, "opencode.json"), JSON.stringify({
    $schema: "https://opencode.ai/config.json", model: "fixture/default", small_model: "fixture/default",
    agent: { general: { model: "fixture/general" } },
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "fixture", options: { baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: "fixture" }, models: {
      default: { name: "default", limit: { context: 128000, output: 4096 } },
      general: { name: "general", limit: { context: 128000, output: 4096 } },
      evaluator: { name: "evaluator", limit: { context: 128000, output: 4096 } },
    } } },
  }));
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"), XDG_CACHE_HOME: path.join(root, "cache"), OPENCODE_DISABLE_DEFAULT_PLUGINS: "1" };
  for (const key of ["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG_CONTENT", "OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME", "OPENCODE_PURE", "OPENCODE_DISABLE_PROJECT_CONFIG"]) delete env[key];
  delete env.NODE_TEST_CONTEXT; // A child must execute its own real Node checks.
  if (live) {
    const privateDir = await mkdtemp(path.join(live.privateRoot, "profile-"));
    env.HOME = os.homedir();
    env.XDG_CONFIG_HOME = path.join(privateDir, "config");
    env.XDG_DATA_HOME = path.join(privateDir, "data");
    env.NODE_OPTIONS = ""; // Only this non-secret runtime option may be inspected.
    delete env.OPENCODE_DISABLE_DEFAULT_PLUGINS;
    await mkdir(path.join(env.XDG_CONFIG_HOME, "opencode"), { recursive: true, mode: 0o700 });
    await mkdir(path.join(env.XDG_DATA_HOME, "opencode"), { recursive: true, mode: 0o700 });
    await writeFile(path.join(env.XDG_CONFIG_HOME, "opencode", "opencode.json"), JSON.stringify({
      $schema: "https://opencode.ai/config.json", provider: live.provider, share: "disabled",
    }), { mode: 0o600 });
    await writeFile(path.join(env.XDG_DATA_HOME, "opencode", "auth.json"), JSON.stringify(live.auth), { mode: 0o600 });
    await writeFile(path.join(root, "opencode.json"), JSON.stringify({
      $schema: "https://opencode.ai/config.json", model: live.model, small_model: live.model, share: "disabled",
      permission: { external_directory: "deny" },
    }));
    await writeFile(path.join(root, ".opencode", "plugins", "qualification.ts"), qualificationGuard(live.receipts, live.maxTurns, live.deadline, live.model));
  }
  const probe = http.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const baseUrl = `http://127.0.0.1:${port}`;
  const sdk = createOpencodeClient({ baseUrl });
  const api = async (url, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
    assert.ok(response.ok, `${method} ${url}: ${response.status} ${response.ok || live ? "" : await response.text()}`);
    return response.status === 204 ? undefined : response.json();
  };
  const wait = async (label, check) => {
    try {
      const deadline = live?.deadline ?? Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (errors.length) throw errors[0];
        const result = await check();
        if (result) return result;
        await delay(live ? 200 : 50);
      }
      throw new Error(`${label} timed out`);
    } catch (error) {
      let sessions = "(unavailable)";
      try {
        const response = await fetch(`${baseUrl}/session`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) sessions = JSON.stringify((await response.json()).filter(session => session.directory === root).slice(-4).map(session => ({ id: session.id, parentID: session.parentID, metadata: brief(session.metadata, 1400) })), null, 2);
      } catch {}
      throw new Error(`${label}: ${brief(error.message, 1800)}\n${diagnostics()}\nSession metadata (up to four):\n${sessions}`, { cause: error });
    }
  };
  const start = async () => {
    const cli = process.env.OPENCODE_GOAL_TEST_CLI ?? path.join(repo, "node_modules", ".bin", "opencode");
    child = spawn(cli, ["serve", "--print-logs", "--port", String(port), "--hostname", "127.0.0.1"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", bytes => { serverLog = (serverLog + bytes).slice(-64_000); });
    child.stderr.on("data", bytes => { serverLog = (serverLog + bytes).slice(-64_000); });
    let lastError;
    await wait("server startup", async () => {
      if (child.exitCode !== null) throw new Error(`CLI exited: ${child.exitCode}`);
      try {
        const response = await fetch(`${baseUrl}/global/health`, { signal: AbortSignal.timeout(1000) });
        return response.ok && await response.json();
      } catch (error) { lastError = error; return false; }
    }).catch(error => { throw new Error(`${error.message}\n${lastError}`, { cause: error }); });
  };
  const kill = async () => { child.kill("SIGKILL"); await once(child, "exit"); };
  const messages = id => api(`/session/${id}/message`);
  const checkpoint = async id => (await api(`/session/${id}`)).metadata?.cuddly_winner_goal;
  const idle = id => wait("session idle", async () => { const status = (await api("/session/status"))[id]; return !status || status.type === "idle"; });
  const observeStopEvents = async id => {
    const controller = new AbortController();
    const subscription = await sdk.event.subscribe({ directory: root }, { signal: controller.signal, sseMaxRetryAttempts: 1 });
    let connected = false;
    const task = (async () => {
      try {
        for await (const event of subscription.stream) {
          connected = true;
          const fields = event.properties ?? event.data;
          if ((fields?.sessionID ?? fields?.part?.sessionID) !== id) continue;
          if (!["permission.replied", "session.error", "session.status", "session.idle"].includes(event.type)
            && !(event.type === "message.part.updated" && fields?.part?.type === "tool" && fields.part.state?.status === "error")) continue;
          eventTrace.push(brief(event, 1800));
          if (eventTrace.length > 12) eventTrace.shift();
        }
      } catch (error) { if (!controller.signal.aborted) errors.push(error); }
    })();
    eventObservers.push({ controller, task });
    await wait("SDK stop-event subscription connected", () => connected);
  };
  return { root, api, sdk, requests, start, kill, wait, messages, checkpoint, idle, observeStopEvents, diagnostics };
}

test("pinned CLI persists V2 session metadata through real compaction and SIGKILL restart", { timeout: 120_000 }, async t => {
  const f = await fixture(t, async (input, { root }) => {
    if (compactionRequest(input)) return { text: "## Objective\n- Preserve the durable checkpoint.\n## Important Details\n- No task action is authorized.\n## Work State\n### Completed\n- Read counter.txt: good.\n### Active\n- (none)\n### Blocked\n- Waiting for explicit user input.\n## Next Move\n1. Wait for explicit user input.\n## Relevant Files\n- counter.txt: qualified read fixture." };
    const { user, results } = conversation(input);
    if (user.includes("Read metadata qualification") && !results.some(result => result.name === "read")) return call("read", { filePath: path.join(root, "counter.txt") });
    return { text: "Native Build fixture finished." };
  }, { runtime: false });
  await writeFile(path.join(f.root, "counter.txt"), "good\n");
  await f.start();
  const session = await f.api("/session", { title: "Metadata qualification" });
  await f.api(`/session/${session.id}/message`, { agent: "build", parts: [{ type: "text", text: "Read metadata qualification counter.txt, then respond once." }] });
  const read = completed(await f.messages(session.id), "read").at(-1);
  assert.ok(readsGood(read.state.output), `fixture must recognize the pinned CLI's actual read output: ${read.state.output}`);
  const metadata = { unrelated: { preserved: true }, cuddly_winner_goal: { runtime_contract: "persistent-worker-v1", state: "paused", reason: "Metadata transport qualification", nested: { findings: [{ c0: "Evidence survives compaction" }] } } };
  const updated = await f.sdk.session.update({ sessionID: session.id, directory: f.root, metadata });
  assert.equal(updated.error, undefined, JSON.stringify(updated.error));
  assert.deepEqual(updated.data.metadata, metadata, "V2 PATCH must return the stored metadata, not silently strip it");
  assert.deepEqual((await f.api(`/session/${session.id}`)).metadata, metadata);
  const summary = await f.sdk.session.summarize({ sessionID: session.id, directory: f.root, providerID: "fixture", modelID: "default", auto: false });
  assert.equal(summary.error, undefined, JSON.stringify(summary.error));
  await f.wait("real compaction summary", async () => (await f.messages(session.id)).find(message => message.info.role === "assistant" && message.info.summary && message.parts.some(part => part.type === "text" && part.text.includes("durable checkpoint"))));
  await f.idle(session.id);
  assert.deepEqual((await f.api(`/session/${session.id}`)).metadata, metadata);
  await f.kill();
  await f.start();
  assert.deepEqual((await f.api(`/session/${session.id}`)).metadata, metadata, "checkpoint must be durable server state after process death");
  assert.ok(f.requests.some(compactionRequest), "compaction must call the real fixture provider");
});

function conversation(input) {
  const messages = input.messages ?? [];
  const calls = new Map(messages.flatMap(message => message.tool_calls ?? []).map(call => [call.id, { name: call.function.name, args: JSON.parse(call.function.arguments) }]));
  const results = messages.filter(message => message.role === "tool").map(message => ({ ...calls.get(message.tool_call_id), output: content(message) }));
  const turnResults = messages.slice(messages.findLastIndex(message => message.role === "user") + 1).filter(message => message.role === "tool").map(message => ({ ...calls.get(message.tool_call_id), output: content(message) }));
  return { messages, results, turnResults, user: messages.filter(message => message.role === "user").map(content).join("\n"), lastUser: content(messages.filter(message => message.role === "user").at(-1) ?? { content: "" }) };
}

const call = (name, args) => ({ call: { name, args } });
function started(results) {
  const result = results.find(result => result.name === "goal_run" && result.args.operation === "start");
  if (!result) return false;
  let value;
  try { value = JSON.parse(result.output); } catch { assert.fail(`start was rejected; no mutation is authorized: ${result.output}`); }
  assert.equal(value.state, "working", `start must establish real mutation authority: ${result.output}`);
  return true;
}
const resumeQuestion = () => ({ questions: [{
  header: "Resume Goal",
  question: "Resume this Goal after the recorded action outcomes are reconciled?",
  options: [
    { label: "Resume Goal", description: "Continue existing authorizedscope" },
    { label: "Keep paused", description: "No resumption" },
  ],
}] });
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
async function bytes(root, file) {
  try { return await readFile(path.join(root, file), "utf8"); } catch (error) { if (error.code === "ENOENT") return; throw error; }
}

async function publish(root, overrides = {}) {
  return publishGoalAgentFile(root, {
    name: "fix-counter", description: "Persistent counter worker", outcome: "Counter implementation verified offline",
    acceptance_criteria: ["counter.txt contains exactly good followed by a newline", "readiness.json contains verified preparation"],
    durable_context: ["counter.txt", "readiness.json"], edit_paths: ["counter.txt", "readiness.json"], bash: false,
    verification_commands: ["Read counter.txt and readiness.json and compare their contents"],
    stop_conditions: ["Filesystem inaccessible", "User cancellation or actual permission rejection", "Unknown action outcome requires inspection before resumption"],
    escalation_triggers: ["Additional edit paths required"], instructions: "Prepare readiness.json, implement counter.txt directly, obtain feedback, repair findings and seek independent final acceptance.",
    ...overrides,
  });
}

function requireTools(input, names) {
  const tools = input.tools?.map(tool => tool.function.name) ?? [];
  for (const name of names) assert.ok(tools.includes(name), `real CLI must expose ${name}; exposed: ${tools.join(", ")}`);
  for (const name of ["goal_cycle", "goal_handoff", "goal_progress"]) assert.ok(!tools.includes(name), `${name} is retired from the persistent worker surface`);
}

test("native predecessor inspection lets a fresh scoped Goal continue without database access", { timeout: 120_000 }, async t => {
  let predecessorID;
  const f = await fixture(t, async (input, { root }) => {
    const { user, results } = conversation(input);
    if (user.includes("INDEPENDENT EVALUATOR")) return evaluator(input, root);
    requireTools(input, ["goal_run", "write"]);
    if (user.includes("PREDECESSOR FIXTURE")) {
      if (!started(results)) return call("goal_run", { operation: "start",
        completion_target: "Verify scoped counter implementation", authorized_actions: "Implement the two declared files; inspect predecessor through the native tool only." });
      if (!results.some(result => result.name === "goal_run" && result.args.operation === "pause")) {
        return call("goal_run", { operation: "pause", reason: "User requested predecessor fixture pause" });
      }
      return { text: "Predecessor is paused." };
    }
    const inspection = results.find(result => result.name === "goal_run" && result.args.predecessor_session_id);
    if (!inspection) return call("goal_run", { operation: "inspect", predecessor_session_id: predecessorID, include_baseline: true });
    const report = JSON.parse(inspection.output);
    assert.equal(report.predecessor.can_continue, true, inspection.output);
    assert.equal(JSON.stringify(report).includes("initial_worktree"), false);
    if (!started(results)) return call("goal_run", { operation: "start",
      completion_target: "Verify scoped counter implementation", authorized_actions: "Implement the two declared files; inspect predecessor through the native tool only." });
    if (await bytes(root, "readiness.json") !== '{"prepared":true}\n') {
      return call("write", { filePath: path.join(root, "readiness.json"), content: '{"prepared":true}\n' });
    }
    if (await bytes(root, "counter.txt") !== "good\n") return call("write", { filePath: path.join(root, "counter.txt"), content: "good\n" });
    if (!results.some(result => result.name === "goal_evaluate")) {
      return call("goal_evaluate", { mode: "final", artifacts: ["counter.txt", "readiness.json"] });
    }
    assert.equal(JSON.parse(results.findLast(result => result.name === "goal_evaluate").output).state, "accepted");
    return { text: "Scoped continuation independently accepted." };
  });
  await publish(f.root);
  await f.start();
  const prior = await f.api("/session", { title: "Paused predecessor fixture" });
  predecessorID = prior.id;
  await f.api(`/session/${prior.id}/message`, { agent: "fix-counter", parts: [{ type: "text", text: "PREDECESSOR FIXTURE: start; pause the Goal without changing files." }] });
  await f.idle(prior.id);
  const before = await f.api(`/session/${prior.id}`);
  assert.equal(before.metadata.cuddly_winner_goal.state, "paused");
  const successor = await f.api("/session", { title: "Scoped successor fixture" });
  await f.api(`/session/${successor.id}/message`, { agent: "fix-counter", parts: [{ type: "text", text: "Continue scoped implementation after inspecting the predecessor through goal_run; do not access database files." }] });
  await waitAccepted(f, successor.id);
  await f.idle(successor.id);
  const messages = await f.messages(successor.id);
  const inspection = outputs(messages, "goal_run").find(result => result.predecessor);
  assert.equal(inspection.predecessor.session_id, prior.id);
  assert.equal(inspection.predecessor.runtime_status, "idle");
  assert.equal(inspection.predecessor.pending_action_count, 0);
  assert.equal(inspection.predecessor.can_continue, true);
  assert.equal(completed(messages, "goal_run")[0].state.input.operation, "inspect", "Reproduce inspection before start, including the harmless include_baseline argument");
  assert.equal(parts(messages).some(part => ["bash", "glob"].includes(part.tool)), false);
  assert.deepEqual((await f.api(`/session/${prior.id}`)).metadata, before.metadata, "Inspection must not reconcile or mutate the predecessor");
  assert.equal(await bytes(f.root, "counter.txt"), "good\n");
});

async function evaluator(input, root, { blocked = false } = {}) {
  const { user, results } = conversation(input);
  assert.match(user, /INDEPENDENT EVALUATOR/);
  assert.match(user, /mode=(feedback|final)/);
  requireTools(input, ["read", "goal_verdict"]);
  const counter = results.findLast(result => result.name === "read" && result.args.filePath === path.join(root, "counter.txt"));
  if (!counter) return call("read", { filePath: path.join(root, "counter.txt") });
  const mode = evaluatorMode(user);
  assert.ok(mode, "the evaluator assignment header must declare its actual mode");
  const final = mode === "final";
  const readiness = results.findLast(result => result.name === "read" && result.args.filePath === path.join(root, "readiness.json"));
  if (final && !readiness) return call("read", { filePath: path.join(root, "readiness.json") });
  if (results.some(result => result.name === "goal_verdict")) return { text: "Independent evidence recorded." };
  if (blocked) return call("goal_verdict", { status: "blocked", reason: "Required external filesystem evidence is inaccessible", checks: {} });
  const passed = readsGood(counter.output) && await bytes(root, "counter.txt") === "good\n";
  return call("goal_verdict", { status: "checked", reason: passed ? "Fresh counter read passes" : "Counter defect requires repair", checks: {
    c0: { passed, evidence: passed ? "Fresh read counter.txt: good followed by newline" : "Fresh read counter.txt: bad; replace bad with good followed by newline", ...(passed ? { resolution: "New independent read of counter.txt shows good instead of the earlier bad content" } : {}) },
    ...(final ? { c1: { passed: readiness.output.includes('"prepared":true'), evidence: "Fresh read readiness.json verifies preparation" } } : {}),
  } });
}

async function waitAccepted(f, id, { expectedErrorIDs = [] } = {}) {
  return f.wait("independent final acceptance", async () => {
    const checkpoint = await f.checkpoint(id);
    if (checkpoint?.state === "accepted") return checkpoint;
    const messages = await f.messages(id);
    const error = parts(messages).find(part => part.type === "tool" && part.state.status === "error" && !expectedErrorIDs.includes(part.id));
    if (error) throw new Error(`Goal tool failed: ${JSON.stringify(error)}`);
    if (["blocked", "paused"].includes(checkpoint?.state)) throw new Error(`Unexpected stop: ${JSON.stringify({ checkpoint, messages })}`);
    return false;
  });
}

async function assertEvaluatorMarker(f, childID, parentID, fingerprint) {
  const response = await f.sdk.session.get({ sessionID: childID, directory: f.root });
  assert.equal(response.error, undefined, JSON.stringify(response.error));
  assert.equal(response.data.parentID, parentID);
  assert.equal(response.data.metadata?.cuddly_winner_goal, undefined, "an evaluator cannot acquire a root execution checkpoint");
  assert.deepEqual(response.data.metadata?.cuddly_winner_evaluator, { parentID, definition_sha256: fingerprint }, "the native SDK must return the permanent read-only evaluator identity");
}

test("Prometheus publishes a fresh scaffold whose worker recovers from errors and repeated impossible claims to independent acceptance", { timeout: 120_000 }, async t => {
  const definition = {
    name: "fix-counter", description: "Persistent counter worker", outcome: "Counter implementation verified offline",
    acceptance_criteria: ["counter.txt contains exactly good followed by a newline", "readiness.json contains verified preparation"],
    durable_context: ["README.md"], edit_paths: ["counter.txt", "readiness.json"], bash: false,
    verification_commands: ["Read counter.txt and readiness.json and compare their contents"],
    stop_conditions: ["Actual user cancellation or permission denial", "Unknown task side effects must be reconciled"],
    escalation_triggers: ["Additional authority required"], instructions: "Implement missing preparation and counter directly; keep repairing and obtain independent final acceptance.",
  };
  const f = await fixture(t, async (input, { root }) => {
    const { user, results, turnResults, messages } = conversation(input);
    if (user.includes("INDEPENDENT EVALUATOR")) return evaluator(input, root, { blocked: await bytes(root, "counter.txt") !== "good\n" });
    if (user.includes("PROMETHEUS PUBLICATION FIXTURE")) {
      requireTools(input, ["publish_goal_agent"]);
      if (!results.some(result => result.name === "publish_goal_agent")) return call("publish_goal_agent", definition);
      return { text: "Scaffold published; restart and select fix-counter." };
    }
    requireTools(input, ["goal_run", "goal_evaluate", "write"]);
    if (!started(results)) return call("goal_run", { operation: "start", completion_target: definition.outcome,
      authorized_actions: "Implement the exact two files and verify offline. Keep looping under existing authority." });
    if (await bytes(root, "readiness.json") !== '{"prepared":true}\n') return call("write", { filePath: path.join(root, "readiness.json"), content: '{"prepared":true}\n' });
    if (await bytes(root, "counter.txt") === undefined) return call("write", { filePath: path.join(root, "counter.txt"), content: "bad\n" });
    if (!results.some(result => result.name === "goal_evaluate")) return call("goal_evaluate", { mode: "final", artifacts: ["counter.txt", "readiness.json"] });
    const continuations = messages.filter(message => message.role === "user" && content(message).startsWith("Continue the admitted Goal in this same worker conversation.")).length;
    if (continuations < 8) {
      if (!turnResults.some(result => result.name === "goal_run" && result.args.operation === "pause")) {
        return call("goal_run", { operation: "pause", reason: "The outcome is impossible and the evaluator is blocked. User rescue required." });
      }
      if (!results.some(result => result.name === "goal_run" && result.args.operation === "resume")) {
        return call("goal_run", { operation: "resume", reconciled: true });
      }
      if (!results.some(result => result.name === "question")) return call("question", resumeQuestion());
      return { text: "This is impossible. I cannot continue. The Goal is blocked." };
    }
    if (await bytes(root, "counter.txt") !== "good\n") return call("write", { filePath: path.join(root, "counter.txt"), content: "good\n" });
    if (JSON.parse(results.findLast(result => result.name === "goal_evaluate").output).state !== "accepted") {
      return call("goal_evaluate", { mode: "final", artifacts: ["counter.txt", "readiness.json"] });
    }
    return { text: "Repaired and independently accepted." };
  }, { prometheus: true });
  await writeFile(path.join(f.root, "README.md"), "Existing task context\n");
  await f.start();
  const planner = await f.api("/session", { title: "Fresh Prometheus publication" });
  await f.api(`/session/${planner.id}/message`, { agent: "prometheus", parts: [{ type: "text", text: "PROMETHEUS PUBLICATION FIXTURE: publish a persistent counter implementation Goal; do not implement it." }] });
  const publication = completed(await f.messages(planner.id), "publish_goal_agent");
  assert.equal(publication.length, 1);
  assert.equal(completed(await f.messages(planner.id), "write").length, 0);
  assert.equal(await bytes(f.root, "counter.txt"), undefined);
  const scaffold = await bytes(f.root, ".opencode/agents/generated/fix-counter.md");
  assert.match(scaffold, /Keep looping even when progress is slow or the outcome appears impossible/);
  assert.equal(JSON.parse(publication[0].state.output).sha256, sha256(scaffold));
  await f.kill(); await f.start();
  const worker = await f.api("/session", { title: "Repeatedly mistaken cheap worker fixture" });
  await f.api(`/session/${worker.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: "Execute the published Goal and keep looping until independent acceptance. Do not ask for ordinary recovery." }] });
  const accepted = await f.wait("mistaken worker recovers to final acceptance", async () => {
    const run = await f.checkpoint(worker.id); return run?.state === "accepted" && run;
  });
  await f.idle(worker.id);
  const history = await f.messages(worker.id);
  const runParts = completed(history, "goal_run");
  assert.equal(runParts.filter(part => part.state.input.operation === "start").length, 1);
  const pauses = runParts.filter(part => part.state.input.operation === "pause");
  assert.equal(pauses.length, 8);
  assert.ok(pauses.every(part => JSON.parse(part.state.output).state === "working" && JSON.parse(part.state.output).pause_applied === false));
  const mistakes = parts(history).filter(part => part.type === "tool" && part.state.status === "error");
  assert.equal(mistakes.length, 2);
  assert.equal(mistakes[0].tool, "goal_run");
  assert.equal(mistakes[0].state.input.operation, "resume");
  assert.match(mistakes[0].state.error, /State: working.*Nothing needs resuming/);
  assert.equal(mistakes[1].tool, "question");
  assert.match(mistakes[1].state.error, /working; no Resume Goal confirmation/);
  assert.deepEqual(await f.api("/question"), [], "Routine recovery never waits for a human popup answer");
  const checks = outputs(history, "goal_evaluate");
  assert.equal(checks[0].state, "working");
  assert.equal(checks[0].validation.status, "blocked");
  assert.equal(checks.at(-1).state, "accepted");
  assert.equal((await f.api(`/session/${worker.id}/children`)).length, 2, "Only independent evaluators are children; repairs remain in the root");
  assert.equal(accepted.definition_sha256, sha256(scaffold));
  assert.equal(accepted.accepted_candidate["counter.txt"].sha256, sha256("good\n"));
  assert.equal(await bytes(f.root, "README.md"), "Existing task context\n");
  assert.equal(history.filter(message => message.info.role === "user" && !message.parts.some(part => part.synthetic)).length, 1, "No human rescues the worker");
});

test("ordinary Prometheus prompts publish repairable work without persistence coaching", { timeout: 120_000 }, async t => {
  for (const kind of ["missing implementation", "stale instructions", "repairable prerequisite"]) {
    const f = await fixture(t, async (input, { root }) => {
      const { user, results, lastUser } = conversation(input);
      if (user.includes("INDEPENDENT EVALUATOR")) return evaluator(input, root);
      if (user.includes("Publish a Goal for README.md")) {
        if (!results.some(result => result.name === "read")) return call("read", { filePath: path.join(root, "README.md") });
        if (kind === "stale instructions" && !results.some(result => result.name === "read" && result.args.filePath.endsWith("HISTORY.md"))) return call("read", { filePath: path.join(root, "HISTORY.md") });
        if (!results.some(result => result.name === "publish_goal_agent")) return call("publish_goal_agent", {
          name: "fix-counter", description: "Implement and verify counter", outcome: "Counter implementation verified offline",
          acceptance_criteria: ["counter.txt contains good followed by a newline", "readiness.json records preparation"],
          durable_context: ["README.md", ...(kind === "stale instructions" ? ["HISTORY.md"] : [])], edit_paths: ["counter.txt", "readiness.json"], bash: false,
          verification_commands: ["Read counter.txt and readiness.json"], stop_conditions: ["Actual user stop or denied permission"],
          escalation_triggers: ["New authority required"], instructions: `Current gap: ${kind}. First implement preparation and counter, then inspect actual files. README.md supersedes obsolete history.`,
        });
        return { text: "Published fix-counter. Restart and select it." };
      }
      if (!started(results)) return call("goal_run", { operation: "start", completion_target: "Implement and verify counter",
        authorized_actions: "Edit only counter.txt/readiness.json; local inspection." });
      if (await bytes(root, "readiness.json") !== '{"prepared":true}\n') return call("write", { filePath: path.join(root, "readiness.json"), content: '{"prepared":true}\n' });
      if (!results.some(result => result.name === "goal_evaluate")) return call("goal_evaluate", { mode: "final", artifacts: ["counter.txt", "readiness.json"] });
      if (await bytes(root, "counter.txt") !== "good\n") {
        if (lastUser.startsWith("Continue the admitted Goal")) return call("write", { filePath: path.join(root, "counter.txt"), content: "good\n" });
        return { text: "The existing check failed. Implementation remains missing." };
      }
      if (JSON.parse(results.findLast(result => result.name === "goal_evaluate").output).state !== "accepted") return call("goal_evaluate", { mode: "final", artifacts: ["counter.txt", "readiness.json"] });
      return { text: "Independently accepted." };
    }, { prometheus: true });
    await writeFile(path.join(f.root, "README.md"), `Current request: implement the counter and required preparation. Gap: ${kind}. Any historical preparation-only stop is obsolete.\n`);
    if (kind !== "missing implementation") await writeFile(path.join(f.root, "counter.txt"), "bad\n");
    if (kind !== "repairable prerequisite") await writeFile(path.join(f.root, "readiness.json"), '{"prepared":true}\n');
    if (kind === "stale instructions") await writeFile(path.join(f.root, "HISTORY.md"), "Historical: preparation only; stop after three attempts.\n");
    await f.start();
    const planner = await f.api("/session", { title: `Ordinary prompt: ${kind}` });
    await f.api(`/session/${planner.id}/message`, { agent: "prometheus", parts: [{ type: "text", text: "Publish a Goal for README.md. You may edit counter.txt and readiness.json." }] });
    assert.equal(completed(await f.messages(planner.id), "publish_goal_agent").length, 1);
    assert.equal(await bytes(f.root, "counter.txt"), kind === "missing implementation" ? undefined : "bad\n");
    await f.kill(); await f.start();
    const worker = await f.api("/session", { title: "Ordinary execution request" });
    await f.api(`/session/${worker.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: "Implement the Goal." }] });
    await waitAccepted(f, worker.id);
    await f.idle(worker.id);
    const history = await f.messages(worker.id);
    assert.equal(outputs(history, "goal_evaluate")[0].state, "working");
    assert.ok(history.some(message => message.parts.some(part => part.synthetic && part.text?.startsWith("Continue the admitted Goal"))));
    assert.equal(history.filter(message => message.info.role === "user" && !message.parts.some(part => part.synthetic)).length, 1);
    assert.equal(completed(history, "write").filter(part => part.state.input.filePath.endsWith("readiness.json")).length, kind === "repairable prerequisite" ? 1 : 0);
    if (kind === "stale instructions") assert.equal(await bytes(f.root, "HISTORY.md"), "Historical: preparation only; stop after three attempts.\n");
  }
});

test("qualification turn receipts survive restart and reject dispatch beyond the explicit test ceiling", { timeout: 120_000 }, async t => {
  const privateRoot = await mkdtemp(path.join(os.tmpdir(), "qualification-control-"));
  const receipts = path.join(privateRoot, "turns.jsonl");
  await writeFile(receipts, "", { mode: 0o600 });
  try {
    const f = await fixture(t, async (input, { root }) => {
      const { results } = conversation(input);
      if (!results.length) return call("read", { filePath: path.join(root, "counter.txt") });
      return { text: "One native model turn with its actual tool result." };
    }, { extraPlugin: qualificationGuard(receipts, 2, Date.now() + 120_000) });
    await writeFile(path.join(f.root, "counter.txt"), "good\n");
    await f.start();
    const first = await f.api("/session", { title: "Qualification budget: two turns" });
    await f.api(`/session/${first.id}/message`, { agent: "build", parts: [{ type: "text", text: "Read the counter once." }] });
    assert.equal(f.requests.length, 2);
    assert.equal((await readFile(receipts, "utf8")).trim().split("\n").length, 2);
    await f.kill(); await f.start();
    const second = await f.api("/session", { title: "Budget remains consumed after restart" });
    await f.api(`/session/${second.id}/prompt_async`, { agent: "build", parts: [{ type: "text", text: "Read the counter once." }] });
    await f.wait("native budget rejection before provider dispatch", async () => (await f.messages(second.id)).some(message => message.info.error));
    assert.equal(f.requests.length, 2);
    assert.equal((await readFile(receipts, "utf8")).trim().split("\n").length, 2);
    await f.kill();
  } finally { t.after(() => rm(privateRoot, { recursive: true, force: true })); }
});

test("real-model first-publication qualification from ordinary prompts", {
  skip: process.env.OPENCODE_LIVE_PUBLICATION !== "1" && "opt in with a model and explicit test-only turn/time ceilings",
}, async t => {
  const settings = qualificationSettings(process.env);
  const evidence = process.env.OPENCODE_PUBLICATION_EVIDENCE ?? await mkdtemp("/tmp/opencode/goal-publication-qualification-");
  let previous;
  try { previous = JSON.parse(await readFile(path.join(evidence, "summary.json"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (process.env.OPENCODE_PUBLICATION_EVIDENCE) assert.ok(previous, "Reuse only a qualification evidence directory with its original recorded authority");
  if (previous) {
    assert.equal(previous.model, settings.model);
    assert.equal(previous.max_turns, settings.maxTurns);
    assert.equal(previous.timeout_ms, settings.timeoutMs);
  }
  const privateRoot = path.join(evidence, "private");
  await mkdir(privateRoot, { mode: 0o700 });
  const receipts = path.join(evidence, "turns.jsonl");
  try { await writeFile(receipts, "", { mode: 0o600, flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const startedAt = previous?.started_at ?? Date.now(), deadline = startedAt + settings.timeoutMs;
  await writeFile(path.join(evidence, "summary.json"), JSON.stringify({ passed: false, model: settings.model,
    max_turns: settings.maxTurns, timeout_ms: settings.timeoutMs, started_at: startedAt, previous }), { mode: 0o600 });
  const providerID = settings.model.split("/")[0];
  const sourceConfig = process.env.OPENCODE_PUBLICATION_CONFIG ?? path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "opencode", "opencode.json");
  const sourceAuth = path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local/share"), "opencode", "auth.json");
  const results = [], fixtures = [];
  let passed = false;
  try {
    const errors = [];
    const config = parseJsonc(await readFile(sourceConfig, "utf8"), errors);
    assert.equal(errors.length, 0, "Provider configuration must be valid JSONC; no transport details are printed");
    const auth = JSON.parse(await readFile(sourceAuth, "utf8"));
    const live = { ...settings, privateRoot, receipts, deadline,
      provider: config.provider?.[providerID] ? { [providerID]: config.provider[providerID] } : {},
      auth: auth[providerID] ? { [providerID]: auth[providerID] } : {},
    };
    for (const testCase of publicationCases) {
      assert.ok(Date.now() < deadline, "Explicit qualification time ceiling reached");
      const f = await fixture(t, () => assert.fail("Real qualification must not use scripted model responses"), { prometheus: true, live });
      fixtures.push(f);
      await writeFile(path.join(f.root, "README.md"), caseReadme(testCase));
      await writeFile(path.join(f.root, "HISTORY.md"), "Historical preparation-only instruction: stop after three attempts. Superseded by current README.md.\n");
      await writeFile(path.join(f.root, "verify.test.mjs"), caseVerifier(testCase));
      if (testCase.initial !== undefined) await writeFile(path.join(f.root, "worker.js"), testCase.initial);
      const protectedFiles = await Promise.all(["README.md", "HISTORY.md", "verify.test.mjs"].map(file => bytes(f.root, file)));
      const model = { providerID, modelID: settings.model.slice(providerID.length + 1) };
      await f.start();
      const planner = await f.api("/session", { title: `First publication: ${testCase.name}` });
      let worker;
      const authorizeChecks = async () => {
        const turns = (await readFile(receipts, "utf8")).trim().split("\n").filter(Boolean).length;
        assert.ok(turns <= settings.maxTurns && Date.now() < deadline, "Explicit qualification ceiling reached; retain charges and stop this test run");
        const owned = new Set([planner.id, ...(worker ? [worker.id] : [])]);
        for (const id of [...owned]) for (const child of await f.api(`/session/${id}/children`)) owned.add(child.id);
        for (const request of await f.api("/permission")) if (owned.has(request.sessionID)) {
          assert.equal(request.permission, "bash", "A qualification cannot expand filesystem or network authority");
          const command = qualificationPermissionCommand(request, await f.messages(request.sessionID));
          const safe = typeof command === "string" && !/api.?key|authorization|bearer|cookie|token|password/i.test(command) ? command : "(unavailable or sensitive)";
          assert.ok(allowedQualificationCommand(command, f.root), `Only the bound existing read-only Node check is approved. Command: ${safe}; bound tool: ${JSON.stringify(request.tool)}`);
          await f.api(`/permission/${request.id}/reply`, { reply: "once" });
        }
        assert.equal((await f.api("/question")).filter(request => owned.has(request.sessionID)).length, 0,
          "Ordinary first publication/recovery must not require a human rescue");
      };
      await f.api(`/session/${planner.id}/prompt_async`, { agent: "prometheus", model, parts: [{ type: "text", text: publicationPrompt(testCase) }] });
      const publication = await f.wait(`${testCase.name}: first publication`, async () => {
        await authorizeChecks();
        const history = await f.messages(planner.id);
        const result = completed(history, "publish_goal_agent").at(-1);
        if (result) return result;
        if (history.at(-1)?.info.error) throw new Error("Planner model/access failed; inspect its native session without retrying through another workflow");
        const activity = (await f.api("/session/status"))[planner.id];
        if (!activity && history.at(-1)?.info.finish === "stop") throw new Error("Planner returned without publishing a runnable Goal");
        return false;
      });
      const published = JSON.parse(publication.state.output);
      assert.ok(!publication.state.input.validator_model || publication.state.input.validator_model === settings.model, "An evaluator override must not change the explicitly authorized model");
      await writeFile(path.join(evidence, `${testCase.name}-goal.md`), await bytes(f.root, published.path), { mode: 0o600 });
      const allowed = ["worker.js", ...(testCase.name === "repairable-prerequisite" ? ["preparation.json"] : [])];
      assert.ok(publication.state.input.edit_paths.every(file => allowed.includes(file)), "Publication must stay within the ordinary prompt's exact authority");
      assert.equal(await bytes(f.root, "worker.js"), testCase.initial, "Planning cannot implement product");
      assert.equal(completed(await f.messages(planner.id), "publish_goal_agent").length, 1, "Exactly one successful first publication");
      await f.kill(); await f.start();
      worker = await f.api("/session", { title: `Execute ordinary request: ${testCase.name}` });
      await f.api(`/session/${worker.id}/prompt_async`, { agent: published.name, model, parts: [{ type: "text", text: "Implement the Goal." }] });
      const terminal = await f.wait(`${testCase.name}: independent outcome or sustained impossible loop`, async () => {
        await authorizeChecks();
        const run = await f.checkpoint(worker.id);
        if (run?.state === "paused" && (await readFile(receipts, "utf8")).trim().split("\n").filter(Boolean).length >= settings.maxTurns) {
          throw new Error("Explicit qualification turn ceiling reached; this is test-budget exhaustion, not a production-loop failure");
        }
        assert.notEqual(run?.state, "paused", "Recoverable task difficulty must not require user resumption");
        if (testCase.impossible) {
          assert.notEqual(run?.state, "accepted", "Contradictory criteria cannot be accepted");
          const history = await f.messages(worker.id);
          const continued = history.filter(message => message.parts.some(part => part.synthetic && part.text?.startsWith("Continue the admitted Goal"))).length;
          const failed = outputs(history, "goal_evaluate").filter(result => result.state === "working").length;
          return run?.state === "working" && continued >= 2 && failed >= 2 && run;
        }
        return run?.state === "accepted" && run;
      });
      if (testCase.impossible) {
        await f.api(`/session/${worker.id}/abort`, {});
        await f.wait("actual user-style cancellation", async () => (await f.checkpoint(worker.id))?.state === "paused");
      }
      await f.idle(worker.id);
      const history = await f.messages(worker.id);
      assert.equal(completed(history, "goal_run").filter(part => part.state.input.operation === "start").length, 1);
      assert.equal(history.filter(message => message.info.role === "user" && !message.parts.some(part => part.synthetic)).length, 1, "No follow-up coaching or rescue");
      assert.deepEqual(await Promise.all(["README.md", "HISTORY.md", "verify.test.mjs"].map(file => bytes(f.root, file))), protectedFiles);
      const { execFile } = await import("node:child_process");
      const checkEnv = { ...process.env }; delete checkEnv.NODE_TEST_CONTEXT;
      const checked = await new Promise(resolve => execFile(process.execPath, ["--test", "verify.test.mjs"], { cwd: f.root, env: checkEnv }, error => resolve(!error)));
      assert.equal(checked, !testCase.impossible, "Native acceptance must agree with independently executed current product bytes");
      if (!testCase.impossible) assert.equal(terminal.accepted_candidate["worker.js"].sha256, sha256(await bytes(f.root, "worker.js")));
      const children = await f.api(`/session/${worker.id}/children`);
      assert.ok(children.length > 0);
      for (const child of children) await assertEvaluatorMarker(f, child.id, worker.id, terminal.definition_sha256);
      const result = { case: testCase.name, planner: planner.id, worker: worker.id, outcome: terminal.state,
        continuations: history.filter(message => message.parts.some(part => part.synthetic)).length,
        evaluations: children.length, independently_checked: true };
      results.push(result); t.diagnostic(JSON.stringify(result));
      for (const file of ["worker.js", "README.md", "HISTORY.md", "verify.test.mjs", ...(testCase.name === "repairable-prerequisite" ? ["preparation.json"] : [])]) {
        await writeFile(path.join(evidence, `${testCase.name}-${file}`), await bytes(f.root, file), { mode: 0o600 });
      }
      await f.kill();
    }
    passed = true;
  } finally {
    for (const f of fixtures) for (const session of await f.api("/session").catch(() => [])) {
      if (session.directory === f.root) await f.api(`/session/${session.id}/abort`, {}).catch(() => {});
    }
    await writeFile(path.join(evidence, "summary.json"), JSON.stringify({ passed, model: settings.model,
      max_turns: settings.maxTurns, timeout_ms: settings.timeoutMs, started_at: startedAt,
      elapsed_ms: Date.now() - startedAt, model_turn_intents: (await readFile(receipts, "utf8")).trim().split("\n").filter(Boolean).length, results, previous }, null, 2), { mode: 0o600 });
    t.diagnostic(`Qualification evidence: ${evidence}`);
    // Registered after fixture cleanup: private credentials are erased only once
    // all isolated servers have stopped. Public receipts remain for inspection.
    t.after(() => rm(privateRoot, { recursive: true, force: true }));
  }
});

test("a genuinely impossible Goal keeps looping until actual user cancellation", { timeout: 120_000 }, async t => {
  let waiting = false;
  const f = await fixture(t, async (input, { root, res }) => {
    const { user, results, turnResults, messages } = conversation(input);
    if (user.includes("INDEPENDENT EVALUATOR")) {
      if (!results.some(result => result.name === "read")) return call("read", { filePath: path.join(root, "counter.txt") });
      if (!results.some(result => result.name === "goal_verdict")) return call("goal_verdict", { status: "checked", reason: "Contradictory fixed criteria cannot both pass", checks: {
        c0: { passed: false, evidence: "Fresh counter.txt contains bad, not good" }, c1: { passed: true, evidence: "Fresh counter.txt contains exactly bad followed by newline" },
      } });
      return { text: "Independent failure recorded." };
    }
    if (!started(results)) return call("goal_run", { operation: "start", completion_target: "Satisfy both contradictory fixed counter criteria",
      authorized_actions: "Inspect the counter, diagnose failures and request independent checks. Do not change the fixed criteria." });
    const continuations = messages.filter(message => message.role === "user" && content(message).startsWith("Continue the admitted Goal in this same worker conversation.")).length;
    if (continuations >= 12) { waiting = true; await new Promise(resolve => res.on("close", resolve)); return; }
    if (!turnResults.some(result => result.name === "goal_evaluate")) return call("goal_evaluate", { mode: "final", artifacts: ["counter.txt"] });
    if (!turnResults.some(result => result.name === "goal_run" && result.args.operation === "pause")) return call("goal_run", { operation: "pause", reason: "This Goal is logically impossible." });
    return { text: "Impossible outcome; I am giving up." };
  });
  await publish(f.root, { acceptance_criteria: ["counter.txt contains exactly good followed by a newline", "counter.txt contains exactly bad followed by a newline"] });
  await writeFile(path.join(f.root, "counter.txt"), "bad\n");
  await f.start();
  const worker = await f.api("/session", { title: "Impossible fixed outcome" });
  await f.api(`/session/${worker.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: "Keep exploring and independently checking this Goal even if the outcome is impossible." }] });
  await f.wait("impossible worker remains live after repeated failures", () => waiting);
  const working = await f.checkpoint(worker.id);
  assert.equal(working.state, "working");
  assert.ok(working.findings.c0.length);
  assert.equal(working.accepted_candidate, undefined);
  const history = await f.messages(worker.id);
  assert.equal(completed(history, "goal_evaluate").length, 12);
  assert.equal(completed(history, "goal_run").filter(part => part.state.input.operation === "pause").length, 12);
  assert.equal(history.filter(message => message.info.role === "user" && !message.parts.some(part => part.synthetic)).length, 1);
  await f.api(`/session/${worker.id}/abort`, {});
  const paused = await f.wait("actual cancellation durably stops the impossible worker", async () => {
    const run = await f.checkpoint(worker.id); return run?.state === "paused" && run;
  });
  assert.match(paused.reason, /cancellation/);
  await f.idle(worker.id);
  const stopped = await f.messages(worker.id);
  await delay(200);
  assert.deepEqual(await f.messages(worker.id), stopped);
  assert.equal(await bytes(f.root, "counter.txt"), "bad\n");
});

test("native Question tool records structured Resume Goal and Keep paused answers without adding user chat messages", { timeout: 120_000 }, async t => {
  const f = await fixture(t, async input => {
    const { user, results } = conversation(input);
    if (!user.includes("Qualify native question receipt")) return { text: "Native question fixture." };
    requireTools(input, ["question"]);
    if (!results.some(result => result.name === "question")) return call("question", resumeQuestion());
    return { text: "Native question receipt recorded." };
  }, { runtime: false });
  await f.start();
  for (const choice of ["Resume Goal", "Keep paused"]) {
    const session = await f.api("/session", { title: `Question receipt: ${choice}` });
    await f.api(`/session/${session.id}/prompt_async`, { agent: "build", parts: [{ type: "text", text: "Qualify native question receipt." }] });
    const request = await f.wait("real native Question request", async () => (await f.api("/question")).find(request => request.sessionID === session.id));
    assert.deepEqual(request.questions, resumeQuestion().questions);
    const before = await f.messages(session.id);
    await f.api(`/question/${request.id}/reply`, { answers: [[choice]] });
    const receipt = await f.wait("completed native Question receipt", async () => completed(await f.messages(session.id), "question").at(-1));
    t.diagnostic(JSON.stringify({ choice, input: receipt.state.input, metadata: receipt.state.metadata, time: receipt.state.time }));
    assert.deepEqual(receipt.state.input.questions, resumeQuestion().questions);
    assert.deepEqual(receipt.state.metadata.answers, [[choice]], "classification must use native answer metadata, not the prose output");
    assert.ok(Number.isFinite(receipt.state.time.end));
    assert.ok(receipt.state.time.end >= receipt.state.time.start);
    await f.idle(session.id);
    const history = await f.messages(session.id);
    assert.deepEqual(history.filter(message => message.info.role === "user").map(message => message.info.id), before.filter(message => message.info.role === "user").map(message => message.info.id), "Question replies must not manufacture a fresh user chat identity");
    assert.equal(completed(history, "question").length, 1);
    assert.equal(await f.checkpoint(session.id), undefined);
  }
});

for (const [choice, compact] of [["Resume Goal", false], ["Keep paused", false], ["Resume Goal", true], ["Keep paused", true]]) {
  test(`paused Goal native Question handback: ${choice}${compact ? " after real API compaction" : ""}`, { timeout: 120_000 }, async t => {
    let session;
    const answerGate = gate(), resumeGate = gate();
    t.after(() => { answerGate.release(); resumeGate.release(); });
    let answerWaiting = false, resumeWaiting = false;
    const f = await fixture(t, async (input, { root }) => {
      const { user, results, turnResults } = conversation(input);
      if (compactionRequest(input)) {
        const receipt = completed(await f.messages(session.id), "question").at(-1);
        assert.ok(receipt, "native compaction must follow a real completed Question receipt");
        assert.equal((await f.checkpoint(session.id)).state, "paused");
        return { text: `## Objective\n- NATIVE_QUESTION_COMPACTION_SUMMARY: complete the counter implementation verified offline.\n## Important Details\n- QUESTION_ROOT_PRIVATE remains in the root conversation.\n- Preserve the admitted Goal, its original baseline and its pause boundary.\n## Work State\n### Completed\n- Read defective counter.txt and prepared readiness.json once.\n- Native Question header Resume Goal received structured answer metadata: ${JSON.stringify(receipt.state.metadata.answers)}.\n### Active\n- The Goal is still paused; the summary cannot authorize work.\n### Blocked\n- Explicit goal_run resume with reconciled action outcomes is required; Keep paused is not authorization.\n## Next Move\n1. Inspect the original native Question receipt and current counter bytes.\n2. Attempt reconciled resume using the native receipt; repair and independently evaluate only if authorized.\n## Relevant Files\n- counter.txt: contains bad and requires repair if resumed.\n- readiness.json: completed preparation to preserve.` };
      }
      if (evaluatorMode(user)) return evaluator(input, root);
      const compacted = (input.messages ?? []).some(message => content(message).includes("NATIVE_QUESTION_COMPACTION_SUMMARY"));
      if (!compacted && !user.includes("Execute native Question handback fixture")) return { text: "Native Question handback fixture." };
      requireTools(input, ["goal_run", "goal_evaluate", "read", "write", "question"]);
      const currentResults = compacted ? turnResults : results;
      if (!compacted) {
        if (!started(results)) return call("goal_run", { operation: "start", completion_target: "Counter implementation verified offline", authorized_actions: "Read and write only counter.txt/readiness.json; reconcile actual preparation and ask the user before continuing." });
        if (!results.some(result => result.name === "read" && result.args.filePath.endsWith("counter.txt"))) return call("read", { filePath: path.join(root, "counter.txt") });
        if (!(await bytes(root, "readiness.json"))) return call("write", { filePath: path.join(root, "readiness.json"), content: '{"prepared":true}\n' });
        if (!results.some(result => result.name === "goal_run" && result.args.operation === "pause")) return call("goal_run", { operation: "pause", reason: "Preparation is reconciled; explicit user handback is required before further task work." });
        if (!results.some(result => result.name === "question")) return call("question", resumeQuestion());
      }
      const receipt = completed(await f.messages(session.id), "question").at(-1);
      assert.ok(receipt, "only a completed native Question receipt can classify the user's choice");
      assert.deepEqual(receipt.state.input.questions, resumeQuestion().questions);
      const answers = receipt.state.metadata.answers;
      if (compact && !compacted) {
        answerWaiting = true;
        await answerGate.promise;
        return { text: "NATIVE_QUESTION_PARTIAL: the native answer is recorded, but the Goal is still paused and no resume has been attempted." };
      }
      if (compacted && !currentResults.some(result => result.name === "read" && result.args.filePath.endsWith("counter.txt"))) return call("read", { filePath: path.join(root, "counter.txt") });
      if (compacted && !currentResults.some(result => result.name === "goal_run" && result.args.operation === "resume")) {
        resumeWaiting = true;
        await resumeGate.promise;
      }
      if (JSON.stringify(answers) === JSON.stringify([["Keep paused"]])) {
        if (!currentResults.some(result => result.name === "goal_run" && result.args.operation === "resume")) return call("goal_run", { operation: "resume", reason: "Attempted resumption must be rejected because the native user answer was Keep paused.", reconciled: true });
        return { text: "User chose Keep paused; no task action or evaluation is authorized." };
      }
      assert.deepEqual(answers, [["Resume Goal"]]);
      const resumed = currentResults.find(result => result.name === "goal_run" && result.args.operation === "resume");
      if (!resumed) return call("goal_run", { operation: "resume", reason: "Completed native Resume Goal answer confirms continuing the existing scope; preparation action outcomes are reconciled.", reconciled: true });
      let value;
      try { value = JSON.parse(resumed.output); } catch { return { text: "Native confirmation was rejected; the Goal remains paused." }; }
      assert.equal(value.state, "working");
      if (await bytes(root, "counter.txt") === "bad\n") return call("write", { filePath: path.join(root, "counter.txt"), content: "good\n" });
      if (!currentResults.some(result => result.name === "goal_evaluate")) return call("goal_evaluate", { mode: "final", artifacts: ["counter.txt", "readiness.json"] });
      return { text: "Native Question handback reached independent final acceptance." };
    });
    await publish(f.root);
    await writeFile(path.join(f.root, "counter.txt"), "bad\n");
    await f.start();
    session = await f.api("/session", { title: `Paused Goal Question: ${choice}` });
    await f.api(`/session/${session.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: "Execute native Question handback fixture; pause the Goal after preparation. QUESTION_ROOT_PRIVATE stays in this root conversation." }] });
    const request = await f.wait("paused worker's actual native Question request", async () => (await f.api("/question")).find(request => request.sessionID === session.id));
    assert.deepEqual(request.questions, resumeQuestion().questions);
    const paused = await f.checkpoint(session.id);
    assert.equal(paused.state, "paused");
    const pauseTime = paused.paused_at;
    assert.ok(Number.isFinite(pauseTime), "freshness requires a durable numeric pause boundary");
    const before = await f.messages(session.id);
    const userIDs = before.filter(message => message.info.role === "user").map(message => message.info.id);
    assert.equal(userIDs.length, 1);
    assert.equal(paused.paused_after_user, userIDs[0]);
    assert.equal(await bytes(f.root, "counter.txt"), "bad\n");
    assert.equal(await bytes(f.root, "readiness.json"), '{"prepared":true}\n');
    await f.api(`/question/${request.id}/reply`, { answers: [[choice]] });
    const receipt = await f.wait("paused worker's completed native Question receipt", async () => completed(await f.messages(session.id), "question").at(-1));
    assert.deepEqual(receipt.state.input.questions, resumeQuestion().questions);
    assert.deepEqual(receipt.state.metadata.answers, [[choice]]);
    assert.ok(Number.isFinite(receipt.state.time.end));
    assert.ok(receipt.state.time.start >= pauseTime);
    assert.ok(receipt.state.time.end > pauseTime, "the native answer receipt must be strictly newer than this pause");
    assert.deepEqual((await f.messages(session.id)).filter(message => message.info.role === "user").map(message => message.info.id), userIDs, "Question handback must be a native receipt, not a fresh user chat message");
    if (compact) {
      await f.wait("native answer held before any resume attempt", () => answerWaiting);
      assert.deepEqual(await f.checkpoint(session.id), paused);
      const summaryRequest = f.sdk.session.summarize({ sessionID: session.id, directory: f.root, providerID: "fixture", modelID: "default", auto: true }, { signal: AbortSignal.timeout(30_000) });
      summaryRequest.catch(() => {});
      await f.wait("real automatic compaction queued after the Question answer", async () => (await f.messages(session.id)).some(message => message.parts.some(part => part.type === "compaction" && part.auto === true)));
      assert.equal(f.requests.filter(compactionRequest).length, 0);
      answerGate.release();
      await f.wait("native core finishes the answered Question in compacted context", () => resumeWaiting);
      assert.deepEqual(await f.checkpoint(session.id), paused, "compaction and fresh-answer processing must not resume the Goal or change its pause boundary");
      const compactedHistory = await f.messages(session.id);
      const preservedReceipt = completed(compactedHistory, "question").at(-1);
      assert.equal(preservedReceipt.id, receipt.id);
      assert.deepEqual(preservedReceipt.state.metadata, receipt.state.metadata);
      assert.deepEqual(preservedReceipt.state.time, receipt.state.time);
      const summaryIndex = compactedHistory.findIndex(message => message.info.summary && message.parts.some(part => part.type === "text" && part.text.includes("NATIVE_QUESTION_COMPACTION_SUMMARY")));
      assert.ok(summaryIndex >= 0, "native core must persist an actual compaction summary after the answer");
      const continuation = compactedHistory.slice(summaryIndex + 1).filter(message => message.info.role === "user");
      assert.equal(continuation.length, 1, "paused native core may finish the fresh answer exactly once");
      assert.ok(continuation[0].parts.some(part => part.type === "text" && part.synthetic));
      assert.equal(f.requests.filter(compactionRequest).length, 1);
      assert.equal(parts(compactedHistory).filter(part => part.tool === "goal_run" && part.state.input.operation === "resume").length, 0);
      assert.equal(completed(compactedHistory, "write").length, 1);
      assert.equal((await f.api(`/session/${session.id}/children`)).length, 0);
      assert.equal(await bytes(f.root, "counter.txt"), "bad\n");
      resumeGate.release();
      const summary = await summaryRequest;
      assert.equal(summary.error, undefined, JSON.stringify(summary.error));
    }
    const resumed = await f.wait("native confirmation's actual resume tool result", async () => parts(await f.messages(session.id)).find(part => part.tool === "goal_run" && part.state.input.operation === "resume" && ["completed", "error"].includes(part.state.status)));
    if (choice === "Keep paused") {
      assert.equal(resumed.state.status, "error", "a completed Keep paused answer cannot authorize resume even when the worker claims reconciliation");
      assert.match(resumed.state.error, /resum|confirm|paused/i);
      await f.idle(session.id);
      const history = await f.messages(session.id);
      assert.deepEqual(await f.checkpoint(session.id), paused, "Keep paused must retain original authority, reason and pause boundary");
      assert.equal(parts(history).filter(part => part.tool === "goal_run" && part.state.input.operation === "resume").length, 1);
      assert.equal(completed(history, "goal_run").filter(part => part.state.input.operation === "resume").length, 0);
      assert.equal(parts(history).filter(part => part.tool === "goal_evaluate").length, 0);
      assert.equal(completed(history, "write").length, 1, "only preparation before pause was written");
      assert.equal((await f.api(`/session/${session.id}/children`)).length, 0);
      assert.deepEqual(history.filter(message => message.info.role === "user" && message.parts.some(part => part.type === "text" && !part.synthetic)).map(message => message.info.id), userIDs);
      assert.equal(parts(history).filter(part => part.type === "text" && part.synthetic && part.text.startsWith("Continue the admitted Goal in this same worker conversation.")).length, 0, "Keep paused cannot schedule Goal-owned nudges even after native compaction");
      assert.equal(await bytes(f.root, "counter.txt"), "bad\n");
      await delay(300);
      assert.deepEqual(await f.checkpoint(session.id), paused);
      assert.deepEqual(await f.messages(session.id), history, "Keep paused must not auto-continue the worker");
      return;
    }
    assert.equal(resumed.state.status, "completed", `fresh native Resume Goal confirmation must authorize reconciled resume without a new chat ID: ${resumed.state.error ?? resumed.state.output}`);
    assert.equal(JSON.parse(resumed.state.output).state, "working");
    const accepted = await waitAccepted(f, session.id);
    await f.idle(session.id);
    for (const key of ["runtime_contract", "agent", "definition_sha256", "completion_target", "authorized_actions", "initial_worktree"]) assert.deepEqual(accepted[key], paused[key], `${key} must survive native-question resumption`);
    const history = await f.messages(session.id);
    assert.deepEqual(history.filter(message => message.info.role === "user" && message.parts.some(part => part.type === "text" && !part.synthetic)).map(message => message.info.id), userIDs, "native answer confirmation must not depend on new human chat identities");
    assert.deepEqual(completed(history, "goal_run").map(part => part.state.input.operation), ["start", "pause", "resume"]);
    assert.equal(completed(history, "question").length, 1);
    assert.deepEqual(completed(history, "write").map(part => path.basename(part.state.input.filePath)), ["readiness.json", "counter.txt"]);
    assert.equal(await bytes(f.root, "counter.txt"), "good\n");
    assert.equal(await bytes(f.root, "readiness.json"), '{"prepared":true}\n');
    const children = await f.api(`/session/${session.id}/children`);
    assert.equal(children.length, 1, "native confirmation must obtain a fresh final evaluator, not a builder or a claimed acceptance");
    await assertEvaluatorMarker(f, children[0].id, session.id, accepted.definition_sha256);
    const messages = await f.messages(children[0].id);
    assert.doesNotMatch(JSON.stringify(messages), /QUESTION_ROOT_PRIVATE/);
    assert.ok(completed(messages, "read").length >= 2);
    const verdicts = outputs(messages, "goal_verdict");
    assert.equal(verdicts.length, 1);
    assert.deepEqual(Object.keys(verdicts[0].checks).sort(), ["c0", "c1"]);
    assert.ok(Object.values(verdicts[0].checks).every(check => check.passed));
    await delay(300);
    assert.deepEqual(await f.checkpoint(session.id), accepted);
    assert.deepEqual(await f.messages(session.id), history);
  });
}

test("persistent primary Goal writes directly, continues partial returns, repairs feedback and accepts only a fresh final evaluator", { timeout: 120_000 }, async t => {
  const feedbackGate = gate();
  t.after(() => feedbackGate.release());
  let awaitingFinal = false;
  const f = await fixture(t, async (input, { root }) => {
    const { user, lastUser, results, turnResults } = conversation(input);
    if (user.includes("INDEPENDENT EVALUATOR")) return evaluator(input, root);
    if (lastUser.includes("Inspect historical Goal")) {
      if (results.at(-1)?.name === "goal_run" && results.at(-1).args.operation === "inspect") return { text: "Historical inspection complete; no execution." };
      return call("goal_run", { operation: "inspect" });
    }
    if (!user.includes("Execute persistent fixture")) return { text: "Native Build fixture finished." };
    requireTools(input, ["goal_run", "goal_evaluate", "read", "write"]);
    assert.ok(!input.tools.some(tool => tool.function.name === "goal_verdict"), "root worker cannot submit its own independent verdict");
    if (!started(results)) return call("goal_run", { operation: "start", completion_target: "Counter implementation verified offline", authorized_actions: "Read and write counter.txt/readiness.json; no external actions." });
    const last = results.at(-1);
    if (turnResults.at(-1)?.name === "write" && last.args.filePath.endsWith("readiness.json")) return { text: "PREPARATION_PARTIAL: preparation verified; implementation remains. ROOT_PRIVATE_SENTINEL." };
    if (!(await bytes(root, "readiness.json"))) return call("write", { filePath: path.join(root, "readiness.json"), content: '{"prepared":true}\n' });
    const counter = await bytes(root, "counter.txt");
    if (counter === "user-existing\n") {
      if (!results.some(result => result.name === "read" && result.args.filePath.endsWith("counter.txt"))) return call("read", { filePath: path.join(root, "counter.txt") });
      return call("write", { filePath: path.join(root, "counter.txt"), content: "bad\n" });
    }
    const evaluations = results.filter(result => result.name === "goal_evaluate");
    if (counter === "bad\n" && !evaluations.length) return call("goal_evaluate", { mode: "feedback", focus: "counter.txt must contain exactly good followed by newline", artifacts: ["counter.txt"] });
    if (counter === "bad\n" && turnResults.at(-1)?.name === "goal_evaluate") {
      assert.match(last.output, /bad/);
      assert.match(last.output, /false/);
      return { text: "FAILURE_PARTIAL: independent feedback found bad content; repair remains." };
    }
    if (counter === "bad\n") {
      if (last?.name !== "read") return call("read", { filePath: path.join(root, "counter.txt") });
      assert.match(last.output, /bad/);
      return call("write", { filePath: path.join(root, "counter.txt"), content: "good\n" });
    }
    if (evaluations.length === 1) return call("goal_evaluate", { mode: "feedback", focus: "counter.txt must contain exactly good followed by newline", artifacts: ["counter.txt"] });
    if (!evaluations.some(result => result.args.mode === "final")) {
      awaitingFinal = true;
      await feedbackGate.promise;
      return call("goal_evaluate", { mode: "final", artifacts: ["counter.txt", "readiness.json"] });
    }
    return { text: "Goal independently accepted." };
  });
  await publish(f.root);
  await writeFile(path.join(f.root, "counter.txt"), "user-existing\n");
  await f.start();
  const session = await f.api("/session", { title: "Persistent worker" });
  const callerMessageID = `msg_${Date.now().toString(16)}${"a".repeat(18)}`;
  await f.api(`/session/${session.id}/prompt_async`, { messageID: callerMessageID, agent: "fix-counter", parts: [{ type: "text", text: "Execute persistent fixture. ROOT_PRIVATE_SENTINEL must stay in the root conversation." }] });
  await f.wait("passing feedback before final request", () => awaitingFinal);
  const working = await f.checkpoint(session.id);
  assert.equal(working.runtime_contract, "persistent-worker-v1");
  assert.equal(working.state, "working", "passing feedback cannot accept the published goal");
  assert.equal(working.initial_worktree.files["counter.txt"].sha256, sha256("user-existing\n"), "start must capture pre-write user bytes");
  assert.equal(working.initial_worktree.files["readiness.json"].state, "absent");
  const feedbackChildren = await f.api(`/session/${session.id}/children`);
  assert.equal(feedbackChildren.length, 2);
  for (const child of feedbackChildren) await assertEvaluatorMarker(f, child.id, session.id, working.definition_sha256);
  feedbackGate.release();
  const accepted = await waitAccepted(f, session.id);
  assert.deepEqual(accepted.initial_worktree, working.initial_worktree);
  await f.idle(session.id);
  const history = await f.messages(session.id);
  assert.equal(history.filter(message => message.info.id === callerMessageID).length, 1, "runtime continuation must not duplicate a caller-owned message ID");
  assert.equal(completed(history, "goal_run").filter(part => part.state.input.operation === "start").length, 1);
  assert.ok(parts(history).some(part => part.type === "text" && part.text.includes("PREPARATION_PARTIAL")));
  assert.ok(parts(history).some(part => part.type === "text" && part.text.includes("FAILURE_PARTIAL")));
  assert.deepEqual(completed(history, "write").map(part => path.basename(part.state.input.filePath)), ["readiness.json", "counter.txt", "counter.txt"], "all implementation writes belong to the persistent root");
  assert.deepEqual(completed(history, "goal_evaluate").map(part => part.state.input.mode), ["feedback", "feedback", "final"]);
  for (const tool of ["goal_cycle", "goal_handoff", "goal_progress", "goal_verdict"]) assert.equal(parts(history).filter(part => part.tool === tool).length, 0);
  assert.equal(await bytes(f.root, "counter.txt"), "good\n");
  const children = await f.api(`/session/${session.id}/children`);
  assert.equal(children.length, 3, "only independent evaluators are children; there are no builder sessions");
  assert.equal(new Set(children.map(child => child.id)).size, 3);
  const verdicts = [];
  for (const child of children) {
    assert.equal(child.parentID, session.id);
    assert.equal(child.metadata?.cuddly_winner_goal, undefined, "independent evaluator must not acquire a malformed root Goal checkpoint");
    await assertEvaluatorMarker(f, child.id, session.id, accepted.definition_sha256);
    const messages = await f.messages(child.id);
    const prompts = messages.filter(message => message.info.role === "user" && message.parts.some(part => part.type === "text" && !part.synthetic));
    assert.equal(prompts.length, 1, "each evaluator starts with independent context");
    const prompt = prompts[0].parts.filter(part => part.type === "text").map(part => part.text).join("\n");
    assert.match(prompt, /INDEPENDENT EVALUATOR/);
    assert.match(prompt, /mode=(feedback|final)/);
    assert.doesNotMatch(JSON.stringify(messages), /ROOT_PRIVATE_SENTINEL|PREPARATION_PARTIAL|FAILURE_PARTIAL/, "root conversation must not be passed to evaluators");
    assert.equal(completed(messages, "write").length, 0);
    assert.ok(completed(messages, "read").length >= 1);
    const verdict = outputs(messages, "goal_verdict");
    assert.equal(verdict.length, 1);
    const final = evaluatorMode(prompt) === "final";
    assert.deepEqual(Object.keys(verdict[0].checks).sort(), final ? ["c0", "c1"] : ["c0"], "feedback checks its focus; final checks every published criterion");
    verdicts.push({ final, verdict: verdict[0] });
  }
  assert.ok(verdicts.some(({ final, verdict }) => !final && !verdict.checks.c0.passed));
  assert.ok(verdicts.some(({ final, verdict }) => !final && verdict.checks.c0.passed));
  assert.ok(verdicts.some(({ final, verdict }) => final && Object.values(verdict.checks).every(check => check.passed)));
  const evaluatorRequests = f.requests.filter(input => conversation(input).user.includes("INDEPENDENT EVALUATOR"));
  assert.deepEqual([...new Set(evaluatorRequests.map(input => input.model))], ["default"], "fresh evaluators inherit the selected root model, not general's configured model");
  await delay(300);
  assert.equal((await f.messages(session.id)).length, history.length, "accepted is terminal and schedules no extra root prompts");
  await f.api(`/session/${session.id}/message`, { agent: "build", parts: [{ type: "text", text: "Inspect historical Goal without executing." }] });
  const inspection = outputs(await f.messages(session.id), "goal_run").at(-1);
  assert.equal(inspection.runtime_contract, "persistent-worker-v1");
  assert.equal(inspection.selected_agent, "build");
  assert.equal(inspection.state, "accepted");
  assert.deepEqual(await f.checkpoint(session.id), accepted, "Build inspection cannot alter the recorded Goal");
  assert.equal((await f.api(`/session/${session.id}/children`)).length, 3);
  const native = await f.api("/session", { title: "Native Build" });
  await f.api(`/session/${native.id}/message`, { agent: "build", parts: [{ type: "text", text: "Native Build: respond once." }] });
  await f.idle(native.id);
  const nativeHistory = await f.messages(native.id);
  await delay(300);
  assert.deepEqual(await f.messages(native.id), nativeHistory, "native Build gets no automatic Goal prompts");
  assert.equal(await f.checkpoint(native.id), undefined);
  assert.equal((await f.api(`/session/${native.id}/children`)).length, 0);
  const unstarted = await f.api("/session", { title: "Unstarted Goal" });
  await f.api(`/session/${unstarted.id}/message`, { agent: "fix-counter", parts: [{ type: "text", text: "Do not start fixture: respond once without starting work." }] });
  await f.idle(unstarted.id);
  const unstartedHistory = await f.messages(unstarted.id);
  await delay(300);
  assert.deepEqual(await f.messages(unstarted.id), unstartedHistory, "a partial return before start grants no continuation authority");
  assert.equal(completed(unstartedHistory, "goal_run").length, 0);
  assert.equal(completed(unstartedHistory, "write").length, 0);
  assert.equal((await f.api(`/session/${unstarted.id}/children`)).length, 0);
});

test("persistent Goal recovers from native patch verification failures without Resume Goal", { timeout: 120_000 }, async t => {
  const repairGate = gate();
  t.after(() => repairGate.release());
  let awaitingRepair = false;
  const faults = [
    { patchText: "*** Update File: counter.txt\n@@\n-bad\n+good", expected: /Invalid patch format: missing Begin\/End markers/ },
    { patchText: "*** Begin Patch\n*** Update File: counter.txt\n@@\n-missing counter context\n+good\n*** End Patch", expected: /Failed to find expected lines.*counter\.txt/s },
    // The first hunk is valid, but a later file fails verification. Native
    // preflight must reject the entire patch before writing either file.
    { patchText: "*** Begin Patch\n*** Update File: counter.txt\n@@\n-bad\n+MUST-NOT-WRITE\n*** Update File: readiness.json\n@@\n-missing readiness definition\n+{}\n*** End Patch", expected: /Failed to find expected lines.*readiness\.json/s },
  ];
  const f = await fixture(t, async (input, { root }) => {
    const { user, results, turnResults } = conversation(input);
    if (evaluatorMode(user)) return evaluator(input, root);
    if (!user.includes("Execute patch rejection fixture")) return { text: "Patch rejection fixture." };
    requireTools(input, ["goal_run", "goal_evaluate", "read", "apply_patch"]);
    if (!started(results)) return call("goal_run", { operation: "start", completion_target: "Counter implementation verified offline", authorized_actions: "Read and patch only counter.txt/readiness.json; correct no-effect failures and continue in this worker." });
    if (!results.some(result => result.name === "read" && result.args.filePath.endsWith("counter.txt"))) return call("read", { filePath: path.join(root, "counter.txt") });
    const rejected = results.filter(result => result.name === "apply_patch" && faults.some(fault => fault.patchText === result.args.patchText));
    for (const [index, result] of rejected.entries()) {
      assert.equal(result.args.patchText, faults[index].patchText);
      assert.match(result.output, /apply_patch verification failed:/);
      assert.match(result.output, faults[index].expected);
    }
    if (rejected.length < faults.length) return call("apply_patch", { patchText: faults[rejected.length].patchText });
    if (turnResults.at(-1)?.name === "apply_patch" && faults.some(fault => fault.patchText === turnResults.at(-1).args.patchText)) {
      return { text: "PATCH_REJECTION_PARTIAL: no changes were applied; correct the patch in this same worker." };
    }
    const inspection = results.find(result => result.name === "goal_run" && result.args.operation === "inspect");
    if (!inspection) return call("goal_run", { operation: "inspect" });
    assert.equal(JSON.parse(inspection.output).state, "working");
    assert.deepEqual(JSON.parse(inspection.output).pending_actions, {});
    if (await bytes(root, "counter.txt") === "bad\n") {
      awaitingRepair = true;
      await repairGate.promise;
      return call("apply_patch", { patchText: "*** Begin Patch\n*** Update File: counter.txt\n@@\n-bad\n+good\n*** End Patch" });
    }
    assert.equal(await bytes(root, "counter.txt"), "good\n");
    if (!results.some(result => result.name === "goal_evaluate")) return call("goal_evaluate", { mode: "final", artifacts: ["counter.txt", "readiness.json"] });
    return { text: "Patch errors recovered without human handback; fresh final evaluation accepted." };
  });
  // OpenCode exposes its native patch tool for gpt-* model IDs. This remains
  // the same isolated deterministic provider, not a remote model or custom tool.
  const configPath = path.join(f.root, "opencode.json"), config = JSON.parse(await readFile(configPath, "utf8"));
  config.provider.fixture.models["gpt-fixture"] = { ...config.provider.fixture.models.default, name: "gpt-fixture" };
  await writeFile(configPath, JSON.stringify(config));
  await publish(f.root);
  await writeFile(path.join(f.root, "counter.txt"), "bad\n");
  await writeFile(path.join(f.root, "readiness.json"), '{"prepared":true}\n');
  await f.start();
  const session = await f.api("/session", { title: "Recoverable native patch errors" });
  await f.api(`/session/${session.id}/prompt_async`, { agent: "fix-counter", model: { providerID: "fixture", modelID: "gpt-fixture" }, parts: [{ type: "text", text: "Execute patch rejection fixture." }] });
  await f.wait("automatic continuation reaches corrected patch without human handback", () => awaitingRepair);
  const working = await f.checkpoint(session.id);
  assert.equal(working.state, "working");
  assert.equal(working.reason, undefined);
  assert.equal(working.paused_at, undefined);
  assert.deepEqual(working.pending_actions, {});
  assert.equal(await bytes(f.root, "counter.txt"), "bad\n", "Failed multi-file preflight cannot apply its earlier valid hunk");
  assert.equal(await bytes(f.root, "readiness.json"), '{"prepared":true}\n');
  const beforeRepair = await f.messages(session.id);
  const errors = parts(beforeRepair).filter(part => part.tool === "apply_patch" && part.state.status === "error");
  assert.equal(errors.length, faults.length);
  assert.equal(parts(beforeRepair).filter(part => part.state?.status === "error").length, faults.length);
  for (const [index, part] of errors.entries()) {
    assert.equal(part.state.input.patchText, faults[index].patchText);
    assert.match(part.state.error, faults[index].expected);
  }
  assert.equal(beforeRepair.filter(message => message.info.role === "user" && message.parts.some(part => part.type === "text" && !part.synthetic)).length, 1);
  assert.ok(parts(beforeRepair).some(part => part.type === "text" && part.synthetic && part.text.startsWith("Continue the admitted Goal in this same worker conversation.")));
  assert.equal((await f.api("/question")).length, 0);
  repairGate.release();
  const accepted = await waitAccepted(f, session.id, { expectedErrorIDs: errors.map(part => part.id) });
  await f.idle(session.id);
  const history = await f.messages(session.id);
  assert.deepEqual(completed(history, "goal_run").map(part => part.state.input.operation), ["start", "inspect"]);
  assert.equal(parts(history).filter(part => part.tool === "question").length, 0);
  assert.equal(completed(history, "apply_patch").length, 1);
  assert.equal(completed(history, "goal_evaluate").length, 1);
  assert.equal(await bytes(f.root, "counter.txt"), "good\n");
  assert.equal(await bytes(f.root, "readiness.json"), '{"prepared":true}\n');
  for (const key of ["definition_sha256", "initial_worktree", "authorized_actions", "completion_target"]) assert.deepEqual(accepted[key], working[key]);
  assert.equal(accepted.initial_worktree.files["counter.txt"].sha256, sha256("bad\n"));
  const children = await f.api(`/session/${session.id}/children`);
  assert.equal(children.length, 1);
  await assertEvaluatorMarker(f, children[0].id, session.id, accepted.definition_sha256);
  const verdict = outputs(await f.messages(children[0].id), "goal_verdict").at(-1);
  assert.ok(Object.values(verdict.checks).every(check => check.passed));
  await delay(300);
  assert.deepEqual(await f.messages(session.id), history, "Acceptance schedules no extra attempts or prompts");
});

test("working Goal API compaction preserves failed feedback and findings and automatically continues the same worker to fresh final acceptance", { timeout: 120_000 }, async t => {
  const feedbackGate = gate(), repairGate = gate();
  t.after(() => { feedbackGate.release(); repairGate.release(); });
  let feedbackWaiting = false, repairWaiting = false;
  const f = await fixture(t, async (input, { root }) => {
    const source = (input.messages ?? []).map(content).join("\n");
    if (compactionRequest(input)) {
      assert.match(source, /Persistent Goal checkpoint remains authoritative/);
      assert.match(source, /State=working/);
      assert.match(source, /Current findings:.*c0/);
      assert.match(source, /latest feedback:.*"passed":false/);
      return { text: "## Objective\n- WORKING_COMPACTION_SUMMARY: finish the counter implementation verified offline.\n## Important Details\n- The Goal is admitted and working in this same conversation; retain original authority and baseline.\n- ROOT_COMPACTION_PRIVATE stays in the root conversation.\n## Work State\n### Completed\n- Prepared readiness.json once.\n- Independent final checking found c0 failed: counter.txt contains bad; c1 preparation passed.\n- Latest independent feedback also found c0 false: replace bad with good followed by newline.\n### Active\n- Repair is still required; no acceptance has been established.\n### Blocked\n- (none)\n## Next Move\n1. Inspect the durable checkpoint and read current counter.txt; preserve the unresolved c0 finding and latest feedback.\n2. Repair counter.txt and request a fresh final evaluation of both published criteria.\n## Relevant Files\n- counter.txt: defective counter to inspect and repair.\n- readiness.json: verified preparation to reuse." };
    }
    const { user, results, turnResults } = conversation(input);
    if (evaluatorMode(user)) return evaluator(input, root);
    const compacted = source.includes("WORKING_COMPACTION_SUMMARY");
    if (!compacted && !user.includes("Execute working compaction fixture")) return { text: "Working compaction fixture." };
    requireTools(input, ["goal_run", "goal_evaluate", "read", "write"]);
    if (compacted) {
      if (!turnResults.some(result => result.name === "goal_run" && result.args.operation === "inspect")) return call("goal_run", { operation: "inspect" });
      const inspection = JSON.parse(turnResults.find(result => result.name === "goal_run" && result.args.operation === "inspect").output);
      assert.equal(inspection.state, "working", "summary does not grant a new admission or clear a stop");
      assert.equal(inspection.feedback.checks.c0.passed, false);
      assert.ok(inspection.findings.c0.length > 0);
      const read = turnResults.findLast(result => result.name === "read" && result.args.filePath.endsWith("counter.txt"));
      if (!read) return call("read", { filePath: path.join(root, "counter.txt") });
      if (await bytes(root, "counter.txt") === "bad\n") {
        assert.match(read.output, /1: bad/);
        repairWaiting = true;
        await repairGate.promise;
        return call("write", { filePath: path.join(root, "counter.txt"), content: "good\n" });
      }
      if (!turnResults.some(result => result.name === "goal_evaluate")) return call("goal_evaluate", { mode: "final", artifacts: ["counter.txt", "readiness.json"] });
      return { text: "Compacted working Goal independently accepted." };
    }
    if (!started(results)) return call("goal_run", { operation: "start", completion_target: "Counter implementation verified offline", authorized_actions: "Read and write counter.txt/readiness.json; obtain independent checks and repair defects." });
    if (!(await bytes(root, "readiness.json"))) return call("write", { filePath: path.join(root, "readiness.json"), content: '{"prepared":true}\n' });
    if (!results.some(result => result.name === "read")) return call("read", { filePath: path.join(root, "counter.txt") });
    const final = results.find(result => result.name === "goal_evaluate" && result.args.mode === "final");
    if (!final) return call("goal_evaluate", { mode: "final", artifacts: ["counter.txt", "readiness.json"] });
    assert.equal(JSON.parse(final.output).validation.checks.c0.passed, false);
    const feedback = results.find(result => result.name === "goal_evaluate" && result.args.mode === "feedback");
    if (!feedback) return call("goal_evaluate", { mode: "feedback", focus: "counter.txt must contain exactly good followed by newline", artifacts: ["counter.txt"] });
    assert.equal(JSON.parse(feedback.output).validation.checks.c0.passed, false);
    feedbackWaiting = true;
    await feedbackGate.promise;
    return { text: "COMPACTION_PARTIAL: failed independent feedback requires repair; continue the working Goal." };
  });
  await publish(f.root);
  await writeFile(path.join(f.root, "counter.txt"), "bad\n");
  await f.start();
  const session = await f.api("/session", { title: "Working Goal compaction" });
  await f.api(`/session/${session.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: "Execute working compaction fixture. ROOT_COMPACTION_PRIVATE stays in this worker conversation." }] });
  await f.wait("failed feedback held before repair", () => feedbackWaiting);
  const before = await f.checkpoint(session.id);
  assert.equal(before.state, "working");
  assert.equal(before.feedback.checks.c0.passed, false);
  assert.equal(before.validation.checks.c0.passed, false);
  assert.ok(before.findings.c0.length > 0, "real failed final evidence must seed nonempty findings before feedback/compaction");
  assert.equal(await bytes(f.root, "counter.txt"), "bad\n");
  const summaryRequest = f.sdk.session.summarize({ sessionID: session.id, directory: f.root, providerID: "fixture", modelID: "default", auto: false }, { signal: AbortSignal.timeout(30_000) });
  summaryRequest.catch(() => {}); // Cleanup can abort the transport if a queue assertion fails.
  await f.wait("actual API compaction queued while the worker model turn is in flight", async () => (await f.messages(session.id)).some(message => message.parts.some(part => part.type === "compaction" && part.auto === false)));
  assert.equal(f.requests.filter(compactionRequest).length, 0, "native core must queue compaction until the held model turn returns");
  assert.deepEqual(await f.checkpoint(session.id), before, "queuing compaction cannot replace durable Goal evidence");
  feedbackGate.release();
  const summary = await summaryRequest;
  assert.equal(summary.error, undefined, JSON.stringify(summary.error));
  await f.wait("automatic post-compaction inspection and fresh counter read", () => repairWaiting);
  const after = await f.checkpoint(session.id);
  assert.equal(after.state, "working");
  for (const key of ["runtime_contract", "agent", "definition_sha256", "completion_target", "authorized_actions", "initial_worktree", "feedback", "validation", "findings"]) assert.deepEqual(after[key], before[key], `${key} must survive real working compaction before repair`);
  const compactedHistory = await f.messages(session.id);
  const summaryIndex = compactedHistory.findIndex(message => message.info.role === "assistant" && message.info.summary && message.parts.some(part => part.type === "text" && part.text.includes("WORKING_COMPACTION_SUMMARY")));
  assert.ok(summaryIndex >= 0, "native core must persist a real compaction summary");
  const continuation = compactedHistory.slice(summaryIndex + 1).filter(message => message.info.role === "user");
  assert.equal(continuation.length, 1, "Goal idle and native compaction must not dispatch two continuation prompts");
  assert.equal(continuation[0].info.agent, "fix-counter");
  assert.ok(continuation[0].parts.some(part => part.type === "text" && part.synthetic && part.text.startsWith("Continue the admitted Goal in this same worker conversation.")), "the Goal idle dispatcher must own the continuation");
  assert.equal(f.requests.filter(compactionRequest).length, 1);
  assert.equal(await bytes(f.root, "counter.txt"), "bad\n", "repair must wait for actual compacted-context inspection");
  repairGate.release();
  const accepted = await waitAccepted(f, session.id);
  await f.idle(session.id);
  assert.deepEqual(accepted.initial_worktree, before.initial_worktree);
  assert.deepEqual(accepted.feedback, before.feedback, "final acceptance must retain the latest failed feedback history");
  assert.deepEqual(accepted.findings, {}, "fresh final evidence must resolve the preserved finding");
  assert.ok(Object.values(accepted.validation.checks).every(check => check.passed));
  assert.ok(accepted.validation.checks.c0.resolution);
  const history = await f.messages(session.id);
  assert.equal(new Set(history.map(message => message.info.id)).size, history.length, "compaction continuation must not duplicate message IDs");
  assert.equal(history.filter(message => message.info.role === "user" && message.parts.some(part => part.type === "text" && !part.synthetic)).length, 1, "no human rescue prompt is permitted");
  assert.deepEqual(completed(history, "goal_run").map(part => part.state.input.operation), ["start", "inspect"]);
  assert.deepEqual(completed(history, "goal_evaluate").map(part => part.state.input.mode), ["final", "feedback", "final"]);
  assert.deepEqual(completed(history, "write").map(part => path.basename(part.state.input.filePath)), ["readiness.json", "counter.txt"]);
  assert.equal(await bytes(f.root, "counter.txt"), "good\n");
  const children = await f.api(`/session/${session.id}/children`);
  assert.equal(children.length, 3);
  assert.equal(new Set(children.map(child => child.id)).size, 3);
  const checks = [];
  for (const child of children) {
    assert.equal(child.parentID, session.id);
    assert.equal(child.metadata?.cuddly_winner_goal, undefined);
    await assertEvaluatorMarker(f, child.id, session.id, accepted.definition_sha256);
    const messages = await f.messages(child.id);
    assert.doesNotMatch(JSON.stringify(messages), /ROOT_COMPACTION_PRIVATE|WORKING_COMPACTION_SUMMARY/);
    assert.equal(completed(messages, "write").length, 0);
    const verdicts = outputs(messages, "goal_verdict");
    assert.equal(verdicts.length, 1);
    checks.push(verdicts[0]);
  }
  assert.equal(checks.filter(verdict => !verdict.checks.c0.passed).length, 2);
  assert.equal(checks.filter(verdict => Object.values(verdict.checks).every(check => check.passed)).length, 1);
  await delay(300);
  assert.deepEqual(await f.checkpoint(session.id), accepted, "accepted checkpoint is terminal after compaction");
  assert.deepEqual(await f.messages(session.id), history, "final acceptance schedules no extra worker prompt");
});

test("a paused persistent Goal survives API compaction and restart and resumes only after explicit reconciliation", { timeout: 120_000 }, async t => {
  const resumeGate = gate();
  t.after(() => resumeGate.release());
  let reconciliationRequired = false;
  const f = await fixture(t, async (input, { root }) => {
    if (compactionRequest(input)) return { text: "## Objective\n- Verify the persistent counter fixture.\n## Important Details\n- Preserve the durable checkpoint and initial baseline.\n## Work State\n### Completed\n- Wrote readiness.json preparation once.\n### Active\n- (none)\n### Blocked\n- Goal is paused pending reconciliation.\n## Next Move\n1. Inspect the recorded checkpoint and read readiness.json.\n2. Resume explicitly with reconciled=true; never start again or replay preparation.\n## Relevant Files\n- counter.txt: existing good counter.\n- readiness.json: preparation receipt." };
    const { user, lastUser, results, turnResults } = conversation(input);
    if (user.includes("INDEPENDENT EVALUATOR")) return evaluator(input, root);
    if (lastUser.includes("Reconcile paused fixture")) {
      requireTools(input, ["goal_run", "goal_evaluate", "read"]);
      if (!turnResults.some(result => result.name === "goal_run" && result.args.operation === "inspect")) return call("goal_run", { operation: "inspect" });
      if (!turnResults.some(result => result.name === "goal_run" && result.args.operation === "resume" && !result.args.reconciled)) return call("goal_run", { operation: "resume", reason: "Attempt without reconciliation" });
      if (!turnResults.some(result => result.name === "read")) return call("read", { filePath: path.join(root, "readiness.json") });
      if (!turnResults.some(result => result.name === "goal_run" && result.args.operation === "resume" && result.args.reconciled)) {
        reconciliationRequired = true;
        await resumeGate.promise;
        return call("goal_run", { operation: "resume", reason: "Read persisted preparation and verified counter; no actions need replay", reconciled: true });
      }
      if (!turnResults.some(result => result.name === "goal_evaluate")) return call("goal_evaluate", { mode: "final", artifacts: ["counter.txt", "readiness.json"] });
      return { text: "Paused fixture independently accepted." };
    }
    if (!user.includes("Execute paused fixture")) return { text: "Metadata summary fixture." };
    requireTools(input, ["goal_run", "write"]);
    if (!started(results)) return call("goal_run", { operation: "start", completion_target: "Counter implementation verified offline", authorized_actions: "Read and write only counter.txt/readiness.json." });
    if (!(await bytes(root, "readiness.json"))) return call("write", { filePath: path.join(root, "readiness.json"), content: '{"prepared":true}\n' });
    if (!results.some(result => result.name === "goal_run" && result.args.operation === "pause")) return call("goal_run", { operation: "pause", reason: "Explicit user handback required before continuing" });
    return { text: "Goal paused; awaiting explicit reconciliation." };
  });
  await publish(f.root);
  await writeFile(path.join(f.root, "counter.txt"), "good\n");
  await f.start();
  const session = await f.api("/session", { title: "Paused persistent worker" });
  await f.api(`/session/${session.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: "Execute paused fixture; pause the Goal after preparation." }] });
  const paused = await f.wait("explicit persisted pause", async () => { const checkpoint = await f.checkpoint(session.id); return checkpoint?.state === "paused" && checkpoint; });
  await f.idle(session.id);
  const pausedHistory = await f.messages(session.id);
  await delay(200);
  assert.deepEqual(await f.messages(session.id), pausedHistory, "explicit pause stops idle continuation");
  const summary = await f.sdk.session.summarize({ sessionID: session.id, directory: f.root, providerID: "fixture", modelID: "default", auto: false });
  assert.equal(summary.error, undefined, JSON.stringify(summary.error));
  await f.wait("paused Goal compaction", async () => (await f.messages(session.id)).some(message => message.info.summary && message.parts.some(part => part.type === "text" && part.text.includes("paused pending reconciliation"))));
  await f.idle(session.id);
  assert.deepEqual(await f.checkpoint(session.id), paused, "compaction must preserve the entire runtime checkpoint");
  await f.kill();
  await f.start();
  assert.deepEqual(await f.checkpoint(session.id), paused);
  await delay(200);
  assert.equal(await bytes(f.root, "readiness.json"), '{"prepared":true}\n');
  assert.equal((await f.api(`/session/${session.id}/children`)).length, 0, "restart cannot silently resume a paused worker");
  await f.api(`/session/${session.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: "Reconcile paused fixture: inspect, read the completed preparation, then explicitly resume without replay." }] });
  await f.wait("unreconciled resume rejected", () => reconciliationRequired);
  assert.equal((await f.checkpoint(session.id)).state, "paused");
  const beforeResume = await f.messages(session.id);
  const rejected = parts(beforeResume).findLast(part => part.tool === "goal_run" && part.state.input.operation === "resume");
  assert.ok(rejected.state.status === "error" || /reconcil|paused|invalid|blocked/i.test(rejected.state.output), JSON.stringify(rejected));
  assert.equal(completed(beforeResume, "write").length, 1, "inspection/rejected resumption cannot replay preparation");
  resumeGate.release();
  await f.wait("explicit reconciled resume", async () => ["working", "accepted"].includes((await f.checkpoint(session.id))?.state));
  const accepted = await waitAccepted(f, session.id, { expectedErrorIDs: rejected.state.status === "error" ? [rejected.id] : [] });
  assert.deepEqual(accepted.initial_worktree, paused.initial_worktree);
  await f.idle(session.id);
  const history = await f.messages(session.id);
  assert.equal(completed(history, "goal_run").filter(part => part.state.input.operation === "start").length, 1);
  assert.equal(completed(history, "write").length, 1);
  assert.equal((await f.api(`/session/${session.id}/children`)).length, 1);
});

test("SIGKILL during a real root write leaves an unknown action that inspection pauses before side effects and reconciled resume never replays", { timeout: 120_000 }, async t => {
  const resumeGate = gate();
  t.after(() => resumeGate.release());
  let inspectedUnknown = false;
  const f = await fixture(t, async (input, { root }) => {
    const { user, lastUser, results, turnResults } = conversation(input);
    if (user.includes("INDEPENDENT EVALUATOR")) return evaluator(input, root);
    if (lastUser.includes("Resume reconciled interrupted fixture")) {
      requireTools(input, ["goal_run", "goal_evaluate", "read"]);
      if (!turnResults.some(result => result.name === "read")) return call("read", { filePath: path.join(root, "readiness.json") });
      assert.match(turnResults.find(result => result.name === "read").output, /completed-once/);
      const resumed = turnResults.find(result => result.name === "goal_run" && result.args.operation === "resume");
      if (!resumed) return call("goal_run", { operation: "resume", reason: "Fresh user handback and receipt read reconcile the interrupted write without replay", reconciled: true });
      assert.equal(JSON.parse(resumed.output).state, "working");
      const final = turnResults.find(result => result.name === "goal_evaluate");
      if (!final) return call("goal_evaluate", { mode: "final", artifacts: ["counter.txt", "readiness.json"] });
      assert.equal(JSON.parse(final.output).state, "accepted");
      return { text: "Interrupted fixture accepted without replay." };
    }
    if (lastUser.includes("Inspect interrupted fixture")) {
      requireTools(input, ["goal_run", "goal_evaluate", "read", "write"]);
      if (!turnResults.some(result => result.name === "read" && result.args.filePath.endsWith("counter.txt"))) return call("read", { filePath: path.join(root, "counter.txt") });
      if (!turnResults.some(result => result.name === "write")) return call("write", { filePath: path.join(root, "counter.txt"), content: "MUST-NOT-WRITE\n" });
      if (!turnResults.some(result => result.name === "goal_run" && result.args.operation === "inspect")) return call("goal_run", { operation: "inspect" });
      if (!turnResults.some(result => result.name === "read" && result.args.filePath.endsWith("readiness.json"))) return call("read", { filePath: path.join(root, "readiness.json") });
      if (!turnResults.some(result => result.name === "goal_run" && result.args.operation === "resume")) {
        inspectedUnknown = true;
        await resumeGate.promise;
        return call("goal_run", { operation: "resume", reason: "Fresh read reconciles completed-once receipt; interrupted write must not be replayed", reconciled: true });
      }
      const rejected = turnResults.find(result => result.name === "goal_run" && result.args.operation === "resume");
      assert.match(rejected.output, /Explicit user resumption and reconciled action outcomes are required/);
      return { text: "Interruption inspected; Goal remains paused pending a fresh explicit user handback." };
    }
    if (!user.includes("Execute interrupted fixture")) return { text: "Interruption fixture." };
    requireTools(input, ["goal_run", "write"]);
    if (!started(results)) return call("goal_run", { operation: "start", completion_target: "Counter implementation verified offline", authorized_actions: "Read and write counter.txt/readiness.json; record preparation once." });
    return call("write", { filePath: path.join(root, "readiness.json"), content: '{"action":"completed-once","prepared":true}\n' });
  }, { extraPlugin: `export const InterruptAfterWrite = async () => ({
    "tool.execute.after": async (input) => {
      if (input.tool === "write") {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const receipt = await readFile(join(process.cwd(), "readiness.json"), "utf8").catch(() => "");
        if (receipt.includes("completed-once")) await new Promise(() => {});
      }
    },
  });\n` });
  await publish(f.root);
  await writeFile(path.join(f.root, "counter.txt"), "good\n");
  await f.start();
  const session = await f.api("/session", { title: "Unknown interrupted write" });
  await f.api(`/session/${session.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: "Execute interrupted fixture." }] });
  await f.wait("real write interrupted after bytes but before completed tool result", async () => {
    const receipt = await bytes(f.root, "readiness.json");
    const history = await f.messages(session.id);
    return receipt?.includes("completed-once") && parts(history).some(part => part.tool === "write" && part.state.status === "running");
  });
  const working = await f.checkpoint(session.id);
  assert.equal(working.state, "working");
  const receipt = await bytes(f.root, "readiness.json");
  await f.kill();
  await f.start();
  assert.equal(await bytes(f.root, "readiness.json"), receipt);
  const inspectionMessageID = `msg_${Date.now().toString(16)}${"c".repeat(18)}`;
  await f.api(`/session/${session.id}/prompt_async`, { messageID: inspectionMessageID, agent: "fix-counter", parts: [{ type: "text", text: "Inspect interrupted fixture: reconcile receipt before explicit resume; never replay an unknown task action." }] });
  await f.wait("unknown action inspection", () => inspectedUnknown);
  const paused = await f.checkpoint(session.id);
  assert.equal(paused.state, "paused", "stale working is unknown, not automatic execution authority");
  assert.equal(paused.paused_after_user, inspectionMessageID, "the pause must retain the user identity that encountered the unknown action");
  assert.deepEqual(paused.initial_worktree, working.initial_worktree);
  const history = await f.messages(session.id);
  const inspectPart = completed(history, "goal_run").findLast(part => part.state.input.operation === "inspect");
  const inspect = inspectPart && JSON.parse(inspectPart.state.output);
  assert.ok(inspect, "real inspect tool must report the interrupted action");
  assert.equal(inspect.state, "paused");
  assert.match(JSON.stringify(inspect), /interrupt|unknown/i);
  assert.match(JSON.stringify(inspect), /write/, "inspect must identify the interrupted running tool");
  const denied = parts(history).find(part => part.tool === "write" && part.state.input.content === "MUST-NOT-WRITE\n");
  assert.equal(denied.state.status, "error", "post-restart mutation must fail closed before explicit reconciliation");
  assert.match(denied.state.error, /paused|interrupt|unknown|reconcil/i, "the runtime must reject unknown-action mutation, rather than relying on an unrelated native tool error");
  assert.equal(await bytes(f.root, "counter.txt"), "good\n");
  assert.equal(await bytes(f.root, "readiness.json"), receipt);
  resumeGate.release();
  const staleResume = await f.wait("pre-pause handback cannot authorize unknown-action resumption", async () => parts(await f.messages(session.id)).find(part => part.tool === "goal_run" && part.state.input.operation === "resume" && part.state.status === "error"));
  assert.match(staleResume.state.error, /Explicit user resumption/);
  await f.idle(session.id);
  assert.deepEqual(await f.checkpoint(session.id), paused, "rejected stale handback must preserve the full pause evidence");
  const resumeMessageID = `msg_${Date.now().toString(16)}${"d".repeat(18)}`;
  assert.notEqual(resumeMessageID, paused.paused_after_user);
  await f.api(`/session/${session.id}/prompt_async`, { messageID: resumeMessageID, agent: "fix-counter", parts: [{ type: "text", text: "Resume reconciled interrupted fixture. I inspected the completed-once receipt and authorize continuation without replaying that write." }] });
  await f.wait("reconciled unknown action resume", async () => ["working", "accepted"].includes((await f.checkpoint(session.id))?.state));
  const interruptedWrite = parts(history).find(part => part.tool === "write" && part.state.input.filePath.endsWith("readiness.json"));
  const accepted = await waitAccepted(f, session.id, { expectedErrorIDs: [denied.id, interruptedWrite.id, staleResume.id] });
  assert.deepEqual(accepted.initial_worktree, working.initial_worktree);
  await f.idle(session.id);
  const recovered = await f.messages(session.id);
  assert.equal(parts(recovered).filter(part => part.tool === "write" && part.state.input.filePath.endsWith("readiness.json")).length, 1, "unknown write is never reissued");
  assert.equal(completed(recovered, "goal_run").filter(part => part.state.input.operation === "start").length, 1);
  assert.equal((await f.api(`/session/${session.id}/children`)).length, 1);
  assert.equal(await bytes(f.root, "readiness.json"), receipt);
});

test("persistent Goal preserves cancellation and actual permission rejection without idle replay", { timeout: 180_000 }, async t => {
  let cancellationWaiting = false;
  const f = await fixture(t, async (input, { root, res }) => {
    const { user, results } = conversation(input);
    if (user.includes("INDEPENDENT EVALUATOR")) return evaluator(input, root, { blocked: true });
    if (!user.includes("Execute stop fixture")) return { text: "Stop fixture." };
    requireTools(input, ["goal_run", "goal_evaluate"]);
    if (!started(results)) return call("goal_run", { operation: "start", completion_target: "Counter implementation verified offline", authorized_actions: "Inspect counter.txt/readiness.json; request approval for local shell inspection." });
    if (user.includes("cancellation")) {
      cancellationWaiting = true;
      await new Promise(resolve => res.on("close", resolve));
      return;
    }
    if (user.includes("permission rejection")) {
      if (!results.some(result => result.name === "bash")) return call("bash", { command: "pwd", description: "Inspect active worktree with user approval" });
      return { text: "Permission was rejected; the Goal remains incomplete." };
    }
    if (!results.some(result => result.name === "goal_evaluate")) return call("goal_evaluate", { mode: "final", artifacts: ["counter.txt", "readiness.json"] });
    return { text: "Independent evaluator is blocked; the Goal remains incomplete." };
  });
  await publish(f.root, { bash: true });
  await f.start();
  for (const reason of ["cancellation", "permission rejection"]) {
    const session = await f.api("/session", { title: reason });
    await f.api(`/session/${session.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: `Execute stop fixture: ${reason}.` }] });
    if (reason === "cancellation") {
      await f.wait("provider in-flight before abort", () => cancellationWaiting);
      await f.api(`/session/${session.id}/abort`, {});
    }
    if (reason === "permission rejection") {
      const permission = await f.wait("real shell permission request", async () => (await f.api("/permission")).find(request => request.sessionID === session.id));
      await f.observeStopEvents(session.id);
      await f.api(`/permission/${permission.id}/reply`, { reply: "reject" });
    }
    const expectedReason = reason === "cancellation" ? /cancel|abort/i : /permission|reject|deni/i;
    let intermediateReason;
    const stopped = await f.wait(`${reason} persisted pause with observed reason`, async () => {
      const checkpoint = await f.checkpoint(session.id);
      if (checkpoint?.state !== "paused") return false;
      if (!expectedReason.test(checkpoint.reason ?? "")) { intermediateReason = checkpoint.reason; return false; }
      return checkpoint;
    });
    assert.equal(stopped.state, "paused");
    assert.match(stopped.reason, expectedReason, "the observed stop reason must be durably persisted before success");
    t.diagnostic(`${reason}: persisted ${JSON.stringify(stopped.reason)}${intermediateReason ? ` after intermediate paused reason ${JSON.stringify(intermediateReason)}` : ""}`);
    await f.idle(session.id);
    const history = await f.messages(session.id);
    const settled = await f.checkpoint(session.id);
    assert.equal(settled.state, "paused");
    assert.equal(settled.reason, stopped.reason, `a later internal event cannot downgrade the observed stop reason\n${f.diagnostics()}`);
    await delay(300);
    assert.deepEqual(await f.checkpoint(session.id), settled, `${reason} pause evidence must remain stable\n${f.diagnostics()}`);
    assert.deepEqual(await f.messages(session.id), history, `${reason} must not schedule another worker turn`);
    assert.equal(history.filter(message => message.info.role === "user").length, 1, "a temporary unknown pause must not dispatch another worker prompt while the observed reason converges");
    assert.equal(completed(history, "goal_run").filter(part => part.state.input.operation === "start").length, 1);
    assert.equal(completed(history, "write").length, 0);
    const children = await f.api(`/session/${session.id}/children`);
    assert.equal(children.length, 0);
    if (reason === "permission rejection") assert.ok(parts(history).some(part => part.tool === "bash" && part.state.status === "error" && /reject|deni/i.test(part.state.error)));
  }
});
