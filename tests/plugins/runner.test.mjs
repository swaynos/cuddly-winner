import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import runTool, { run, __testing } from "../../tools/run.ts";

test("runner exports an OpenCode custom tool definition", () => {
  assert.equal(typeof runTool?.description, "string");
  assert.equal(typeof runTool?.args?.command?.safeParse, "function");
  assert.equal(typeof runTool?.execute, "function");
});

test("runner persists complete execution evidence before resolving", async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-")); const result=await run({command:"printf ok",cwd:root});
  assert.equal(result.exit_code,0); assert.equal(result.context,"execution"); assert.ok(result.started_at && result.finished_at);
  const saved=JSON.parse(await fs.readFile(path.join(root,".opencode/runs",`${result.run_id}.json`),"utf8")); assert.deepEqual(saved,result);
  assert.equal(await fs.readFile(path.join(root,".opencode/runs",`${result.run_id}.log`),"utf8"),"ok");
});
test("execution sandbox provides writable devices",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-dev-")); const result=await run({command:"printf ok >/dev/null",cwd:root}); assert.equal(result.exit_code,0,result.stderr_tail);
});
test("execution commands cannot forge runner or supervisor state",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-forgery-"));
  const result=await run({command:"printf forged > .opencode/runs/forged.json; printf forged > .opencode/supervisor/forged.json",cwd:root}); assert.notEqual(result.exit_code,0);
  await assert.rejects(fs.access(path.join(root,".opencode/runs/forged.json"))); await assert.rejects(fs.access(path.join(root,".opencode/supervisor/forged.json")));
});
test("nonzero timeout invalid cwd and concurrency cleanup",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-errors-")); assert.equal((await run({command:"exit 7",cwd:root})).exit_code,7);
  const timed=await run({command:"sleep 2",cwd:root,timeoutSec:.01}); assert.equal(timed.timed_out,true);
  await assert.rejects(run({command:"true",cwd:path.join(root,"missing")})); assert.equal(__testing.running,0);
});
test("spike is contracted and routed without execution leakage",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-spike-")); await assert.rejects(run({command:"true",cwd:root,context:"spike",spike_id:"s"}));
  await fs.mkdir(path.join(root,".spike/s"),{recursive:true}); await fs.writeFile(path.join(root,".spike/s/QUESTION.md"),"# Q\n## Question\nQ?\n## Kill criterion\nDenied");
  const result=await run({command:"true",cwd:root,context:"spike",spike_id:"s"}); await fs.access(path.join(root,".spike/s/runs",`${result.run_id}.json`));
  await assert.rejects(fs.access(path.join(root,".opencode/runs",`${result.run_id}.json`)));
});
test("spike sandbox writes only inside its spike directory",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-sandbox-")); await fs.writeFile(path.join(root,"source.txt"),"original");
  await fs.mkdir(path.join(root,".spike/s"),{recursive:true}); await fs.writeFile(path.join(root,".spike/s/QUESTION.md"),"## Question\nCan it write?\n## Kill criterion\nOnly spike writes work");
  const inside=await run({command:"printf yes > .spike/s/result.txt",cwd:root,context:"spike",spike_id:"s"}); assert.equal(inside.exit_code,0); assert.equal(await fs.readFile(path.join(root,".spike/s/result.txt"),"utf8"),"yes");
  const outside=await run({command:"printf forged > source.txt; mkdir -p .opencode/runs; printf x > .opencode/runs/forged.json",cwd:root,context:"spike",spike_id:"s"}); assert.notEqual(outside.exit_code,0);
  assert.equal(await fs.readFile(path.join(root,"source.txt"),"utf8"),"original"); await assert.rejects(fs.access(path.join(root,".opencode/runs/forged.json")));
});
test("spawn errors reject and restore concurrency",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-spawn-")), fake=path.join(root,"not-executable"), old=process.env.OPENCODE_BWRAP_PATH; await fs.writeFile(fake,"x"); process.env.OPENCODE_BWRAP_PATH=fake;
  try { await assert.rejects(run({command:"true",cwd:root}),/EACCES/); } finally { if(old===undefined)delete process.env.OPENCODE_BWRAP_PATH; else process.env.OPENCODE_BWRAP_PATH=old; }
  assert.equal(__testing.running,0);
});
test("persistence failures surface and leave concurrency clean",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"runner-persist-")); await fs.mkdir(path.join(root,".opencode")); await fs.writeFile(path.join(root,".opencode/runs"),"not a directory");
  await assert.rejects(run({command:"true",cwd:root}),/EEXIST|ENOTDIR/); assert.equal(__testing.running,0);
});
