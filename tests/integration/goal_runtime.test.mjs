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

test("OpenCode V1 resumes an unfinished builder before validation, then repairs independent failures", { timeout: 120_000 }, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "goal-runtime-live-")));
  let processHandle;
  let serverLog = "";
  let rootTurns = 0;
  let builds = 0;
  let checks = 0;
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
        if (!tools.length) {
          builds++;
          call = { name: "goal_progress", arguments: JSON.stringify({ summary: "Preparing counter implementation" }) };
        } else if (!messages.some(m => m.role === "assistant" && m.tool_calls?.some(t => t.function.name === "write"))) {
          await new Promise(resolve => setTimeout(resolve, 300));
          call = { name: "write", arguments: JSON.stringify({ filePath: path.join(root, builds === 1 ? "readiness.json" : "counter.txt"), content: builds === 1 ? '{"prepared":true}\n' : builds < 4 || user.includes("Non-progress fixture") ? "bad\n" : "good\n" }) };
        } else if (builds === 1) {
          // Deliberately no handoff: the builder admits missing implementation
          // after changing only metadata. The runtime must not start a validator.
          text = "Readiness metadata recorded; counter implementation is still missing.";
        } else if (!messages.some(m => m.role === "assistant" && m.tool_calls?.some(t => t.function.name === "read"))) {
          call = { name: "read", arguments: JSON.stringify({ filePath: path.join(root, "counter.txt") }) };
        } else if (!messages.some(m => m.role === "assistant" && m.tool_calls?.some(t => t.function.name === "goal_handoff"))) {
          call = { name: "goal_handoff", arguments: JSON.stringify({ status: "ready", evidence: "Counter implementation written and inspected; independent validation is required", remaining: [] }) };
        }
      } else if (user.includes("Perform only your assigned validator phase")) {
        if (!tools.length) {
          call = { name: "goal_progress", arguments: JSON.stringify({ summary: "Checking independent counter evidence" }) };
        } else if (builds === 2 && !messages.some(m => m.role === "assistant" && m.tool_calls?.some(t => t.function.name === "goal_verdict"))) {
          await new Promise(resolve => setTimeout(resolve, 300));
          checks++;
          call = { name: "goal_verdict", arguments: JSON.stringify({ status: "blocked", reason: "goal_cycle unavailable to validator", checks: {} }) };
        } else if (builds !== 2 && !messages.some(m => m.role === "assistant" && m.tool_calls?.some(t => t.function.name === "read"))) {
          await new Promise(resolve => setTimeout(resolve, 300));
          call = { name: "read", arguments: JSON.stringify({ filePath: path.join(root, "counter.txt") }) };
        } else if (!messages.some(m => m.role === "assistant" && m.tool_calls?.some(t => t.function.name === "goal_verdict"))) {
          checks++;
          const passed = (await readFile(path.join(root, "counter.txt"), "utf8")) === "good\n";
          call = { name: "goal_verdict", arguments: JSON.stringify({ status: "checked", reason: "", checks: { c0: { passed, evidence: `Read counter.txt: ${passed ? "good" : "bad; replace with good"}`, ...(passed ? { resolution: "Fresh read shows good, resolving previous bad content finding" } : {}) } } }) };
        }
      } else if (input.tools?.some(t => t.function.name === "goal_cycle")) {
         rootTurns++;
        if (user.includes("Generate real images")) {
          if (!tools.length) call = { name: "goal_cycle", arguments: JSON.stringify({ alignment: "clarification_required" }) };
          else text = "Execution mismatch. This definition implements a counter offline and does not authorize generation.";
        } else if (cycleStatuses.includes("blocked")) text = "Goal remains incomplete. Diagnose the recorded non-progress.";
        else if (rootTurns === 2) text = "Premature completion claim.";
        else if (tools.some(t => JSON.stringify(t.content).includes("validated"))) text = "Goal independently validated.";
        else call = { name: "goal_cycle", arguments: JSON.stringify({ alignment: "confirmed", completion_target: user.includes("Non-progress fixture") ? "Non-progress fixture" : "Counter implementation verified offline", authorized_actions: "Write counter.txt and inspect files. No live generation.", max_cycles: 4, max_stalled_cycles: user.includes("Non-progress fixture") ? 2 : 3,
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
    processHandle = spawn(cli, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    processHandle.stdout.on("data", b => { serverLog += b; });
    processHandle.stderr.on("data", b => { serverLog += b; });
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
    assert.equal(builds, 4);
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
    assert.equal(children.length, 7);
    assert.equal(new Set(children.map(c => c.id)).size, 7);
    const cycleParts = history.flatMap(m => m.parts).filter(p => p.tool === "goal_cycle" && p.state.status === "completed");
    const early = JSON.parse(cycleParts[0].state.output);
    assert.equal(early.builder_handoff.status, "unfinished");
    assert.equal(early.children.length, 1);
    assert.equal(early.validation, undefined);
    const firstChild = await api(`/session/${early.children[0]}/message`);
    assert.ok(firstChild.some(m => m.parts.some(p => p.type === "text" && p.text.includes("implementation is still missing"))));
    assert.ok(requests.some(input => input.messages?.some(m => m.role === "user" && JSON.stringify(m.content).includes("UNFINISHED BUILDER CHECKPOINT"))));
    for (const child of children) {
      assert.equal(child.parentID, session.id);
      const messages = await api(`/session/${child.id}/message`);
      assert.equal(messages.filter(m => m.info.role === "user" && !m.parts.every(p => p.synthetic)).length, 1, "each phase has fresh context");
    }
     assert.equal(await readFile(path.join(root, "counter.txt"), "utf8"), "good\n");
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
