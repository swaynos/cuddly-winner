import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import runTool, { run, __testing } from "../../tools/run.ts";

const execution = (command, cwd, extra={}) => ({command,cwd,supervisor_run_id:"run-a",spec_fingerprint:"a".repeat(64),...extra});
const sandboxTest = process.platform === "linux" ? test : test.skip;

test("runner exports an OpenCode custom tool definition", () => {
  assert.equal(typeof runTool?.description, "string");
  assert.equal(typeof runTool?.args?.command?.safeParse, "function");
  assert.equal(typeof runTool?.execute, "function");
});

test("redaction covers documented secret shapes (platform-independent)", () => {
  const r = __testing.redact;
  assert.match(r("key AKIA1234567890ABCDEF here"), /\[REDACTED\]/);
  assert.match(r("tok eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w"), /\[REDACTED\]/);
  assert.match(r("Authorization: Bearer abcdef1234567890xyz"), /\[REDACTED\]/);
  assert.match(r("password=hunter2secret"), /\[REDACTED\]/);
  assert.match(r("ghp_abcdefghijklmnopqrstuvwxyz0123"), /\[REDACTED\]/);
  assert.match(r("-----BEGIN PRIVATE KEY-----\nMIIBVg==\n-----END PRIVATE KEY-----"), /\[REDACTED\]/);
  assert.equal(r("nothing secret here"), "nothing secret here");
});

sandboxTest("runner persists complete execution evidence before resolving", async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-")); const result=await run(execution("printf ok",root));
  assert.equal(result.exit_code,0); assert.equal(result.context,"execution"); assert.ok(result.started_at && result.finished_at);
  const saved=JSON.parse(await fs.readFile(path.join(root,".opencode/runs",`${result.run_id}.json`),"utf8")); assert.deepEqual(saved,result);
  assert.equal(await fs.readFile(path.join(root,".opencode/runs",`${result.run_id}.log`),"utf8"),"ok");
});
sandboxTest("execution sandbox provides writable devices",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-dev-")); const result=await run(execution("printf ok >/dev/null",root)); assert.equal(result.exit_code,0,result.stderr_tail);
});
sandboxTest("execution commands cannot forge runner or supervisor state",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-forgery-"));
  const result=await run(execution("printf forged > .opencode/runs/forged.json; printf forged > .opencode/supervisor/forged.json",root)); assert.notEqual(result.exit_code,0);
  await assert.rejects(fs.access(path.join(root,".opencode/runs/forged.json"))); await assert.rejects(fs.access(path.join(root,".opencode/supervisor/forged.json")));
});
sandboxTest("nonzero timeout invalid cwd and concurrency cleanup",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-errors-")); assert.equal((await run(execution("exit 7",root))).exit_code,7);
  const timed=await run(execution("sleep 2",root,{timeoutSec:.01})); assert.equal(timed.timed_out,true);
  await assert.rejects(run(execution("true",path.join(root,"missing")))); assert.equal(__testing.running,0);
});
sandboxTest("spike is contracted and routed without execution leakage",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-spike-")); await assert.rejects(run({command:"true",cwd:root,context:"spike",spike_id:"s"}));
  await fs.mkdir(path.join(root,".spike/s"),{recursive:true}); await fs.writeFile(path.join(root,".spike/s/QUESTION.md"),"# Q\n## Question\nQ?\n## Kill criterion\nDenied");
  const result=await run({command:"true",cwd:root,context:"spike",spike_id:"s"}); await fs.access(path.join(root,".spike/s/runs",`${result.run_id}.json`));
  await assert.rejects(fs.access(path.join(root,".opencode/runs",`${result.run_id}.json`)));
});
sandboxTest("spike sandbox writes only inside its spike directory",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-sandbox-")); await fs.writeFile(path.join(root,"source.txt"),"original");
  await fs.mkdir(path.join(root,".spike/s"),{recursive:true}); await fs.writeFile(path.join(root,".spike/s/QUESTION.md"),"## Question\nCan it write?\n## Kill criterion\nOnly spike writes work");
  const inside=await run({command:"printf yes > .spike/s/result.txt",cwd:root,context:"spike",spike_id:"s"}); assert.equal(inside.exit_code,0); assert.equal(await fs.readFile(path.join(root,".spike/s/result.txt"),"utf8"),"yes");
  const outside=await run({command:"printf forged > source.txt; mkdir -p .opencode/runs; printf x > .opencode/runs/forged.json",cwd:root,context:"spike",spike_id:"s"}); assert.notEqual(outside.exit_code,0);
  assert.equal(await fs.readFile(path.join(root,"source.txt"),"utf8"),"original"); await assert.rejects(fs.access(path.join(root,".opencode/runs/forged.json")));
});
sandboxTest("spawn errors reject and restore concurrency",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-spawn-")), fake=path.join(root,"not-executable"), old=process.env.OPENCODE_BWRAP_PATH; await fs.writeFile(fake,"x"); process.env.OPENCODE_BWRAP_PATH=fake;
  try { await assert.rejects(run(execution("true",root)),/EACCES/); } finally { if(old===undefined)delete process.env.OPENCODE_BWRAP_PATH; else process.env.OPENCODE_BWRAP_PATH=old; }
  assert.equal(__testing.running,0);
});
test("persistence failures surface and leave concurrency clean",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-persist-")); await fs.mkdir(path.join(root,".opencode")); await fs.writeFile(path.join(root,".opencode/runs"),"not a directory");
  await assert.rejects(run(execution("true",root)),/EEXIST|ENOTDIR/); assert.equal(__testing.running,0);
});
test("execution evidence requires trusted provenance",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-provenance-"));
  await assert.rejects(run({command:"true",cwd:root}),/provenance/i);
});
test("unsupported operating systems fail before execution", { skip: process.platform === "linux" }, async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-platform-"));
  await assert.rejects(run(execution("true",root)),/requires Linux with Bubblewrap/);
});
