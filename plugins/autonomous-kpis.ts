import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateTaskPackage } from "../tools/validate_scaffold.ts";

export type RunKpiPolicy = {
  unattendedRuntimeSeconds: number;
  targetTokensPerActiveMinute: number;
  hardBudgetTokens: number;
};

type AssistantMessage = {
  id: string;
  sessionID: string;
  role: "assistant";
  time: { created: number; completed?: number };
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
};

type Usage = { tokens: number; created: number; completed: number };

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function parseRunKpis(manifest: unknown): RunKpiPolicy | undefined | {} {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return {};
  if ("directory" in manifest && "client" in manifest && !("schema_version" in manifest) && !("run_kpis" in manifest)) {
    return {};
  }
  const runKpis = (manifest as Record<string, unknown>).run_kpis;
  if (!runKpis || typeof runKpis !== "object" || Array.isArray(runKpis)) return;
  const policy = runKpis as Record<string, unknown>;
  if (policy.enabled !== true) return;
  const unattended = policy.unattended_runtime;
  const tokenBurn = policy.token_burn;
  if (!unattended || typeof unattended !== "object" || Array.isArray(unattended)) return;
  if (!tokenBurn || typeof tokenBurn !== "object" || Array.isArray(tokenBurn)) return;
  const targetSeconds = (unattended as Record<string, unknown>).target_seconds;
  const targetRate = (tokenBurn as Record<string, unknown>).target_tokens_per_active_minute;
  const hardBudget = (tokenBurn as Record<string, unknown>).hard_budget_tokens;
  if (!finitePositive(targetSeconds) || !finitePositive(targetRate) || !finitePositive(hardBudget)) return;
  return {
    unattendedRuntimeSeconds: targetSeconds,
    targetTokensPerActiveMinute: targetRate,
    hardBudgetTokens: hardBudget,
  };
}

function usageFor(message: AssistantMessage): Usage | undefined {
  if (
    typeof message?.time?.created !== "number" ||
    typeof message?.time?.completed !== "number" ||
    !Number.isFinite(message.time.created) ||
    !Number.isFinite(message.time.completed) ||
    message.time.completed < message.time.created
  ) return;
  if (!message.tokens || typeof message.tokens !== "object") return;
  const { input, output, reasoning, cache } = message.tokens;
  const cacheRead = cache?.read ?? 0;
  const cacheWrite = cache?.write ?? 0;
  const values = [input, output, reasoning, cacheRead, cacheWrite];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) return;
  return {
    tokens: input + output + reasoning + cacheRead + cacheWrite,
    created: message.time.created,
    completed: message.time.completed,
  };
}

function resolvedSession(result: unknown, sessionID: string): Record<string, any> | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return;
  const response = result as Record<string, unknown>;
  const value = Object.prototype.hasOwnProperty.call(response, "data") ? response.data : result;
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const session = value as Record<string, any>;
  if (session.id !== sessionID) return;
  if (Object.prototype.hasOwnProperty.call(session, "parentID") && (typeof session.parentID !== "string" || !session.parentID)) return;
  return session;
}

export function summarizeUsage(messages: Iterable<Usage>): any {
  if (!messages || typeof messages !== "object" || (!Array.isArray(messages) && typeof (messages as any)[Symbol.iterator] !== "function")) {
    return {};
  }
  if ("directory" in messages && "client" in messages) {
    return {};
  }
  const usages = [...messages];
  const tokens = usages.reduce((total, usage) => total + usage.tokens, 0);
  const intervals = usages
    .filter((usage) => usage.completed >= usage.created)
    .map((usage) => [usage.created, usage.completed] as const)
    .sort((left, right) => left[0] - right[0]);
  let activeMilliseconds = 0;
  let start: number | undefined;
  let end: number | undefined;
  for (const [nextStart, nextEnd] of intervals) {
    if (start === undefined || end === undefined) {
      start = nextStart;
      end = nextEnd;
    } else if (nextStart <= end) {
      end = Math.max(end, nextEnd);
    } else {
      activeMilliseconds += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  if (start !== undefined && end !== undefined) activeMilliseconds += end - start;
  return {
    tokens,
    activeMilliseconds,
    tokensPerActiveMinute: activeMilliseconds > 0 ? tokens / (activeMilliseconds / 60_000) : 0,
  };
}

export const AutonomousKpis = async ({ directory, worktree, client }: { directory: string; worktree: string; client: any }) => {
  const rootDirectory = resolve(directory || worktree);
  const roots = new Map<string, string>();
  const invalidAncestry = new Set<string>();
  const rootAgents = new Map<string, string>();
  const policies = new Map<string, Promise<RunKpiPolicy | undefined>>();
  const messages = new Map<string, Map<string, Usage>>();

  async function rootAgent(root: string): Promise<string | undefined> {
    const selected = rootAgents.get(root);
    if (selected) return selected;
    try {
      const result = await client?.session?.get?.({ path: { id: root } });
      const session = resolvedSession(result, root);
      return typeof session?.agent === "string" && session.agent ? session.agent : undefined;
    } catch {
      return;
    }
  }

  type RootResolution = { valid: true; root: string } | { valid: false };
  async function rootFor(sessionID: string, visited = new Set<string>()): Promise<RootResolution> {
    if (invalidAncestry.has(sessionID)) return { valid: false };
    if (roots.has(sessionID)) return { valid: true, root: roots.get(sessionID)! };
    if (visited.has(sessionID)) {
      for (const id of visited) invalidAncestry.add(id);
      invalidAncestry.add(sessionID);
      return { valid: false };
    }
    visited.add(sessionID);
    try {
      const result = await client?.session?.get?.({ path: { id: sessionID } });
      const session = resolvedSession(result, sessionID);
      if (!session) throw new Error("unresolved session");
      if (typeof session?.parentID === "string" && session.parentID) {
        const parent = await rootFor(session.parentID, visited);
        if (!parent.valid) {
          invalidAncestry.add(sessionID);
          return parent;
        }
        roots.set(sessionID, parent.root);
        return parent;
      }
    } catch {
      for (const id of visited) invalidAncestry.add(id);
      return { valid: false };
    }
    roots.set(sessionID, sessionID);
    return { valid: true, root: sessionID };
  }

  async function policyFor(agent: string | undefined): Promise<RunKpiPolicy | undefined> {
    if (!agent) return;
    const cached = policies.get(agent);
    if (cached) return cached;
    const pending = (async () => {
      try {
        const result = await validateTaskPackage(rootDirectory, agent);
        if (!result.valid) return;
        const parsed = parseRunKpis(JSON.parse(await readFile(resolve(rootDirectory, `.opencode/tasks/${agent}.json`), "utf8")));
        if (parsed && "hardBudgetTokens" in parsed) return parsed as RunKpiPolicy;
      } catch {
        return;
      }
    })();
    policies.set(agent, pending);
    return pending;
  }

  async function enabledPolicy(sessionID: string, candidate?: string): Promise<{ root: string; agent: string; policy: RunKpiPolicy } | undefined> {
    const resolution = await rootFor(sessionID);
    if (!resolution.valid) return;
    const root = resolution.root;
    if (candidate && root === sessionID) rootAgents.set(root, candidate);
    const agent = await rootAgent(root);
    const policy = await policyFor(agent);
    return policy && agent ? { root, agent, policy } : undefined;
  }

  function summary(root: string, agent: string) {
    return summarizeUsage(messages.get(`${root}\0${agent}`)?.values() ?? []);
  }

  return {
    event: async ({ event }: { event: { type: string; properties?: any } }) => {
      if (event.type !== "message.updated") {
        if (event.type !== "message.removed") return;
        const sessionID = event.properties?.sessionID;
        const messageID = event.properties?.messageID;
        if (!sessionID || !messageID) return;
        const enabled = await enabledPolicy(sessionID);
        if (enabled) {
          for (const [key, records] of messages) if (key.startsWith(`${enabled.root}\0`)) records.delete(messageID);
        }
        return;
      }
      const message = event.properties?.info as AssistantMessage | undefined;
      if (!message || message.role !== "assistant") return;
      const enabled = await enabledPolicy(message.sessionID);
      if (!enabled) return;
      const usage = usageFor(message);
      const key = `${enabled.root}\0${enabled.agent}`;
      const records = messages.get(key) ?? new Map<string, Usage>();
      if (usage) records.set(message.id, usage);
      else records.delete(message.id);
      messages.set(key, records);
    },
    "chat.params": async (
      input: { sessionID: string; agent: string },
      output: { maxOutputTokens: number | undefined },
    ) => {
      const enabled = await enabledPolicy(input.sessionID, input.agent);
      if (!enabled) return;
      const used = summary(enabled.root, enabled.agent).tokens;
      const remaining = Math.floor(enabled.policy.hardBudgetTokens - used);
      if (remaining <= 0) throw new Error("Generated-agent KPI hard token budget exhausted; stop new work and report the incomplete state.");
      output.maxOutputTokens = output.maxOutputTokens === undefined
        ? remaining
        : Math.min(output.maxOutputTokens, remaining);
    },
    "experimental.chat.system.transform": async (
      input: { sessionID?: string },
      output: { system: string[] },
    ) => {
      if (!input.sessionID) return;
      const enabled = await enabledPolicy(input.sessionID);
      if (!enabled) return;
      const usage = summary(enabled.root, enabled.agent);
      const activeMinutes = usage.activeMilliseconds / 60_000;
      const rate = activeMinutes > 0 ? Math.round(usage.tokensPerActiveMinute) : 0;
      output.system.push(
        `Run KPIs are enabled. Continue only useful in-scope work while it remains. Do not sleep, pad, create no-op work, widen scope, skip checks, or continue after valid completion. Active time target: ${enabled.policy.unattendedRuntimeSeconds}s. Token usage: ${usage.tokens}/${enabled.policy.hardBudgetTokens}; active token rate: ${rate}/${enabled.policy.targetTokensPerActiveMinute} tokens/min. Prefer concise evidence, batched local inspection, and necessary delegation only. Hard budget exhaustion stops new work.`,
      );
    },
  };
};
