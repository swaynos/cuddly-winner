/**
 * Static validator for the Prometheus scaffold (schema v1).
 * Authoritative schema: docs/ARCHITECTURE.md § Manifest Schema (v1).
 * Fails closed: unknown version/field/enum/limit key is a hard error.
 */
import { tool } from "@opencode-ai/plugin";
import { existsSync, lstatSync, promises as fs } from "node:fs";
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
const COUNT_LIMIT_KEYS = new Set([
  "iterations",
  "repair_per_item",
  "no_progress",
  "repeated_error",
  "experiments",
  "failure_pivot",
]);
const VERIFICATION_KEYS = new Set(["commands", "baseline"]);
const OPTIMIZATION_KEYS = new Set([
  "objective",
  "direction",
  "baseline",
  "score_extraction",
  "noise_probe",
  "mutable_targets",
  "immutable_targets",
  "limits",
  "stop",
]);
const NOISE_PROBE_KEYS = new Set(["runs", "threshold"]);
const OPTIMIZATION_LIMIT_KEYS = new Set(["experiments", "failure_pivot"]);
const STOP_KEYS = new Set(["target", "exhaustion"]);

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function canonicalRelative(p: string): boolean {
  if (p === "" || p.includes("\\") || /^[A-Za-z]:/.test(p) || path.isAbsolute(p) || path.win32.isAbsolute(p)) return false;
  return p.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function rejectUnknownKeys(value: Record<string, unknown>, known: Set<string>, name: string, push: (m: string) => void): void {
  for (const key of Object.keys(value)) {
    if (!known.has(key)) push(`unknown key inside ${name}: ${key}`);
  }
}

function validatePaths(paths: string[], name: string, push: (m: string) => void): void {
  const seen = new Set<string>();
  for (const p of paths) {
    if (!canonicalRelative(p)) push(`${name} path must be canonical and worktree-relative: ${p}`);
    if (seen.has(p)) push(`${name} contains a duplicate path: ${p}`);
    seen.add(p);
  }
}

function validateEvaluatorFile(p: string, root: string, push: (m: string) => void): void {
  let current = root;
  for (const part of p.split("/")) {
    current = path.join(current, part);
    if (!existsSync(current)) {
      push(`inventoried evaluator file is missing: ${p}`);
      return;
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      push(`inventoried evaluator path contains a symlink: ${p}`);
      return;
    }
  }
  if (!lstatSync(current).isFile()) push(`inventoried evaluator path is not a regular file: ${p}`);
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
    validatePaths(m.implementation_scope as string[], "implementation_scope", push);
  }

  if (!isStringArray(m.evaluator_inventory)) {
    push("evaluator_inventory must be a string[]");
  } else {
    const inventory = m.evaluator_inventory as string[];
    if (strategy === "karpathy" && inventory.length === 0) push("karpathy strategy requires a non-empty evaluator_inventory");
    validatePaths(inventory, "evaluator_inventory", push);
    for (const p of inventory) {
      if (!p.startsWith(".prometheus/evaluator/")) {
        push(`inventoried evaluator file must be under .prometheus/evaluator: ${p}`);
        continue;
      }
      if (canonicalRelative(p) && opts.root) validateEvaluatorFile(p, opts.root, push);
    }
  }

  const verification = m.verification;
  if (!isRecord(verification)) {
    push("verification must be an object with commands[] and baseline");
  } else {
    rejectUnknownKeys(verification, VERIFICATION_KEYS, "verification", push);
    if (!isStringArray(verification.commands) || verification.commands.length === 0) {
      push("verification.commands must be a non-empty string[]");
    }
    if (typeof verification.baseline !== "string") push("verification.baseline must be a string");
  }

  if (m.limits !== undefined) {
    if (!isRecord(m.limits)) {
      push("limits must be an object");
    } else {
      for (const [k, v] of Object.entries(m.limits)) {
        if (!KNOWN_LIMIT_KEYS.has(k)) push(`unknown key inside limits: ${k}`);
        else if (!isFiniteNumber(v) || !(v > 0)) push(`limits.${k} must be a positive finite number`);
        else if (COUNT_LIMIT_KEYS.has(k) && !Number.isInteger(v)) push(`limits.${k} must be an integer`);
      }
    }
  }

  if (strategy === "karpathy") {
    validateOptimization(m.optimization, push);
    if (isStringArray(m.evaluator_inventory) && isRecord(m.optimization) && isStringArray(m.optimization.immutable_targets)) {
      for (const evaluator of m.evaluator_inventory) {
        if (!m.optimization.immutable_targets.includes(evaluator)) {
          push(`optimization.immutable_targets must include evaluator: ${evaluator}`);
        }
      }
    }
  }
  else if (strategy === "ralph" && m.optimization !== undefined) {
    push("ralph strategy must not declare an optimization block");
  }

  return { valid: errors.length === 0, strategy: strategy as ValidationResult["strategy"], errors };
}

const REQUIRED_SPEC_SECTIONS = [
  "Grounding",
  "Approaches Considered",
  "Acceptance Criteria",
  "Verification",
  "Implementation Checklist",
];

export function parseVerification(spec: string): string[] {
  const headings = [...spec.matchAll(/^## Verification\s*$/gm)];
  if (headings.length !== 1) throw new Error("SPEC must contain exactly one ## Verification section");
  const start = headings[0].index + headings[0][0].length;
  const following = spec.slice(start).search(/^##\s/m);
  const body = following < 0 ? spec.slice(start) : spec.slice(start, start + following);
  const commands = [...body.matchAll(/^- `([^`\n]+)`\s*$/gm)].map((match) => match[1]);
  const listItems = body.split(/\r?\n/).filter((line) => /^-\s/.test(line));
  if (!commands.length || commands.length !== listItems.length || new Set(commands).size !== commands.length) {
    throw new Error("SPEC verification commands must be non-empty, unique `- `<command>`` items");
  }
  return commands;
}

export async function validateScaffold(root: string): Promise<{ valid: true; strategy: string; verification_commands: string[]; evaluator_inventory: string[] }> {
  const resolvedRoot = await fs.realpath(path.resolve(root));
  const [spec, manifestText] = await Promise.all([
    fs.readFile(path.join(resolvedRoot, "SPEC.md"), "utf8"),
    fs.readFile(path.join(resolvedRoot, "opencode-autonomous.json"), "utf8"),
  ]);
  let manifest: Record<string, unknown>;
  try { manifest = JSON.parse(manifestText); } catch { throw new Error("opencode-autonomous.json must be valid JSON"); }
  const result = validateManifest(manifest, { root: resolvedRoot });
  if (!result.valid) throw new Error(`Invalid opencode-autonomous.json: ${result.errors.join("; ")}`);
  for (const section of REQUIRED_SPEC_SECTIONS) {
    const count = [...spec.matchAll(new RegExp(`^## ${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "gm"))].length;
    if (count !== 1) throw new Error(`SPEC must contain exactly one ## ${section} section`);
  }
  const commands = parseVerification(spec);
  const manifestCommands = (manifest.verification as { commands: string[] }).commands;
  if (JSON.stringify(commands) !== JSON.stringify(manifestCommands)) {
    throw new Error("SPEC and manifest verification commands must match exactly and in order");
  }
  return {
    valid: true,
    strategy: result.strategy!,
    verification_commands: commands,
    evaluator_inventory: manifest.evaluator_inventory as string[],
  };
}

function validateOptimization(opt: unknown, push: (m: string) => void): void {
  if (!isRecord(opt)) {
    push("karpathy strategy requires an optimization object");
    return;
  }
  const o = opt;
  rejectUnknownKeys(o, OPTIMIZATION_KEYS, "optimization", push);
  if (typeof o.objective !== "string") push("optimization.objective must be a string");
  if (o.direction !== "minimize" && o.direction !== "maximize") push('optimization.direction must be "minimize" or "maximize"');
  if (!isFiniteNumber(o.baseline)) push("optimization.baseline must be a finite number");
  if (o.score_extraction !== "last float on stdout" && o.score_extraction !== "first float on stdout") {
    push('optimization.score_extraction must be "last float on stdout" or "first float on stdout"');
  }

  const np = o.noise_probe;
  if (!isRecord(np)) push("optimization.noise_probe must be an object");
  else {
    rejectUnknownKeys(np, NOISE_PROBE_KEYS, "optimization.noise_probe", push);
    if (!isFiniteNumber(np.runs) || !Number.isInteger(np.runs) || np.runs < 2) push("optimization.noise_probe.runs must be an integer >= 2");
    if (!isFiniteNumber(np.threshold) || np.threshold < 0) push("optimization.noise_probe.threshold must be a finite number >= 0");
  }

  if (!isStringArray(o.mutable_targets) || (o.mutable_targets as string[]).length === 0) {
    push("optimization.mutable_targets must be a non-empty string[]");
  } else {
    validatePaths(o.mutable_targets, "optimization.mutable_targets", push);
    for (const t of o.mutable_targets) {
      if (/[*?[\]]/.test(t)) push(`optimization.mutable_targets path must not contain glob characters: ${t}`);
    }
  }
  if (!isStringArray(o.immutable_targets) || (o.immutable_targets as string[]).length === 0) {
    push("optimization.immutable_targets must be a non-empty string[] including the evaluator");
  } else {
    validatePaths(o.immutable_targets, "optimization.immutable_targets", push);
    for (const t of o.immutable_targets) {
      if (/[*?[\]]/.test(t)) push(`optimization.immutable_targets path must not contain glob characters: ${t}`);
    }
  }

  if (isStringArray(o.mutable_targets) && isStringArray(o.immutable_targets)) {
    const immutable = new Set(o.immutable_targets);
    for (const target of o.mutable_targets) {
      if (immutable.has(target)) push(`optimization mutable and immutable targets overlap: ${target}`);
    }
  }

  const limits = o.limits;
  if (!isRecord(limits)) push("optimization.limits must be an object");
  else {
    rejectUnknownKeys(limits, OPTIMIZATION_LIMIT_KEYS, "optimization.limits", push);
    if (!isFiniteNumber(limits.experiments) || !Number.isInteger(limits.experiments) || !(limits.experiments > 0)) push("optimization.limits.experiments must be an integer > 0");
    if (!isFiniteNumber(limits.failure_pivot) || !Number.isInteger(limits.failure_pivot) || !(limits.failure_pivot > 0)) push("optimization.limits.failure_pivot must be an integer > 0");
  }

  const stop = o.stop;
  if (!isRecord(stop)) push("optimization.stop must be an object");
  else {
    rejectUnknownKeys(stop, STOP_KEYS, "optimization.stop", push);
    if (stop.target !== undefined && !isFiniteNumber(stop.target)) push("optimization.stop.target must be a finite number");
    if (stop.exhaustion !== "experiments") push('optimization.stop.exhaustion must be "experiments"');
  }
}

export default tool({
  description: "Validate SPEC.md and opencode-autonomous.json structurally without executing project commands.",
  args: {},
  async execute(_args, context) {
    const root = path.resolve(context.directory ?? context.worktree ?? process.cwd());
    return JSON.stringify(await validateScaffold(root), null, 2);
  },
});
