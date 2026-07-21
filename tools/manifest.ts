/**
 * Validator for opencode-autonomous.json (schema v1).
 * Authoritative schema: docs/ARCHITECTURE.md § Manifest Schema (v1);
 * limits: docs/REQUIREMENTS.md § Autonomous Profile > Execution Limits.
 * Fails closed: unknown version/field/enum/limit key is a hard error.
 */
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";

export interface ValidationResult {
  valid: boolean;
  strategy?: "ralph" | "karpathy";
  errors: string[];
}

const DOC_KEYS = new Set(["_note", "_comment"]);
const COMMON_KEYS = new Set([
  "schema_version",
  "strategy",
  "invariants",
  "implementation_scope",
  "escalation_triggers",
  "evaluator_inventory",
  "verification",
  "limits",
  "optimization",
]);
const KNOWN_LIMIT_KEYS = new Set([
  "iterations",
  "repair_per_item",
  "no_progress",
  "repeated_error",
  "wall_clock",
  "command_timeout",
  "output_cap",
  "experiments",
  "failure_pivot",
]);

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function canonicalRelative(p: string): { ok: boolean; rel: string } {
  // Worktree-relative, canonical, non-escaping. We validate the string form
  // (leading "../", absolute) without touching the filesystem.
  const normalized = p.replace(/\\/g, "/");
  if (path.isAbsolute(normalized) || normalized.startsWith("/")) return { ok: false, rel: normalized };
  const parts = normalized.split("/");
  let depth = 0;
  for (const part of parts) {
    if (part === "..") depth--;
    else if (part !== "." && part !== "") depth++;
    if (depth < 0) return { ok: false, rel: normalized };
  }
  return { ok: true, rel: normalized };
}

export function validateManifest(raw: unknown, opts: { root?: string } = {}): ValidationResult {
  const errors: string[] = [];
  const push = (m: string) => errors.push(m);

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["manifest must be a JSON object"] };
  }
  const m = raw as Record<string, unknown>;

  if (m.schema_version !== 1) push(`schema_version must be 1 (got ${JSON.stringify(m.schema_version)})`);

  const strategy = m.strategy;
  if (strategy !== "ralph" && strategy !== "karpathy") {
    push(`strategy must be "ralph" or "karpathy" (got ${JSON.stringify(strategy)})`);
  }

  for (const key of Object.keys(m)) {
    if (!COMMON_KEYS.has(key) && !DOC_KEYS.has(key)) push(`unknown top-level key: ${key}`);
  }

  if (!isStringArray(m.invariants)) push("invariants must be a string[]");
  if (!isStringArray(m.escalation_triggers)) push("escalation_triggers must be a string[]");

  if (!isStringArray(m.implementation_scope) || (m.implementation_scope as string[]).length === 0) {
    push("implementation_scope must be a non-empty string[]");
  } else {
    for (const p of m.implementation_scope as string[]) {
      const { ok } = canonicalRelative(p);
      if (!ok) push(`implementation_scope path escapes worktree or is absolute: ${p}`);
    }
  }

  if (!isStringArray(m.evaluator_inventory)) {
    push("evaluator_inventory must be a string[]");
  } else {
    for (const p of m.evaluator_inventory as string[]) {
      const { ok } = canonicalRelative(p);
      if (!ok) { push(`evaluator path escapes worktree or is absolute: ${p}`); continue; }
      if (opts.root) {
        const abs = path.join(opts.root, p);
        if (!existsSync(abs)) push(`inventoried evaluator file is missing: ${p}`);
        else if (lstatSync(abs).isSymbolicLink()) push(`inventoried evaluator file is a symlink: ${p}`);
      }
    }
  }

  const verification = m.verification as Record<string, unknown> | undefined;
  if (typeof verification !== "object" || verification === null) {
    push("verification must be an object with commands[] and baseline");
  } else {
    if (!isStringArray(verification.commands) || (verification.commands as string[]).length === 0) {
      push("verification.commands must be a non-empty string[]");
    }
    if (typeof verification.baseline !== "string") push("verification.baseline must be a string");
  }

  if (m.limits !== undefined) {
    if (typeof m.limits !== "object" || m.limits === null || Array.isArray(m.limits)) {
      push("limits must be an object");
    } else {
      for (const [k, v] of Object.entries(m.limits)) {
        if (!KNOWN_LIMIT_KEYS.has(k)) push(`unknown key inside limits: ${k}`);
        else if (typeof v !== "number" || !(v > 0)) push(`limits.${k} must be a positive number`);
      }
    }
  }

  if (strategy === "karpathy") validateOptimization(m.optimization, push);
  else if (strategy === "ralph" && m.optimization !== undefined) {
    push("ralph strategy must not declare an optimization block");
  }

  return { valid: errors.length === 0, strategy: strategy as ValidationResult["strategy"], errors };
}

function validateOptimization(opt: unknown, push: (m: string) => void): void {
  if (typeof opt !== "object" || opt === null || Array.isArray(opt)) {
    push("karpathy strategy requires an optimization object");
    return;
  }
  const o = opt as Record<string, unknown>;
  if (typeof o.objective !== "string") push("optimization.objective must be a string");
  if (o.direction !== "minimize" && o.direction !== "maximize") push('optimization.direction must be "minimize" or "maximize"');
  if (typeof o.baseline !== "number") push("optimization.baseline must be a number");
  if (typeof o.score_extraction !== "string") push("optimization.score_extraction must be a string");

  const np = o.noise_probe as Record<string, unknown> | undefined;
  if (typeof np !== "object" || np === null) push("optimization.noise_probe must be an object");
  else {
    if (typeof np.runs !== "number" || np.runs < 2) push("optimization.noise_probe.runs must be an integer >= 2");
    if (typeof np.threshold !== "number" || np.threshold < 0) push("optimization.noise_probe.threshold must be a number >= 0");
  }

  if (!isStringArray(o.mutable_targets) || (o.mutable_targets as string[]).length === 0) {
    push("optimization.mutable_targets must be a non-empty string[]");
  }
  if (!isStringArray(o.immutable_targets) || (o.immutable_targets as string[]).length === 0) {
    push("optimization.immutable_targets must be a non-empty string[] including the evaluator");
  }

  const limits = o.limits as Record<string, unknown> | undefined;
  if (typeof limits !== "object" || limits === null) push("optimization.limits must be an object");
  else {
    if (typeof limits.experiments !== "number" || !(limits.experiments > 0)) push("optimization.limits.experiments must be > 0");
    if (typeof limits.failure_pivot !== "number" || !(limits.failure_pivot > 0)) push("optimization.limits.failure_pivot must be > 0");
  }

  const stop = o.stop as Record<string, unknown> | undefined;
  if (typeof stop !== "object" || stop === null) push("optimization.stop must be an object");
  else if (stop.exhaustion !== "experiments") push('optimization.stop.exhaustion must be "experiments"');
}
