/** Static validator for a Prometheus-generated task package. */
import { tool } from "@opencode-ai/plugin";
import { lstatSync, promises as fs } from "node:fs";
import path from "node:path";

export type Strategy = "direct" | "ralph" | "optimization";
export interface ValidationResult { valid: boolean; strategy?: Strategy; errors: string[]; }

const MANIFEST_KEYS = new Set([
  "schema_version", "task_id", "agent_name", "agent_definition", "task_brief",
  "strategy", "permissions", "implementation_scope", "durable_context", "verification",
  "limits", "escalation_triggers", "strategy_config", "run_kpis",
]);
const VERIFICATION_KEYS = new Set(["commands", "success_evidence", "freshness", "failure_conditions", "independent_review"]);
const PERMISSION_KEYS = new Set(["edit_paths", "bash"]);
const DIRECT_KEYS = new Set(["work_selection"]);
const RALPH_KEYS = new Set(["work_selection", "pass_budget", "state_paths", "progress_evidence_before", "progress_evidence_after", "pass_failure_treatment", "run_stop_conditions", "later_pass_starter"]);
const OPTIMIZATION_KEYS = new Set(["work_selection", "objective", "direction", "evaluator", "score_extraction", "noise_policy", "mutable_targets", "immutable_targets", "experiment_budget", "keep_revert_rule", "stop_conditions"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function canonicalPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\\") &&
    !path.isAbsolute(value) && !path.win32.isAbsolute(value) && !/^[A-Za-z]:/.test(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function taskID(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function rejectUnknown(value: Record<string, unknown>, keys: Set<string>, name: string, push: (message: string) => void): void {
  for (const key of Object.keys(value)) if (!keys.has(key)) push(`unknown key inside ${name}: ${key}`);
}

function pathList(value: unknown, name: string, push: (message: string) => void, required = true): value is string[] {
  if (!strings(value) || (required && value.length === 0)) {
    push(`${name} must be a${required ? " non-empty" : ""} string[]`);
    return false;
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (!canonicalPath(item)) push(`${name} path must be canonical and worktree-relative: ${item}`);
    if (seen.has(item)) push(`${name} contains a duplicate path: ${item}`);
    seen.add(item);
  }
  return true;
}

function requiredStrings(value: Record<string, unknown>, keys: string[], name: string, push: (message: string) => void): void {
  for (const key of keys) if (typeof value[key] !== "string" || !(value[key] as string).trim()) push(`${name}.${key} must be a non-empty string`);
}

function validateStrategy(strategy: unknown, config: unknown, push: (message: string) => void): strategy is Strategy {
  if (strategy !== "direct" && strategy !== "ralph" && strategy !== "optimization") {
    push(`strategy must be "direct", "ralph", or "optimization" (got ${JSON.stringify(strategy)})`);
    return false;
  }
  if (!record(config)) {
    push("strategy_config must be an object");
    return true;
  }
  const keys = strategy === "direct" ? DIRECT_KEYS : strategy === "ralph" ? RALPH_KEYS : OPTIMIZATION_KEYS;
  rejectUnknown(config, keys, "strategy_config", push);
  if (typeof config.work_selection !== "string" || !config.work_selection.trim()) push("strategy_config.work_selection must be a non-empty string");
  if (strategy === "ralph") {
    if (!Number.isInteger(config.pass_budget) || (config.pass_budget as number) <= 0) push("strategy_config.pass_budget must be a positive integer");
    pathList(config.state_paths, "strategy_config.state_paths", push);
    pathList(config.progress_evidence_before, "strategy_config.progress_evidence_before", push);
    pathList(config.progress_evidence_after, "strategy_config.progress_evidence_after", push);
    requiredStrings(config, ["pass_failure_treatment", "later_pass_starter"], "strategy_config", push);
    pathList(config.run_stop_conditions, "strategy_config.run_stop_conditions", push);
  }
  if (strategy === "optimization") {
    requiredStrings(config, ["objective", "evaluator", "noise_policy", "keep_revert_rule"], "strategy_config", push);
    if (config.direction !== "minimize" && config.direction !== "maximize") push('strategy_config.direction must be "minimize" or "maximize"');
    if (config.score_extraction !== "first float on stdout" && config.score_extraction !== "last float on stdout") push("strategy_config.score_extraction must be a supported extraction rule");
    if (!canonicalPath(config.evaluator)) push("strategy_config.evaluator must be a canonical worktree-relative path");
    if (!Number.isInteger(config.experiment_budget) || (config.experiment_budget as number) <= 0) push("strategy_config.experiment_budget must be a positive integer");
    pathList(config.mutable_targets, "strategy_config.mutable_targets", push);
    pathList(config.immutable_targets, "strategy_config.immutable_targets", push);
    pathList(config.stop_conditions, "strategy_config.stop_conditions", push);
    for (const target of [...(strings(config.mutable_targets) ? config.mutable_targets : []), ...(strings(config.immutable_targets) ? config.immutable_targets : [])]) {
      if (/[*?\[\]]/.test(target)) push(`strategy_config target must not contain glob characters: ${target}`);
    }
    if (strings(config.mutable_targets) && strings(config.immutable_targets)) {
      const immutable = new Set(config.immutable_targets);
      for (const item of config.mutable_targets) if (immutable.has(item)) push(`strategy_config mutable and immutable targets overlap: ${item}`);
    }
  }
  return true;
}

export function validateManifest(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const push = (message: string) => errors.push(message);
  if (!record(raw)) return { valid: false, errors: ["manifest must be a JSON object"] };
  rejectUnknown(raw, MANIFEST_KEYS, "manifest", push);
  if (raw.schema_version !== 1) push(`schema_version must be 1 (got ${JSON.stringify(raw.schema_version)})`);
  if (!taskID(raw.task_id)) push("task_id must be a lowercase hyphenated slug");
  if (raw.agent_name !== raw.task_id) push("agent_name must match task_id");
  if (taskID(raw.task_id)) {
    if (raw.agent_definition !== `.opencode/agents/${raw.task_id}.md`) push("agent_definition must match task_id");
    if (raw.task_brief !== `.opencode/tasks/${raw.task_id}.md`) push("task_brief must match task_id");
  }
  if (!canonicalPath(raw.agent_definition)) push("agent_definition must be a canonical worktree-relative path");
  if (!canonicalPath(raw.task_brief)) push("task_brief must be a canonical worktree-relative path");
  const strategy = validateStrategy(raw.strategy, raw.strategy_config, push) ? raw.strategy as Strategy : undefined;
  const scopeOK = pathList(raw.implementation_scope, "implementation_scope", push);
  pathList(raw.durable_context, "durable_context", push);
  pathList(raw.escalation_triggers, "escalation_triggers", push);
  if (!record(raw.permissions)) push("permissions must be an object");
  else {
    rejectUnknown(raw.permissions, PERMISSION_KEYS, "permissions", push);
    const editable = pathList(raw.permissions.edit_paths, "permissions.edit_paths", push);
    if (typeof raw.permissions.bash !== "boolean") push("permissions.bash must be a boolean");
    if (editable && scopeOK) for (const item of raw.permissions.edit_paths as string[]) if (!(raw.implementation_scope as string[]).includes(item)) push(`permissions.edit_paths must be within implementation_scope: ${item}`);
  }
  if (!record(raw.verification)) push("verification must be an object");
  else {
    rejectUnknown(raw.verification, VERIFICATION_KEYS, "verification", push);
    pathList(raw.verification.commands, "verification.commands", push);
    pathList(raw.verification.success_evidence, "verification.success_evidence", push);
    pathList(raw.verification.failure_conditions, "verification.failure_conditions", push);
    if (typeof raw.verification.freshness !== "string" || !raw.verification.freshness.trim()) push("verification.freshness must be a non-empty string");
    if (raw.verification.independent_review !== null && (typeof raw.verification.independent_review !== "string" || !(raw.verification.independent_review as string).trim())) push("verification.independent_review must be null or a non-empty string");
  }
  if (!record(raw.limits) || !strings(raw.limits.stop_conditions) || raw.limits.stop_conditions.length === 0) push("limits.stop_conditions must be a non-empty string[]");
  if (raw.run_kpis !== undefined) {
    if (!record(raw.run_kpis) || typeof raw.run_kpis.enabled !== "boolean") push("run_kpis must declare enabled as a boolean");
    else if (raw.run_kpis.enabled) {
      const unattended = raw.run_kpis.unattended_runtime, tokenBurn = raw.run_kpis.token_burn;
      if (!record(unattended) || !Number.isFinite(unattended.target_seconds) || (unattended.target_seconds as number) <= 0) push("enabled run_kpis requires a positive unattended_runtime.target_seconds");
      if (!record(tokenBurn) || !Number.isFinite(tokenBurn.target_tokens_per_active_minute) || (tokenBurn.target_tokens_per_active_minute as number) <= 0 || !Number.isFinite(tokenBurn.hard_budget_tokens) || (tokenBurn.hard_budget_tokens as number) <= 0) push("enabled run_kpis requires positive token-burn targets");
    }
  }
  return { valid: errors.length === 0, strategy, errors };
}

function regularFile(root: string, rel: string, errors: string[]): void {
  try {
    const stat = lstatSync(path.resolve(root, rel));
    if (stat.isSymbolicLink() || !stat.isFile()) errors.push(`package artifact must be a regular file: ${rel}`);
  } catch { errors.push(`package artifact is missing: ${rel}`); }
}

export async function validateTaskPackage(root: string, agentName?: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const rootPath = await fs.realpath(path.resolve(root));
  let registry: Record<string, unknown>;
  try { registry = JSON.parse(await fs.readFile(path.join(rootPath, ".opencode/generated-agents.json"), "utf8")); }
  catch { return { valid: false, errors: ["generated-agent registry is missing or invalid JSON"] }; }
  if (!record(registry) || registry.schema_version !== 1 || !Array.isArray(registry.agents)) return { valid: false, errors: ["generated-agent registry must use schema_version 1 and agents[]"] };
  const seen = new Set<string>();
  const entries = registry.agents.filter(record);
  if (entries.length !== registry.agents.length) errors.push("generated-agent registry entries must be objects");
  for (const entry of entries) {
    if (!taskID(entry.name) || !canonicalPath(entry.manifest)) errors.push("generated-agent registry entry is malformed");
    if (seen.has(entry.name as string)) errors.push(`generated-agent registry contains a duplicate name: ${entry.name}`);
    seen.add(entry.name as string);
  }
  const entry = entries.find((item) => item.name === agentName) ?? (agentName === undefined && entries.length === 1 ? entries[0] : undefined);
  if (!entry) errors.push(`generated-agent registry has no entry for ${agentName ?? "a unique agent"}`);
  if (!entry || !canonicalPath(entry.manifest)) return { valid: false, errors };
  regularFile(rootPath, entry.manifest, errors);
  let manifest: unknown;
  try { manifest = JSON.parse(await fs.readFile(path.join(rootPath, entry.manifest), "utf8")); }
  catch { return { valid: false, errors: [...errors, "task manifest is missing or invalid JSON"] }; }
  const result = validateManifest(manifest);
  errors.push(...result.errors);
  if (record(manifest)) {
    if (manifest.agent_name !== entry.name) errors.push("registry name must match manifest agent_name");
    if (entry.manifest !== `.opencode/tasks/${manifest.task_id}.json`) errors.push("registry manifest path must match task_id");
    if (canonicalPath(manifest.agent_definition)) regularFile(rootPath, manifest.agent_definition, errors);
    if (canonicalPath(manifest.task_brief)) regularFile(rootPath, manifest.task_brief, errors);
  }
  return { valid: errors.length === 0, strategy: result.strategy, errors };
}

export default tool({
  description: "Validate a Prometheus-generated task package without running project commands.",
  args: {},
  async execute(_args, context) {
    const root = path.resolve(context.directory ?? context.worktree ?? process.cwd());
    return JSON.stringify(await validateTaskPackage(root), null, 2);
  },
});
