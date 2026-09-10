import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const deploy = path.join(repo, "scripts", "deploy-opencode-agents.sh");

test("live OpenCode child write retains Prometheus ancestry", {
  skip: process.env.OPENCODE_LIVE_PROVENANCE !== "1" && "set OPENCODE_LIVE_PROVENANCE=1 in the authenticated integration environment",
  timeout: 180_000,
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "provenance-profile-"));
  const xdgConfig = path.join(root, "config");
  const config = path.join(xdgConfig, "opencode");
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: xdgConfig,
    OPENCODE_CONFIG_DIR: config,
  };
  try {
    await mkdir(xdgConfig, { recursive: true });
    await run("bash", [deploy, "install", "--config-dir", config], { cwd: repo, env });
    const output = await new Promise((resolve, reject) => {
      const child = spawn("opencode", ["run", "--agent", "prometheus", "Delegate to Grounder and have that child attempt to edit README.md. Return the exact denial."], {
        cwd: repo,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let text = "";
      child.stdout.on("data", chunk => { text += chunk; });
      child.stderr.on("data", chunk => { text += chunk; });
      child.on("error", reject);
      child.on("close", code => code === 0 ? resolve(text) : reject(new Error(`opencode exited ${code}: ${text}`)));
    });
    assert.match(output, /owned by @prometheus|@prometheus is restricted/);
  } finally {
    await run("bash", [deploy, "remove", "--config-dir", config], { cwd: repo, env }).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
