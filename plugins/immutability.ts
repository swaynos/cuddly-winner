import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const MUTATING_TOOLS = new Set(["write", "edit", "patch", "apply_patch"]);
const SHELL_TOOLS = new Set(["bash", "run"]);
const RESERVED_RUNTIME_PREFIXES = [".opencode/runs/", ".opencode/supervisor/"];

interface ImmutableConfig {
  readonly?: string[];
  write_allowlist?: Record<string, string[]>;
}

function matchesPattern(relPath: string, pattern: string): boolean {
  const norm = relPath.replace(/\\/g, "/");
  const escaped = pattern
    .replace(/\\/g, "/")
    .replace(/[.+^${}()|[\]]/g, "\\$&")
    .replace(/\*\*/g, "{{DOUBLE_STAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{DOUBLE_STAR\}\}/g, ".*");
  return new RegExp(`^${escaped}$`).test(norm);
}

function extractPatchedPaths(patchText: string): string[] {
  const paths = new Set<string>();
  for (const line of patchText.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
    if (match?.[1].trim()) paths.add(match[1].trim());
  }
  return [...paths];
}

function findConfigRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, "opencode-immutable.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function loadConfig(root: string): ImmutableConfig {
  try {
    const value = JSON.parse(readFileSync(join(root, "opencode-immutable.json"), "utf8"));
    if (!value || typeof value !== "object") throw new Error("policy must be an object");
    if (value.prometheus_only !== undefined) throw new Error("prometheus_only is obsolete; use write_allowlist ownership");
    if (value.readonly?.some((entry: unknown) => typeof entry !== "string" || entry.includes("*"))) {
      throw new Error("readonly accepts explicit file paths only");
    }
    return value;
  } catch (error) {
    throw new Error(`ImmutabilityGuard: invalid opencode-immutable.json in ${root}`, { cause: error });
  }
}

export const ImmutabilityGuard = async ({ directory, worktree, client }: { directory: string; worktree: string; client: any }) => {
  const defaultRoot = worktree || directory;
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
      if (!MUTATING_TOOLS.has(input.tool) && !SHELL_TOOLS.has(input.tool)) return;
      const args = output.args ?? {};
      const agent = await resolveAgent(input.sessionID);

      if (SHELL_TOOLS.has(input.tool)) {
        const root = findConfigRoot(String(args.cwd ?? defaultRoot));
        const config = root ? loadConfig(root) : null;
        if (agent && config?.write_allowlist?.[agent]) {
          if (input.tool === "bash") throw new Error(`ImmutabilityGuard: @${agent} may not execute shell commands directly.`);
          if (args.context !== "spike" || typeof args.spike_id !== "string") {
            throw new Error(`ImmutabilityGuard: @${agent} may invoke run only with contracted spike context.`);
          }
        }
        if (!agent && config && Object.keys(config.write_allowlist ?? {}).length) {
          throw new Error("ImmutabilityGuard: shell execution denied because agent identity could not be resolved.");
        }
        return;
      }

      const rawPath = (args.filePath ?? args.file_path ?? args.path) as string | undefined;
      const cwd = (args.cwd as string | undefined) ?? defaultRoot;
      const paths = rawPath
        ? [isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath)]
        : input.tool === "apply_patch" && typeof args.patchText === "string"
          ? extractPatchedPaths(args.patchText).map((item) => isAbsolute(item) ? item : resolve(cwd, item))
          : [];

      for (const absolutePath of paths) {
        const root = findConfigRoot(dirname(absolutePath));
        if (!root) continue;
        const config = loadConfig(root);
        const relPath = relative(root, absolutePath).replace(/\\/g, "/");
        const readonly = config.readonly ?? [];
        const allowlists = config.write_allowlist ?? {};
        const allOwnedPatterns = Object.values(allowlists).flat();

        for (const pattern of [...readonly, ...allOwnedPatterns]) {
          if (!pattern.includes("*") && !pattern.includes("/") && basename(relPath).toLowerCase() === pattern.toLowerCase() && relPath !== pattern) {
            throw new Error(`ImmutabilityGuard: "${basename(relPath)}" is a case variant of the protected file "${pattern}".`);
          }
        }

        if (RESERVED_RUNTIME_PREFIXES.some((prefix) => relPath.startsWith(prefix)) || readonly.includes(relPath)) {
          throw new Error(`ImmutabilityGuard: "${relPath}" is readonly.`);
        }

        const owners = Object.entries(allowlists)
          .filter(([, patterns]) => patterns.some((pattern) => matchesPattern(relPath, pattern)))
          .map(([owner]) => owner);
        if (owners.length > 1) throw new Error(`ImmutabilityGuard: "${relPath}" has ambiguous write_allowlist ownership.`);
        if (owners.length === 1 && agent !== owners[0]) {
          const identity = agent ? `@${agent}` : "an agent whose identity could not be resolved";
          throw new Error(`ImmutabilityGuard: "${relPath}" is owned by @${owners[0]} and cannot be written by ${identity}.`);
        }
        if (agent && allowlists[agent] && !allowlists[agent].some((pattern) => matchesPattern(relPath, pattern))) {
          throw new Error(`ImmutabilityGuard: @${agent} is restricted to writing [${allowlists[agent].join(", ")}].`);
        }
      }
    },
  };
};
