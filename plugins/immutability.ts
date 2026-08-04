import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const MUTATING_TOOLS = new Set(["write", "edit", "patch", "apply_patch"]);
const SHELL_TOOLS = new Set(["bash"]);
const PROMETHEUS_ONLY_TOOLS = new Set(["spike", "scaffold_gitignore", "validate_scaffold"]);
const MANAGED_AGENTS = new Set(["ask", "prometheus", "autonomous", "karpathy", "reviewer", "grounder", "implementation-validator"]);
const READ_ONLY_AGENTS = new Set(["ask", "karpathy", "reviewer", "grounder", "implementation-validator"]);
const PROMETHEUS_WRITABLE = ["SPEC.md", "opencode-autonomous.json", ".prometheus/evaluator/**", ".spike/**"];
const TRUSTED_PATHS = [
  "tools/spike.ts",
  "tools/validate_scaffold.ts",
  "tools/scaffold_gitignore.ts",
  "plugins/immutability.ts",
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

function isPublishedScaffold(relPath: string): boolean {
  return relPath === "SPEC.md" || relPath === "opencode-autonomous.json" || relPath.startsWith(".prometheus/evaluator/");
}

export const ImmutabilityGuard = async ({ directory, worktree, client }: { directory: string; worktree: string; client: any }) => {
  const lexicalRoot = resolve(directory || worktree);
  const root = realpathSync(lexicalRoot);
  const sessionAgents = new Map<string, string>();
  const publicationReminders = new Set<string>();

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
        if (parentAgent && MANAGED_AGENTS.has(parentAgent)) {
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

  return {
    event: async ({ event }: { event: { type: string; properties?: { sessionID?: string } } }) => {
      if (event.type !== "session.idle") return;
      const sessionID = event.properties?.sessionID;
      if (!sessionID || publicationReminders.has(sessionID)) return;
      if (await resolveAgent(sessionID) !== "prometheus") return;
      if (existsSync(resolve(root, "SPEC.md")) && existsSync(resolve(root, "opencode-autonomous.json"))) return;

      // Continue the same session once rather than allowing an unpublished plan to end silently.
      publicationReminders.add(sessionID);
      await client?.session?.promptAsync?.({
        path: { id: sessionID },
        body: {
          agent: "prometheus",
          parts: [{ type: "text", text: "Before completing, publish SPEC.md and opencode-autonomous.json if this task is planning-ready. If a concrete planning blocker remains, state it as a focused question." }],
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
      if (!agent || !MANAGED_AGENTS.has(agent)) return;

      if (PROMETHEUS_ONLY_TOOLS.has(input.tool)) {
        if (agent !== "prometheus") throw new Error(`ImmutabilityGuard: only @prometheus may invoke ${input.tool}.`);
        return;
      }

      const args = output.args ?? {};
      if (SHELL_TOOLS.has(input.tool)) {
        if (READ_ONLY_AGENTS.has(agent)) throw new Error(`ImmutabilityGuard: @${agent} is read-only.`);
        if (agent === "prometheus") throw new Error("ImmutabilityGuard: @prometheus may not execute shell commands directly.");
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
        if (isPublishedScaffold(relPath) && agent !== "prometheus") throw new Error(`ImmutabilityGuard: @${agent} cannot rewrite published scaffold: "${relPath}".`);
        if (agent === "prometheus" && isPublishedScaffold(relPath)) continue;
        if (isTrustedPath(relPath)) throw new Error(`ImmutabilityGuard: "${relPath}" is trusted control-plane state.`);
        if (agent === "prometheus" && !PROMETHEUS_WRITABLE.some((pattern) => matchesPattern(relPath, pattern))) {
          throw new Error(`ImmutabilityGuard: @prometheus is restricted to writing [${PROMETHEUS_WRITABLE.join(", ")}].`);
        }
      }
    },
  };
};
