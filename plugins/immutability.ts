import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MUTATING_TOOLS = new Set(["write", "edit", "patch", "apply_patch"]);
const SHELL_TOOLS = new Set(["bash", "run"]);
const PROMETHEUS_ONLY_TOOLS = new Set(["scaffold_gitignore"]);
const MANAGED_AGENTS = new Set(["ask", "prometheus", "autonomous", "karpathy", "reviewer", "grounder"]);
const READ_ONLY_AGENTS = new Set(["ask", "karpathy", "reviewer", "grounder"]);
const PROMETHEUS_WRITABLE = ["SPEC.md", "opencode-autonomous.json", ".prometheus/evaluator/**", ".spike/**"];
const TRUSTED_PATHS = [
  ".opencode/runs",
  ".opencode/supervisor",
  ".opencode/progress",
  ".opencode/quarantine",
  "tools/run.ts",
  "plugins/immutability.ts",
  "plugins/opencode-autonomous-supervisor.js",
  "plugins/opencode-autonomous-supervisor/index.js",
  "plugins/opencode-autonomous-supervisor/package.json",
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

function canonicalTarget(target: string): string {
  let existing = target;
  const suffix: string[] = [];
  while (!existsSync(existing)) {
    suffix.unshift(basename(existing));
    const parent = dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  let canonical = realpathSync(existing);
  for (const part of suffix) canonical = join(canonical, part);
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) return realpathSync(target);
  return canonical;
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function isTrustedPath(relPath: string): boolean {
  return TRUSTED_PATHS.some((trusted) => relPath === trusted || relPath.startsWith(`${trusted}/`));
}

export const ImmutabilityGuard = async ({ directory, worktree, client }: { directory: string; worktree: string; client: any }) => {
  const root = realpathSync(resolve(worktree || directory));
  const sessionAgents = new Map<string, string>();

  async function resolveAgent(sessionID: string, visited = new Set<string>()): Promise<string | undefined> {
    if (visited.has(sessionID)) return undefined;
    visited.add(sessionID);
    try {
      const result = await client?.session?.get?.({ path: { id: sessionID } });
      const parentID = (result?.data ?? result)?.parentID;
      if (parentID) {
        const parentAgent = await resolveAgent(parentID, visited);
        if (parentAgent) {
          sessionAgents.set(sessionID, parentAgent);
          return parentAgent;
        }
      }
    } catch {}
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
        if (agent === "prometheus") {
          if (input.tool === "bash") throw new Error("ImmutabilityGuard: @prometheus may not execute shell commands directly.");
          if (args.context !== "spike" || typeof args.spike_id !== "string") {
            throw new Error("ImmutabilityGuard: @prometheus may invoke run only with contracted spike context.");
          }
        }
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
        const absolutePath = canonicalTarget(unresolvedPath);
        if (!isInside(root, absolutePath)) throw new Error(`ImmutabilityGuard: target escapes active worktree: ${unresolvedPath}`);
        const relPath = relative(root, absolutePath).replace(/\\/g, "/");
        if (isTrustedPath(relPath)) throw new Error(`ImmutabilityGuard: "${relPath}" is trusted control-plane state.`);
        if (agent === "prometheus" && !PROMETHEUS_WRITABLE.some((pattern) => matchesPattern(relPath, pattern))) {
          throw new Error(`ImmutabilityGuard: @prometheus is restricted to writing [${PROMETHEUS_WRITABLE.join(", ")}].`);
        }
      }
    },
  };
};
