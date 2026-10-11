import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile, readdir } from "node:fs/promises";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import xterm from "@xterm/headless";
import { publishGoalAgentFile } from "../../tools/publish_goal_agent.ts";

const repo = path.resolve(import.meta.dirname, "../..");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const gate = () => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
};

test("real pinned TUI follows persistent root worker metadata at 80 and 60 columns", { timeout: 180_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "goal-tui-live-"));
  const feedbackGate = gate(), repairGate = gate(), finalGate = gate(), cancelGate = gate();
  const processes = [];
  let serverLog = "", repairWaiting = false;
  const screens = [];
  const requests = [];
  const pendingRequests = new Set();
  const errors = [];
  let journeyError;
  const content = message => typeof message?.content === "string" ? message.content : Array.isArray(message?.content)
    ? message.content.map(part => part.text ?? JSON.stringify(part)).join("\n") : JSON.stringify(message?.content ?? "");
  const respond = async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      const messages = input.messages ?? [];
      const user = messages.filter(m => m.role === "user").map(content).join("\n");
      const lastUser = content(messages.filter(m => m.role === "user").at(-1));
      const calls = new Map(messages.flatMap(m => m.tool_calls ?? []).map(c => [c.id, { name: c.function.name, args: JSON.parse(c.function.arguments) }]));
      const results = messages.filter(m => m.role === "tool").map(m => ({ ...calls.get(m.tool_call_id), output: content(m) }));
      const turnResults = messages.slice(messages.findLastIndex(m => m.role === "user") + 1)
        .filter(m => m.role === "tool").map(m => ({ ...calls.get(m.tool_call_id), output: content(m) }));
      const called = name => results.some(result => result.name === name);
      const child = user.includes("INDEPENDENT EVALUATOR");
      const evaluatorMode = user.match(/^INDEPENDENT EVALUATOR mode=(feedback|final)\s*$/m)?.[1];
      const tools = input.tools?.map(t => t.function.name) ?? [];
      if (requests.length < 60) requests.push({ child, tools, lastTool: results.at(-1)?.name, lastUser: lastUser.slice(0, 120) });
      let call, text = "Phase complete.";
      const invoke = (name, args) => { call = { name, arguments: JSON.stringify(args) }; };
      if (child) {
        assert.ok(evaluatorMode, "independent evaluator must identify its mode in the prompt header");
        assert.ok(tools.includes("goal_verdict") && tools.includes("read"));
        for (const name of ["goal_cycle", "goal_handoff", "goal_progress"]) assert.ok(!tools.includes(name));
        const final = evaluatorMode === "final";
        if (!called("read")) invoke("read", { filePath: path.join(root, "counter.txt") });
        else if (!final && !called("bash")) invoke("bash", { command: "pwd", description: "Inspect evaluator worktree" });
        else if (!called("goal_verdict")) {
          await (final ? finalGate.promise : feedbackGate.promise);
          const read = results.findLast(result => result.name === "read");
          const passed = /^\s*\d+\s*[:|]\s*good\s*$/m.test(read.output) && (await readFile(path.join(root, "counter.txt"), "utf8")) === "good\n";
          invoke("goal_verdict", { status: "checked", reason: passed ? "Counter verified" : "Counter requires repair", checks: {
            c0: { passed, evidence: passed ? "Read counter.txt: good" : "Read counter.txt: bad; repair it",
              ...(passed ? { resolution: "Fresh read shows good, resolving the earlier bad content finding" } : {}) },
          } });
        }
      } else if (lastUser.includes("Native session")) text = "Native session untouched";
      else if (lastUser.includes("Inspect visibility goal")) {
        if (turnResults.some(result => result.name === "goal_run")) text = "Inspection complete.";
        else invoke("goal_run", { operation: "inspect" });
      } else if (user.includes("Execute visibility goal") || user.includes("Execute cancel goal")) {
        for (const name of ["goal_run", "goal_evaluate", "read", "write"]) assert.ok(tools.includes(name), `${name} must be a root worker tool`);
        for (const name of ["goal_cycle", "goal_handoff", "goal_progress", "goal_verdict"]) assert.ok(!tools.includes(name));
        if (!called("goal_run")) invoke("goal_run", { operation: "start", completion_target: "Counter implementation verified offline",
          authorized_actions: "Read and write counter.txt; allow evaluator shell inspection. No external actions." });
        else if (!called("read")) invoke("read", { filePath: path.join(root, "counter.txt") });
        else if (user.includes("Execute cancel goal")) { await cancelGate.promise; text = "Interrupted worker response"; }
        else if (!called("write")) invoke("write", { filePath: path.join(root, "counter.txt"), content: "bad\n" });
        else {
          const evaluations = results.filter(result => result.name === "goal_evaluate");
          const counter = await readFile(path.join(root, "counter.txt"), "utf8");
          if (!evaluations.length) invoke("goal_evaluate", { mode: "feedback", focus: "counter.txt content", artifacts: ["counter.txt"] });
          else if (counter === "bad\n" && turnResults.at(-1)?.name === "goal_evaluate") text = "Feedback found defect; repair remains.";
          else if (counter === "bad\n") {
            repairWaiting = true;
            await repairGate.promise;
            if (results.at(-1)?.name !== "read") invoke("read", { filePath: path.join(root, "counter.txt") });
            else invoke("write", { filePath: path.join(root, "counter.txt"), content: "good\n" });
          } else if (!evaluations.some(result => result.args.mode === "final")) invoke("goal_evaluate", { mode: "final", artifacts: ["counter.txt"] });
          else text = "Goal independently accepted.";
        }
      } else text = "Visibility fixture";
      const delta = call ? { tool_calls: [{ index: 0, id: `call-${Date.now()}-${Math.random()}`, type: "function", function: call }] } : { content: text };
      if (input.stream === false) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "fixture", object: "chat.completion", created: 1, model: "fixture", choices: [{ index: 0,
          message: { role: "assistant", ...delta }, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const [d, finish] of [[{ role: "assistant", ...delta }, null], [{}, call ? "tool_calls" : "stop"]]) {
        res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: d, finish_reason: finish }] })}\n\n`);
      }
      res.end("data: [DONE]\n\n");
    } catch (error) { errors.push(error); if (!res.destroyed) { res.writeHead(500); res.end(String(error)); } }
  };
  const provider = http.createServer((req, res) => {
    const pending = respond(req, res);
    pendingRequests.add(pending);
    void pending.finally(() => pendingRequests.delete(pending));
  });
  let api;
  const wait = async (predicate, label, attempts = 300) => {
    for (let i = 0; i < attempts; i++) {
      if (errors.length) throw errors[0];
      if (await predicate()) return;
      await delay(100);
    }
    throw new Error(`${label}\nRequests: ${JSON.stringify(requests)}\nScreens: ${screens.map(s => s.text()).join("\n---\n")}\nServer: ${serverLog.slice(-6000)}`);
  };
  const bounded = async (promise, label, milliseconds = 5000) => {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not finish within ${milliseconds}ms`)), milliseconds);
      })]);
    } finally { clearTimeout(timer); }
  };
  // script's PTY child starts a separate session; npm bootstrap may outlive its
  // wrapper. Track only descendants of our spawned PIDs, including start times
  // so PID reuse cannot turn cleanup into a signal to an unrelated process.
  const identity = async pid => {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return { pid, state: fields[0], parent: Number(fields[1]), started: fields[19] };
    } catch (error) { if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error; }
  };
  const capture = async record => {
    if (record.capturing) return record.capturing;
    record.capturing = (async () => {
      if (record.proc.exitCode === null && record.proc.signalCode === null && record.proc.pid && !record.owned.has(record.proc.pid)) {
        const rootProcess = await identity(record.proc.pid);
        if (rootProcess) record.owned.set(rootProcess.pid, rootProcess);
      }
      for (const owned of record.owned.values()) {
        const current = await identity(owned.pid);
        if (!current || current.started !== owned.started) continue;
        let threads;
        try { threads = await readdir(`/proc/${owned.pid}/task`); }
        catch (error) { if (error.code === "ENOENT" || error.code === "ESRCH") continue; throw error; }
        // Bun can launch npm from a non-main thread; children is per task.
        const children = await Promise.all(threads.map(async thread => {
          try { return await readFile(`/proc/${owned.pid}/task/${thread}/children`, "utf8"); }
          catch (error) { if (error.code === "ENOENT" || error.code === "ESRCH") return ""; throw error; }
        }));
        for (const pid of new Set(children.join(" ").trim().split(/\s+/).filter(Boolean).map(Number))) {
          const child = await identity(pid);
          if (child?.parent === owned.pid && !record.owned.has(pid)) record.owned.set(pid, child);
        }
      }
    })();
    try { await record.capturing; } finally { record.capturing = undefined; }
  };
  const track = proc => {
    const record = { proc, owned: new Map(), closed: false };
    proc.once("close", () => { record.closed = true; });
    proc.on("error", error => errors.push(error));
    processes.push(record);
    void capture(record).catch(error => errors.push(error));
    return proc;
  };
  const tracker = setInterval(() => {
    for (const record of processes) if (!record.stopping) void capture(record).catch(error => errors.push(error));
  }, 100);
  const stop = proc => {
    const record = processes.find(record => record.proc === proc);
    if (record.stopping) return record.stopping;
    record.stopping = (async () => {
      const active = async () => {
        await capture(record);
        const current = await Promise.all([...record.owned.values()].map(async owned => {
          const value = await identity(owned.pid);
          return value?.started === owned.started && !["Z", "X"].includes(value.state) ? value : undefined;
        }));
        return current.filter(Boolean);
      };
      const signal = (pid, name) => {
        try { process.kill(pid, name); } catch (error) { if (error.code !== "ESRCH") throw error; }
      };
      for (const name of ["SIGTERM", "SIGKILL"]) {
        const running = await active();
        // The detached wrapper's group is owned; separately signal its known
        // PTY/bootstrap descendants that moved into their own process groups.
        if (running.some(value => value.pid === proc.pid)) signal(-proc.pid, name);
        for (const value of running) signal(value.pid, name);
        const deadline = Date.now() + 5000;
        do {
          const remaining = await active();
          if (record.closed && !remaining.length) return;
          await delay(50);
        } while (Date.now() < deadline);
      }
      throw new Error(`Fixture process ${proc.pid} or its bootstrap descendants failed to close after SIGKILL`);
    })();
    return record.stopping;
  };
  try {
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    await mkdir(path.join(root, ".opencode/plugins"), { recursive: true });
    await mkdir(path.join(root, ".opencode/tools"), { recursive: true });
    await mkdir(path.join(root, "config/opencode"), { recursive: true });
    for (const file of ["plugins/goal.ts", "plugins/immutability.ts", "tools/publish_goal_agent.ts"]) {
      await symlink(path.join(repo, file), path.join(root, ".opencode", file));
    }
    await symlink(path.join(repo, "plugins/tui"), path.join(root, ".opencode/plugins/tui"));
    await symlink(path.join(repo, "node_modules"), path.join(root, ".opencode/node_modules"));
    await writeFile(path.join(root, "config/opencode/tui.json"), JSON.stringify({
      $schema: "https://opencode.ai/tui.json", plugin: [path.join(repo, "plugins/tui/goal-progress.tsx")],
    }));
    await writeFile(path.join(root, "opencode.json"), JSON.stringify({
      $schema: "https://opencode.ai/config.json", model: "fixture/default", small_model: "fixture/default",
      provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "fixture", options: {
        baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: "fixture",
      }, models: { default: { name: "default", limit: { context: 128000, output: 4096 } } } } },
    }));
    await writeFile(path.join(root, "counter.txt"), "user-existing\n");
    await publishGoalAgentFile(root, { name: "fix-counter", description: "Visibility fixture", outcome: "Counter contains good",
      acceptance_criteria: ["counter.txt contains good"], durable_context: ["counter.txt"], edit_paths: ["counter.txt"], bash: true,
      verification_commands: ["Read counter.txt"], stop_conditions: ["Filesystem inaccessible"], escalation_triggers: ["More paths needed"],
      instructions: "Write and independently check counter.txt" });
    const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"),
      XDG_CACHE_HOME: path.join(root, "cache"), OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", TERM: "xterm-256color", COLORTERM: "truecolor" };
    for (const key of ["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG_CONTENT", "OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME", "OPENCODE_PURE", "OPENCODE_DISABLE_PROJECT_CONFIG"]) delete env[key];
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const cli = process.env.OPENCODE_TUI_TEST_CLI ?? path.join(repo, "node_modules/.bin/opencode");
    const server = track(spawn(cli, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] }));
    server.stdout.on("data", b => { serverLog += b; });
    server.stderr.on("data", b => { serverLog += b; });
    const base = `http://127.0.0.1:${port}`;
    api = async (url, body) => {
      const response = await fetch(base + url, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`API ${url}: ${response.status}`);
      return response.status === 204 ? undefined : response.json();
    };
    await wait(async () => { try { await api("/global/health"); return true; } catch { return false; } }, "Server startup", 100);
    const attach = (id, columns) => {
      const terminal = new xterm.Terminal({ cols: columns, rows: 24, allowProposedApi: true });
      const proc = track(spawn("script", ["-q", "-e", "-f", "-c", `stty cols ${columns} rows 24 && exec "${cli}" attach ${base} --session ${id}`, "/dev/null"],
        { cwd: root, env, detached: true, stdio: ["pipe", "pipe", "pipe"] }));
      proc.stdout.on("data", b => terminal.write(b));
      proc.stderr.on("data", b => { serverLog += b; });
      terminal.onData(data => { if (!proc.stdin.destroyed) proc.stdin.write(data); });
      const screen = { proc, terminal, text: () => Array.from({ length: terminal.rows }, (_, i) =>
        terminal.buffer.active.getLine(terminal.buffer.active.viewportY + i)?.translateToString(true) ?? "").join("\n") };
      screens.push(screen);
      return screen;
    };
    const state = async id => (await api(`/session/${id}`)).metadata?.cuddly_winner_goal;
    const toolParts = async id => (await api(`/session/${id}/message`)).flatMap(m => m.parts).filter(p => p.type === "tool");
    const session = await api("/session", { title: "Goal visibility" });
    await api(`/session/${session.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: "Execute visibility goal" }] });
    await wait(async () => (await state(session.id))?.state === "evaluating", "Root evaluation checkpoint");
    assert.equal((await state(session.id)).runtime_contract, "persistent-worker-v1");
    let wide = attach(session.id, 80);
    const narrow = attach(session.id, 60);
    for (const screen of [wide, narrow]) {
      await wait(() => screen.text().includes("Goal worker | evaluating") && screen.text().includes("Waiting for"), "Visible in-flight root evaluator panel");
      assert.doesNotMatch(screen.text(), /Remaining attempts|Reported:|Goal activity/);
    }
    await stop(wide.proc);
    wide = attach(session.id, 80);
    await wait(() => wide.text().includes("Goal worker | evaluating"), "Reattach hydrates root session metadata");
    await writeFile(path.join(root, "config/opencode/tui.json"), JSON.stringify({
      $schema: "https://opencode.ai/tui.json", plugin: [[path.join(repo, "plugins/tui/goal-progress.tsx"), { enabled: false }]],
    }));
    const disabled = attach(session.id, 80);
    await wait(() => disabled.text().includes("goal_evaluate") && disabled.text().includes("Fix-Counter"), "Disabled plugin renders the active native tool transcript");
    disabled.proc.stdin.write("\x07"); // Native Ctrl+G (messages_first): inspect the original user prompt.
    await wait(() => disabled.text().includes("Execute visibility goal") && disabled.text().includes("Fix-Counter"), "Disabled plugin still renders the native session");
    assert.doesNotMatch(disabled.text(), /Goal worker/);
    await stop(disabled.proc);
    await writeFile(path.join(root, "config/opencode/tui.json"), JSON.stringify({
      $schema: "https://opencode.ai/tui.json", plugin: [path.join(repo, "plugins/tui/goal-progress.tsx")],
    }));
    for (const agent of ["build", "plan"]) {
      const native = await api("/session", { title: "Native session" });
      await api(`/session/${native.id}/prompt_async`, { agent, parts: [{ type: "text", text: "Native session" }] });
      const screen = attach(native.id, 80);
      await wait(() => screen.text().includes("Native session untouched"), "Native session rendered");
      assert.equal(await state(native.id), undefined);
      assert.doesNotMatch(screen.text(), /Goal worker/);
      screen.proc.stdin.write("native-draft-kept");
      await wait(() => screen.text().includes("native-draft-kept"), "Native prompt stays usable");
      await stop(screen.proc);
    }
    let permission;
    await wait(async () => {
      const childID = (await state(session.id)).evaluation?.childID;
      permission = (await api("/permission")).find(p => p.sessionID === childID);
      return Boolean(permission);
    }, "Actual evaluator Bash permission request");
    assert.ok(permission.sessionID !== session.id, "approval belongs to independent evaluator, not the root worker");
    assert.equal(permission.permission, "bash");
    for (const screen of [wide, narrow]) await wait(() => screen.text().includes("Goal worker | evaluating") && screen.text().includes("Waiting for user permission"), "Panel remains visible during native permission wait");
    await api(`/permission/${permission.id}/reply`, { reply: "once" });
    for (const screen of [wide, narrow]) await wait(() => screen.text().includes("Waiting for independent feedback evaluator"), "Gated independent feedback checkpoint");
    const childID = (await state(session.id)).evaluation.childID;
    const childScreen = attach(childID, 60);
    await wait(() => childScreen.text().includes("counter.txt"), "Evaluator child native transcript rendered");
    assert.doesNotMatch(childScreen.text(), /Goal worker/);
    await stop(childScreen.proc);
    feedbackGate.release();
    await wait(() => repairWaiting, "Failed-feedback root automatically continues to repair gate");
    for (const screen of [wide, narrow]) await wait(() => screen.text().includes("Goal worker | working") && screen.text().includes("Feedback: failed (c0)"), "Visible failed feedback while root remains working");
    repairGate.release();
    await wait(async () => (await state(session.id))?.evaluation?.mode === "final", "Independent final evaluation after root repair");
    for (const screen of [wide, narrow]) await wait(() => screen.text().includes("Goal worker | evaluating") && screen.text().includes("Waiting for independent final evaluator")
      && screen.text().includes("Feedback: failed (c0)"), "Prior findings persist during independent final check");
    finalGate.release();
    for (const screen of [wide, narrow]) await wait(() => screen.text().includes("Goal worker | accepted") && screen.text().includes("Final: passed (c0)"), "Visible independent final acceptance");
    await wait(async () => {
      const status = (await api("/session/status"))[session.id];
      return !status || status.type === "idle";
    }, "Accepted root finishes its active native turn");
    const accepted = await state(session.id);
    const history = await toolParts(session.id);
    assert.equal(history.filter(p => p.tool === "goal_run" && p.state.input.operation === "start").length, 1);
    assert.deepEqual(history.filter(p => p.tool === "write").map(p => p.state.input.content), ["bad\n", "good\n"], "implementation and repair stay in the persistent root");
    assert.deepEqual(history.filter(p => p.tool === "goal_evaluate").map(p => p.state.input.mode), ["feedback", "final"]);
    for (const tool of ["goal_cycle", "goal_handoff", "goal_progress", "goal_verdict"]) assert.ok(!history.some(p => p.tool === tool));
    const children = await api(`/session/${session.id}/children`);
    assert.equal(children.length, 2, "only fresh evaluators are children");
    for (const child of children) {
      const parts = await toolParts(child.id);
      assert.ok(parts.some(p => p.tool === "read" && p.state.status === "completed"));
      if (child.id === childID) assert.ok(parts.some(p => p.tool === "bash" && p.state.status === "completed"), "approved native Bash actually executes in the feedback evaluator");
      assert.equal(parts.filter(p => p.tool === "goal_verdict" && p.state.status === "completed").length, 1);
      assert.ok(!parts.some(p => p.tool === "write"));
    }
    await api(`/session/${session.id}/message`, { agent: "fix-counter", parts: [{ type: "text", text: "Inspect visibility goal" }] });
    assert.deepEqual(await state(session.id), accepted, "inspection preserves authoritative metadata");
    await wait(() => wide.text().includes("Goal worker | accepted") && wide.text().includes("Final: passed (c0)"), "Inspection retains recorded final findings");
    await api(`/session/${session.id}/message`, { agent: "build", parts: [{ type: "text", text: "Native session" }] });
    await wait(() => wide.text().includes("Native session untouched") && wide.text().includes("Goal worker | accepted"), "Historical Goal remains visible during native Build");
    assert.deepEqual(await state(session.id), accepted);
    assert.equal((await api(`/session/${session.id}/children`)).length, 2, "native Build and inspection start no evaluator");
    wide.proc.stdin.write("historical-build-draft-kept");
    await wait(() => wide.text().includes("historical-build-draft-kept"), "Historical Build prompt remains usable");

    const cancelled = await api("/session", { title: "Cancelled Goal" });
    await api(`/session/${cancelled.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: "Execute cancel goal" }] });
    await wait(async () => (await toolParts(cancelled.id)).some(p => p.tool === "read" && p.state.status === "completed"), "Cancelable root worker started");
    const cancelledScreen = attach(cancelled.id, 80);
    await wait(() => cancelledScreen.text().includes("Goal worker | working"), "Cancelable root checkpoint visible");
    await api(`/session/${cancelled.id}/abort`, {});
    await wait(() => cancelledScreen.text().includes("Goal worker | paused"), "Cancellation visibly pauses the root worker");
    assert.match((await state(cancelled.id)).reason, /cancel|abort/i);
  } catch (error) {
    journeyError = error;
  } finally {
    for (const item of [feedbackGate, repairGate, finalGate, cancelGate]) item.release();
    const cleanupErrors = [];
    const stopped = await Promise.allSettled([...processes].reverse().map(record => stop(record.proc)));
    cleanupErrors.push(...stopped.filter(result => result.status === "rejected").map(result => result.reason));
    clearInterval(tracker);
    await Promise.allSettled(processes.map(record => record.capturing));
    for (const screen of screens) {
      try {
        screen.proc.stdout.removeAllListeners("data");
        screen.terminal.dispose();
      } catch (error) { cleanupErrors.push(error); }
    }
    try {
      provider.closeAllConnections();
      if (provider.listening) await bounded(new Promise((resolve, reject) => provider.close(error => error ? reject(error) : resolve())), "Fixture provider close");
      await bounded(Promise.all([...pendingRequests]), "Pending fixture provider handlers");
    } catch (error) { cleanupErrors.push(error); }
    if (!cleanupErrors.length) {
      try {
        // All owned writers and their pipes/transport have closed. Limited
        // retries cover transient filesystem removal contention, not live npm.
        await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (error) { cleanupErrors.push(error); }
    }
    if (journeyError || cleanupErrors.length) {
      if (journeyError && !cleanupErrors.length) throw journeyError;
      throw new AggregateError([...(journeyError ? [journeyError] : []), ...cleanupErrors],
        `${journeyError ? "TUI journey failed; " : ""}fixture teardown failed (preserved ${root})`, { cause: journeyError ?? cleanupErrors[0] });
    }
  }
});
