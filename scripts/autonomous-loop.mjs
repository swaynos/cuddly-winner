#!/usr/bin/env node
/**
 * autonomous-loop.mjs — optional external loop controller for Autonomous.
 *
 * This is a developer tool, not part of the managed profile. The installer
 * never deploys it and no agent, plugin, or tool depends on it. It treats
 * Autonomous as a black box: one fresh `opencode run --agent autonomous --auto`
 * per configured pass, with independent per-pass evidence recorded to a JSONL
 * log. Autonomous's one-invocation completion contract is unchanged — the
 * wrapper owns loop control and domain measurement, the agent never sees them.
 *
 * There is no cross-session resume: each pass starts a fresh Autonomous session
 * and relies on the target project's own worktree and durable state for
 * continuity, exactly as a Ralph-style runner does. The JSONL log is plain
 * append-only evidence, not a run-state machine handed back to the agent.
 *
 * State continuity and progress measurement belong to the target project. The
 * optional `--state-cmd` runs a project-supplied command that prints JSON
 * counters; the wrapper only diffs two JSON objects and records the delta. It
 * has no domain knowledge of what the counters mean.
 *
 * See docs/REQUIREMENTS.md § External Loop Wrapper and docs/ARCHITECTURE.md
 * § Autonomous Flow.
 */
import { spawn, execFile } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const STATE_CMD_MAX_BUFFER = 8 * 1024 * 1024;

const USAGE = `Usage:
  node scripts/autonomous-loop.mjs [options]

Runs Autonomous once per pass as a black box, recording per-pass evidence.
Each pass is a fresh \`opencode run --agent autonomous --auto\` session with no
message, so the published scaffold is the sole driver.

Options:
  --project <path>     Directory to run each pass in (default: current directory)
  --passes <n>         Maximum number of passes (default: 10)
  --state-cmd <cmd>    Shell command printing JSON counters; run before and
                       after each pass. The wrapper records the per-key delta.
  --idle-stop <n>      Stop after N consecutive zero-delta passes (needs --state-cmd)
  --wall-budget <sec>  Stop before a pass once this cumulative wall time is reached
  --stop-on-failure    Stop after the first pass that exits non-zero
                       (default: record and continue, like a Ralph runner)
  --log <path>         JSONL evidence log, relative to --project unless absolute
                       (default: .autonomous-loop/runs.jsonl)
  --dry-run            Print the resolved plan and exit without running a pass
  -h, --help           Show this help

Post-hoc per-session analysis uses tests/audit_run.py --project <path>.
`;

function usageError(message) {
  const error = new Error(message);
  error.usage = true;
  return error;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined) throw usageError(`${flag} requires a value`);
  return value;
}

function positiveInteger(raw, flag) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw usageError(`${flag} must be an integer >= 1 (got ${JSON.stringify(raw)})`);
  return value;
}

function positiveNumber(raw, flag) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw usageError(`${flag} must be a positive number (got ${JSON.stringify(raw)})`);
  return value;
}

export function parseArgs(argv) {
  const options = {
    project: process.cwd(),
    passes: 10,
    stateCmd: null,
    idleStop: null,
    wallBudget: null,
    stopOnFailure: false,
    log: ".autonomous-loop/runs.jsonl",
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--project": options.project = resolve(requireValue(argv, ++index, flag)); break;
      case "--passes": options.passes = positiveInteger(requireValue(argv, ++index, flag), flag); break;
      case "--state-cmd": options.stateCmd = requireValue(argv, ++index, flag); break;
      case "--idle-stop": options.idleStop = positiveInteger(requireValue(argv, ++index, flag), flag); break;
      case "--wall-budget": options.wallBudget = positiveNumber(requireValue(argv, ++index, flag), flag); break;
      case "--stop-on-failure": options.stopOnFailure = true; break;
      case "--log": options.log = requireValue(argv, ++index, flag); break;
      case "--dry-run": options.dryRun = true; break;
      case "-h": case "--help": options.help = true; break;
      default: throw usageError(`unknown argument: ${flag}`);
    }
  }
  if (options.idleStop !== null && options.stateCmd === null) {
    throw usageError("--idle-stop requires --state-cmd to measure per-pass deltas");
  }
  return options;
}

/**
 * Per-key numeric difference between two JSON snapshots. Returns null unless
 * both snapshots are plain objects. Missing values on either side count as 0,
 * and only keys numeric on at least one side are included.
 */
export function computeDelta(before, after) {
  const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!isPlainObject(before) || !isPlainObject(after)) return null;
  const delta = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const beforeValue = before[key];
    const afterValue = after[key];
    const beforeNumeric = typeof beforeValue === "number" && Number.isFinite(beforeValue);
    const afterNumeric = typeof afterValue === "number" && Number.isFinite(afterValue);
    if (!beforeNumeric && !afterNumeric) continue;
    delta[key] = (afterNumeric ? afterValue : 0) - (beforeNumeric ? beforeValue : 0);
  }
  return delta;
}

/** A pass is idle only when its delta is a measured object with at least one key, all zero. */
export function isIdle(delta) {
  if (delta === null || typeof delta !== "object") return false;
  const values = Object.values(delta);
  return values.length > 0 && values.every((value) => value === 0);
}

function formatDelta(delta) {
  if (delta === null) return "n/a";
  const keys = Object.keys(delta);
  if (keys.length === 0) return "{}";
  return keys
    .map((key) => `${key}:${delta[key] > 0 ? "+" : ""}${delta[key]}`)
    .join(", ");
}

function formatPassLine(record, passes) {
  return `pass ${record.pass}/${passes}  exit=${record.exit_code}  ${record.duration_s.toFixed(1)}s  delta=${formatDelta(record.delta)}`;
}

function defaultSpawnPass(options) {
  return new Promise((resolvePromise) => {
    const child = spawn("opencode", ["run", "--agent", "autonomous", "--auto", "--dir", options.project], {
      cwd: options.project,
      stdio: "inherit",
    });
    child.on("error", (error) => {
      process.stderr.write(`autonomous-loop: failed to spawn opencode: ${error.message}\n`);
      resolvePromise({ exitCode: 127 });
    });
    child.on("close", (code) => resolvePromise({ exitCode: code === null ? 1 : code }));
  });
}

function defaultReadState(options) {
  return new Promise((resolvePromise) => {
    execFile(
      "/bin/sh",
      ["-c", options.stateCmd],
      { cwd: options.project, maxBuffer: STATE_CMD_MAX_BUFFER },
      (error, stdout) => {
        if (error) return resolvePromise(null);
        try {
          resolvePromise(JSON.parse(stdout));
        } catch {
          resolvePromise(null);
        }
      },
    );
  });
}

function makeFileSink(options) {
  const logPath = resolve(options.project, options.log);
  mkdirSync(dirname(logPath), { recursive: true });
  return (record) => appendFileSync(logPath, `${JSON.stringify(record)}\n`);
}

const DEFAULT_DEPS = {
  spawnPass: defaultSpawnPass,
  readState: defaultReadState,
  now: () => Date.now(),
  sink: () => {},
  log: (line) => process.stdout.write(`${line}\n`),
};

/**
 * Run the bounded loop. Every side effect is injectable so the loop is testable
 * without a live opencode binary. Returns a summary describing why it stopped.
 */
export async function runLoop(options, deps = {}) {
  const { spawnPass, readState, now, sink, log } = { ...DEFAULT_DEPS, ...deps };
  const startWall = now();
  const summary = { passes: [], stoppedBy: null };
  let idleStreak = 0;

  for (let pass = 1; pass <= options.passes; pass += 1) {
    if (options.wallBudget !== null && (now() - startWall) / 1000 >= options.wallBudget) {
      summary.stoppedBy = "wall-budget";
      break;
    }

    const before = options.stateCmd ? await readState(options) : null;
    const startedAtMs = now();
    const { exitCode } = await spawnPass(options, pass);
    const durationS = (now() - startedAtMs) / 1000;
    const after = options.stateCmd ? await readState(options) : null;
    const delta = computeDelta(before, after);

    const record = {
      pass,
      started_at: new Date(startedAtMs).toISOString(),
      duration_s: Number(durationS.toFixed(3)),
      exit_code: exitCode,
      before,
      after,
      delta,
    };
    summary.passes.push(record);
    sink(record);
    log(formatPassLine(record, options.passes));

    if (options.stopOnFailure && exitCode !== 0) {
      summary.stoppedBy = "failure";
      break;
    }

    if (options.idleStop !== null) {
      if (isIdle(delta)) {
        idleStreak += 1;
        if (idleStreak >= options.idleStop) {
          summary.stoppedBy = "idle";
          break;
        }
      } else {
        idleStreak = 0;
      }
    }
  }

  if (summary.stoppedBy === null) summary.stoppedBy = "passes-exhausted";
  return summary;
}

function planText(options) {
  const lines = [
    "autonomous-loop plan:",
    `  project:         ${options.project}`,
    `  passes:          ${options.passes}`,
    `  state-cmd:       ${options.stateCmd ?? "(none)"}`,
    `  idle-stop:       ${options.idleStop ?? "(disabled)"}`,
    `  wall-budget:     ${options.wallBudget === null ? "(disabled)" : `${options.wallBudget}s`}`,
    `  stop-on-failure: ${options.stopOnFailure}`,
    `  log:             ${resolve(options.project, options.log)}`,
    `  per-pass command: opencode run --agent autonomous --auto --dir ${options.project}`,
  ];
  return lines.join("\n");
}

function summaryText(options, summary) {
  const productive = summary.passes.filter((record) => record.exit_code === 0).length;
  return [
    "",
    `autonomous-loop finished: ${summary.stoppedBy}`,
    `  passes run:   ${summary.passes.length}/${options.passes}`,
    `  exit 0 passes: ${productive}`,
    `  log:          ${resolve(options.project, options.log)}`,
    "This did not stage, commit, or accept any changes; review the worktree.",
  ].join("\n");
}

/**
 * Testable entry point: parse args, dispatch help/dry-run, else run the loop.
 * Returns a process exit code and never calls process.exit itself.
 */
export async function run(argv, deps = {}) {
  const emit = deps.log ?? DEFAULT_DEPS.log;
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`autonomous-loop: ${error.message}\n`);
    if (error.usage) process.stderr.write(USAGE);
    return 2;
  }
  if (options.help) {
    emit(USAGE);
    return 0;
  }
  if (options.dryRun) {
    emit(planText(options));
    return 0;
  }
  const sink = deps.sink ?? makeFileSink(options);
  const summary = await runLoop(options, { ...deps, sink });
  emit(summaryText(options, summary));
  return 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
