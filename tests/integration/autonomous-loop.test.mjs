import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computeDelta,
  isIdle,
  parseArgs,
  run,
  runLoop,
} from "../../scripts/autonomous-loop.mjs";

const silent = () => {};

test("parseArgs applies the documented defaults", () => {
  const options = parseArgs([]);
  assert.equal(options.project, process.cwd());
  assert.equal(options.passes, 10);
  assert.equal(options.stateCmd, null);
  assert.equal(options.idleStop, null);
  assert.equal(options.wallBudget, null);
  assert.equal(options.stopOnFailure, false);
  assert.equal(options.log, ".autonomous-loop/runs.jsonl");
  assert.equal(options.dryRun, false);
});

test("parseArgs reads every flag", () => {
  const options = parseArgs([
    "--project", "/tmp/project",
    "--passes", "5",
    "--state-cmd", "cat state.json",
    "--idle-stop", "3",
    "--wall-budget", "120",
    "--stop-on-failure",
    "--log", "evidence/log.jsonl",
    "--dry-run",
  ]);
  assert.equal(options.project, path.resolve("/tmp/project"));
  assert.equal(options.passes, 5);
  assert.equal(options.stateCmd, "cat state.json");
  assert.equal(options.idleStop, 3);
  assert.equal(options.wallBudget, 120);
  assert.equal(options.stopOnFailure, true);
  assert.equal(options.log, "evidence/log.jsonl");
  assert.equal(options.dryRun, true);
});

test("parseArgs rejects invalid input", () => {
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument: --bogus/);
  assert.throws(() => parseArgs(["--passes", "0"]), /--passes must be an integer >= 1/);
  assert.throws(() => parseArgs(["--passes", "1.5"]), /--passes must be an integer >= 1/);
  assert.throws(() => parseArgs(["--wall-budget", "0"]), /--wall-budget must be a positive number/);
  assert.throws(() => parseArgs(["--idle-stop", "2"]), /--idle-stop requires --state-cmd/);
  assert.throws(() => parseArgs(["--project"]), /--project requires a value/);
});

test("computeDelta diffs numeric keys and treats missing sides as zero", () => {
  assert.deepEqual(computeDelta({ a: 1, b: 2 }, { a: 4, b: 2 }), { a: 3, b: 0 });
  assert.deepEqual(computeDelta({ a: 1 }, { a: 3, c: 5 }), { a: 2, c: 5 });
  assert.deepEqual(computeDelta({ a: 1, note: "x" }, { a: 1, note: "y" }), { a: 0 });
});

test("computeDelta returns null unless both snapshots are plain objects", () => {
  assert.equal(computeDelta(null, { a: 1 }), null);
  assert.equal(computeDelta({ a: 1 }, null), null);
  assert.equal(computeDelta([1], { a: 1 }), null);
});

test("isIdle only fires for a measured all-zero delta", () => {
  assert.equal(isIdle({ a: 0, b: 0 }), true);
  assert.equal(isIdle({ a: 0, b: 1 }), false);
  assert.equal(isIdle({}), false);
  assert.equal(isIdle(null), false);
});

test("runLoop runs every pass and records evidence when none stop early", async () => {
  const records = [];
  let spawned = 0;
  const summary = await runLoop(parseArgs(["--passes", "3"]), {
    spawnPass: async () => {
      spawned += 1;
      return { exitCode: 0 };
    },
    now: () => 0,
    sink: (record) => records.push(record),
    log: silent,
  });
  assert.equal(spawned, 3);
  assert.equal(summary.passes.length, 3);
  assert.equal(summary.stoppedBy, "passes-exhausted");
  assert.deepEqual(records.map((r) => r.pass), [1, 2, 3]);
  for (const record of records) {
    assert.equal(record.before, null);
    assert.equal(record.after, null);
    assert.equal(record.delta, null);
    assert.equal(record.exit_code, 0);
  }
});

test("runLoop stops after N consecutive idle passes", async () => {
  let reads = 0;
  let spawned = 0;
  const summary = await runLoop(parseArgs(["--passes", "5", "--state-cmd", "x", "--idle-stop", "2"]), {
    spawnPass: async () => {
      spawned += 1;
      return { exitCode: 0 };
    },
    readState: async () => {
      reads += 1;
      return { inventory: 5 };
    },
    sink: silent,
    log: silent,
  });
  assert.equal(summary.stoppedBy, "idle");
  assert.equal(summary.passes.length, 2);
  assert.equal(spawned, 2);
  assert.equal(reads, 4); // before + after, each of 2 passes
});

test("runLoop resets the idle streak when a pass makes progress", async () => {
  const states = [
    { a: 1 }, { a: 1 }, // pass 1: idle
    { a: 1 }, { a: 9 }, // pass 2: progress, streak resets
    { a: 9 }, { a: 9 }, // pass 3: idle
    { a: 9 }, { a: 9 }, // pass 4: idle -> streak hits 2
  ];
  let index = 0;
  const summary = await runLoop(parseArgs(["--passes", "9", "--state-cmd", "x", "--idle-stop", "2"]), {
    spawnPass: async () => ({ exitCode: 0 }),
    readState: async () => states[index++],
    sink: silent,
    log: silent,
  });
  assert.equal(summary.stoppedBy, "idle");
  assert.equal(summary.passes.length, 4);
  assert.deepEqual(summary.passes.map((r) => r.delta), [{ a: 0 }, { a: 8 }, { a: 0 }, { a: 0 }]);
});

test("runLoop stops before a pass once the wall budget is reached", async () => {
  let clock = 1000;
  let spawned = 0;
  const summary = await runLoop(parseArgs(["--passes", "5", "--wall-budget", "90"]), {
    spawnPass: async () => {
      spawned += 1;
      clock += 60_000; // each pass burns 60s
      return { exitCode: 0 };
    },
    now: () => clock,
    sink: silent,
    log: silent,
  });
  assert.equal(summary.stoppedBy, "wall-budget");
  assert.equal(summary.passes.length, 2);
  assert.equal(spawned, 2);
});

test("runLoop records a failure and continues by default", async () => {
  const summary = await runLoop(parseArgs(["--passes", "3"]), {
    spawnPass: async (_options, pass) => ({ exitCode: pass === 1 ? 1 : 0 }),
    now: () => 0,
    sink: silent,
    log: silent,
  });
  assert.equal(summary.stoppedBy, "passes-exhausted");
  assert.equal(summary.passes.length, 3);
  assert.equal(summary.passes[0].exit_code, 1);
});

test("runLoop stops on the first failure when --stop-on-failure is set", async () => {
  let spawned = 0;
  const summary = await runLoop(parseArgs(["--passes", "5", "--stop-on-failure"]), {
    spawnPass: async () => {
      spawned += 1;
      return { exitCode: 1 };
    },
    now: () => 0,
    sink: silent,
    log: silent,
  });
  assert.equal(summary.stoppedBy, "failure");
  assert.equal(summary.passes.length, 1);
  assert.equal(spawned, 1);
});

test("run --dry-run prints the plan and never spawns a pass", async () => {
  const lines = [];
  const code = await run(["--dry-run", "--project", "/tmp/loop-project"], {
    log: (line) => lines.push(line),
    spawnPass: async () => {
      throw new Error("dry-run must not spawn a pass");
    },
  });
  assert.equal(code, 0);
  const output = lines.join("\n");
  assert.match(output, /autonomous-loop plan:/);
  assert.match(output, /\/tmp\/loop-project/);
});

test("run --help prints usage", async () => {
  const lines = [];
  const code = await run(["--help"], { log: (line) => lines.push(line) });
  assert.equal(code, 0);
  assert.match(lines.join("\n"), /Usage:/);
});

test("run returns exit code 2 on an argument error", async () => {
  const code = await run(["--bogus"], { log: silent });
  assert.equal(code, 2);
});

test("run writes one JSONL evidence record per pass through the file sink", async () => {
  const project = mkdtempSync(path.join(tmpdir(), "autonomous-loop-"));
  try {
    const code = await run(["--project", project, "--passes", "2"], {
      spawnPass: async () => ({ exitCode: 0 }),
      now: () => 0,
      log: silent,
    });
    assert.equal(code, 0);
    const logPath = path.join(project, ".autonomous-loop", "runs.jsonl");
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    const records = lines.map((line) => JSON.parse(line));
    assert.deepEqual(records.map((r) => r.pass), [1, 2]);
    assert.equal(records[0].exit_code, 0);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
