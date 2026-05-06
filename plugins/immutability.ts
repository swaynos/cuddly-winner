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
 * Case-variant protection:
 *   If a write targets a filename whose lowercase form matches a protected canonical
 *   filename (case-insensitively), but the exact case does not match, the write is
 *   rejected with a message pointing at the canonical form. This prevents spec.md
 *   from silently coexisting with SPEC.md on case-insensitive filesystems.
 */

import { readFileSync, existsSync } from "fs";
import { join, basename } from "path";

const MUTATING_TOOLS = new Set(["write", "edit", "patch", "apply_patch"]);

interface ImmutableConfig {
  readonly?: string[];
  prometheus_only?: string[];
  write_allowlist?: Record<string, string[]>;
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

export const ImmutabilityGuard = async ({
  directory,
  worktree,
}: {
  directory: string;
  worktree: string;
}) => {
  const root = worktree || directory;
  const cfg = loadConfig(root);

  // No marker file — plugin is a no-op for this project.
  if (!cfg) return {};

  const readonly = new Set<string>(cfg.readonly ?? []);
  const prometheusOnly = new Set<string>(cfg.prometheus_only ?? []);
  const writeAllowlist: Record<string, Set<string>> = {};
  for (const [agent, files] of Object.entries(cfg.write_allowlist ?? {})) {
    writeAllowlist[agent] = new Set(files);
  }

  // Build a lowercase lookup of all canonical protected names for case-variant detection.
  const allCanonical = new Set<string>([
    ...readonly,
    ...prometheusOnly,
    ...Object.values(cfg.write_allowlist ?? {}).flat(),
  ]);
  const lowerToCanonical = new Map<string, string>();
  for (const name of allCanonical) {
    lowerToCanonical.set(name.toLowerCase(), name);
  }

  return {
    "tool.execute.before": async (
      input: { tool: string; agent?: string },
      output: { args?: Record<string, unknown> }
    ) => {
      if (!MUTATING_TOOLS.has(input.tool)) return;

      const args = output.args ?? {};
      const rawPath =
        (args.filePath as string | undefined) ??
        (args.file_path as string | undefined) ??
        (args.path as string | undefined);

      if (!rawPath) return;

      const name = basename(rawPath);
      const agent = input.agent ?? "unknown";

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
    },
  };
};
