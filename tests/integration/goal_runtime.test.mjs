import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, writeFile, symlink, rm } from "node:fs/promises";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { publishGoalAgentFile } from "../../tools/publish_goal_agent.ts";

const repo = path.resolve(import.meta.dirname, "../..");

test("OpenCode V1 continues partial builders, corrects input and recovers the same run after restart", { timeout: 180_000 }, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "goal-runtime-live-")));
  let processHandle;
  let serverLog = "";
  let rootTurns = 0;
  let builds = 0;
  let checks = 0;
  let recoveryBuilders = 0;
  let recoveryPaused = false;
  const requests = [];
  const provider = http.createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      requests.push(input);
      const messages = input.messages ?? [];
      const user = messages.filter(m => m.role === "user").map(m => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n");
      const tools = messages.filter(m => m.role === "tool");
      const cycleStatuses = tools.map(message => {
        const content = typeof message.content === "string" ? message.content : message.content.map(part => part.text ?? "").join("\n");
        try { return JSON.parse(content).status; } catch { return; }
      });
      let call;
      let text = "Phase complete.";
      if (user.includes("Perform only your assigned builder phase")) {
        if (user.includes("Recovery fixture")) {
          if (!tools.length) recoveryBuilders++;
          if (recoveryBuilders === 1) {
            if (!tools.length) call = { name: "write", arguments: JSON.stringify({ filePath: path.join(root, "readiness.json"), content: '{"action":"completed-once"}\n' }) };
            else {
              recoveryPaused = true;
              await new Promise(resolve => res.on("close", resolve));
              return;
            }
          } else if (!messages.some(m => m.role === "assistant" && m.tool_calls?.some(t => t.function.name === "read"))) {
            assert.match(user, /Reconcile recorded task actions/);
            call = { name: "read", arguments: JSON.stringify({ filePath: path.join(root, "readiness.json") }) };
          } else if (!messages.some(m => m.role === "assistant" && m.tool_calls?.some(t => t.function.name === "goal_handoff"))) {
            call = { name: "goal_handoff", arguments: JSON.stringify({ status: "ready", evidence: "Existing action receipt reconciled without replay; counter already checked", remaining: [], checks: { c0: { evidence: "readiness.json receipt completed-once reconciled; counter.txt read good" } } }) };
          }
        } else {
        if (!tools.length) {
          builds++;
          call = { name: "goal_progress", arguments: JSON.stringify({ summary: "Preparing counter implementation" }) };
        } else if (!messages.some(m => m.role === "assistant" && m.tool_calls?.some(t => t.function.name === "write"))) {
          await new Promise(resolve => setTimeout(resolve, 300));
          call = { name: "write", arguments: JSON.stringify({ filePath: path.join(root, builds === 1 ? "readiness.json" : "counter.txt"), content: builds === 1 ? '{"prepared":true}\n' : builds < 5 || user.includes("Non-progress fixture") ? "bad\n" : "good\n" }) };
        } else if (builds <= 2) {
          if (!messages.some(m => m.role === "assistant" && m.tool_calls?.some(t => t.function.name === "goal_handoff"))) call = { name: "goal_handoff", arguments: JSON.stringify({ status: "unfinished", evidence: builds === 1 ? "Readiness prepared" : "First counter operation implemented and checked", remaining: ["Finish the next counter operation and obtain independent checking"] }) };
        } else if (!messages.some(m => m.role === "assistant" && m.tool_calls?.some(t => t.function.name === "read"))) {
          call = { name: "read", arguments: JSON.stringify({ filePath: path.join(root, "counter.txt") }) };
        } else if (!messages.some(m => m.role === "assistant" && m.tool_calls?.some(t => t.function.name === "goal_handoff"))) {
          call = { name: "goal_handoff", arguments: JSON.stringify({ status: "ready", evidence: "Counter implementation written and inspected; independent validation is required", remaining: [], checks: { c0: { evidence: "counter.txt written and read; independent content check still required" } } }) };
        }
        }
      } else if (user.includes("Perform only your assigned validator phase")) {
        if (!tools.length) {
          call = { name: "goal_progress", arguments: JSON.stringify({ summary: "Checking independent counter evidence" }) };
        } else if (builds === 3 && !messages.some(m => m.role === "assistant" && m.tool_calls?.some(t => t.function.name === "goal_verdict"))) {
          await new Promise(resolve => setTimeout(resolve, 300));
          checks++;
          call = { name: "goal_verdict", arguments: JSON.stringify({ status: "blocked", reason: "goal_cycle unavailable to validator", checks: {} }) };
        } else if (builds !== 3 && !messages.some(m => m.role === "assistant" && m.tool_calls?.some(t => t.function.name === "read"))) {
          await new Promise(resolve => setTimeout(resolve, 300));
          call = { name: "read", arguments: JSON.stringify({ filePath: path.join(root, "counter.txt") }) };
        } else if (!messages.some(m => m.role === "assistant" && m.tool_calls?.some(t => t.function.name === "goal_verdict"))) {
          checks++;
          const passed = (await readFile(path.join(root, "counter.txt"), "utf8")) === "good\n";
          call = { name: "goal_verdict", arguments: JSON.stringify({ status: "checked", reason: "", checks: { c0: { passed, evidence: `Read counter.txt: ${passed ? "good" : "bad; replace with good"}`, ...(passed ? { resolution: "Fresh read shows good, resolving previous bad content finding" } : {}) } } }) };
        }
      } else if (user.includes("Inspect historical Goal")) {
        if (!cycleStatuses.includes("inspected")) call = { name: "goal_cycle", arguments: JSON.stringify({ operation: "inspect" }) };
        else text = "Historical inspection complete; no execution.";
      } else if (user.includes("Premature before admission")) text = "Ready to restart; no work performed.";
      else if (input.tools?.some(t => t.function.name === "goal_cycle")) {
         rootTurns++;
        if (user.includes("Generate real images")) {
          if (!tools.length) call = { name: "goal_cycle", arguments: JSON.stringify({ alignment: "clarification_required" }) };
          else text = "Execution mismatch. This definition implements a counter offline and does not authorize generation.";
        } else if (cycleStatuses.includes("blocked")) text = "Goal remains incomplete. Diagnose the recorded non-progress.";
         else if (cycleStatuses.includes("failed") && rootTurns === 3) text = "Premature completion claim.";
         else if (tools.some(t => JSON.stringify(t.content).includes("validated"))) text = "Goal independently validated.";
         else if (user.includes("Recovery fixture") && !messages.slice(messages.findLastIndex(m => m.role === "user" && JSON.stringify(m.content).includes("I inspected the completed action")) + 1)
           .some(m => m.role === "tool" && JSON.stringify(m.content).includes("inspected"))) call = { name: "goal_cycle", arguments: JSON.stringify({ operation: "inspect" }) };
         else if (!tools.length && !user.includes("Non-progress fixture") && !user.includes("Recovery fixture")) call = { name: "goal_cycle", arguments: JSON.stringify({ ...{ alignment: "confirmed" }, authorized_actions: "x".repeat(1001) }) };
         else call = { name: "goal_cycle", arguments: JSON.stringify({ alignment: "confirmed", completion_target: user.includes("Recovery fixture") ? "Recovery fixture: reconcile completed action receipt and independently check counter" : user.includes("Non-progress fixture") ? "Non-progress fixture" : "Counter implementation verified offline", authorized_actions: "Write counter.txt/readiness.json and inspect files. No live generation.", max_cycles: user.includes("Recovery fixture") ? 2 : 5, max_stalled_cycles: 2,
          finding: "c0 or validation protocol unresolved", repair: "Repair counter and obtain independent evidence", expected_evidence: "Fresh read returns good" }) };
      } else text = "Goal fixture"; // Title generation.
      const delta = call ? { tool_calls: [{ index: 0, id: `call-${requests.length}`, type: "function", function: call }] } : { content: text };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const [d, finish] of [[{ role: "assistant", ...delta }, null], [{}, call ? "tool_calls" : "stop"]]) {
        res.write(`data: ${JSON.stringify({ id: `chat-${requests.length}`, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: d, finish_reason: finish }] })}\n\n`);
      }
      res.end("data: [DONE]\n\n");
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  try {
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    await mkdir(path.join(root, ".opencode", "plugins"), { recursive: true });
    await mkdir(path.join(root, ".opencode", "tools"), { recursive: true });
    for (const file of ["plugins/goal.ts", "plugins/immutability.ts", "tools/publish_goal_agent.ts"]) {
      await symlink(path.join(repo, file), path.join(root, ".opencode", file));
    }
    await symlink(path.join(repo, "node_modules"), path.join(root, ".opencode", "node_modules"));
    await writeFile(path.join(root, "opencode.json"), JSON.stringify({
      $schema: "https://opencode.ai/config.json", model: "fixture/default", small_model: "fixture/default",
      agent: { general: { model: "fixture/general" } },
      provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "fixture", options: { baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: "fixture" }, models: {
        default: { name: "default", limit: { context: 128000, output: 4096 } },
        general: { name: "general", limit: { context: 128000, output: 4096 } },
        fixture: { name: "fixture", limit: { context: 128000, output: 4096 } },
      } } },
    }));
    await publishGoalAgentFile(root, {
      name: "fix-counter", description: "Fix counter", outcome: "counter.txt contains good",
      acceptance_criteria: ["counter.txt contains exactly good followed by a newline"],
       durable_context: ["counter.txt"], edit_paths: ["counter.txt", "readiness.json"], bash: false,
      verification_commands: ["Read counter.txt and compare its contents"],
      stop_conditions: ["Filesystem inaccessible"], escalation_triggers: ["Additional edit paths required"],
      instructions: "Write counter.txt and independently check it",
    });
    const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"), XDG_CACHE_HOME: path.join(root, "cache"), OPENCODE_DISABLE_DEFAULT_PLUGINS: "1" };
    for (const key of ["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG_CONTENT", "OPENCODE_SERVER_PASSWORD"]) delete env[key];
    const portProbe = http.createServer();
    portProbe.listen(0, "127.0.0.1");
    await once(portProbe, "listening");
    const port = portProbe.address().port;
    await new Promise(resolve => portProbe.close(resolve));
    const cli = process.env.OPENCODE_GOAL_TEST_CLI ?? path.join(repo, "node_modules", ".bin", "opencode");
    const start = () => {
      processHandle = spawn(cli, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
      processHandle.stdout.on("data", b => { serverLog += b; });
      processHandle.stderr.on("data", b => { serverLog += b; });
    };
    start();
    const base = `http://127.0.0.1:${port}`;
    const api = async (url, body) => {
      const res = await fetch(`${base}${url}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
      assert.ok(res.ok, `${res.status}: ${await (!res.ok ? res.text() : Promise.resolve(""))}`);
      return res.status === 204 ? undefined : res.json();
    };
    for (let i = 0; i < 100; i++) {
      try { await api("/global/health"); break; } catch { if (i === 99) throw new Error(`Server startup failed: ${serverLog}`); await new Promise(r => setTimeout(r, 100)); }
    }
    const session = await api("/session", { title: "Goal fixture" });
    await api(`/session/${session.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: "Execute this goal." }] });
    let history;
    const livePhases = new Set();
    for (let i = 0; i < 300; i++) {
      history = await api(`/session/${session.id}/message`);
      for (const part of history.flatMap(m => m.parts)) {
        if (part.tool === "goal_cycle" && part.state.status === "running" && part.state.metadata?.goal_activity?.milestone) {
          livePhases.add(part.state.metadata.goal_activity.phase);
        }
      }
      if (history.some(m => m.parts.some(p => p.type === "tool" && p.tool === "goal_cycle" && p.state.status === "completed" && JSON.parse(p.state.output).status === "validated"))) break;
      const blocked = history.flatMap(m => m.parts).find(p => p.type === "tool" && p.tool === "goal_cycle" && (p.state.status === "error" || (p.state.status === "completed" && JSON.parse(p.state.output).status === "blocked")));
      if (blocked || i === 299) {
        const children = await api(`/session/${session.id}/children`);
        const records = await Promise.all(children.map(c => api(`/session/${c.id}/message`)));
        throw new Error(`Goal did not complete: ${JSON.stringify({ blocked, history, records }, null, 2)}\n${serverLog}`);
      }
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(builds, 5);
    assert.equal(checks, 3);
    assert.deepEqual([...livePhases].sort(), ["builder", "validator"], "both phases must report while the parent tool is running: " + JSON.stringify(history.flatMap(m => m.parts).filter(p => p.tool === "goal_cycle").map(p => p.state.metadata)));
    const completed = history.flatMap(m => m.parts).findLast(p => p.tool === "goal_cycle" && p.state.status === "completed");
    assert.equal(completed.state.metadata.goal_activity.status, "validated");
    const phaseModels = role => requests
      .filter(input => input.messages?.some(message => message.role === "user" && JSON.stringify(message.content).includes(`Perform only your assigned ${role} phase`)))
      .map(input => input.model);
    for (const role of ["builder", "validator"]) {
      const models = phaseModels(role);
      assert.ok(models.length >= 2, `expected model requests for both ${role} children`);
      assert.deepEqual([...new Set(models)], ["default"]);
    }
    assert.ok(rootTurns >= 3, "premature stop must have resumed");
    const children = await api(`/session/${session.id}/children`);
    assert.equal(children.length, 8);
    assert.equal(new Set(children.map(c => c.id)).size, 8);
    const cycleParts = history.flatMap(m => m.parts).filter(p => p.tool === "goal_cycle" && p.state.status === "completed");
    const executionParts = cycleParts.filter(p => JSON.parse(p.state.output).children?.length);
    const early = JSON.parse(executionParts[0].state.output);
    assert.equal(early.builder_handoff.status, "unfinished");
    assert.equal(early.children.length, 1);
    assert.equal(early.validation, undefined);
    const firstChild = await api(`/session/${early.children[0]}/message`);
    assert.ok(firstChild.some(m => m.parts.some(p => p.tool === "goal_handoff" && p.state.status === "completed" && JSON.parse(p.state.output).status === "unfinished")));
    assert.equal(JSON.parse(executionParts[1].state.output).builder_handoff.status, "unfinished");
    assert.equal(JSON.parse(executionParts[1].state.output).status, "failed", "two partial builders must not stop continuation");
    assert.equal(JSON.parse(cycleParts[0].state.output).status, "invalid_request");
    assert.ok(requests.some(input => input.messages?.some(m => m.role === "user" && JSON.stringify(m.content).includes("UNFINISHED BUILDER CHECKPOINT"))));
    for (const child of children) {
      assert.equal(child.parentID, session.id);
      const messages = await api(`/session/${child.id}/message`);
      assert.equal(messages.filter(m => m.info.role === "user" && !m.parts.every(p => p.synthetic)).length, 1, "each phase has fresh context");
    }
      assert.equal(await readFile(path.join(root, "counter.txt"), "utf8"), "good\n");
      const historical = await api(`/session/${session.id}/message`, { agent: "build", parts: [{ type: "text", text: "Inspect historical Goal without executing." }] });
      const historicalRecords = await api(`/session/${session.id}/message`);
      const inspection = historicalRecords.flatMap(m => m.parts).findLast(p => p.tool === "goal_cycle" && p.state.status === "completed" && JSON.parse(p.state.output).status === "inspected");
      assert.ok(inspection, JSON.stringify(historical));
      assert.equal(JSON.parse(inspection.state.output).selected_agent, "build");
      assert.equal(JSON.parse(inspection.state.output).runtime_contract, "goal-criterion-readiness-v1");
      assert.equal((await api(`/session/${session.id}/children`)).length, 8);
      const unstarted = await api("/session", { title: "Unstarted fixture" });
      await api(`/session/${unstarted.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: "Premature before admission" }] });
      for (let i = 0; i < 100; i++) {
        const records = await api(`/session/${unstarted.id}/message`);
        const checkpoint = records.flatMap(m => m.parts).find(p => p.metadata?.goal_activity?.status === "not_started");
        if (checkpoint) { assert.match(checkpoint.metadata.goal_activity.activity, /no execution or validation evidence/); break; }
        if (i === 99) throw new Error(`Missing not-started checkpoint: ${JSON.stringify(records)}\n${serverLog}`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal((await api(`/session/${unstarted.id}/children`)).length, 0);
      const recovery = await api("/session", { title: "Recovery fixture" });
      await api(`/session/${recovery.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: "Execute Recovery fixture." }] });
      for (let i = 0; !recoveryPaused; i++) {
        if (i === 300) throw new Error("Recovery child did not reach the interruption point");
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const interruptedHistory = await api(`/session/${recovery.id}/message`);
      const interrupted = interruptedHistory.flatMap(m => m.parts).find(p => p.tool === "goal_cycle" && p.state.status === "running" && p.state.metadata?.children?.length);
      assert.ok(interrupted?.state.metadata.cycle_evidence.admission);
      const originalBaseline = interrupted.state.metadata.cycle_evidence.initial_worktree;
      assert.equal(await readFile(path.join(root, "readiness.json"), "utf8"), '{"action":"completed-once"}\n');
      processHandle.kill("SIGKILL");
      await once(processHandle, "exit");
      start();
      for (let i = 0; i < 100; i++) {
        try { await api("/global/health"); break; } catch { if (i === 99) throw new Error(`Restart failed: ${serverLog}`); await new Promise(r => setTimeout(r, 100)); }
      }
      await api(`/session/${recovery.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: "I inspected the completed action receipt. Inspect this run and resume the unchanged definition without replay." }] });
      let recovered;
      for (let i = 0; i < 300; i++) {
        const messages = await api(`/session/${recovery.id}/message`);
        const outputs = messages.flatMap(m => m.parts).filter(p => p.tool === "goal_cycle" && p.state.status === "completed").map(p => JSON.parse(p.state.output));
        recovered = outputs.find(r => r.status === "validated");
        if (recovered) {
          const inspected = outputs.findLast(r => r.status === "inspected");
          assert.equal(inspected.attempts_used, 1);
          assert.equal(inspected.attempts_remaining, 1);
          assert.equal(inspected.interrupted_children[0].status, "idle");
          break;
        }
        if (outputs.some(r => r.status === "blocked") || i === 299) throw new Error(`Recovery did not validate: ${JSON.stringify(messages)}\n${serverLog}`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.deepEqual(recovered.initial_worktree, originalBaseline);
      assert.equal(recovered.admission.max_cycles, 2);
      assert.equal(recoveryBuilders, 2);
      assert.equal((await api(`/session/${recovery.id}/children`)).length, 3);
      assert.equal(await readFile(path.join(root, "readiness.json"), "utf8"), '{"action":"completed-once"}\n');
      for (const [instruction, expectedChildren] of [["Generate real images. Run your loop.", 0], ["Execute Non-progress fixture", 4]]) {
       const stoppedSession = await api("/session", { title: instruction });
       await api(`/session/${stoppedSession.id}/prompt_async`, { agent: "fix-counter", parts: [{ type: "text", text: instruction }] });
       let records;
       for (let i = 0; i < 300; i++) {
         records = await api(`/session/${stoppedSession.id}/message`);
         if (records.at(-1)?.info.role === "assistant" && records.at(-1).info.finish && records.some(message => message.parts.some(part => part.tool === "goal_cycle" && part.state.status === "completed" && JSON.parse(part.state.output).status === "blocked"))) break;
         if (i === 299) throw new Error(`Stop fixture did not finish: ${JSON.stringify(records)}`);
         await new Promise(resolve => setTimeout(resolve, 100));
       }
       const results = records.flatMap(message => message.parts).filter(part => part.tool === "goal_cycle" && part.state.status === "completed").map(part => JSON.parse(part.state.output));
       assert.match(results.at(-1).reason, expectedChildren ? /Non-progress/ : /Execution mismatch/);
       assert.equal((await api(`/session/${stoppedSession.id}/children`)).length, expectedChildren);
       assert.equal(results.length, expectedChildren ? 2 : 1, "stopped outcomes do not schedule another cycle");
       if (expectedChildren) assert.equal(results.at(-1).validation.checks.c0.passed, false);
     }
  } finally {
    if (processHandle && processHandle.exitCode === null) { processHandle.kill("SIGTERM"); await once(processHandle, "exit"); }
    provider.closeAllConnections();
    await new Promise(resolve => provider.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
