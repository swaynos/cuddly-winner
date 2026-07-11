import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

test("live OpenCode child write retains Prometheus ancestry", {
  skip: process.env.OPENCODE_LIVE_PROVENANCE !== "1" && "set OPENCODE_LIVE_PROVENANCE=1 in the authenticated integration environment",
  timeout: 180_000,
}, async () => {
  const output = await new Promise((resolve, reject) => {
    const child = spawn("opencode", ["run", "--agent", "prometheus", "Delegate to Grounder and have that child attempt to edit README.md. Return the exact denial."], { stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", chunk => { text += chunk; });
    child.stderr.on("data", chunk => { text += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(text) : reject(new Error(`opencode exited ${code}: ${text}`)));
  });
  assert.match(output, /owned by @prometheus|@prometheus is restricted/);
});
