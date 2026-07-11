/**
 * immutability.ts
 *
 * Global OpenCode plugin that enforces file-level immutability rules per project.
 *
 * Install:
 *   Copy or symlink to ~/.config/opencode/plugins/immutability.ts
 *   (the deploy script handles this with --with-plugins)
 *
 * Activation:
 *   The plugin only activates when the project contains .opencode/immutable.json.
 *   Without that marker file the plugin is a no-op — safe for global install.
 *
 * Marker file format (.opencode/immutable.json):
 *   {
 *     "readonly":          ["prepare.py"],   // no agent may edit these
 *     "prometheus_only":   ["SPEC.md"],      // only @prometheus may edit these
 *     "write_allowlist": {
 *       "prometheus": ["SPEC.md"]            // agent may ONLY write files in this list
 *     }
 *   }
 *
 * All three modes may be combined. Rules are evaluated in this order:
 *   1. readonly        — blanket deny for all agents
 *   2. prometheus_only — deny for all agents except prometheus
 *   3. write_allowlist — deny any write by the named agent that is NOT in its list
 *
 * Agent identity:
 *   OpenCode's tool.execute.before hook does not carry an agent field. The
 *   plugin resolves identity via three mechanisms in priority order:
 *     1. A session→agent cache populated by the chat.params hook, which fires
 *        before each LLM turn and does carry the agent name.
 *     2. A fallback lookup via client.session.messages({ path: { id } }) that
 *        reads the most recent user message's agent field for sessions not yet
 *        seen by chat.params.
 *     3. A parent-session lookup via client.session.get({ path: { id } }) that
 *        walks parentID to find the originating agent (covers subagent/task
 *        child sessions whose own messages carry a different agent identity).
 *   If identity cannot be resolved by any mechanism:
 *     - Writes to files covered by prometheus_only or write_allowlist are denied.
 *     - Writes to files NOT covered by any agent-scoped rule are ALLOWED.
 *       (readonly files are always denied regardless of identity.)
 *   This policy avoids a total session lockout when identity is merely unknown
 *   while still protecting explicitly named files.
 *
 * Case-variant protection:
 *   If a write targets a filename whose lowercase form matches a protected canonical
 *   filename (case-insensitively), but the exact case does not match, the write is
 *   rejected with a message pointing at the canonical form. This prevents spec.md
 *   from silently coexisting with SPEC.md on case-insensitive filesystems.
 */

import { readFileSync, existsSync } from "fs";
import { join, basename, dirname, resolve, relative, isAbsolute as pathIsAbsolute } from "path";

const MUTATING_TOOLS = new Set(["write", "edit", "patch", "apply_patch"]);
const SHELL_TOOLS = new Set(["bash", "run"]);

interface ImmutableConfig {
  readonly?: string[];
  prometheus_only?: string[];
  write_allowlist?: Record<string, string[]>;
}

/**
 * Match a relative file path against a pattern that may contain:
 *   - exact basename:           "SPEC.md"
 *   - exact relative path:     "gmail_scanner/experiments/harness.py"
 *   - glob with **:            "gmail_scanner/experiments/**"
 *   - glob with *:             "tests/*.py"
 *
 * Matching is done against both the full relative path and the basename,
 * so a bare "SPEC.md" still matches "/any/dir/SPEC.md".
 */
function matchesPattern(relPath: string, pattern: string): boolean {
  // Normalise separators to forward slash
  const norm = relPath.replace(/\\/g, "/");
  const name = basename(norm);

  // Convert glob pattern to regex
  function globToRegex(glob: string): RegExp {
    const escaped = glob
      .replace(/\\/g, "/")
      .replace(/[.+^${}()|[\]]/g, "\\$&")  // escape regex specials except * and ?
      .replace(/\*\*/g, "{{DOUBLE_STAR}}")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/\{\{DOUBLE_STAR\}\}/g, ".*");
    return new RegExp(`^${escaped}$`);
  }

  const re = globToRegex(pattern);

  // 1. Match against full relative path
  if (re.test(norm)) return true;

  // 2. Bare names are project-root files, never same-named nested files.
  if (!pattern.includes("/") && !pattern.includes("*")) {
    if (!norm.includes("/") && re.test(name)) return true;
  }

  // 3. Pattern with no path sep and no glob: compare as basename
  return false;
}

function extractPatchedPaths(patchText: string): string[] {
  const out = new Set<string>();
  const lines = patchText.split(/\r?\n/);
  for (const line of lines) {
    if (
      line.startsWith("*** Update File: ") ||
      line.startsWith("*** Add File: ") ||
      line.startsWith("*** Delete File: ")
    ) {
      const filePath = line
        .replace("*** Update File: ", "")
        .replace("*** Add File: ", "")
        .replace("*** Delete File: ", "")
        .trim();
      if (filePath) out.add(filePath);
    }
  }
  return [...out];
}

function loadConfig(root: string): ImmutableConfig | null {
  const marker = join(root, ".opencode", "immutable.json");
  if (!existsSync(marker)) return null;
  try {
    return JSON.parse(readFileSync(marker, "utf8")) as ImmutableConfig;
  } catch {
    return null;
  }
}

function findConfigRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    const marker = join(current, ".opencode", "immutable.json");
    if (existsSync(marker)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export const ImmutabilityGuard = async ({
  directory,
  worktree,
  client,
}: {
  directory: string;
  worktree: string;
  client: any;
}) => {
  const defaultRoot = worktree || directory;

  // Session→agent cache: populated by chat.params (fires before each LLM turn).
  // Key: sessionID, Value: agent name string.
  const sessionAgentCache = new Map<string, string>();

  // Resolve agent identity for a session, with parent-session fallback.
  async function resolveAgent(sessionID: string): Promise<string | undefined> {
    // Parent identity is authoritative for child sessions; do this before using
    // a child agent cache so delegation cannot shed the origin's restrictions.
    try {
      const res = await client?.session?.get?.({ path: { id: sessionID } });
      const parentID: string | undefined = (res?.data ?? res)?.parentID;
      if (parentID) {
        const parentAgent = await resolveAgent(parentID);
        if (parentAgent) { sessionAgentCache.set(sessionID, parentAgent); return parentAgent; }
      }
    } catch { /* continue with direct attribution */ }

    // 1. Hot-path: cache populated by chat.params
    const cached = sessionAgentCache.get(sessionID);
    if (cached) return cached;

    if (!client?.session) return undefined;

    // 2. Look up this session's messages — most recent user message carries agent.
    //    SDK requires path: { id }, NOT path: { sessionID }.
    try {
      const result = await client.session.messages({
        path: { id: sessionID },
      });
      const messages: any[] = result?.data ?? (Array.isArray(result) ? result : []);
      for (let i = messages.length - 1; i >= 0; i--) {
        const info = messages[i]?.info;
        if (info?.role === "user" && info?.agent) {
          sessionAgentCache.set(sessionID, info.agent);
          return info.agent;
        }
      }
    } catch {
      // SDK unavailable or session not found — fall through to parent lookup.
    }

    return undefined;
  }

  return {
    // Populate the cache from chat.params, which reliably carries the agent name.
    "chat.params": async (
      input: { sessionID: string; agent: string },
      _output: unknown
    ) => {
      if (input.sessionID && input.agent) {
        sessionAgentCache.set(input.sessionID, input.agent);
      }
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args?: Record<string, unknown> }
    ) => {
      if (!MUTATING_TOOLS.has(input.tool) && !SHELL_TOOLS.has(input.tool)) return;

      const args = (output as any).args ?? {};
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
        if (!agent && config && (config.prometheus_only?.length || Object.keys(config.write_allowlist ?? {}).length)) {
          throw new Error("ImmutabilityGuard: shell execution denied because agent identity could not be resolved.");
        }
        return;
      }
      const rawPath =
        (args.filePath as string | undefined) ??
        (args.file_path as string | undefined) ??
        (args.path as string | undefined);
      const patchText = args.patchText as string | undefined;
      const rawCwd = (args.cwd as string | undefined) ?? defaultRoot;

      // Build list of absolute paths being written
      const absPaths: string[] = rawPath
        ? [pathIsAbsolute(rawPath) ? rawPath : resolve(rawCwd, rawPath)]
        : input.tool === "apply_patch" && patchText
          ? extractPatchedPaths(patchText).map((p) =>
              p.startsWith("/") ? p : resolve(rawCwd, p)
            )
          : [];

      if (absPaths.length === 0) return;

      for (const absPath of absPaths) {
        const configRoot = findConfigRoot(dirname(absPath));
        if (!configRoot) continue;
        const cfg = loadConfig(configRoot);
        if (!cfg) continue;
        const readonlyPatterns: string[] = cfg.readonly ?? [];
        const prometheusOnlyPatterns: string[] = cfg.prometheus_only ?? [];
        const writeAllowlistPatterns: Record<string, string[]> = cfg.write_allowlist ?? {};
        // Compute path relative to configRoot for glob matching
        const relPath = relative(configRoot, absPath).replace(/\\/g, "/");
        const name    = basename(absPath);

        // --- Case-variant protection (exact-name patterns only) ---
        const allPatterns = [
          ...readonlyPatterns,
          ...prometheusOnlyPatterns,
          ...Object.values(writeAllowlistPatterns).flat(),
        ];
        for (const pattern of allPatterns) {
          if (!pattern.includes("*") && !pattern.includes("/")) {
            // bare filename pattern
            if (
              name.toLowerCase() === pattern.toLowerCase() &&
              name !== pattern
            ) {
              throw new Error(
                `ImmutabilityGuard: "${name}" is a case variant of the protected file ` +
                  `"${pattern}". Use the canonical filename.`
              );
            }
          }
        }

        // --- readonly: no agent may edit ---
        const isReadonly = readonlyPatterns.some((p) =>
          matchesPattern(relPath, p)
        );
        if (isReadonly) {
          throw new Error(
            `ImmutabilityGuard: "${relPath}" is declared readonly in ` +
              `.opencode/immutable.json — no agent may edit it.`
          );
        }

        // --- prometheus_only: only @prometheus may edit ---
        const isPrometheusOnly = prometheusOnlyPatterns.some((p) =>
          matchesPattern(relPath, p)
        );
        if (isPrometheusOnly) {
          if (!agent) {
            throw new Error(
              `ImmutabilityGuard: "${relPath}" may only be edited by @prometheus ` +
                `but the agent identity could not be resolved for session ` +
                `${input.sessionID}. Invoke @prometheus directly to edit this file.`
            );
          }
          if (agent !== "prometheus") {
            throw new Error(
              `ImmutabilityGuard: "${relPath}" may only be edited by @prometheus ` +
                `(attempted by @${agent}). If the spec needs to change, invoke ` +
                `@prometheus to revise it.`
            );
          }
        }

        // --- write_allowlist: agent may only write files matching its patterns ---
        if (!agent) {
          const coveredByAnyAllowlist = Object.values(
            writeAllowlistPatterns
          ).some((patterns) =>
            patterns.some((p) => matchesPattern(relPath, p))
          );
          if (coveredByAnyAllowlist) {
            throw new Error(
              `ImmutabilityGuard: "${relPath}" is covered by a write_allowlist rule but ` +
                `the agent identity could not be resolved for session ${input.sessionID}. ` +
                `Only the explicitly allowed agent may write this file.`
            );
          }
          continue;
        }

        if (writeAllowlistPatterns[agent]) {
          const allowed = writeAllowlistPatterns[agent].some((p) =>
            matchesPattern(relPath, p)
          );
          if (!allowed) {
            throw new Error(
              `ImmutabilityGuard: @${agent} is restricted to writing ` +
                `[${writeAllowlistPatterns[agent].join(", ")}] per .opencode/immutable.json. ` +
                `Writing "${relPath}" is not permitted.`
            );
          }
        }
      }
    },
  };
};
