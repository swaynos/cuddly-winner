/** Native, approval-gated runner for bounded Prometheus investigations. */
import { tool } from "@opencode-ai/plugin";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

export interface SpikeInput {
  command: string;
  root: string;
  spike_id: string;
  timeoutSec?: number;
}

export interface SpikeResult {
  run_id: string;
  spike_id: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  command: string;
  exit_code: number;
  stdout_tail: string;
  stderr_tail: string;
  timed_out: boolean;
  output_truncated: boolean;
  sandboxed: false;
  working_directory: string;
}

const MAX_CONCURRENT = 3;
const DEFAULT_TIMEOUT_SEC = 30;
const MAX_TIMEOUT_SEC = 300;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const TAIL_CHARS = 4096;
let running = 0;

const SECRET_NAME = /(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL|COOKIE|AUTH)/i;
const SAFE_ENV = new Set(["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "SHELL", "PYENV_ROOT", "PYENV_VERSION", "NODE_OPTIONS"]);
const REDACTION_PATTERNS = [
  /\b(?:sk|ghp|github_pat)[-_][A-Za-z0-9_-]{12,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi,
  /\b(?:password|passwd|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi,
  /-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+)?PRIVATE KEY-----/g,
];

function safeEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { TMPDIR: process.env.TMPDIR ?? "/tmp" };
  for (const [key, value] of Object.entries(process.env)) {
    if (SAFE_ENV.has(key) && !SECRET_NAME.test(key) && value !== undefined) env[key] = value;
  }
  return env;
}

function redact(value: string): string {
  let result = value;
  for (const pattern of REDACTION_PATTERNS) result = result.replace(pattern, "[REDACTED]");
  for (const [key, secret] of Object.entries(process.env)) {
    if (SECRET_NAME.test(key) && secret && secret.length >= 4) result = result.split(secret).join("[REDACTED]");
  }
  return result;
}

const tail = (value: string) => value.length > TAIL_CHARS ? `...${value.slice(-TAIL_CHARS)}` : value;

async function atomicWrite(file: string, data: string): Promise<void> {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    const handle = await fs.open(temp, "wx");
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}

async function projectRoot(value: string): Promise<string> {
  try {
    const root = await fs.realpath(path.resolve(value));
    if (!(await fs.stat(root)).isDirectory()) throw new Error();
    return root;
  } catch {
    throw new Error(`Invalid project root: ${value}`);
  }
}

async function spikeDirectory(root: string, spikeID: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(spikeID)) throw new Error("Spike requires a safe spike_id");
  const dir = path.join(root, ".spike", spikeID);
  const questionPath = path.join(dir, "QUESTION.md");
  const question = await fs.readFile(questionPath, "utf8").catch(() => {
    throw new Error(`Missing spike contract: ${questionPath}`);
  });
  if (!/^##?\s+Question/im.test(question) || !/kill criterion/i.test(question)) {
    throw new Error("QUESTION.md must contain a question and kill criterion");
  }
  return dir;
}

function killProcessGroup(proc: ReturnType<typeof spawn>): void {
  if (!proc.pid) return;
  try { process.kill(-proc.pid, "SIGKILL"); } catch { try { proc.kill("SIGKILL"); } catch {} }
}

export async function runSpike(input: SpikeInput): Promise<SpikeResult> {
  if (!input.command || typeof input.command !== "string") throw new Error("command is required");
  if (running >= MAX_CONCURRENT) throw new Error(`Too many concurrent spikes (max ${MAX_CONCURRENT})`);
  running++;
  try {
    const root = await projectRoot(input.root);
    const cwd = await spikeDirectory(root, input.spike_id);
    const runs = path.join(cwd, "runs");
    await fs.mkdir(runs, { recursive: true });
    const run_id = crypto.randomBytes(12).toString("hex");
    const startMs = Date.now();
    const started_at = new Date(startMs).toISOString();
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let output_truncated = false;
    let timed_out = false;
    const chunks: Buffer[] = [];
    let storedBytes = 0;

    const exit_code = await new Promise<number>((resolve, reject) => {
      const proc = spawn(process.env.OPENCODE_SPIKE_SHELL ?? "bash", ["-c", input.command], {
        cwd,
        env: safeEnvironment(),
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let settled = false;
      const timeoutMs = Math.min(MAX_TIMEOUT_SEC, Math.max(0.01, input.timeoutSec ?? DEFAULT_TIMEOUT_SEC)) * 1000;
      const timer = setTimeout(() => { timed_out = true; killProcessGroup(proc); }, timeoutMs);
      const collect = (target: "stdout" | "stderr", chunk: Buffer) => {
        outputBytes += chunk.length;
        const remaining = Math.max(0, MAX_OUTPUT_BYTES - storedBytes);
        if (remaining) {
          const saved = chunk.subarray(0, remaining);
          chunks.push(saved);
          storedBytes += saved.length;
          if (target === "stdout") stdout += saved.toString("utf8"); else stderr += saved.toString("utf8");
        }
        if (outputBytes > MAX_OUTPUT_BYTES && !output_truncated) {
          output_truncated = true;
          killProcessGroup(proc);
        }
      };
      proc.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
      proc.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
      proc.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      proc.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal && !timed_out && !output_truncated) stderr += `\nTerminated by ${signal}`;
        resolve(timed_out || signal ? -1 : (code ?? -1));
      });
    });

    const finishMs = Date.now();
    const result: SpikeResult = {
      run_id,
      spike_id: input.spike_id,
      started_at,
      finished_at: new Date(finishMs).toISOString(),
      duration_ms: finishMs - startMs,
      command: redact(input.command),
      exit_code,
      stdout_tail: tail(redact(stdout)),
      stderr_tail: tail(redact(stderr)),
      timed_out,
      output_truncated,
      sandboxed: false,
      working_directory: cwd,
    };
    await atomicWrite(path.join(runs, `${run_id}.log`), redact(Buffer.concat(chunks).toString("utf8")));
    await atomicWrite(path.join(runs, `${run_id}.json`), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    running--;
  }
}

export const __testing = { get running() { return running; }, redact };

export default tool({
  description: "Run an approval-gated Prometheus spike natively from .spike/<id>. This is bounded and recorded but not sandboxed.",
  args: {
    command: tool.schema.string().min(1).describe("Exact exploratory command to run"),
    spike_id: tool.schema.string().regex(/^[a-z0-9][a-z0-9-]*$/).describe("Contracted spike identifier"),
    timeoutSec: tool.schema.number().positive().optional().describe("Timeout in seconds"),
  },
  async execute(args, context) {
    const root = path.resolve(context.directory ?? context.worktree ?? process.cwd());
    return JSON.stringify(await runSpike({ ...args, root }), null, 2);
  },
});
