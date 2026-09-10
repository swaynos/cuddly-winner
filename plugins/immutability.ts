import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { isRegisteredGeneratedAgent, validateTaskPackage } from "../tools/validate_scaffold.ts";

const MUTATING_TOOLS = new Set(["write", "edit", "patch", "apply_patch"]);
const SHELL_TOOLS = new Set(["bash"]);
const PROMETHEUS_ONLY_TOOLS = new Set(["spike", "scaffold_gitignore", "validate_scaffold"]);
const MANAGED_AGENTS = new Set(["ask", "prometheus", "reviewer", "grounder"]);
const READ_ONLY_AGENTS = new Set(["ask", "reviewer", "grounder"]);
const PROMETHEUS_WRITABLE = [".opencode/agents/**", ".opencode/tasks/**", ".opencode/generated-agents.json", ".spike/**"];
const TRUSTED_PATHS = [
  "tools/spike.ts",
  "tools/validate_scaffold.ts",
  "tools/scaffold_gitignore.ts",
  "plugins/immutability.ts",
  "plugins/autonomous-kpis.ts",
  "skills/cuddly-winner-feedback/record-feedback.mjs",
];

function matchesPattern(relPath: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/\\/g, "/")
    .replace(/[.+^${}()|[\]]/g, "\\$&")
    .replace(/\*\*/g, "{{DOUBLE_STAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{DOUBLE_STAR\}\}/g, ".*");
  return new RegExp(`^${escaped}$`).test(relPath.replace(/\\/g, "/"));
}

function extractPatchedPaths(patchText: string): string[] {
  const paths = new Set<string>();
  for (const line of patchText.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/) ?? line.match(/^\*\*\* Move to: (.+)$/);
    if (match?.[1].trim()) paths.add(match[1].trim());
  }
  return [...paths];
}

function safeTarget(lexicalRoot: string, root: string, target: string): string {
  const resolved = resolve(target);
  if (!isInside(lexicalRoot, resolved)) throw new Error(`ImmutabilityGuard: target escapes active worktree: ${target}`);
  const rel = relative(lexicalRoot, resolved);
  let current = lexicalRoot;
  for (const part of rel ? rel.split(sep) : []) {
    current = resolve(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error(`ImmutabilityGuard: target escapes active worktree: ${target}`);
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return resolve(root, rel);
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function isTrustedPath(relPath: string): boolean {
  return TRUSTED_PATHS.some((trusted) => relPath === trusted || relPath.startsWith(`${trusted}/`));
}

function isPublishedTaskPackage(relPath: string): boolean {
  return relPath === ".opencode/generated-agents.json" || relPath.startsWith(".opencode/agents/") || relPath.startsWith(".opencode/tasks/");
}

function resolvedSession(result: unknown, sessionID: string): Record<string, any> | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return;
  const response = result as Record<string, unknown>;
  const value = Object.prototype.hasOwnProperty.call(response, "data") ? response.data : result;
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const session = value as Record<string, any>;
  if (session.id !== sessionID) return;
  if (Object.prototype.hasOwnProperty.call(session, "parentID") && (typeof session.parentID !== "string" || !session.parentID)) return;
  return session;
}

type AgentSelection = { agent: string; created?: number; index: number };
type HistoryResolution = { valid: true; selections: AgentSelection[] } | { valid: false };

function userAgentSelections(result: unknown): HistoryResolution {
  const messages = Array.isArray(result)
    ? result
    : result && typeof result === "object" && !Array.isArray(result) && Array.isArray((result as Record<string, unknown>).data)
      ? (result as Record<string, unknown>).data as unknown[]
      : undefined;
  if (!messages) return { valid: false };
  const selections: AgentSelection[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || typeof message !== "object" || Array.isArray(message)) return { valid: false };
    const info = (message as Record<string, unknown>).info;
    if (!info || typeof info !== "object" || Array.isArray(info) || typeof (info as Record<string, unknown>).role !== "string") {
      return { valid: false };
    }
    const messageInfo = info as Record<string, unknown>;
    if (messageInfo.role !== "user") continue;
    const agent = messageInfo.agent;
    if (typeof agent !== "string" || !agent) return { valid: false };
    const time = messageInfo.time;
    const rawCreated = time && typeof time === "object" && !Array.isArray(time) ? (time as Record<string, unknown>).created : undefined;
    const created = typeof rawCreated === "number" && Number.isFinite(rawCreated)
      ? rawCreated
      : undefined;
    selections.push({ agent, created, index });
  }
  if (selections.every((selection) => selection.created !== undefined)) {
    selections.sort((left, right) => left.created! - right.created! || left.index - right.index);
  }
  return { valid: true, selections };
}

export const ImmutabilityGuard = async ({ directory, worktree, client }: { directory: string; worktree: string; client: any }) => {
  const lexicalRoot = resolve(directory || worktree);
  const root = realpathSync(lexicalRoot);
  const sessionAgents = new Map<string, string>();
  const invalidAncestry = new Set<string>();
  const publicationReminders = new Set<string>();

  type GeneratedPolicy = { editPaths: string[]; bash: boolean };
  type GeneratedRegistration = { registered: boolean; policy?: GeneratedPolicy };
  const generatedPolicies = new Map<string, Promise<GeneratedRegistration>>();
  function generatedPolicy(agent: string): Promise<GeneratedRegistration> {
    const cached = generatedPolicies.get(agent);
    if (cached) return cached;
    const pending = (async () => {
      let registered = false;
      try {
        registered = await isRegisteredGeneratedAgent(root, agent);
        if (!registered) return { registered: false };
        const result = await validateTaskPackage(root, agent);
        if (!result.valid) return { registered };
        const manifest = JSON.parse(readFileSync(resolve(root, `.opencode/tasks/${agent}.json`), "utf8"));
        return { registered, policy: { editPaths: manifest.permissions.edit_paths, bash: manifest.permissions.bash } };
      } catch {
        return { registered };
      }
    })();
    generatedPolicies.set(agent, pending);
    return pending;
  }
  async function isManaged(agent: string): Promise<boolean> { return MANAGED_AGENTS.has(agent) || (await generatedPolicy(agent)).registered; }

  async function stickyManagedAgent(sessionID: string, candidate?: string): Promise<string | undefined> {
    const cached = sessionAgents.get(sessionID);
    if (cached || !candidate || !await isManaged(candidate)) return cached;
    const resolved = sessionAgents.get(sessionID);
    if (resolved) return resolved;
    sessionAgents.set(sessionID, candidate);
    return candidate;
  }

  async function historicalManagedAgent(sessionID: string): Promise<{ valid: true; agent?: string } | { valid: false }> {
    try {
      const history = userAgentSelections(await client?.session?.messages?.({ path: { id: sessionID } }));
      if (!history.valid) return history;
      for (const selection of history.selections) {
        if (await isManaged(selection.agent)) return { valid: true, agent: selection.agent };
      }
      return { valid: true };
    } catch {
      return { valid: false };
    }
  }

  type AgentResolution = { valid: true; agent?: string } | { valid: false };
  async function resolveAgent(sessionID: string, visited = new Set<string>()): Promise<AgentResolution> {
    if (invalidAncestry.has(sessionID)) return { valid: false };
    if (visited.has(sessionID)) {
      for (const id of visited) invalidAncestry.add(id);
      invalidAncestry.add(sessionID);
      return { valid: false };
    }
    visited.add(sessionID);
    let session: Record<string, any>;
    try {
      const result = await client?.session?.get?.({ path: { id: sessionID } });
      const resolved = resolvedSession(result, sessionID);
      if (!resolved) throw new Error("unresolved session");
      session = resolved;
      const parentID = session?.parentID;
      if (parentID) {
        const parent = await resolveAgent(parentID, visited);
        if (!parent.valid) {
          invalidAncestry.add(sessionID);
          return parent;
        }
        if (!parent.agent) {
          invalidAncestry.add(sessionID);
          return { valid: false };
        }
        if (await isManaged(parent.agent)) {
          sessionAgents.set(sessionID, parent.agent);
          return { valid: true, agent: parent.agent };
        }
      }
    } catch {
      for (const id of visited) invalidAncestry.add(id);
      return { valid: false };
    }
    const cached = sessionAgents.get(sessionID);
    if (cached) return { valid: true, agent: cached };
    const historical = await historicalManagedAgent(sessionID);
    if (!historical.valid) return historical;
    const remembered = await stickyManagedAgent(sessionID, historical.agent);
    if (remembered) return { valid: true, agent: remembered };
    const current = typeof session?.agent === "string" && session.agent ? session.agent : undefined;
    const managed = await stickyManagedAgent(sessionID, current);
    if (managed) return { valid: true, agent: managed };
    if (current) return { valid: true, agent: current };
    if (session.parentID) {
      invalidAncestry.add(sessionID);
      return { valid: false };
    }
    return { valid: true };
  }

  // Unlike resolveAgent, this never walks parentID or reads/writes the shared
  // inheritance cache: the idle-publication reminder must fire only for a
  // session that is itself Prometheus, not a managed descendant (e.g. a
  // Grounder child) that merely inherits Prometheus's edit restrictions.
  async function ownAgent(sessionID: string): Promise<string | undefined> {
    try {
      const result = await client?.session?.get?.({ path: { id: sessionID } });
      const session = result?.data ?? result;
      if (typeof session?.agent === "string" && session.agent) return session.agent;
    } catch {}
    try {
      const result = await client?.session?.messages?.({ path: { id: sessionID } });
      const messages = result?.data ?? (Array.isArray(result) ? result : []);
      for (let index = messages.length - 1; index >= 0; index--) {
        const info = messages[index]?.info;
        if (info?.role === "user" && info.agent) return info.agent;
      }
    } catch {}
    return undefined;
  }

  return {
    event: async ({ event }: { event: { type: string; properties?: { sessionID?: string } } }) => {
      if (event.type !== "session.idle") return;
      const sessionID = event.properties?.sessionID;
      if (!sessionID || publicationReminders.has(sessionID)) return;
      const agent = await ownAgent(sessionID);
      if (agent !== "prometheus") return;
      if (existsSync(resolve(root, ".opencode/generated-agents.json"))) return;

      // Continue the same session once rather than allowing an unpublished plan to end silently.
      publicationReminders.add(sessionID);
      await client?.session?.promptAsync?.({
        path: { id: sessionID },
        body: {
          agent: "prometheus",
          parts: [{ type: "text", text: "Before completing, publish a registered .opencode generated-agent task package if this task is planning-ready. If a concrete planning blocker remains, state it as a focused question." }],
        },
      });
    },
    "chat.params": async (input: { sessionID: string; agent: string }) => {
      if (!input.sessionID || !input.agent) return;
      const resolution = await resolveAgent(input.sessionID);
      if (resolution.valid) await stickyManagedAgent(input.sessionID, input.agent);
    },
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args?: Record<string, unknown> },
    ) => {
      if (!MUTATING_TOOLS.has(input.tool) && !SHELL_TOOLS.has(input.tool) && !PROMETHEUS_ONLY_TOOLS.has(input.tool)) return;
      const resolution = await resolveAgent(input.sessionID);
      if (!resolution.valid) throw new Error("ImmutabilityGuard: session has invalid or cyclic ancestry; mutation and shell access are denied.");
      const agent = resolution.agent;
      if (!agent || !await isManaged(agent)) return;
      const registration = await generatedPolicy(agent);
      const generated = registration.policy;
      if (registration.registered && !generated) throw new Error(`ImmutabilityGuard: @${agent} has an invalid generated task package; mutation and shell access are denied.`);

      if (PROMETHEUS_ONLY_TOOLS.has(input.tool)) {
        if (agent !== "prometheus") throw new Error(`ImmutabilityGuard: only @prometheus may invoke ${input.tool}.`);
        return;
      }

      const args = output.args ?? {};
      if (SHELL_TOOLS.has(input.tool)) {
        if (READ_ONLY_AGENTS.has(agent)) throw new Error(`ImmutabilityGuard: @${agent} is read-only.`);
        if (agent === "prometheus") throw new Error("ImmutabilityGuard: @prometheus may not execute shell commands directly.");
        if (generated && !generated.bash) throw new Error(`ImmutabilityGuard: @${agent} may not execute shell commands.`);
        return;
      }

      if (READ_ONLY_AGENTS.has(agent)) throw new Error(`ImmutabilityGuard: @${agent} is read-only.`);
      const rawPath = (args.filePath ?? args.file_path ?? args.path) as string | undefined;
      const cwd = (args.cwd as string | undefined) ?? root;
      const paths = rawPath
        ? [isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath)]
        : input.tool === "apply_patch" && typeof args.patchText === "string"
          ? extractPatchedPaths(args.patchText).map((item) => isAbsolute(item) ? item : resolve(cwd, item))
          : [];
      if (!paths.length) throw new Error(`ImmutabilityGuard: ${input.tool} did not expose mutation targets.`);

      for (const unresolvedPath of paths) {
        const absolutePath = safeTarget(lexicalRoot, root, unresolvedPath);
        const relPath = relative(root, absolutePath).replace(/\\/g, "/");
        if (isPublishedTaskPackage(relPath) && agent !== "prometheus") throw new Error(`ImmutabilityGuard: @${agent} cannot rewrite published task package: "${relPath}".`);
        if (agent === "prometheus" && isPublishedTaskPackage(relPath)) continue;
        if (isTrustedPath(relPath)) throw new Error(`ImmutabilityGuard: "${relPath}" is trusted control-plane state.`);
        if (generated && !generated.editPaths.includes(relPath)) throw new Error(`ImmutabilityGuard: @${agent} cannot edit outside its declared edit paths: "${relPath}".`);
        if (agent === "prometheus" && !PROMETHEUS_WRITABLE.some((pattern) => matchesPattern(relPath, pattern))) {
          throw new Error(`ImmutabilityGuard: @prometheus is restricted to writing [${PROMETHEUS_WRITABLE.join(", ")}].`);
        }
      }
    },
  };
};
