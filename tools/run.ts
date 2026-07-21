/** Trusted command runner. Evidence is durable before this tool resolves. */
import { tool } from "@opencode-ai/plugin";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type RunContext = "execution" | "spike";

export interface RunInput {
  command: string;
  cwd?: string;
  timeoutSec?: number;
  context?: RunContext;
  spike_id?: string;
  supervisor_run_id?: string;
  spec_fingerprint?: string;
  active_worktree?: string;
  network?: "none" | "verification";
}

export interface RunResult {
  run_id: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  command: string;
  exit_code: number;
  stdout_tail: string;
  stderr_tail: string;
  timed_out: boolean;
  context: RunContext;
  spike_id?: string;
  supervisor_run_id?: string;
  spec_fingerprint?: string;
  worktree: string;
  output_truncated: boolean;
  network: "none" | "verification";
}

const MAX_CONCURRENT = 5;
const DEFAULT_TIMEOUT_SEC = 30;
const MAX_TIMEOUT_SEC = 900;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_RUN_INVOCATIONS = 64;
const MAX_RUN_WALL_MS = 2 * 60 * 60 * 1000;
const MAX_RUN_OUTPUT_BYTES = 16 * 1024 * 1024;
const TAIL_CHARS = 4096;
let running = 0;

const tail = (value: string) =>
  value.length > TAIL_CHARS ? `...${value.slice(-TAIL_CHARS)}` : value;

export const normalizeCommand = (command: string) =>
  command.replace(
    /\/home\/[^/]+\/\.pyenv\/versions\/[^/]+\/bin\/python3/g,
    "python3",
  );

const fingerprint = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

async function atomicWrite(file: string, data: string | Buffer): Promise<void> {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    const handle = await fs.open(temp, "w");
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, file);
    const directory = await fs.open(path.dirname(file), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

const SECRET_NAME = /(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL|COOKIE|AUTH)/i;
const SAFE_ENV = new Set(["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "SHELL", "PYENV_ROOT", "PYENV_VERSION", "NODE_OPTIONS"]);

function safeEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { TMPDIR: "/tmp" };
  for (const [key, value] of Object.entries(process.env)) {
    if (SAFE_ENV.has(key) && !SECRET_NAME.test(key) && value !== undefined) env[key] = value;
  }
  return env;
}

// Pattern-based redaction over common secret shapes. Best-effort per the
// documented threat model (docs/ARCHITECTURE.md § Protected Execution Threat
// Model): reduces accidental leakage, not a guarantee against exfiltration.
const REDACTION_PATTERNS: RegExp[] = [
  /\b(?:sk|ghp|github_pat)[-_][A-Za-z0-9_-]{12,}\b/g, // provider token prefixes
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi, // bearer tokens
  /\b(?:password|passwd|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi, // key=value assignments
  /-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+)?PRIVATE KEY-----/g, // PEM blocks
];

function redact(value: string): string {
  let result = value;
  for (const pattern of REDACTION_PATTERNS) result = result.replace(pattern, "[REDACTED]");
  for (const [key, secret] of Object.entries(process.env)) {
    if (SECRET_NAME.test(key) && secret && secret.length >= 4) result = result.split(secret).join("[REDACTED]");
  }
  return result;
}

async function canonicalDirectory(value: string): Promise<string> {
  const result = await fs.realpath(path.resolve(value));
  if (!(await fs.stat(result)).isDirectory()) throw new Error(`Invalid cwd: ${result}`);
  return result;
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

async function consumeBudget(cwd: string, runID: string, outputBytes = 0, countInvocation = false): Promise<void> {
  const file = path.join(cwd, ".opencode", "supervisor", `${runID}.budget.json`);
  let budget = { started_at: new Date().toISOString(), invocations: 0, output_bytes: 0 };
  try { budget = JSON.parse(await fs.readFile(file, "utf8")); } catch (error: any) { if (error?.code !== "ENOENT") throw new Error("Runner budget state is malformed", { cause: error }); }
  if (Date.now() - Date.parse(budget.started_at) > MAX_RUN_WALL_MS) throw new Error("Runner wall-clock budget exhausted");
  if (countInvocation) budget.invocations += 1;
  budget.output_bytes += outputBytes;
  if (budget.invocations > MAX_RUN_INVOCATIONS) throw new Error("Runner invocation budget exhausted");
  if (budget.output_bytes > MAX_RUN_OUTPUT_BYTES) throw new Error("Runner aggregate output budget exhausted");
  await atomicWrite(file, `${JSON.stringify(budget, null, 2)}\n`);
}

async function destination(
  cwd: string,
  input: RunInput,
): Promise<{ dir: string; context: RunContext }> {
  const context = input.context ?? "execution";
  if (context !== "execution" && context !== "spike") {
    throw new Error(`Unknown execution context: ${context}`);
  }
  if (context === "execution") {
    if (input.spike_id) throw new Error("spike_id is only valid in spike context");
    return { dir: path.join(cwd, ".opencode", "runs"), context };
  }
  if (!input.spike_id || !/^[a-z0-9][a-z0-9-]*$/.test(input.spike_id)) {
    throw new Error("Spike context requires a safe spike_id");
  }
  const questionPath = path.join(cwd, ".spike", input.spike_id, "QUESTION.md");
  const question = await fs.readFile(questionPath, "utf8").catch(() => {
    throw new Error(`Missing spike contract: ${questionPath}`);
  });
  if (!/^##?\s+Question/im.test(question) || !/kill criterion/i.test(question)) {
    throw new Error("QUESTION.md must contain a question and kill criterion");
  }
  return { dir: path.join(cwd, ".spike", input.spike_id, "runs"), context };
}

async function processCommand(
  cwd: string,
  input: RunInput,
): Promise<{ file: string; args: string[] }> {
  if (process.platform !== "linux") throw new Error(`Runner sandbox unsupported on ${process.platform}; secure execution requires Linux with Bubblewrap`);
  const bwrap = process.env.OPENCODE_BWRAP_PATH || "/usr/bin/bwrap";
  try {
    await fs.access(bwrap);
  } catch {
    throw new Error(`Runner sandbox unavailable: ${bwrap} is required`);
  }

  const tempProjectArgs = cwd.startsWith(`/tmp${path.sep}`)
    ? ["--dir", cwd, "--ro-bind", cwd, cwd]
    : [];

  if ((input.context ?? "execution") === "execution") {
    return {
      file: bwrap,
      args: [
        "--die-with-parent", "--new-session", "--unshare-net", "--ro-bind", "/", "/",
        "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp",
        ...tempProjectArgs,
        "--chdir", cwd, "bash", "-c", input.command,
      ],
    };
  }

  const spikeDir = path.join(cwd, ".spike", input.spike_id!);
  return {
    file: bwrap,
    args: [
      "--die-with-parent", "--new-session", "--unshare-net", "--ro-bind", "/", "/",
      "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp",
      ...tempProjectArgs,
      "--bind", spikeDir, spikeDir,
      "--chdir", cwd, "bash", "-c", input.command,
    ],
  };
}

export async function run(input: RunInput): Promise<RunResult> {
  if (!input.command || typeof input.command !== "string") {
    throw new Error("command is required");
  }
  if (running >= MAX_CONCURRENT) {
    throw new Error(`Too many concurrent runs (max ${MAX_CONCURRENT})`);
  }
  running++;
  try {
    const cwd = await canonicalDirectory(input.cwd ?? process.cwd()).catch(() => { throw new Error(`Invalid cwd: ${input.cwd ?? process.cwd()}`); });
    const worktree = input.active_worktree ? await canonicalDirectory(input.active_worktree) : cwd;
    if (!isInside(worktree, cwd)) throw new Error(`Runner cwd escapes active worktree: ${cwd}`);

    const dest = await destination(cwd, input);
    if (dest.context === "execution" && (
      !input.supervisor_run_id ||
      !/^[a-zA-Z0-9_-]+$/.test(input.supervisor_run_id) ||
      !/^[a-f0-9]{64}$/.test(input.spec_fingerprint ?? "")
    )) {
      throw new Error("Execution context requires valid supervisor run and SPEC provenance");
    }
    await fs.mkdir(dest.dir, { recursive: true });
    if (dest.context === "execution") {
      await fs.mkdir(path.join(cwd, ".opencode", "supervisor"), { recursive: true });
      await consumeBudget(cwd, input.supervisor_run_id!, 0, true);
    }

    const processSpec = await processCommand(cwd, input);
    const run_id = crypto.randomBytes(12).toString("hex");
    const startMs = Date.now();
    const started_at = new Date(startMs).toISOString();
    let stdout = "";
    let stderr = "";
    let timed_out = false;
    let signal: NodeJS.Signals | null = null;
    const chunks: Buffer[] = [];
    let storedBytes = 0;
    let outputBytes = 0;
    let output_truncated = false;

    const exit_code = await new Promise<number>((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        callback();
      };

      let proc;
      try {
        proc = spawn(processSpec.file, processSpec.args, {
          cwd,
          env: safeEnvironment(),
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        reject(error);
        return;
      }

      proc.stdout.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        const remaining = Math.max(0, MAX_OUTPUT_BYTES - storedBytes);
        if (remaining) { const saved = Buffer.from(redact(chunk.subarray(0, remaining).toString("utf8"))); chunks.push(saved); storedBytes += saved.length; }
        stdout = tail(redact(`${stdout}${chunk.toString("utf8")}`));
        if (outputBytes > MAX_OUTPUT_BYTES) { output_truncated = true; proc.kill("SIGKILL"); }
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        const remaining = Math.max(0, MAX_OUTPUT_BYTES - storedBytes);
        if (remaining) { const saved = Buffer.from(redact(chunk.subarray(0, remaining).toString("utf8"))); chunks.push(saved); storedBytes += saved.length; }
        stderr = tail(redact(`${stderr}${chunk.toString("utf8")}`));
        if (outputBytes > MAX_OUTPUT_BYTES) { output_truncated = true; proc.kill("SIGKILL"); }
      });
      proc.on("error", (error) => settle(() => reject(error)));
      proc.on("close", (code, receivedSignal) => settle(() => {
        signal = receivedSignal;
        resolve(timed_out || receivedSignal ? -1 : (code ?? -1));
      }));
      timer = setTimeout(() => {
        timed_out = true;
        proc.kill("SIGKILL");
      }, Math.min(MAX_TIMEOUT_SEC, Math.max(1, input.timeoutSec ?? DEFAULT_TIMEOUT_SEC)) * 1000);
    });

    const finishMs = Date.now();
    if (dest.context === "execution") await consumeBudget(cwd, input.supervisor_run_id!, outputBytes);
    const result: RunResult = {
      run_id,
      started_at,
      finished_at: new Date(finishMs).toISOString(),
      duration_ms: finishMs - startMs,
      command: normalizeCommand(input.command),
      exit_code,
      stdout_tail: tail(stdout),
      stderr_tail: tail(signal ? `${stderr}\nTerminated by ${signal}` : stderr),
      timed_out,
      context: dest.context,
      ...(input.spike_id ? { spike_id: input.spike_id } : {}),
      ...(input.supervisor_run_id ? { supervisor_run_id: input.supervisor_run_id } : {}),
      ...(input.spec_fingerprint ? { spec_fingerprint: input.spec_fingerprint } : {}),
      worktree,
      output_truncated,
      network: input.network ?? "none",
    };

    await atomicWrite(path.join(dest.dir, `${run_id}.log`), Buffer.concat(chunks));
    await atomicWrite(
      path.join(dest.dir, `${run_id}.json`),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    return result;
  } finally {
    running--;
  }
}

export const __testing = {
  get running() {
    return running;
  },
  redact,
};

export default tool({
  description: "Run a verification or contracted spike command in the trusted sandbox and persist durable evidence.",
  args: {
    command: tool.schema.string().min(1).describe("Exact shell command to execute"),
    cwd: tool.schema.string().optional().describe("Project directory; defaults to the active worktree"),
    timeoutSec: tool.schema.number().positive().optional().describe("Timeout in seconds"),
    context: tool.schema.enum(["execution", "spike"]).optional().describe("Evidence context; defaults to execution"),
    spike_id: tool.schema.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional().describe("Contracted spike identifier"),
  },
  async execute(args, context) {
    const cwd = path.resolve(
      args.cwd ?? context.worktree ?? context.directory ?? process.cwd(),
    );
    const active_worktree = path.resolve(context.worktree ?? context.directory ?? cwd);
    if ((args.context ?? "execution") === "spike") {
      return JSON.stringify(await run({ ...args, cwd, active_worktree }), null, 2);
    }

    const sessionID = (context as { sessionID?: string }).sessionID;
    if (!sessionID) {
      throw new Error("Runner cannot establish supervisor run provenance for this session");
    }
    const spec = await fs.readFile(path.join(cwd, "SPEC.md"), "utf8");
    return JSON.stringify(
      await run({
        ...args,
        cwd,
        active_worktree,
        supervisor_run_id: sessionID,
        spec_fingerprint: fingerprint(spec),
      }),
      null,
      2,
    );
  },
});
