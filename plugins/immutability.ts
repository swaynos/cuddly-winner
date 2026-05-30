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
 *   plugin resolves identity via two mechanisms in priority order:
 *     1. A session→agent cache populated by the chat.params hook, which fires
 *        before each LLM turn and does carry the agent name.
 *     2. A fallback lookup via client.session.messages() that reads the most
 *        recent user message's agent field for sessions not yet seen by
 *        chat.params (e.g., a tool invoked before the first LLM turn).
 *   If identity cannot be resolved by either mechanism the write is denied
 *   with an explicit error naming the unresolved state.
 *
 * Case-variant protection:
 *   If a write targets a filename whose lowercase form matches a protected canonical
 *   filename (case-insensitively), but the exact case does not match, the write is
 *   rejected with a message pointing at the canonical form. This prevents spec.md
 *   from silently coexisting with SPEC.md on case-insensitive filesystems.
 */

import { readFileSync, existsSync } from "fs";
import { join, basename, dirname, resolve } from "path";

const MUTATING_TOOLS = new Set(["write", "edit", "patch", "apply_patch"]);

interface ImmutableConfig {
  readonly?: string[];
  prometheus_only?: string[];
  write_allowlist?: Record<string, string[]>;
}

function extractPatchedBasenames(patchText: string): string[] {
  const out = new Set<string>();
  const lines = patchText.split(/\r?\n/);
  for (const line of lines) {
    if (
      line.startsWith("*** Update File: ") ||
      line.startsWith("*** Add File: ") ||
      line.startsWith("*** Delete File: ")
    ) {
      const filePath = line.replace("*** Update File: ", "")
        .replace("*** Add File: ", "")
        .replace("*** Delete File: ", "")
        .trim();
      if (filePath) out.add(basename(filePath));
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
      if (!MUTATING_TOOLS.has(input.tool)) return;

      const args = (output as any).args ?? {};
      const rawPath =
        (args.filePath as string | undefined) ??
        (args.file_path as string | undefined) ??
        (args.path as string | undefined);
      const patchText = args.patchText as string | undefined;
      const rawCwd = (args.cwd as string | undefined) ?? defaultRoot;

      const names = rawPath
        ? [basename(rawPath)]
        : input.tool === "apply_patch" && patchText
          ? extractPatchedBasenames(patchText)
          : [];

      if (names.length === 0) return;

      const configRoot = findConfigRoot(rawPath ? dirname(resolve(rawPath)) : rawCwd);
      if (!configRoot) return;
      const cfg = loadConfig(configRoot);
      if (!cfg) return;

      // --- Resolve agent identity ---
      // Primary: cache populated by chat.params
      let agent: string | undefined = sessionAgentCache.get(input.sessionID);

      // Fallback: look up via client API (first tool call before any LLM turn)
      if (!agent && client?.session?.messages) {
        try {
          const result = await client.session.messages({
            path: { sessionID: input.sessionID },
          });
          const messages: any[] = result?.data ?? [];
          // Find the most recent user message with an agent field
          for (let i = messages.length - 1; i >= 0; i--) {
            const info = messages[i]?.info;
            if (info?.role === "user" && info?.agent) {
              agent = info.agent;
              sessionAgentCache.set(input.sessionID, agent);
              break;
            }
          }
        } catch {
          // client unavailable — will fail closed below
        }
      }

      // Fail closed: no identity means we cannot enforce agent-scoped rules.
      if (!agent) {
        const hasAgentRules =
          (cfg.prometheus_only?.length ?? 0) > 0 ||
          Object.keys(cfg.write_allowlist ?? {}).length > 0;
        if (hasAgentRules) {
          throw new Error(
            `ImmutabilityGuard: agent identity could not be resolved for session ` +
              `${input.sessionID}. Write of "${names.join(", ")}" denied. ` +
              `If you are running opencode directly without an agent context, ` +
              `invoke the appropriate named agent (e.g. @prometheus) instead.`
          );
        }
        // No agent-scoped rules in this config — only readonly rules apply.
        // Fall through with agent = "" so readonly check still fires.
        agent = "";
      }

      const readonly = new Set<string>(cfg.readonly ?? []);
      const prometheusOnly = new Set<string>(cfg.prometheus_only ?? []);
      const writeAllowlist: Record<string, Set<string>> = {};
      for (const [allowAgent, files] of Object.entries(cfg.write_allowlist ?? {})) {
        writeAllowlist[allowAgent] = new Set(files);
      }

      const allCanonical = new Set<string>([
        ...readonly,
        ...prometheusOnly,
        ...Object.values(cfg.write_allowlist ?? {}).flat(),
      ]);
      const lowerToCanonical = new Map<string, string>();
      for (const canonicalName of allCanonical) {
        lowerToCanonical.set(canonicalName.toLowerCase(), canonicalName);
      }

      for (const name of names) {

      // --- Case-variant protection ---
        const canonical = lowerToCanonical.get(name.toLowerCase());
        if (canonical && canonical !== name) {
          throw new Error(
            `ImmutabilityGuard: "${name}" is a case variant of the protected file ` +
              `"${canonical}". Use the canonical filename.`
          );
        }

      // --- readonly: no agent may edit ---
        if (readonly.has(name)) {
          throw new Error(
            `ImmutabilityGuard: "${name}" is declared readonly in ` +
              `.opencode/immutable.json — no agent may edit it.`
          );
        }

      // --- prometheus_only: only @prometheus may edit ---
        if (prometheusOnly.has(name) && agent !== "prometheus") {
          throw new Error(
            `ImmutabilityGuard: "${name}" may only be edited by @prometheus ` +
              `(attempted by @${agent}). If the spec needs to change, invoke ` +
              `@prometheus to revise it.`
          );
        }

      // --- write_allowlist: agent may only write files in its list ---
        if (writeAllowlist[agent] && !writeAllowlist[agent].has(name)) {
          throw new Error(
            `ImmutabilityGuard: @${agent} is restricted to writing ` +
              `[${[...writeAllowlist[agent]].join(", ")}] per .opencode/immutable.json. ` +
              `Writing "${name}" is not permitted.`
          );
        }
      }
    },
  };
};
