import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Supervisor, { parseVerification, validateRunArtifact, applyCorrection, atomicStateUpdate, serializedStateUpdate, evaluate, fingerprint } from "../../plugins/opencode-autonomous-supervisor/index.js";

const section = (commands) => `# S\n\n## Verification\n\n${commands.map(c => `- \`${c}\``).join("\n")}\n\n## Implementation Checklist\n- [x] done\n`;
test("strict verification parser", () => {
  assert.deepEqual(parseVerification(section(["node --test"])), ["node --test"]);
  assert.throws(() => parseVerification("# none"));
  assert.throws(() => parseVerification(section(["x", "x"])));
  assert.throws(() => parseVerification(section([])));
  assert.throws(() => parseVerification(section(["x"]).replace("- `x`","- malformed")));
});
test("malformed and duplicate artifacts invalidate the whole evaluation", async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"supervisor-invalid-")); await fs.mkdir(path.join(root,"tests")); await fs.mkdir(path.join(root,".opencode/runs"),{recursive:true}); await fs.writeFile(path.join(root,"tests/x"),"x");
  await fs.writeFile(path.join(root,".opencode/runs/bad.json"),"{}"); assert.equal((await evaluate(root,section(["x"]))).complete,false);
});
test("artifact validation fails closed", () => {
  const good={run_id:"1",supervisor_run_id:"run-a",spec_fingerprint:fingerprint("spec"),started_at:new Date().toISOString(),finished_at:new Date().toISOString(),duration_ms:1,command:"x",exit_code:0,stdout_tail:"",stderr_tail:"",timed_out:false,context:"execution"};
  assert.equal(validateRunArtifact(good), good);
  for (const change of [{context:"spike"},{duration_ms:NaN},{finished_at:"bad"}]) assert.throws(()=>validateRunArtifact({...good,...change}));
});
test("corrections deduplicate and enforce both caps", () => {
  let state={}; applyCorrection(state,"verification","same"); applyCorrection(state,"verification","same"); assert.equal(state.global_count,1);
  applyCorrection(state,"verification","2"); applyCorrection(state,"verification","3"); assert.equal(state.status,"blocked");
  state={}; for(let i=0;i<12;i++) applyCorrection(state,`c${i}`,String(i)); assert.equal(state.status,"blocked");
});
test("atomic state restores and serialized updates do not lose counts", async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"supervisor-")), file=path.join(dir,"state.json");
  await atomicStateUpdate(file,()=>({count:1}));
  await Promise.all(Array.from({length:20},()=>serializedStateUpdate(file,s=>({...s,count:(s.count??0)+1}))));
  assert.equal(JSON.parse(await fs.readFile(file,"utf8")).count,21);
});
test("corrupt state fails closed rather than resetting",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"supervisor-corrupt-")),file=path.join(dir,"state.json"); await fs.writeFile(file,"not-json");
  await assert.rejects(atomicStateUpdate(file,s=>s),/state corruption/); assert.equal(await fs.readFile(file,"utf8"),"not-json");
});
test("evaluation requires exact fresh execution evidence", async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"supervisor-eval-")); await fs.mkdir(path.join(root,"tests")); await fs.mkdir(path.join(root,".opencode/runs"),{recursive:true});
  await fs.writeFile(path.join(root,"tests/x"),"x"); const now=new Date(Date.now()+1000).toISOString();
  const spec=section(["node --test"]), specFingerprint=fingerprint(spec);
  const artifact={run_id:"a",supervisor_run_id:"run-a",spec_fingerprint:specFingerprint,started_at:now,finished_at:now,duration_ms:1,command:"node --test",exit_code:0,stdout_tail:"",stderr_tail:"",timed_out:false,context:"execution"};
  await fs.writeFile(path.join(root,".opencode/runs/a.json"),JSON.stringify(artifact));
  assert.equal((await evaluate(root,spec,{runID:"run-a",specFingerprint})).complete,true);
  assert.equal((await evaluate(root,spec,{runID:"run-b",specFingerprint})).complete,false);
  assert.equal((await evaluate(root,spec,{runID:"run-a",specFingerprint:fingerprint("changed")})).complete,false);
  assert.equal((await evaluate(root,section(["node --test other"]),{runID:"run-a",specFingerprint})).complete,false);
  artifact.context="spike"; await fs.writeFile(path.join(root,".opencode/runs/a.json"),JSON.stringify(artifact)); assert.equal((await evaluate(root,spec,{runID:"run-a",specFingerprint})).complete,false);
  assert.equal(fingerprint("x"),fingerprint("x"));
});

function mockClient(meta,agents,prompts=[]){return {session:{get:async({path:p})=>({data:meta[p.id]??{}}),messages:async({path:p})=>({data:agents[p.id]?[{info:{role:"user",agent:agents[p.id]}}]:[]}),promptAsync:async(x)=>prompts.push(x)}};}
test("event hook is run-scoped, parent-aware, terminal, and reviewer-advisory",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"supervisor-hooks-")); await fs.writeFile(path.join(root,"SPEC.md"),section(["x"]));
  const prompts=[], client=mockClient({child:{parentID:"run-a"}},{"run-a":"autonomous",other:"ask",child:"reviewer"},prompts);
  const hooks=await Supervisor({directory:root,worktree:root,client});
  await hooks.event({type:"session.idle",properties:{sessionID:"other"}}); await assert.rejects(fs.access(path.join(root,".opencode/supervisor/other.json")));
  await hooks["chat.params"]({sessionID:"run-a",agent:"autonomous"});
  const file=path.join(root,".opencode/supervisor/run-a.json"), initial=JSON.parse(await fs.readFile(file,"utf8")); assert.equal(initial.status,"running");
  await hooks.event({type:"message.updated",properties:{sessionID:"child",text:"REQUEST_CHANGES"}}); await hooks.event({type:"message.updated",properties:{sessionID:"child",text:"REQUEST_CHANGES"}});
  assert.equal(JSON.parse(await fs.readFile(file,"utf8")).corrective_counts.reviewer,1);
  await hooks.event({type:"session.error",properties:{sessionID:"child",error:{name:"same"}}}); await hooks.event({type:"session.error",properties:{sessionID:"child",error:{name:"same"}}});
  const corrected=JSON.parse(await fs.readFile(file,"utf8")); assert.equal(corrected.global_count,2); assert.equal(corrected.corrective_counts.runtime,1); assert.equal(prompts[0].path.id,"run-a");
  await fs.writeFile(path.join(root,"SPEC.md"),section(["changed"])); await hooks.event({type:"session.idle",properties:{sessionID:"child"}});
  const blocked=JSON.parse(await fs.readFile(file,"utf8")); assert.equal(blocked.status,"blocked"); assert.equal(blocked.spec_fingerprint,initial.spec_fingerprint);
  await fs.writeFile(path.join(root,"SPEC.md"),section(["x"])); await hooks.event({type:"session.idle",properties:{sessionID:"run-a"}}); assert.equal(JSON.parse(await fs.readFile(file,"utf8")).status,"blocked");
});
test("idle verification correction is bounded and deduplicated",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"supervisor-correct-")); await fs.writeFile(path.join(root,"SPEC.md"),section(["missing"])); const prompts=[],client=mockClient({}, {a:"autonomous"},prompts);
  const hooks=await Supervisor({directory:root,worktree:root,client}); await hooks["chat.params"]({sessionID:"a",agent:"autonomous"}); await hooks.event({type:"session.idle",properties:{sessionID:"a"}}); await hooks.event({type:"session.idle",properties:{sessionID:"a"}});
  const state=JSON.parse(await fs.readFile(path.join(root,".opencode/supervisor/a.json"),"utf8")); assert.equal(state.corrective_counts.verification,1); assert.equal(state.global_count,1); assert.equal(prompts.length,1);
});
test("missing trusted runner blocks once without a verification retry",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"supervisor-capability-"));
  await fs.writeFile(path.join(root,"SPEC.md"),section(["x"]));
  const prompts=[],client=mockClient({}, {a:"autonomous"},prompts);
  const hooks=await Supervisor({directory:root,worktree:root,client});
  await hooks["chat.params"]({sessionID:"a",agent:"autonomous"});
  await hooks.event({type:"message.updated",properties:{sessionID:"a",text:"The trusted `run` tool is unavailable in this session. <promise>BLOCKED</promise>"}});
  const file=path.join(root,".opencode/supervisor/a.json");
  const state=JSON.parse(await fs.readFile(file,"utf8"));
  assert.equal(state.status,"blocked");
  assert.match(state.blocker_reason,/trusted run capability unavailable/i);
  await hooks.event({type:"session.idle",properties:{sessionID:"a"}});
  assert.equal(prompts.length,0);
});
test("failed reevaluation clears a previously complete status",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"supervisor-recheck-"));
  await fs.mkdir(path.join(root,".opencode/runs"),{recursive:true});
  await fs.mkdir(path.join(root,"tests"));
  await fs.writeFile(path.join(root,"tests/source"),"x");
  await fs.writeFile(path.join(root,"SPEC.md"),section(["x"]));
  const now=new Date(Date.now()+1000).toISOString();
  await fs.writeFile(path.join(root,".opencode/runs/a.json"),JSON.stringify({run_id:"a",supervisor_run_id:"a",spec_fingerprint:fingerprint(section(["x"])),started_at:now,finished_at:now,duration_ms:1,command:"x",exit_code:0,stdout_tail:"",stderr_tail:"",timed_out:false,context:"execution"}));
  const client=mockClient({}, {a:"autonomous"});
  const hooks=await Supervisor({directory:root,worktree:root,client});
  await hooks["chat.params"]({sessionID:"a",agent:"autonomous"});
  await hooks.event({type:"session.idle",properties:{sessionID:"a"}});
  const file=path.join(root,".opencode/supervisor/a.json");
  assert.equal(JSON.parse(await fs.readFile(file,"utf8")).status,"complete");
  await fs.rm(path.join(root,".opencode/runs/a.json"));
  await hooks.event({type:"session.idle",properties:{sessionID:"a"}});
  assert.equal(JSON.parse(await fs.readFile(file,"utf8")).status,"running");
});
test("concurrent autonomous sessions retain separate state",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"supervisor-concurrent-")); await fs.writeFile(path.join(root,"SPEC.md"),section(["x"])); const client=mockClient({}, {a:"autonomous",b:"autonomous"});
  const hooks=await Supervisor({directory:root,worktree:root,client}); await Promise.all([hooks["chat.params"]({sessionID:"a",agent:"autonomous"}),hooks["chat.params"]({sessionID:"b",agent:"autonomous"})]);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,".opencode/supervisor/a.json"),"utf8")).run_id,"a"); assert.equal(JSON.parse(await fs.readFile(path.join(root,".opencode/supervisor/b.json"),"utf8")).run_id,"b");
});
