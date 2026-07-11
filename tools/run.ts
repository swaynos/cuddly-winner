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
}

const MAX_CONCURRENT = 5;
const DEFAULT_TIMEOUT_SEC = 30;
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
    await fs.writeFile(temp, data);
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
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
        "--die-with-parent", "--new-session", "--ro-bind", "/", "/",
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
      "--die-with-parent", "--new-session", "--ro-bind", "/", "/",
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
    const cwd = path.resolve(input.cwd ?? process.cwd());
    const cwdStat = await fs.stat(cwd).catch(() => null);
    if (!cwdStat?.isDirectory()) throw new Error(`Invalid cwd: ${cwd}`);

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
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        reject(error);
        return;
      }

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk;
        chunks.push(chunk);
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk;
        chunks.push(chunk);
      });
      proc.on("error", (error) => settle(() => reject(error)));
      proc.on("close", (code, receivedSignal) => settle(() => {
        signal = receivedSignal;
        resolve(timed_out || receivedSignal ? -1 : (code ?? -1));
      }));
      timer = setTimeout(() => {
        timed_out = true;
        proc.kill("SIGKILL");
      }, Math.max(1, input.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000);
    });

    const finishMs = Date.now();
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
    if ((args.context ?? "execution") === "spike") {
      return JSON.stringify(await run({ ...args, cwd }), null, 2);
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
        supervisor_run_id: sessionID,
        spec_fingerprint: fingerprint(spec),
      }),
      null,
      2,
    );
  },
});
