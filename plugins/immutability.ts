import { constants, existsSync, lstatSync, realpathSync } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MUTATING_TOOLS = new Set(["write", "edit", "patch", "apply_patch"]);
const SHELL_TOOLS = new Set(["bash"]);
const PROMETHEUS_ONLY_TOOLS = new Set(["spike", "scaffold_gitignore", "validate_scaffold"]);
const MANAGED_AGENTS = new Set(["ask", "prometheus", "autonomous", "karpathy", "reviewer", "grounder", "implementation-validator", "out-of-the-box-thinker"]);
const READ_ONLY_AGENTS = new Set(["ask", "karpathy", "reviewer", "grounder", "implementation-validator", "out-of-the-box-thinker"]);
const PROMETHEUS_WRITABLE = ["SPEC.md", "opencode-autonomous.json", ".prometheus/evaluator/**", ".spike/**"];
const TRUSTED_PATHS = [
  "tools/spike.ts",
  "tools/validate_scaffold.ts",
  "tools/scaffold_gitignore.ts",
  "plugins/immutability.ts",
  "plugins/autonomous-kpis.ts",
  "skills/cuddly-winner-feedback/record-feedback.mjs",
];

type TerminalRecord = {
  schema_version: 1;
  terminal: "confirmed_blocked";
  session_id: string;
  episode: string;
  blocker_code: string;
};

function strictTerminalRecord(value: unknown): TerminalRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = ["blocker_code", "episode", "schema_version", "session_id", "terminal"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return;
  if (
    record.schema_version !== 1 || record.terminal !== "confirmed_blocked"
    || typeof record.session_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(record.session_id)
    || typeof record.episode !== "string" || !/^[1-9][0-9]{0,8}$/.test(record.episode)
    || typeof record.blocker_code !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(record.blocker_code)
  ) return;
  return record as TerminalRecord;
}

async function feedbackRoot(locator: string): Promise<string> {
  const locatorStat = await lstat(locator);
  if (!locatorStat.isFile() || locatorStat.isSymbolicLink()) throw new Error("terminal feedback locator is unsafe");
  const raw = await readFile(locator, "utf8");
  if (!raw.endsWith("\n") || raw.slice(0, -1).includes("\n") || !isAbsolute(raw.slice(0, -1))) throw new Error("terminal feedback locator is malformed");
  const root = raw.slice(0, -1);
  if (root.split(sep).pop() !== "feedback") throw new Error("terminal feedback locator is malformed");
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("terminal feedback locator is stale");
  return realpath(root);
}

export async function captureTerminalFeedback(value: unknown, locator?: string, projectRoot?: string): Promise<any> {
  if (typeof locator !== "string" || typeof projectRoot !== "string") return {};
  const record = strictTerminalRecord(value);
  if (!record) throw new Error("strict terminal record required");
  let root: string;
  try { root = await feedbackRoot(locator); } catch { return; }
  if (await realpath(projectRoot) === dirname(root)) return;
  const inbox = resolve(root, "inbox");
  await mkdir(inbox, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  await chmod(inbox, 0o700);
  const digest = createHash("sha256").update(`${record.session_id}\0${record.episode}`).digest("hex");
  const target = resolve(inbox, `terminal-${digest}.md`);
  const body = `---\nschema_version: 1\nstatus: new\ncaptured_at: ${new Date().toISOString()}\n---\n\n# Summary\n\nConfirmed Autonomous block.\n\n# Terminal record\n\n- Session: ${record.session_id}\n- Episode: ${record.episode}\n- Blocker code: ${record.blocker_code}\n`;
  try {
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { await handle.writeFile(body, "utf8"); } finally { await handle.close(); }
    await chmod(target, 0o600);
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
  }
  return target;
}

function terminalRecordFromMessage(messages: any[]): TerminalRecord | undefined {
  const latest = messages.at(-1);
  if (latest?.info?.role !== "assistant" || !latest?.info?.time?.completed) return;
  const text = (latest.parts ?? [])
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n");
  const match = text.match(/^CUDDLY_WINNER_TERMINAL_RECORD: ([^\n]+)$/m);
  if (!match) return;
  try { return strictTerminalRecord(JSON.parse(match[1])); } catch { return; }
}

function deployedFeedbackLocator(): string {
  return resolve(dirname(dirname(fileURLToPath(import.meta.url))), "feedback", "cuddly-winner-feedback-root");
}

function matchesPattern(relPath: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/\\/g, "/")
    .replace(/[.+^${}()|[\]]/g, "\\$&")
    .replace(/\*\*/g, "{{DOUBLE_STAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{DOUBLE_STAR\}\}/g, ".*");
  return new RegExp(`^${escaped}$`).test(relPath.replace(/\\/g, "/"));
}

function extractPatchedPaths(patchText: string): string[] {
  const paths = new Set<string>();
  for (const line of patchText.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
    if (match?.[1].trim()) paths.add(match[1].trim());
  }
  return [...paths];
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

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function isTrustedPath(relPath: string): boolean {
  return TRUSTED_PATHS.some((trusted) => relPath === trusted || relPath.startsWith(`${trusted}/`));
}

function isPublishedScaffold(relPath: string): boolean {
  return relPath === "SPEC.md" || relPath === "opencode-autonomous.json" || relPath.startsWith(".prometheus/evaluator/");
}

export const ImmutabilityGuard = async ({ directory, worktree, client }: { directory: string; worktree: string; client: any }) => {
  const lexicalRoot = resolve(directory || worktree);
  const root = realpathSync(lexicalRoot);
  const sessionAgents = new Map<string, string>();
  const publicationReminders = new Set<string>();

  async function resolveAgent(sessionID: string, visited = new Set<string>()): Promise<string | undefined> {
    if (visited.has(sessionID)) return undefined;
    visited.add(sessionID);
    let session: any;
    try {
      const result = await client?.session?.get?.({ path: { id: sessionID } });
      session = result?.data ?? result;
      const parentID = session?.parentID;
      if (parentID) {
        const parentAgent = await resolveAgent(parentID, visited);
        if (parentAgent && MANAGED_AGENTS.has(parentAgent)) {
          sessionAgents.set(sessionID, parentAgent);
          return parentAgent;
        }
      }
    } catch {}
    if (typeof session?.agent === "string" && session.agent) {
      sessionAgents.set(sessionID, session.agent);
      return session.agent;
    }
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

  // Unlike resolveAgent, this never walks parentID or reads/writes the shared
  // inheritance cache: the idle-publication reminder must fire only for a
  // session that is itself Prometheus, not a managed descendant (e.g. a
  // Grounder child) that merely inherits Prometheus's edit restrictions.
  async function ownAgent(sessionID: string): Promise<string | undefined> {
    try {
      const result = await client?.session?.get?.({ path: { id: sessionID } });
      const session = result?.data ?? result;
      if (typeof session?.agent === "string" && session.agent) return session.agent;
    } catch {}
    try {
      const result = await client?.session?.messages?.({ path: { id: sessionID } });
      const messages = result?.data ?? (Array.isArray(result) ? result : []);
      for (let index = messages.length - 1; index >= 0; index--) {
        const info = messages[index]?.info;
        if (info?.role === "user" && info.agent) return info.agent;
      }
    } catch {}
    return undefined;
  }

  return {
    event: async ({ event }: { event: { type: string; properties?: { sessionID?: string } } }) => {
      if (event.type !== "session.idle") return;
      const sessionID = event.properties?.sessionID;
      if (!sessionID || publicationReminders.has(sessionID)) return;
      const agent = await ownAgent(sessionID);
      if (agent === "autonomous") {
        try {
          const sessionResult = await client?.session?.get?.({ path: { id: sessionID } });
          const session = sessionResult?.data ?? sessionResult;
          if (session?.parentID) return;
          const result = await client?.session?.messages?.({ path: { id: sessionID } });
          const messages = result?.data ?? (Array.isArray(result) ? result : []);
          const record = terminalRecordFromMessage(messages);
          if (record) await captureTerminalFeedback(record, deployedFeedbackLocator(), root);
        } catch {}
        return;
      }
      if (agent !== "prometheus") return;
      if (existsSync(resolve(root, "SPEC.md")) && existsSync(resolve(root, "opencode-autonomous.json"))) return;

      // Continue the same session once rather than allowing an unpublished plan to end silently.
      publicationReminders.add(sessionID);
      await client?.session?.promptAsync?.({
        path: { id: sessionID },
        body: {
          agent: "prometheus",
          parts: [{ type: "text", text: "Before completing, publish SPEC.md and opencode-autonomous.json if this task is planning-ready. If a concrete planning blocker remains, state it as a focused question." }],
        },
      });
    },
    "chat.params": async (input: { sessionID: string; agent: string }) => {
      if (input.sessionID && input.agent) sessionAgents.set(input.sessionID, input.agent);
    },
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args?: Record<string, unknown> },
    ) => {
      if (!MUTATING_TOOLS.has(input.tool) && !SHELL_TOOLS.has(input.tool) && !PROMETHEUS_ONLY_TOOLS.has(input.tool)) return;
      const agent = await resolveAgent(input.sessionID);
      if (!agent || !MANAGED_AGENTS.has(agent)) return;

      if (PROMETHEUS_ONLY_TOOLS.has(input.tool)) {
        if (agent !== "prometheus") throw new Error(`ImmutabilityGuard: only @prometheus may invoke ${input.tool}.`);
        return;
      }

      const args = output.args ?? {};
      if (SHELL_TOOLS.has(input.tool)) {
        if (READ_ONLY_AGENTS.has(agent)) throw new Error(`ImmutabilityGuard: @${agent} is read-only.`);
        if (agent === "prometheus") throw new Error("ImmutabilityGuard: @prometheus may not execute shell commands directly.");
        return;
      }

      if (READ_ONLY_AGENTS.has(agent)) throw new Error(`ImmutabilityGuard: @${agent} is read-only.`);
      const rawPath = (args.filePath ?? args.file_path ?? args.path) as string | undefined;
      const cwd = (args.cwd as string | undefined) ?? root;
      const paths = rawPath
        ? [isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath)]
        : input.tool === "apply_patch" && typeof args.patchText === "string"
          ? extractPatchedPaths(args.patchText).map((item) => isAbsolute(item) ? item : resolve(cwd, item))
          : [];
      if (!paths.length) throw new Error(`ImmutabilityGuard: ${input.tool} did not expose mutation targets.`);

      for (const unresolvedPath of paths) {
        const absolutePath = safeTarget(lexicalRoot, root, unresolvedPath);
        const relPath = relative(root, absolutePath).replace(/\\/g, "/");
        if (isPublishedScaffold(relPath) && agent !== "prometheus") throw new Error(`ImmutabilityGuard: @${agent} cannot rewrite published scaffold: "${relPath}".`);
        if (agent === "prometheus" && isPublishedScaffold(relPath)) continue;
        if (isTrustedPath(relPath)) throw new Error(`ImmutabilityGuard: "${relPath}" is trusted control-plane state.`);
        if (agent === "prometheus" && !PROMETHEUS_WRITABLE.some((pattern) => matchesPattern(relPath, pattern))) {
          throw new Error(`ImmutabilityGuard: @prometheus is restricted to writing [${PROMETHEUS_WRITABLE.join(", ")}].`);
        }
      }
    },
  };
};
