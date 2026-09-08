import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { validateManifest } from "../tools/validate_scaffold.ts";

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
    const match = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
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

export const ImmutabilityGuard = async ({ directory, worktree, client }: { directory: string; worktree: string; client: any }) => {
  const lexicalRoot = resolve(directory || worktree);
  const root = realpathSync(lexicalRoot);
  const sessionAgents = new Map<string, string>();
  const publicationReminders = new Set<string>();

  type GeneratedPolicy = { editPaths: string[]; bash: boolean };
  const generatedPolicies = new Map<string, GeneratedPolicy | undefined>();
  function generatedPolicy(agent: string): GeneratedPolicy | undefined {
    if (generatedPolicies.has(agent)) return generatedPolicies.get(agent);
    let policy: GeneratedPolicy | undefined;
    try {
      const registry = JSON.parse(readFileSync(resolve(root, ".opencode/generated-agents.json"), "utf8"));
      const entry = Array.isArray(registry?.agents) ? registry.agents.find((item: any) => item?.name === agent) : undefined;
      if (registry?.schema_version === 1 && typeof entry?.manifest === "string") {
        const manifest = JSON.parse(readFileSync(resolve(root, entry.manifest), "utf8"));
        const result = validateManifest(manifest);
        if (result.valid && manifest.agent_name === agent && entry.manifest === `.opencode/tasks/${manifest.task_id}.json`) {
          policy = { editPaths: manifest.permissions.edit_paths, bash: manifest.permissions.bash };
        }
      }
    } catch {}
    generatedPolicies.set(agent, policy);
    return policy;
  }
  function isManaged(agent: string): boolean { return MANAGED_AGENTS.has(agent) || generatedPolicy(agent) !== undefined; }

  async function resolveAgent(sessionID: string, visited = new Set<string>()): Promise<string | undefined> {
    if (visited.has(sessionID)) return undefined;
    visited.add(sessionID);
    let session: any;
    try {
      const result = await client?.session?.get?.({ path: { id: sessionID } });
      session = result?.data ?? result;
      const parentID = session?.parentID;
      if (parentID) {
        const parentAgent = await resolveAgent(parentID, visited);
        if (parentAgent && isManaged(parentAgent)) {
          sessionAgents.set(sessionID, parentAgent);
          return parentAgent;
        }
      }
    } catch {}
    if (typeof session?.agent === "string" && session.agent) {
      sessionAgents.set(sessionID, session.agent);
      return session.agent;
    }
    const cached = sessionAgents.get(sessionID);
    if (cached) return cached;
    try {
      const result = await client?.session?.messages?.({ path: { id: sessionID } });
      const messages = result?.data ?? (Array.isArray(result) ? result : []);
      for (let index = messages.length - 1; index >= 0; index--) {
        const info = messages[index]?.info;
        if (info?.role === "user" && info.agent) {
          sessionAgents.set(sessionID, info.agent);
          return info.agent;
        }
      }
    } catch {}
    return undefined;
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
      if (input.sessionID && input.agent) sessionAgents.set(input.sessionID, input.agent);
    },
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args?: Record<string, unknown> },
    ) => {
      if (!MUTATING_TOOLS.has(input.tool) && !SHELL_TOOLS.has(input.tool) && !PROMETHEUS_ONLY_TOOLS.has(input.tool)) return;
      const agent = await resolveAgent(input.sessionID);
      if (!agent || !isManaged(agent)) return;
      const generated = generatedPolicy(agent);

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
