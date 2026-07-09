/**
 * run.ts — Deterministic bash command runner tool for OpenCode agents.
 *
 * Always spawns `bash -c` (never $SHELL) so behavior is reproducible across
 * macOS (zsh login shell) and Linux (bash login shell).
 *
 * Writes two artifacts per run into .opencode/runs/:
 *   {run_id}.json  — structured result (RunResult)
 *   {run_id}.log   — raw stdout+stderr interleaved
 *
 * The gate plugin reads .opencode/runs/ to satisfy evidence requirements
 * without relying on transcript scanning.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface RunInput {
  command: string;
  cwd?: string;
  timeoutSec?: number;
}

export interface RunResult {
  run_id: string;
  exit_code: number;
  duration_ms: number;
  stdout_tail: string;
  stderr_tail: string;
  timed_out: boolean;
  command: string;
}

const MAX_CONCURRENT = 5;
const DEFAULT_TIMEOUT_SEC = 30;
const TAIL_CHARS = 4096;

let _running = 0;

function tail(s: string): string {
  return s.length > TAIL_CHARS ? "..." + s.slice(-TAIL_CHARS) : s;
}

export async function run(input: RunInput): Promise<RunResult> {
  if (_running >= MAX_CONCURRENT) {
    throw new Error(`Too many concurrent runs (max ${MAX_CONCURRENT})`);
  }

  const run_id = crypto.randomBytes(8).toString("hex");
  const timeoutMs = (input.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;
  const cwd = input.cwd ?? process.cwd();

  const runsDir = path.join(cwd, ".opencode", "runs");
  await fs.mkdir(runsDir, { recursive: true });

  const logPath = path.join(runsDir, `${run_id}.log`);
  const jsonPath = path.join(runsDir, `${run_id}.json`);

  _running++;
  const start = Date.now();

  let stdout = "";
  let stderr = "";
  let timed_out = false;

  const result = await new Promise<RunResult>((resolve) => {
    const proc = spawn("bash", ["-c", input.command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const logParts: string[] = [];

    proc.stdout.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stdout += s;
      logParts.push(s);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stderr += s;
      logParts.push(s);
    });

    const timer = setTimeout(() => {
      timed_out = true;
      proc.kill("SIGKILL");
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const duration_ms = Date.now() - start;

      fs.writeFile(logPath, logParts.join(""), "utf-8").catch(() => {});

      const r: RunResult = {
        run_id,
        exit_code: timed_out ? -1 : (code ?? -1),
        duration_ms,
        stdout_tail: tail(stdout),
        stderr_tail: tail(stderr),
        timed_out,
        command: input.command,
      };

      fs.writeFile(jsonPath, JSON.stringify(r, null, 2) + "\n", "utf-8").catch(() => {});

      resolve(r);
    });
  });

  _running--;
  return result;
}

// OpenCode tool registration: default export consumed by the runtime to
// auto-register this file as an invocable tool.
export type RunParams = RunInput;

export default async function(params: RunParams): Promise<RunResult> {
  return run(params);
}
