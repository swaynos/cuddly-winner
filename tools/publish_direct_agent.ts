/** Publish one self-contained Direct agent without replacing an existing task. */
import { tool } from "@opencode-ai/plugin";
import { randomBytes } from "node:crypto";
import { promises as fs, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export const DIRECT_AGENT_DIRECTORY = ".opencode/agents/generated";
export const DIRECT_POLICY_BEGIN = "<!-- CUDDLY-WINNER DIRECT POLICY BEGIN -->";
export const DIRECT_POLICY_END = "<!-- CUDDLY-WINNER DIRECT POLICY END -->";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TRUSTED_CONTROL_PATHS = ["agents", "plugins", "tools", "rules", "scripts"];
const RESERVED_NAMES = new Set([
  "build", "plan", "general", "explore", "compaction", "title", "summary",
  "ask", "grounder", "prometheus", "reviewer",
]);
const POLICY_KEYS = new Set(["schema_version", "name", "edit_paths", "bash"]);

export type DirectAgentPolicy = {
  schema_version: 1;
  name: string;
  edit_paths: string[];
  bash: boolean;
};

export type DirectAgentRequest = {
  model?: string;
  name: string;
  description: string;
  outcome: string;
  acceptance_criteria: string[];
  durable_context: string[];
  edit_paths: string[];
  bash: boolean;
  verification_commands: string[];
  stop_conditions: string[];
  escalation_triggers: string[];
  instructions: string;
};

type PublishedAgent = { name: string; path: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\\") &&
    !path.isAbsolute(value) && !path.win32.isAbsolute(value) && !/^[A-Za-z]:/.test(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function pathKey(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

export function isGeneratedDirectPath(value: string): boolean {
  const candidate = pathKey(value);
  const generated = pathKey(DIRECT_AGENT_DIRECTORY);
  return candidate === generated || candidate.startsWith(`${generated}/`);
}

export function isProtectedControlPath(value: string): boolean {
  if (isGeneratedDirectPath(value)) return true;
  const candidate = pathKey(value);
  return TRUSTED_CONTROL_PATHS.some((trusted) => {
    const protectedPath = pathKey(trusted);
    return candidate === protectedPath || candidate.startsWith(`${protectedPath}/`);
  });
}

function assertName(value: unknown): asserts value is string {
  if (typeof value !== "string" || !NAME_RE.test(value) || RESERVED_NAMES.has(value)) {
    throw new Error("agent name must be an unreserved lowercase hyphenated name");
  }
}

export function isDirectAgentName(value: unknown): value is string {
  return typeof value === "string" && NAME_RE.test(value) && !RESERVED_NAMES.has(value);
}

function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
}

function assertTextList(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} must be a non-empty string array`);
  }
}

function assertPathList(value: unknown, label: string): asserts value is string[] {
  assertTextList(value, label);
  const seen = new Set<string>();
  for (const item of value) {
    if (!canonicalPath(item)) throw new Error(`${label} must contain canonical worktree-relative paths`);
    if (seen.has(item)) throw new Error(`${label} contains a duplicate path: ${item}`);
    seen.add(item);
  }
}

function assertSafeEditPaths(paths: string[]): void {
  for (const item of paths) {
    if (isProtectedControlPath(item)) {
      throw new Error(`edit_paths must not contain a protected control-plane path: ${item}`);
    }
  }
}

function assertNoPolicyMarker(value: string, label: string): void {
  if (value.includes(DIRECT_POLICY_BEGIN) || value.includes(DIRECT_POLICY_END)) {
    throw new Error(`${label} must not contain a Direct policy marker`);
  }
}

function assertNoPolicyMarkers(request: DirectAgentRequest): void {
  for (const [label, value] of Object.entries(request)) {
    if (typeof value === "string") assertNoPolicyMarker(value, label);
    else if (Array.isArray(value)) for (const item of value) assertNoPolicyMarker(item, label);
  }
}

export function validateDirectAgentRequest(value: unknown): DirectAgentRequest {
  if (!record(value)) throw new Error("Direct agent request must be an object");
  const expected = new Set([
    "name", "description", "outcome", "acceptance_criteria", "durable_context",
    "edit_paths", "bash", "verification_commands", "stop_conditions",
    "escalation_triggers", "instructions",
  ]);
  for (const key of Object.keys(value)) if (!expected.has(key) && key !== "model") throw new Error(`unknown Direct agent field: ${key}`);
  for (const key of expected) if (!(key in value)) throw new Error(`missing Direct agent field: ${key}`);

  assertName(value.name);
  assertText(value.description, "description");
  assertText(value.outcome, "outcome");
  assertTextList(value.acceptance_criteria, "acceptance_criteria");
  assertPathList(value.durable_context, "durable_context");
  assertPathList(value.edit_paths, "edit_paths");
  assertSafeEditPaths(value.edit_paths);
  if (typeof value.bash !== "boolean") throw new Error("bash must be boolean");
  assertTextList(value.verification_commands, "verification_commands");
  assertTextList(value.stop_conditions, "stop_conditions");
  assertTextList(value.escalation_triggers, "escalation_triggers");
  assertText(value.instructions, "instructions");

  const request: DirectAgentRequest = {
    ...(value.model === undefined ? {} : { model: value.model as string }),
    name: value.name,
    description: value.description,
    outcome: value.outcome,
    acceptance_criteria: value.acceptance_criteria,
    durable_context: value.durable_context,
    edit_paths: value.edit_paths,
    bash: value.bash,
    verification_commands: value.verification_commands,
    stop_conditions: value.stop_conditions,
    escalation_triggers: value.escalation_triggers,
    instructions: value.instructions,
  };
  if (request.model !== undefined && (typeof request.model !== "string" || !/^[^\s/]+\/[^\s]+$/.test(request.model))) {
    throw new Error("model must be a provider/model identifier");
  }
  assertNoPolicyMarkers(request);
  return request;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function directAgentRelativePath(name: string): string {
  assertName(name);
  return `${DIRECT_AGENT_DIRECTORY}/${name}.md`;
}

export function directAgentPath(root: string, name: string): string {
  const realRoot = realpathSync(path.resolve(root));
  const target = path.resolve(realRoot, directAgentRelativePath(name));
  if (!inside(realRoot, target)) throw new Error("Direct agent path escapes the project root");
  return target;
}

function assertSafeExistingPath(root: string, target: string, leafMustBeFile = false): void {
  const relative = path.relative(root, target);
  let current = root;
  for (const [index, part] of (relative ? relative.split(path.sep) : []).entries()) {
    current = path.join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        if (leafMustBeFile) throw error;
        return;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Direct agent path contains a symlink: ${current}`);
    if (index < relative.split(path.sep).length - 1 && !stat.isDirectory()) {
      throw new Error(`Direct agent parent is not a directory: ${current}`);
    }
    if (index === relative.split(path.sep).length - 1 && leafMustBeFile && !stat.isFile()) {
      throw new Error(`Direct agent must be a regular file: ${current}`);
    }
  }
}

async function ensureSafeGeneratedDirectory(root: string): Promise<string> {
  let current = root;
  for (const part of DIRECT_AGENT_DIRECTORY.split("/")) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`Direct agent path contains a symlink: ${current}`);
      if (!stat.isDirectory()) throw new Error(`Direct agent parent is not a directory: ${current}`);
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      await fs.mkdir(current, { mode: 0o700 });
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Direct agent parent is unsafe: ${current}`);
    }
  }
  return current;
}

function list(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function commands(items: string[]): string {
  return items.map((item) => `- \`${item}\``).join("\n");
}

export function renderDirectAgent(request: DirectAgentRequest): string {
  const policy: DirectAgentPolicy = {
    schema_version: 1,
    name: request.name,
    edit_paths: request.edit_paths,
    bash: request.bash,
  };
  return [
    "---",
    `name: ${request.name}`,
    `description: ${JSON.stringify(request.description)}`,
    "mode: primary",
    ...(request.model ? [`model: ${JSON.stringify(request.model)}`] : []),
    `options: ${JSON.stringify({ goal: { criteria: request.acceptance_criteria } })}`,
    "permission:",
    "  \"*\": deny",
    "  read: allow",
    "  glob: allow",
    "  grep: allow",
    "  list: allow",
    "  question: allow",
    "  edit: deny",
    "  write: deny",
    "  bash: deny",
    "  task: deny",
    "  goal_cycle: allow",
    "---",
    "",
    DIRECT_POLICY_BEGIN,
    JSON.stringify(policy),
    DIRECT_POLICY_END,
    "",
    "You are the Direct implementation agent coordinating this goal. Read this file before working.",
    "Call goal_cycle to run a build iteration AND an independent validation iteration in separate fresh child sessions.",
    "On failed validation, call goal_cycle again: it supplies the findings to a fresh builder and then a fresh validator.",
    "Do not implement directly, reuse child contexts, or declare completion from a builder's report.",
    "Only a validated goal_cycle result establishes completion. Report its criterion-by-criterion evidence.",
    "A blocked result is incomplete: report the specific blocker and ask for the needed decision. Never weaken the goal to finish.",
    "",
    "# Outcome",
    request.outcome,
    "",
    "# Acceptance Criteria",
    list(request.acceptance_criteria),
    "",
    "# Durable Context",
    list(request.durable_context.map((item) => `Read \`${item}\`.`)),
    "",
    "# Instructions",
    request.instructions,
    "",
    "# Verification",
    commands(request.verification_commands),
    "",
    "# Stop Conditions",
    list(request.stop_conditions),
    "",
    "# Escalation Triggers",
    list(request.escalation_triggers),
    "",
  ].join("\n");
}

function parsePolicy(content: string, expectedName: string): DirectAgentPolicy {
  const begin = content.indexOf(DIRECT_POLICY_BEGIN);
  const end = content.indexOf(DIRECT_POLICY_END);
  if (begin === -1 || end === -1 || begin !== content.lastIndexOf(DIRECT_POLICY_BEGIN) || end !== content.lastIndexOf(DIRECT_POLICY_END) || end <= begin) {
    throw new Error("Direct agent must contain exactly one policy block");
  }
  const body = content.slice(begin + DIRECT_POLICY_BEGIN.length, end).trim();
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new Error("Direct agent policy is not valid JSON");
  }
  if (!record(raw)) throw new Error("Direct agent policy must be an object");
  for (const key of Object.keys(raw)) if (!POLICY_KEYS.has(key)) throw new Error(`unknown Direct agent policy key: ${key}`);
  for (const key of POLICY_KEYS) if (!(key in raw)) throw new Error(`missing Direct agent policy key: ${key}`);
  if (raw.schema_version !== 1) throw new Error("Direct agent policy schema_version must be 1");
  assertName(raw.name);
  if (raw.name !== expectedName) throw new Error("Direct agent policy name does not match the selected agent");
  assertPathList(raw.edit_paths, "Direct agent policy edit_paths");
  if (typeof raw.bash !== "boolean") throw new Error("Direct agent policy bash must be boolean");

  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
  if (!frontmatter || !new RegExp(`^name:\\s*${expectedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(frontmatter[1])) {
    throw new Error("Direct agent frontmatter name does not match the selected agent");
  }
  return { schema_version: 1, name: raw.name, edit_paths: raw.edit_paths, bash: raw.bash };
}

export function readDirectAgentPolicy(root: string, name: string): DirectAgentPolicy {
  const realRoot = realpathSync(path.resolve(root));
  const file = directAgentPath(realRoot, name);
  assertSafeExistingPath(realRoot, file, true);
  return parsePolicy(readFileSync(file, "utf8"), name);
}

export function hasDirectAgentFile(root: string, name: string): boolean {
  if (!isDirectAgentName(name)) return false;
  try {
    const realRoot = realpathSync(path.resolve(root));
    const file = directAgentPath(realRoot, name);
    assertSafeExistingPath(realRoot, file, true);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    return true;
  }
}

async function assertNameIsAvailable(root: string, name: string): Promise<void> {
  const declaredName = (content: string): string | undefined => {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    if (!frontmatter) return;
    let parsed: unknown;
    try {
      parsed = parseYaml(frontmatter[1]);
    } catch (error: any) {
      throw new Error(`local agent has invalid YAML frontmatter: ${error.message}`);
    }
    return record(parsed) && typeof parsed.name === "string" ? parsed.name : undefined;
  };
  const inspect = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error: any) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`local agent path contains a symlink: ${file}`);
      if (entry.isDirectory()) {
        await inspect(file);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
        const fileName = path.basename(entry.name, path.extname(entry.name));
        if (fileName === name || declaredName(await fs.readFile(file, "utf8")) === name) {
          throw new Error(`agent name already exists: ${name}`);
        }
      }
    }
  };
  for (const relative of [".opencode/agents", ".opencode/agent"]) {
    await inspect(path.join(root, relative));
  }
}

export async function publishDirectAgentFile(root: string, value: unknown): Promise<PublishedAgent> {
  const request = validateDirectAgentRequest(value);
  const realRoot = await fs.realpath(path.resolve(root));
  await assertNameIsAvailable(realRoot, request.name);
  const directory = await ensureSafeGeneratedDirectory(realRoot);
  const target = path.join(directory, `${request.name}.md`);
  const temporary = path.join(directory, `.publish-${process.pid}-${randomBytes(12).toString("hex")}`);
  const content = renderDirectAgent(request);
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.link(temporary, target);
    } catch (error: any) {
      if (error?.code === "EEXIST") throw new Error(`agent already exists: ${request.name}`);
      throw error;
    }
    return { name: request.name, path: directAgentRelativePath(request.name) };
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export default tool({
  description: "Publish one self-contained task-derived Direct agent without replacing an existing definition.",
  args: {
    model: tool.schema.string().regex(/^[^\s/]+\/[^\s]+$/).optional(),
    name: tool.schema.string().regex(NAME_RE),
    description: tool.schema.string().min(1),
    outcome: tool.schema.string().min(1),
    acceptance_criteria: tool.schema.array(tool.schema.string().min(1)).min(1),
    durable_context: tool.schema.array(tool.schema.string().min(1)).min(1),
    edit_paths: tool.schema.array(tool.schema.string().min(1)).min(1),
    bash: tool.schema.boolean(),
    verification_commands: tool.schema.array(tool.schema.string().min(1)).min(1),
    stop_conditions: tool.schema.array(tool.schema.string().min(1)).min(1),
    escalation_triggers: tool.schema.array(tool.schema.string().min(1)).min(1),
    instructions: tool.schema.string().min(1),
  },
  async execute(args, context) {
    const root = context.directory ?? context.worktree ?? process.cwd();
    return JSON.stringify(await publishDirectAgentFile(root, args), null, 2);
  },
});
