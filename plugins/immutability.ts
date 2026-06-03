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

  // Resolve agent identity for a session, with parent-session fallback.
  async function resolveAgent(sessionID: string): Promise<string | undefined> {
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

    // 3. Walk parentID chain — covers subagent/task child sessions whose own
    //    messages may not carry the originating agent name.
    try {
      const res = await client.session.get({ path: { id: sessionID } });
      const session = res?.data ?? res;
      const parentID: string | undefined = session?.parentID;
      if (parentID) {
        // Recurse once — a single parent walk is enough in practice.
        const parentAgent = await resolveAgent(parentID);
        if (parentAgent) {
          sessionAgentCache.set(sessionID, parentAgent);
          return parentAgent;
        }
      }
    } catch {
      // Parent lookup failed — give up gracefully.
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
      const agent = await resolveAgent(input.sessionID);

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

        // --- readonly: no agent may edit (enforced regardless of identity) ---
        if (readonly.has(name)) {
          throw new Error(
            `ImmutabilityGuard: "${name}" is declared readonly in ` +
              `.opencode/immutable.json — no agent may edit it.`
          );
        }

        // --- prometheus_only: only @prometheus may edit ---
        //     If identity is unknown, deny (file is explicitly protected).
        if (prometheusOnly.has(name)) {
          if (!agent) {
            throw new Error(
              `ImmutabilityGuard: "${name}" may only be edited by @prometheus ` +
                `but the agent identity could not be resolved for session ` +
                `${input.sessionID}. Invoke @prometheus directly to edit this file.`
            );
          }
          if (agent !== "prometheus") {
            throw new Error(
              `ImmutabilityGuard: "${name}" may only be edited by @prometheus ` +
                `(attempted by @${agent}). If the spec needs to change, invoke ` +
                `@prometheus to revise it.`
            );
          }
        }

        // --- write_allowlist: agent may only write files in its list ---
        //     If identity is unknown and the file is NOT in any allowlist, allow.
        //     If identity is known and agent has an allowlist, enforce it.
        //     If identity is unknown and the file IS in some agent's allowlist, deny.
        if (!agent) {
          // Unknown identity: deny only if the file appears in any agent's allowlist.
          const coveredByAllowlist = Object.values(writeAllowlist).some(
            (files) => files.has(name)
          );
          if (coveredByAllowlist) {
            throw new Error(
              `ImmutabilityGuard: "${name}" is covered by a write_allowlist rule but ` +
                `the agent identity could not be resolved for session ${input.sessionID}. ` +
                `Only the explicitly allowed agent may write this file. ` +
                `If you are running without an agent context, invoke the appropriate ` +
                `named agent instead.`
            );
          }
          // File is not covered by any agent-scoped rule — allow.
          continue;
        }

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
