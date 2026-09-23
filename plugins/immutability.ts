import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  hasGoalAgentFile,
  isGeneratedGoalAgentPath,
  isGoalAgentName,
  isProtectedControlPath,
  readGoalAgentPolicy,
  type GoalAgentPolicy,
} from "../tools/publish_goal_agent.ts";

const MUTATING_TOOLS = new Set(["write", "edit", "patch", "apply_patch"]);
const SHELL_TOOLS = new Set(["bash"]);
const GOAL_AGENT_PUBLISH_TOOLS = new Set(["publish_goal_agent"]);
const BROWSER_FILE_WRITE_TOOLS = new Set(["browser_screenshot", "browser_download", "browser_save_media"]);
const MANAGED_AGENTS = new Set(["ask", "prometheus", "grounder"]);
const READ_ONLY_AGENTS = new Set(["ask", "grounder"]);

// Browser tools that can hand saved authentication state back to the model stay
// blocked even though the managed MCP does not expose them.
const BROWSER_STATE_EXPORT_TOOLS = new Set([
  "browser_get_cookies",
  "browser_storage_state",
  "browser_network_requests",
]);

function matchesTool(tool: string, names: Set<string>): boolean {
  return names.has(tool) || [...names].some((name) => tool.endsWith(`_${name}`));
}

function exposesBrowserState(tool: string): boolean {
  return matchesTool(tool, BROWSER_STATE_EXPORT_TOOLS);
}

function mutatesFiles(tool: string): boolean {
  return MUTATING_TOOLS.has(tool) || matchesTool(tool, BROWSER_FILE_WRITE_TOOLS);
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function safeTarget(lexicalRoot: string, root: string, target: string): string {
  const resolved = resolve(target);
  if (!isInside(lexicalRoot, resolved)) throw new Error(`ImmutabilityGuard: target escapes active worktree: ${target}`);
  const rel = relative(lexicalRoot, resolved);
  let current = lexicalRoot;
  for (const part of rel ? rel.split(sep) : []) {
    current = resolve(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error(`ImmutabilityGuard: target escapes active worktree: ${target}`);
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return resolve(root, rel);
}

function extractPatchedPaths(patchText: string): string[] {
  const paths = new Set<string>();
  for (const line of patchText.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/) ?? line.match(/^\*\*\* Move to: (.+)$/);
    if (match?.[1].trim()) paths.add(match[1].trim());
  }
  return [...paths];
}

function hasLegacyGeneratedPackage(root: string, agent: string): boolean {
  if (!isGoalAgentName(agent)) return false;
  const paths = [
    ".opencode/generated-agents.json",
    `.opencode/agents/${agent}.md`,
    `.opencode/tasks/${agent}.md`,
    `.opencode/tasks/${agent}.json`,
  ];
  return paths.every((relativePath) => {
    try {
      return lstatSync(resolve(root, relativePath)).isFile();
    } catch (error: any) {
      return error?.code !== "ENOENT";
    }
  });
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

export const ImmutabilityGuard = async ({ directory, worktree, client }: { directory: string; worktree: string; client: any }) => {
  const lexicalRoot = resolve(directory || worktree);
  const root = realpathSync(lexicalRoot);
  const sessionAgents = new Map<string, string>();
  const invalidAncestry = new Set<string>();

  type GoalAgentRegistration = { goalAgent: boolean; legacy?: boolean; policy?: GoalAgentPolicy };
  const goalAgentPolicies = new Map<string, GoalAgentRegistration>();
  function goalAgentPolicy(agent: string): GoalAgentRegistration {
    const cached = goalAgentPolicies.get(agent);
    if (cached) return cached;
    if (hasLegacyGeneratedPackage(root, agent)) {
      const registration = { goalAgent: true, legacy: true };
      goalAgentPolicies.set(agent, registration);
      return registration;
    }
    if (!hasGoalAgentFile(root, agent)) return { goalAgent: false };
    try {
      const registration = { goalAgent: true, policy: readGoalAgentPolicy(root, agent) };
      goalAgentPolicies.set(agent, registration);
      return registration;
    } catch {
      const registration = { goalAgent: true };
      goalAgentPolicies.set(agent, registration);
      return registration;
    }
  }
  function isManaged(agent: string): boolean {
    return MANAGED_AGENTS.has(agent) || goalAgentPolicy(agent).goalAgent;
  }

  type AgentResolution = { valid: true; agents: string[]; current?: string; hasParent: boolean } | { valid: false };
  async function resolveAgent(sessionID: string, visited = new Set<string>()): Promise<AgentResolution> {
    if (invalidAncestry.has(sessionID)) return { valid: false };
    if (visited.has(sessionID)) {
      for (const id of visited) invalidAncestry.add(id);
      invalidAncestry.add(sessionID);
      return { valid: false };
    }
    visited.add(sessionID);
    let session: Record<string, any>;
    try {
      const result = await client?.session?.get?.({ path: { id: sessionID } });
      const resolved = resolvedSession(result, sessionID);
      if (!resolved) throw new Error("unresolved session");
      session = resolved;
      let parent: AgentResolution | undefined;
      if (session.parentID) {
        parent = await resolveAgent(session.parentID, visited);
        if (!parent.valid) {
          invalidAncestry.add(sessionID);
          return parent;
        }
      }
      const current = sessionAgents.get(sessionID) ?? (typeof session.agent === "string" && session.agent ? session.agent : undefined);
      const agents = [...(parent?.agents ?? [])];
      if (current && isManaged(current)) agents.push(current);
      return { valid: true, agents, current, hasParent: Boolean(session.parentID) };
    } catch {
      for (const id of visited) invalidAncestry.add(id);
      return { valid: false };
    }
    return { valid: true, agents: [], hasParent: false };
  }

  function goalAgentPolicyFor(agent: string): GoalAgentPolicy | undefined {
    const registration = goalAgentPolicy(agent);
    if (registration.legacy) {
      throw new Error(`ImmutabilityGuard: @${agent} uses a retired generated-agent package; republish it as a Goal Agent before mutating files or using shell commands.`);
    }
    if (registration.goalAgent && !registration.policy) {
      throw new Error(`ImmutabilityGuard: @${agent} has an invalid Goal Agent definition; mutation and shell access are denied.`);
    }
    return registration.policy;
  }

  return {
    "chat.params": async (input: { sessionID: string; agent: string }) => {
      if (input.sessionID && input.agent) sessionAgents.set(input.sessionID, input.agent);
    },
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args?: Record<string, unknown> },
    ) => {
      if (exposesBrowserState(input.tool)) {
        throw new Error(`ImmutabilityGuard: ${input.tool} is blocked because it can hand saved browser authentication state to the model. Managed browser tools load login state privately; export tools are never permitted.`);
      }
      if (!mutatesFiles(input.tool) && !SHELL_TOOLS.has(input.tool) && !GOAL_AGENT_PUBLISH_TOOLS.has(input.tool)) return;

      const resolution = await resolveAgent(input.sessionID);
      if (!resolution.valid) throw new Error("ImmutabilityGuard: session has invalid or cyclic ancestry; mutation and shell access are denied.");
      const agents = resolution.agents;

      if (GOAL_AGENT_PUBLISH_TOOLS.has(input.tool)) {
        const canPublish =
          !resolution.hasParent &&
          ((resolution.current === "prometheus" && agents.length === 1 && agents[0] === "prometheus") ||
           (resolution.current === "build" && agents.length === 0));
        if (!canPublish) {
          throw new Error(`ImmutabilityGuard: only @prometheus or @build may invoke ${input.tool}.`);
        }
        return;
      }
      if (!agents.length) return;
      const agent = agents[agents.length - 1];
      if (agents.some((name) => READ_ONLY_AGENTS.has(name))) {
        throw new Error(`ImmutabilityGuard: @${agent} is read-only.`);
      }
      if (agents.includes("prometheus")) {
        if (SHELL_TOOLS.has(input.tool)) throw new Error("ImmutabilityGuard: @prometheus may not execute shell commands.");
        throw new Error("ImmutabilityGuard: @prometheus may not edit project files.");
      }
      const policies = agents.map(goalAgentPolicyFor).filter((policy): policy is GoalAgentPolicy => Boolean(policy));

      if (SHELL_TOOLS.has(input.tool)) {
        if (policies.some((policy) => !policy.bash)) throw new Error(`ImmutabilityGuard: @${agent} may not execute shell commands.`);
        return;
      }

      const args = output.args ?? {};
      const browserFileWriter = matchesTool(input.tool, BROWSER_FILE_WRITE_TOOLS);
      let paths: string[];
      if (browserFileWriter) {
        if (["filePath", "file_path", "cwd"].some((key) => Object.prototype.hasOwnProperty.call(args, key))) {
          throw new Error(`ImmutabilityGuard: ${input.tool} exposed unsupported target arguments.`);
        }
        if (typeof args.path !== "string" || !isAbsolute(args.path)) {
          throw new Error(`ImmutabilityGuard: ${input.tool} requires an absolute output path.`);
        }
        paths = [args.path];
      } else {
        const rawPath = (args.filePath ?? args.file_path ?? args.path) as string | undefined;
        const cwd = (args.cwd as string | undefined) ?? root;
        paths = rawPath
          ? [isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath)]
          : input.tool === "apply_patch" && typeof args.patchText === "string"
            ? extractPatchedPaths(args.patchText).map((item) => isAbsolute(item) ? item : resolve(cwd, item))
            : [];
      }
      if (!paths.length) throw new Error(`ImmutabilityGuard: ${input.tool} did not expose mutation targets.`);

      for (const unresolvedPath of paths) {
        const absolutePath = safeTarget(lexicalRoot, root, unresolvedPath);
        const relPath = relative(root, absolutePath).replace(/\\/g, "/");
        if (isGeneratedGoalAgentPath(relPath)) throw new Error(`ImmutabilityGuard: @${agent} cannot rewrite published Goal Agent definition: "${relPath}".`);
        if (isProtectedControlPath(relPath)) throw new Error(`ImmutabilityGuard: "${relPath}" is trusted control-plane state.`);
        if (policies.some((policy) => !policy.edit_paths.includes(relPath))) throw new Error(`ImmutabilityGuard: @${agent} cannot edit outside its declared edit paths: "${relPath}".`);
      }
    },
  };
};
