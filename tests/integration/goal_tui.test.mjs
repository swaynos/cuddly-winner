import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from "node:fs/promises";
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

test("real pinned TUI shows in-flight Goal activity at 80 and 60 columns without a sidebar", { timeout: 180_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "goal-tui-live-"));
  const builderGate = gate(), validatorGate = gate(), retryGate = gate(), finalGate = gate(), cancelGate = gate();
  const processes = [];
  let serverLog = "", builds = 0, cancelMode = false;
  const screens = [];
  const requests = [];
  const provider = http.createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      const messages = input.messages ?? [];
      const user = messages.filter(m => m.role === "user").map(m => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n");
      const lastUser = messages.filter(m => m.role === "user").at(-1)?.content;
      const called = name => messages.some(m => m.role === "assistant" && m.tool_calls?.some(t => t.function.name === name));
      const child = input.tools?.some(t => t.function.name === "goal_progress");
      if (requests.length < 12) requests.push({ child, tools: input.tools?.map(t => t.function.name), role: user.includes("assigned builder") ? "builder" : user.includes("assigned validator") ? "validator" : "root" });
      let call, text = "Phase complete.";
      if (child && user.includes("Perform only your assigned builder phase")) {
        if (!called("goal_progress")) {
          builds++;
          call = { name: "goal_progress", arguments: JSON.stringify({ summary: "Preparing local artifacts" }) };
        } else if (!called("read")) {
          call = { name: "read", arguments: JSON.stringify({ filePath: path.join(root, "private-context.txt") }) };
        } else {
          if (builds === 1) await builderGate.promise;
          if (cancelMode) await cancelGate.promise;
          if (builds === 1 && !called("bash")) call = { name: "bash", arguments: JSON.stringify({ command: "pwd", description: "Check worktree" }) };
          else if (!called("write")) call = { name: "write", arguments: JSON.stringify({ filePath: path.join(root, "counter.txt"), content: builds === 1 ? "bad\n" : "good\n" }) };
          else if (!called("goal_handoff")) call = { name: "goal_handoff", arguments: JSON.stringify({ status: "ready", evidence: "Counter written and inspection performed; ready for independent check", remaining: [] }) };
        }
      } else if (child && user.includes("Perform only your assigned validator phase")) {
        if (!called("goal_progress")) call = { name: "goal_progress", arguments: JSON.stringify({ summary: "Checking independent evidence" }) };
        else if (!called("read")) call = { name: "read", arguments: JSON.stringify({ filePath: path.join(root, "counter.txt") }) };
        else if (!called("goal_verdict")) {
          await (builds === 1 ? validatorGate.promise : finalGate.promise);
          const passed = (await readFile(path.join(root, "counter.txt"), "utf8")) === "good\n";
          call = { name: "goal_verdict", arguments: JSON.stringify({ status: "checked", reason: "", checks: { c0: { passed, evidence: passed ? "Read counter.txt: good" : "Read counter.txt: bad; repair it", ...(passed ? { resolution: "Fresh read shows good, resolving the earlier bad content finding" } : {}) } } }) };
        }
      } else if (JSON.stringify(lastUser).includes("Native session")) text = "Native session untouched";
      else if (input.tools?.some(t => t.function.name === "goal_cycle") && user.includes("Execute visibility goal")) {
        const outputs = messages.filter(m => m.role === "tool").map(m => JSON.stringify(m.content));
        if (outputs.some(s => s.includes('\\"validated\\"') || s.includes('"validated"'))) text = "Goal independently validated.";
        else if (called("goal_cycle") && !JSON.stringify(lastUser).includes("The goal is not yet validated")) {
          await retryGate.promise;
          text = "Repair required.";
        } else call = { name: "goal_cycle", arguments: JSON.stringify({ alignment: "confirmed", completion_target: "Counter implementation verified offline", authorized_actions: "Write counter.txt and run checks. No generation.", max_cycles: 3, max_stalled_cycles: 2,
          finding: "c0 bad counter content", repair: "Replace bad counter with good", expected_evidence: "Fresh read returns good" }) };
      } else text = "Visibility fixture";
      const delta = call ? { tool_calls: [{ index: 0, id: `call-${Date.now()}-${Math.random()}`, type: "function", function: call }] } : { content: text };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const [d, finish] of [[{ role: "assistant", ...delta }, null], [{}, call ? "tool_calls" : "stop"]]) {
        res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: d, finish_reason: finish }] })}\n\n`);
      }
      res.end("data: [DONE]\n\n");
    } catch (error) { if (!res.destroyed) { res.writeHead(500); res.end(String(error)); } }
  });
  let api;
  const wait = async (predicate, label, attempts = 300) => {
    for (let i = 0; i < attempts; i++) {
      if (await predicate()) return;
      await delay(100);
    }
    throw new Error(`${label}\nRequests: ${JSON.stringify(requests)}\nScreens: ${screens.map(s => s.text()).join("\n---\n")}\nServer: ${serverLog.slice(-6000)}`);
  };
  const stop = proc => { if (proc.exitCode === null && proc.signalCode === null) { try { process.kill(-proc.pid, "SIGTERM"); } catch {} } };
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
    await writeFile(path.join(root, "private-context.txt"), "PRIVATE_SENTINEL must stay in the child output.\n");
    await publishGoalAgentFile(root, { name: "fix-counter", description: "Visibility fixture", outcome: "Counter contains good",
      acceptance_criteria: ["counter.txt contains good"], durable_context: ["counter.txt"], edit_paths: ["counter.txt"], bash: true,
      verification_commands: ["Read counter.txt"], stop_conditions: ["Filesystem inaccessible"], escalation_triggers: ["More paths needed"],
      instructions: "Write and independently check counter.txt" });
    const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"),
      XDG_CACHE_HOME: path.join(root, "cache"), OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", TERM: "xterm-256color", COLORTERM: "truecolor" };
    for (const key of ["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG_CONTENT", "OPENCODE_SERVER_PASSWORD", "OPENCODE_PURE"]) delete env[key];
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const cli = process.env.OPENCODE_TUI_TEST_CLI ?? path.join(repo, "node_modules/.bin/opencode");
    const server = spawn(cli, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    processes.push(server);
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
      const proc = spawn("script", ["-q", "-e", "-f", "-c", `stty cols ${columns} rows 24 && exec "${cli}" attach ${base} --session ${id}`, "/dev/null"],
        { cwd: root, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
      processes.push(proc);
      proc.stdout.on("data", b => terminal.write(b));
      proc.stderr.on("data", b => { serverLog += b; });
      terminal.onData(data => { if (!proc.stdin.destroyed) proc.stdin.write(data); });
      const screen = { proc, terminal, text: () => Array.from({ length: terminal.rows }, (_, i) =>
        terminal.buffer.active.getLine(terminal.buffer.active.viewportY + i)?.translateToString(true) ?? "").join("\n") };
      screens.push(screen);
      return screen;
    };
    const state = async id => (await api(`/session/${id}/message`)).flatMap(m => m.parts)
      .findLast(p => p.tool === "goal_cycle");
    const session = await api("/session", { title: "Goal visibility" });
    await api(`/session/${session.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: "Execute visibility goal" }] });
    await wait(async () => (await state(session.id))?.state.metadata?.goal_activity?.milestone === "Preparing local artifacts", "Builder milestone");
    let wide = attach(session.id, 80);
    const narrow = attach(session.id, 60);
    for (const screen of [wide, narrow]) {
      await wait(() => screen.text().includes("Goal activity") && screen.text().includes("Preparing local artifacts"), "Visible in-flight builder panel");
      assert.doesNotMatch(screen.text(), /PRIVATE_SENTINEL/);
    }
    assert.equal((await state(session.id)).state.status, "running");
    stop(wide.proc);
    wide = attach(session.id, 80);
    await wait(() => wide.text().includes("Preparing local artifacts"), "Reattach hydrates in-flight metadata");
    await writeFile(path.join(root, "config/opencode/tui.json"), JSON.stringify({
      $schema: "https://opencode.ai/tui.json", plugin: [[path.join(repo, "plugins/tui/goal-progress.tsx"), { enabled: false }]],
    }));
    const disabled = attach(session.id, 80);
    await wait(() => disabled.text().includes("Execute visibility goal") && disabled.text().includes("Fix-Counter"), "Disabled plugin still renders the native session");
    assert.doesNotMatch(disabled.text(), /Goal activity/);
    stop(disabled.proc);
    await writeFile(path.join(root, "config/opencode/tui.json"), JSON.stringify({
      $schema: "https://opencode.ai/tui.json", plugin: [path.join(repo, "plugins/tui/goal-progress.tsx")],
    }));
    for (const agent of ["build", "plan"]) {
      const native = await api("/session", { title: "Native session" });
      await api(`/session/${native.id}/prompt_async`, { agent, parts: [{ type: "text", text: "Native session" }] });
      const screen = attach(native.id, 80);
      await wait(() => screen.text().includes("Native session untouched"), "Native session rendered");
      assert.doesNotMatch(screen.text(), /Goal activity/);
      screen.proc.stdin.write("native-draft-kept");
      await wait(() => screen.text().includes("native-draft-kept"), "Native prompt stays usable");
      stop(screen.proc);
    }
    builderGate.release();
    let permission;
    await wait(async () => { permission = (await api("/permission"))[0]; return Boolean(permission); }, "Actual child permission request");
    await wait(() => wide.text().includes("waiting") && wide.text().includes("Waiting for user"), "Panel remains visible during permission wait");
    await api(`/permission/${permission.id}/reply`, { reply: "once" });
    await wait(() => wide.text().includes("Validator") && wide.text().includes("Checking independent evidence"), "In-flight validator panel");
    assert.equal((await state(session.id)).state.status, "running");
    validatorGate.release();
    await wait(() => wide.text().includes("failed") && wide.text().includes("repair cycle"), "Visible failed-validation outcome");
    retryGate.release();
    await wait(async () => (await state(session.id))?.state.metadata?.goal_activity?.cycle === 2 &&
      (await state(session.id)).state.metadata.goal_activity.phase === "validator", "Fresh repair/validation cycle");
     await wait(() => wide.text().includes("activity 2") && wide.text().includes("Validator"), "Second cycle rendered");
     await wait(() => wide.text().includes("Verdict: failed (c0)") && wide.text().includes("Replace bad counter"), "Prior failed verdict and repair reason remain visible");
    finalGate.release();
    await wait(() => wide.text().includes("validated") && wide.text().includes("Independently validated"), "Visible validated completion");
    assert.doesNotMatch(wide.text(), /PRIVATE_SENTINEL/);
    await api(`/session/${session.id}/prompt_async`, { agent: "build", parts: [{ type: "text", text: "Native session" }] });
    await wait(() => wide.text().includes("Native session untouched") && !wide.text().includes("Goal activity"), "Switching to native Build hides old Goal panel");

    cancelMode = true;
    const cancelled = await api("/session", { title: "Cancelled Goal" });
    await api(`/session/${cancelled.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: "Execute visibility goal" }] });
    await wait(async () => (await state(cancelled.id))?.state.metadata?.goal_activity?.milestone === "Preparing local artifacts", "Cancelable builder started");
    const cancelledScreen = attach(cancelled.id, 80);
    await wait(() => cancelledScreen.text().includes("Goal activity"), "Cancelable panel visible");
    await api(`/session/${cancelled.id}/abort`, {});
    await wait(() => cancelledScreen.text().includes("cancelled") && !cancelledScreen.text().includes("| running |"), "Cancellation is visibly terminal");
  } finally {
    for (const item of [builderGate, validatorGate, retryGate, finalGate, cancelGate]) item.release();
    for (const proc of processes.reverse()) stop(proc);
    for (const screen of screens) screen.terminal.dispose();
    provider.closeAllConnections();
    await new Promise(resolve => provider.close(resolve));
    await delay(200);
    await rm(root, { recursive: true, force: true });
  }
});
