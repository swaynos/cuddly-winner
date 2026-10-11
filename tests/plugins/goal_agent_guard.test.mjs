import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ImmutabilityGuard } from "../../plugins/immutability.ts";
import { activeWorktree, goalDefinitionFingerprint, hasGoalAgentFile, publishGoalAgentFile } from "../../tools/publish_goal_agent.ts";

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "goal-agent-guard-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function client(agents = {}, parents = {}, metadata = {}) {
  return { session: {
    get: async ({ path: value }) => ({ data: parents[value.id]
      ? { id: value.id, agent: agents[value.id], parentID: parents[value.id], metadata: metadata[value.id] }
      : { id: value.id, agent: agents[value.id], metadata: metadata[value.id] } }),
  } };
}

async function publish(root, overrides = {}) {
  return publishGoalAgentFile(root, {
    name: "retry-fix",
    description: "Fix retry scheduling.",
    outcome: "Retry scheduling follows the requested policy.",
    acceptance_criteria: ["Focused coverage passes."],
    durable_context: ["docs/REQUIREMENTS.md"],
    edit_paths: ["src/retry.ts"],
    bash: true,
    verification_commands: ["node --test tests/retry.test.mjs"],
    stop_conditions: ["Scope expands."],
    escalation_triggers: ["The outcome is ambiguous."],
    instructions: "Implement the smallest correct change.",
    ...overrides,
  });
}

function checkpoint(root, agent = "retry-fix", overrides = {}) {
  return { runtime_contract: "persistent-worker-v1", agent,
    definition_sha256: goalDefinitionFingerprint(root, agent), state: "working", ...overrides };
}

function sessionMetadata(root, agents, parents = {}, overrides = {}) {
  const metadata = {};
  for (const [id, agent] of Object.entries(agents)) {
    if (!parents[id] && hasGoalAgentFile(root, agent)) {
      metadata[id] = { cuddly_winner_goal: checkpoint(root, agent) };
    }
  }
  return { ...metadata, ...overrides };
}

async function guard(root, agents, parents = {}, overrides = {}) {
  return ImmutabilityGuard({ directory: root, worktree: root,
    client: client(agents, parents, sessionMetadata(root, agents, parents, overrides)) });
}

function mutate(instance, sessionID, filePath) {
  return instance["tool.execute.before"](
    { tool: "edit", sessionID, callID: "call" },
    { args: { filePath, cwd: path.dirname(filePath) } },
  );
}

function invoke(instance, sessionID, tool, args = {}) {
  return instance["tool.execute.before"]({ tool, sessionID, callID: "call" }, { args });
}

test("activeWorktree selects an enclosing worktree and ignores root sentinels or unrelated bases", async () => fixture(async root => {
  const nested = path.join(root, "nested");
  assert.equal(activeWorktree(nested, root), root);
  assert.equal(activeWorktree(root, root), root);
  assert.equal(activeWorktree(nested, `${root}${path.sep}`), root);
  assert.equal(activeWorktree(nested, "/"), nested);
  assert.equal(activeWorktree(nested, path.join(root, "unrelated")), nested);
  assert.equal(activeWorktree(`${root}-sibling`, root), `${root}-sibling`);
  assert.equal(activeWorktree(root, `${root}-sibling`), root);
  assert.equal(activeWorktree(nested), nested);
  assert.equal(activeWorktree(undefined, root), root);
  assert.equal(activeWorktree(), path.resolve(process.cwd()));
}));

test("a nested caller uses parent Goal definition, checkpoint and worktree boundaries while Build stays native", async () => fixture(async root => {
  const nested = path.join(root, "nested");
  await mkdir(nested);
  await writeFile(path.join(root, "counter.mjs"), "export const counter = 1;\n");
  await writeFile(path.join(nested, "counter.mjs"), "export const counter = 0;\n");
  const published = await publish(root, { edit_paths: ["counter.mjs"] });
  const metadata = { goalAgent: { cuddly_winner_goal: checkpoint(root) } };
  const instance = await ImmutabilityGuard({ directory: nested, worktree: root,
    client: client({ goalAgent: "retry-fix", native: "build" }, {}, metadata) });
  await mutate(instance, "goalAgent", path.join(root, "counter.mjs"));
  await assert.rejects(mutate(instance, "goalAgent", path.join(nested, "counter.mjs")), /outside its declared edit paths/);
  await assert.rejects(mutate(instance, "goalAgent", path.join(root, published.path)), /published Goal Agent/);
  await assert.rejects(mutate(instance, "goalAgent", path.join(root, ".opencode/runtime.ts")), /trusted control-plane state/);
  metadata.goalAgent = {};
  await assert.rejects(mutate(instance, "goalAgent", path.join(root, "counter.mjs")), /no Goal checkpoint/);
  await mutate(instance, "native", path.join(root, "counter.mjs"));
  await mutate(instance, "native", path.join(nested, "counter.mjs"));
  await invoke(instance, "native", "bash", { command: "true", cwd: nested });
}));

test("Goal Agents use the policy in their one generated file", async () => fixture(async root => {
  await publish(root);
  const instance = await guard(root, { goalAgent: "retry-fix" });
  await mutate(instance, "goalAgent", path.join(root, "src", "retry.ts"));
  await assert.rejects(mutate(instance, "goalAgent", path.join(root, "README.md")), /outside its declared edit paths/);
  await instance["tool.execute.before"](
    { tool: "bash", sessionID: "goalAgent", callID: "shell" },
    { args: { command: "node --test", cwd: root } },
  );

  const child = await guard(root, { goalAgent: "retry-fix", builder: "general" }, { builder: "goalAgent" });
  await child["tool.execute.before"](
    { tool: "bash", sessionID: "builder", callID: "shell" },
    { args: { command: "node --test", cwd: root } },
  );
}));

test("root Goal mutation and Bash require a started checkpoint", async () => fixture(async root => {
  await publish(root);
  const instance = await guard(root, { goalAgent: "retry-fix" }, {}, { goalAgent: {} });
  await assert.rejects(mutate(instance, "goalAgent", path.join(root, "src/retry.ts")), /goal_run\(operation=start\)/);
  await assert.rejects(invoke(instance, "goalAgent", "bash", { command: "true" }), /no Goal checkpoint/);
  await assert.rejects(invoke(instance, "goalAgent", "browser_download", { path: path.join(root, "src/retry.ts") }), /no Goal checkpoint/);
  await invoke(instance, "goalAgent", "read", { filePath: path.join(root, "src/retry.ts") });
}));

test("checkpoint state is re-read and freezes roots and descendants", async () => fixture(async root => {
  await publish(root);
  const state = checkpoint(root);
  const instance = await guard(root, { goalAgent: "retry-fix", child: "build" }, { child: "goalAgent" },
    { goalAgent: { cuddly_winner_goal: state } });
  for (const value of ["paused", "accepted", "evaluating", "unknown", undefined]) {
    state.state = value;
    for (const sessionID of ["goalAgent", "child"]) {
      await assert.rejects(mutate(instance, sessionID, path.join(root, "src/retry.ts")), /mutation and Bash are frozen/);
      await assert.rejects(invoke(instance, sessionID, "bash", { command: "true" }), /mutation and Bash are frozen/);
      await assert.rejects(invoke(instance, sessionID, "browser_screenshot", { path: path.join(root, "src/retry.ts") }), /mutation and Bash are frozen/);
      await invoke(instance, sessionID, "read");
    }
  }
  state.state = "working";
  await mutate(instance, "goalAgent", path.join(root, "src/retry.ts"));
  await invoke(instance, "goalAgent", "bash", { command: "node --test" });
  await mutate(instance, "child", path.join(root, "src/retry.ts"));
}));

test("only the recorded evaluator child can verify an evaluating Goal and it never writes", async () => fixture(async root => {
  await publish(root);
  const state = checkpoint(root, "retry-fix", { state: "evaluating", evaluation: { childID: "evaluator" } });
  const marker = { parentID: "goalAgent", definition_sha256: state.definition_sha256 };
  const instance = await guard(root, {
    goalAgent: "retry-fix", evaluator: "general", arbitrary: "general", forged: "general", grandchild: "general",
  }, { evaluator: "goalAgent", arbitrary: "goalAgent", forged: "goalAgent", grandchild: "evaluator" }, {
    goalAgent: { cuddly_winner_goal: state }, forged: { cuddly_winner_evaluator: marker },
  });
  // Identity comes from the parent's checkpoint, even before child metadata is set.
  await invoke(instance, "evaluator", "bash", { command: "node --test" });
  await invoke(instance, "evaluator", "read");
  for (const tool of ["edit", "write", "patch", "apply_patch", "browser_screenshot", "browser_download", "cuddly-winner-browser_browser_save_media"]) {
    await assert.rejects(invoke(instance, "evaluator", tool, {
      filePath: path.join(root, "src/retry.ts"), path: path.join(root, "src/retry.ts"),
      patchText: "*** Begin Patch\n*** Add File: src/retry.ts\n+test\n*** End Patch",
    }), /evaluator children are read-only/, tool);
  }
  for (const sessionID of ["goalAgent", "arbitrary", "forged", "grandchild"]) {
    await assert.rejects(invoke(instance, sessionID, "bash", { command: "node --test" }), /mutation and Bash are frozen/, sessionID);
    await assert.rejects(mutate(instance, sessionID, path.join(root, "src/retry.ts")), /frozen|read-only/, sessionID);
  }
  for (const value of ["paused", "accepted", "working"]) {
    state.state = value;
    await assert.rejects(mutate(instance, "evaluator", path.join(root, "src/retry.ts")), /evaluator children are read-only/);
    await assert.rejects(invoke(instance, "evaluator", "bash", { command: "node --test" }), /mutation and Bash are frozen/);
  }
}));

test("evaluator Bash obeys the inherited boolean and managed role limits", async () => fixture(async root => {
  await publish(root, { bash: false });
  const instance = await guard(root, { goalAgent: "retry-fix", evaluator: "general" }, { evaluator: "goalAgent" }, {
    goalAgent: { cuddly_winner_goal: checkpoint(root, "retry-fix", { state: "evaluating", evaluation: { childID: "evaluator" } }) },
  });
  await assert.rejects(invoke(instance, "evaluator", "bash", { command: "node --test" }), /may not execute shell/);
  const researcher = await guard(root, { goalAgent: "retry-fix", evaluator: "grounder" }, { evaluator: "goalAgent" }, {
    goalAgent: { cuddly_winner_goal: checkpoint(root, "retry-fix", { state: "evaluating", evaluation: { childID: "evaluator" } }) },
  });
  await assert.rejects(invoke(researcher, "evaluator", "bash", { command: "node --test" }), /read-only/);
}));

test("evaluator metadata retains read-only ancestry after the parent returns to working", async () => fixture(async root => {
  await publish(root);
  const instance = await guard(root, { goalAgent: "retry-fix", evaluator: "general", child: "build" },
    { evaluator: "goalAgent", child: "evaluator" }, {
      evaluator: { cuddly_winner_evaluator: { parentID: "goalAgent", definition_sha256: goalDefinitionFingerprint(root, "retry-fix") } },
    });
  for (const sessionID of ["evaluator", "child"]) {
    await assert.rejects(mutate(instance, sessionID, path.join(root, "src/retry.ts")), /evaluator children are read-only/);
    await assert.rejects(invoke(instance, sessionID, "bash", { command: "true" }), /mutation and Bash are frozen/);
  }
}));

test("invalid Goal metadata denies writes and Bash", async () => fixture(async root => {
  await publish(root);
  for (const invalid of [null, [], "working", { runtime_contract: "retired" }, { agent: "other-fix" }, { definition_sha256: "0".repeat(64) }]) {
    const value = invalid && !Array.isArray(invalid) && typeof invalid === "object" ? checkpoint(root, "retry-fix", invalid) : invalid;
    const instance = await guard(root, { goalAgent: "retry-fix" }, {}, { goalAgent: { cuddly_winner_goal: value } });
    await assert.rejects(mutate(instance, "goalAgent", path.join(root, "src/retry.ts")), /no Goal checkpoint|invalid Goal metadata/);
    await assert.rejects(invoke(instance, "goalAgent", "bash", { command: "true" }), /no Goal checkpoint|invalid Goal metadata/);
  }
}));

test("old checkpoint runtime and status keys cannot authorize mutation or Bash", async () => fixture(async root => {
  await publish(root);
  const { runtime_contract, state, ...binding } = checkpoint(root);
  for (const value of [
    { ...binding, runtime: runtime_contract, state },
    { ...binding, runtime_contract, status: state },
    { ...binding, runtime: runtime_contract, status: state },
  ]) {
    const instance = await guard(root, { goalAgent: "retry-fix" }, {}, { goalAgent: { cuddly_winner_goal: value } });
    await assert.rejects(mutate(instance, "goalAgent", path.join(root, "src/retry.ts")), /invalid Goal metadata|mutation and Bash are frozen/);
    await assert.rejects(invoke(instance, "goalAgent", "bash", { command: "true" }), /invalid Goal metadata|mutation and Bash are frozen/);
  }
}));

test("definition binding uses checkpoint metadata rather than cycle history, including after reload", async () => fixture(async root => {
  const published = await publish(root);
  const agents = { goalAgent: "retry-fix", child: "build" };
  const parents = { child: "goalAgent" };
  const metadata = sessionMetadata(root, agents, parents);
  const api = client(agents, parents, metadata);
  api.session.messages = async () => { throw new Error("cycle history must not be read"); };
  const instance = await ImmutabilityGuard({ directory: root, worktree: root, client: api });
  await mutate(instance, "goalAgent", path.join(root, "src/retry.ts"));
  const file = path.join(root, published.path);
  const original = await readFile(file, "utf8");
  await writeFile(file, `${original}\nDefinition revision.\n`);
  await assert.rejects(mutate(instance, "child", path.join(root, "src/retry.ts")), /invalid Goal Agent definition/);
  const reloaded = await ImmutabilityGuard({ directory: root, worktree: root, client: api });
  await assert.rejects(mutate(reloaded, "goalAgent", path.join(root, "src/retry.ts")), /changed definition fingerprint/);
  await assert.rejects(invoke(reloaded, "child", "bash", { command: "true" }), /changed definition fingerprint/);
  await rm(file);
  const missing = await ImmutabilityGuard({ directory: root, worktree: root, client: api });
  await assert.rejects(mutate(missing, "goalAgent", path.join(root, "src/retry.ts")), /missing or invalid Goal Agent definition/);
  await assert.rejects(invoke(missing, "child", "bash", { command: "true" }), /missing or invalid Goal Agent definition/);
}));

test("old single-file Goals without the runtime marker require republication", async () => fixture(async root => {
  const published = await publish(root);
  const file = path.join(root, published.path);
  await writeFile(file, (await readFile(file, "utf8")).replace('"runtime":"persistent-worker-v1",', ""));
  const instance = await guard(root, { goalAgent: "retry-fix", child: "build" }, { child: "goalAgent" });
  for (const sessionID of ["goalAgent", "child"]) {
    await assert.rejects(mutate(instance, sessionID, path.join(root, "src/retry.ts")), /runtime marker; republish/);
    await assert.rejects(invoke(instance, sessionID, "bash", { command: "true" }), /runtime marker; republish/);
    await invoke(instance, sessionID, "read");
  }
}));

test("Goal Agents cannot rewrite generated definitions", async () => fixture(async root => {
  const published = await publish(root);
  const instance = await guard(root, { goalAgent: "retry-fix" });
  await assert.rejects(
    mutate(instance, "goalAgent", path.join(root, published.path)),
    /published Goal Agent/,
  );
  await assert.rejects(
    mutate(instance, "goalAgent", path.join(root, ".OPENCODE", "agents", "generated", "retry-fix.md")),
    /published Goal Agent/,
  );
}));

test("browser file writers obey Goal Agent edit paths", async () => fixture(async root => {
  await publish(root);
  const instance = await guard(root, { goalAgent: "retry-fix" });
  await instance["tool.execute.before"](
    { tool: "cuddly-winner-browser_browser_screenshot", sessionID: "goalAgent", callID: "allowed" },
    { args: { path: path.join(root, "src", "retry.ts") } },
  );
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "cuddly-winner-browser_browser_download", sessionID: "goalAgent", callID: "blocked" },
      { args: { path: path.join(root, "README.md") } },
    ),
    /outside its declared edit paths/,
  );
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "browser_save_media", sessionID: "goalAgent", callID: "generated" },
      { args: { path: path.join(root, ".opencode", "agents", "generated", "retry-fix.md") } },
    ),
    /published Goal Agent/,
  );
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "cuddly-winner-browser_browser_download", sessionID: "goalAgent", callID: "aliases" },
      { args: {
        filePath: path.join(root, "src", "retry.ts"),
        path: path.join(root, "README.md"),
      } },
    ),
    /unsupported target arguments/,
  );
}));

test("publisher rejects case-variant protected edit paths", async () => fixture(async root => {
  for (const protectedPath of [
    ".OPENCODE/agents/generated/retry-fix.md",
    ".opencode/runtime.ts",
    "OPENCODE.JSON",
    "opencode.jsonc",
    "AGENTS.md",
  ]) {
    await assert.rejects(
      publish(root, { edit_paths: [protectedPath] }),
      /protected control-plane path/,
      protectedPath,
    );
  }
}));

test("declared task directories are editable outside the loaded control project", async () => fixture(async root => {
  const paths = ["agents/prometheus.md", "plugins/immutability.ts", "TOOLS/publish_goal_agent.ts",
    "scripts/deploy-opencode-agents.sh", "scripts/opencode-playwright-mcp.mjs", "rules/resource-selection.md"];
  await publish(root, { edit_paths: paths });
  const instance = await guard(root, { goalAgent: "retry-fix" });
  for (const item of paths) await mutate(instance, "goalAgent", path.join(root, item));
}));

test("the guard protects its actual loaded runtime sources", async () => fixture(async root => {
  for (const item of ["plugins/immutability.ts", "tools/publish_goal_agent.ts"]) {
    const target = path.join(root, item);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(new URL(`../../${item}`, import.meta.url)));
  }
  await symlink(fileURLToPath(new URL("../../node_modules", import.meta.url)), path.join(root, "node_modules"), "dir");
  const paths = ["plugins/immutability.ts", "tools/publish_goal_agent.ts", "agents/prometheus.md",
    "rules/resource-selection.md", "scripts/opencode-playwright-mcp.mjs", "PLUGINS/new.ts", "src/retry.ts"];
  await publish(root, { edit_paths: paths });
  const { ImmutabilityGuard: loadedGuard } = await import(pathToFileURL(path.join(root, "plugins/immutability.ts")));
  const nested = path.join(root, "nested");
  await mkdir(nested);
  for (const directory of [root, nested]) {
    const instance = await loadedGuard({ directory, worktree: root,
      client: client({ goalAgent: "retry-fix" }, {}, { goalAgent: { cuddly_winner_goal: checkpoint(root) } }) });
    for (const item of paths.slice(0, -1)) {
      await assert.rejects(mutate(instance, "goalAgent", path.join(root, item)), /trusted control-plane state/, item);
    }
    await mutate(instance, "goalAgent", path.join(root, "src/retry.ts"));
  }
}));

test("a malformed generated policy fails closed", async () => fixture(async root => {
  const file = path.join(root, ".opencode", "agents", "generated", "retry-fix.md");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "---\nname: retry-fix\nmode: primary\n---\nmissing policy\n");
  const instance = await guard(root, { goalAgent: "retry-fix" });
  await assert.rejects(mutate(instance, "goalAgent", path.join(root, "src", "retry.ts")), /invalid Goal Agent definition/);
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "bash", sessionID: "goalAgent", callID: "shell" },
      { args: { command: "true", cwd: root } },
    ),
    /invalid Goal Agent definition/,
  );
}));

test("Goal-Agent policy boundaries inherit through descendants", async () => fixture(async root => {
  await publish(root, { bash: false });
  const instance = await guard(root, { parent: "retry-fix", child: "build" }, { child: "parent" });
  await mutate(instance, "child", path.join(root, "src", "retry.ts"));
  await assert.rejects(mutate(instance, "child", path.join(root, "README.md")), /outside its declared edit paths/);
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "bash", sessionID: "child", callID: "shell" },
      { args: { command: "true", cwd: root } },
    ),
    /may not execute shell/,
  );
}));

test("nested Goal Agents combine their Bash restrictions", async () => fixture(async root => {
  await publish(root, { bash: true });
  await publish(root, { name: "nested-fix", bash: false });
  const instance = await guard(root, { parent: "retry-fix", child: "nested-fix" }, { child: "parent" });
  await mutate(instance, "child", path.join(root, "src", "retry.ts"));
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "bash", sessionID: "child", callID: "shell" },
      { args: { command: "true", cwd: root } },
    ),
    /may not execute shell/,
  );
}));

test("nested Goal edit paths intersect rather than expand parent authority", async () => fixture(async root => {
  await publish(root);
  await publish(root, { name: "nested-fix", edit_paths: ["src/retry.ts", "src/other.ts"] });
  const instance = await guard(root, { parent: "retry-fix", child: "nested-fix" }, { child: "parent" });
  await mutate(instance, "child", path.join(root, "src/retry.ts"));
  await assert.rejects(mutate(instance, "child", path.join(root, "src/other.ts")), /outside its declared edit paths/);
}));

test("selected agents follow chat.params while child Build keeps Goal ancestry", async () => fixture(async root => {
  await publish(root);
  const instance = await guard(root, { goalAgent: "retry-fix", child: "general", native: "build" }, { child: "goalAgent" }, {
    goalAgent: { cuddly_winner_goal: checkpoint(root, "retry-fix", { state: "paused" }) },
  });
  await instance["chat.params"]({ sessionID: "child", agent: "build" });
  await assert.rejects(mutate(instance, "child", path.join(root, "README.md")), /mutation and Bash are frozen/);
  await instance["chat.params"]({ sessionID: "goalAgent", agent: "build" });
  await mutate(instance, "goalAgent", path.join(root, "README.md"));
  await invoke(instance, "goalAgent", "bash", { command: "true" });
  await invoke(instance, "goalAgent", "publish_goal_agent");
  await instance["chat.params"]({ sessionID: "goalAgent", agent: "plan" });
  await invoke(instance, "goalAgent", "bash", { command: "true" });
  await assert.rejects(invoke(instance, "goalAgent", "publish_goal_agent"), /only @prometheus or @build/);
  await instance["chat.params"]({ sessionID: "native", agent: "ask" });
  await assert.rejects(mutate(instance, "native", path.join(root, "README.md")), /read-only/);
  await instance["chat.params"]({ sessionID: "native", agent: "build" });
  await mutate(instance, "native", path.join(root, "README.md"));
}));

test("unresolved or cyclic session ancestry fails closed for mutation and Bash", async () => fixture(async root => {
  const failingClients = [
    { session: { get: async () => { throw new Error("metadata unavailable"); } } },
    { session: { get: async () => ({ data: { id: "wrong", agent: "build" } }) } },
    { session: { get: async () => ({ error: "unavailable" }) } },
    client({ child: "build", parent: "build" }, { child: "parent", parent: "child" }),
  ];
  for (const api of failingClients) {
    const instance = await ImmutabilityGuard({ directory: root, worktree: root, client: api });
    await assert.rejects(mutate(instance, "child", path.join(root, "README.md")), /invalid or cyclic ancestry/);
    await assert.rejects(invoke(instance, "child", "bash", { command: "true" }), /invalid or cyclic ancestry/);
    await assert.rejects(invoke(instance, "child", "publish_goal_agent"), /invalid or cyclic ancestry/);
  }
}));

test("transient session reads deny the current write but allow verified same-session recovery", async () => fixture(async root => {
  await publish(root);
  const agents = { goalAgent: "retry-fix", child: "build" };
  const parents = { child: "goalAgent" };
  const metadata = sessionMetadata(root, agents, parents);
  for (const sessionID of ["goalAgent", "child"]) {
    for (const failure of ["transport", "unreadable response"]) {
      const api = client(agents, parents, metadata);
      const get = api.session.get;
      const reads = [];
      let available = false;
      api.session.get = async input => {
        reads.push(input.path.id);
        if (!available && input.path.id === "goalAgent") {
          if (failure === "transport") throw new Error("session API unavailable");
          return { error: "session API unavailable" };
        }
        return get(input);
      };
      const instance = await ImmutabilityGuard({ directory: root, worktree: root, client: api });
      await assert.rejects(mutate(instance, sessionID, path.join(root, "src/retry.ts")), /invalid or cyclic ancestry/);
      available = true;
      reads.length = 0;
      // Only the guard hook runs: no edit was dispatched or needs replaying.
      await mutate(instance, sessionID, path.join(root, "src/retry.ts"));
      assert.deepEqual(reads, sessionID === "goalAgent" ? ["goalAgent"] : ["child", "goalAgent"]);
      await assert.rejects(mutate(instance, sessionID, path.join(root, "README.md")), /outside its declared edit paths/);
    }
  }
}));

test("deterministically cyclic ancestry remains cached as invalid", async () => fixture(async root => {
  const parents = { child: "parent", parent: "child" };
  const api = client({ child: "build", parent: "build" }, parents);
  const get = api.session.get;
  let reads = 0;
  api.session.get = async input => { reads++; return get(input); };
  const instance = await ImmutabilityGuard({ directory: root, worktree: root, client: api });
  await assert.rejects(mutate(instance, "child", path.join(root, "README.md")), /invalid or cyclic ancestry/);
  assert.equal(reads, 2);
  delete parents.parent;
  await assert.rejects(mutate(instance, "child", path.join(root, "README.md")), /invalid or cyclic ancestry/);
  await assert.rejects(invoke(instance, "parent", "bash", { command: "true" }), /invalid or cyclic ancestry/);
  assert.equal(reads, 2, "known cyclic sessions stay denied without rereading the API");
}));

test("patch moves and browser paths cannot escape exact paths or the worktree", async () => fixture(async root => {
  await publish(root, { edit_paths: ["src/retry.ts", "src/link.ts"] });
  const instance = await guard(root, { goalAgent: "retry-fix" });
  await assert.rejects(invoke(instance, "goalAgent", "apply_patch", {
    patchText: "*** Begin Patch\n*** Update File: src/retry.ts\n*** Move to: README.md\n*** End Patch",
  }), /outside its declared edit paths/);
  await assert.rejects(invoke(instance, "goalAgent", "edit"), /did not expose mutation targets/);
  await assert.rejects(invoke(instance, "goalAgent", "browser_download", { path: "src/retry.ts" }), /absolute output path/);
  await assert.rejects(mutate(instance, "goalAgent", path.join(root, "../escape.ts")), /escapes active worktree/);
  await mkdir(path.join(root, "src"));
  await symlink(path.join(root, "README.md"), path.join(root, "src/link.ts"));
  await assert.rejects(mutate(instance, "goalAgent", path.join(root, "src/link.ts")), /escapes active worktree/);
}));

test("Prometheus may publish Goal Agents but cannot edit or use Bash", async () => fixture(async root => {
  const instance = await guard(root, { planner: "prometheus" });
  await instance["tool.execute.before"](
    { tool: "publish_goal_agent", sessionID: "planner", callID: "publish" },
    { args: {} },
  );
  await assert.rejects(mutate(instance, "planner", path.join(root, "README.md")), /may not edit project files/);
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "bash", sessionID: "planner", callID: "shell" },
      { args: { command: "true", cwd: root } },
    ),
    /may not execute shell/,
  );
}));

test("only root Prometheus and Build sessions may publish Goal Agents", async () => fixture(async root => {
  const instance = await guard(root, {
    build: "build",
    planner: "prometheus",
    plan: "plan",
    ask: "ask",
    general: "general",
    unknown: undefined,
    child: "build",
  }, { child: "build" });
  await instance["tool.execute.before"](
    { tool: "publish_goal_agent", sessionID: "build", callID: "publish" },
    { args: {} },
  );
  await instance["tool.execute.before"](
    { tool: "publish_goal_agent", sessionID: "planner", callID: "publish" },
    { args: {} },
  );
  for (const sessionID of ["plan", "ask", "general", "unknown", "child"]) {
    await assert.rejects(
      instance["tool.execute.before"](
        { tool: "publish_goal_agent", sessionID, callID: "publish" },
        { args: {} },
      ),
      /only @prometheus or @build/,
      sessionID,
    );
  }
}));

test("children keep their own role limits and cannot inherit publication", async () => fixture(async root => {
  await publish(root);
  const instance = await guard(root, {
    planner: "prometheus",
    researcher: "grounder",
    worker: "build",
    native: "build",
    nestedPlanner: "prometheus",
    goalAgent: "retry-fix",
    goalAgentResearcher: "grounder",
  }, {
    researcher: "planner",
    worker: "planner",
    nestedPlanner: "native",
    goalAgentResearcher: "goalAgent",
  });

  for (const sessionID of ["researcher", "worker", "nestedPlanner"]) {
    await assert.rejects(
      instance["tool.execute.before"](
        { tool: "publish_goal_agent", sessionID, callID: "publish" },
        { args: {} },
      ),
      /only @prometheus or @build/,
    );
  }
  await assert.rejects(
    mutate(instance, "goalAgentResearcher", path.join(root, "src", "retry.ts")),
    /read-only/,
  );
}));

test("managed children cannot exceed managed parent restrictions", async () => fixture(async root => {
  await publish(root);
  const instance = await guard(root, {
    researcher: "grounder",
    goalAgentUnderResearch: "retry-fix",
    planner: "prometheus",
    goalAgentUnderPlanner: "retry-fix",
  }, {
    goalAgentUnderResearch: "researcher",
    goalAgentUnderPlanner: "planner",
  });

  await assert.rejects(
    mutate(instance, "goalAgentUnderResearch", path.join(root, "src", "retry.ts")),
    /read-only/,
  );
  await assert.rejects(
    mutate(instance, "goalAgentUnderPlanner", path.join(root, "src", "retry.ts")),
    /@prometheus may not edit/,
  );
}));

test("retired generated task packages fail closed until republished", async () => fixture(async root => {
  const agents = path.join(root, ".opencode", "agents");
  const tasks = path.join(root, ".opencode", "tasks");
  await mkdir(agents, { recursive: true });
  await mkdir(tasks, { recursive: true });
  await writeFile(path.join(agents, "legacy-fix.md"), "---\nname: legacy-fix\nmode: primary\n---\nlegacy\n");
  await writeFile(path.join(tasks, "legacy-fix.md"), "# Legacy task\n");
  await writeFile(path.join(tasks, "legacy-fix.json"), "{}\n");
  await writeFile(path.join(root, ".opencode", "generated-agents.json"), "{}\n");

  const instance = await guard(root, { legacy: "legacy-fix" });
  await assert.rejects(
    mutate(instance, "legacy", path.join(root, "src", "retry.ts")),
    /retired generated-agent package/,
  );
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "bash", sessionID: "legacy", callID: "shell" },
      { args: { command: "true", cwd: root } },
    ),
    /retired generated-agent package/,
  );
}));

test("read-only roles and browser-state exports stay protected while native Build stays native", async () => fixture(async root => {
  const instance = await guard(root, { ask: "ask", build: "build" });
  await assert.rejects(mutate(instance, "ask", path.join(root, "README.md")), /read-only/);
  await mutate(instance, "build", path.join(root, "README.md"));
  await assert.rejects(
    instance["tool.execute.before"](
      { tool: "playwright_browser_storage_state", sessionID: "build", callID: "state" },
      { args: {} },
    ),
    /saved browser authentication state/,
  );
  await instance["tool.execute.before"](
    { tool: "playwright_browser_navigate", sessionID: "build", callID: "browse" },
    { args: { url: "https://example.com" } },
  );
}));
