import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const FAILURE_CAP = 3;
export const GLOBAL_CAP = 12;
export const fingerprint = (text) => crypto.createHash("sha256").update(text).digest("hex");
export const normalizeCommand = (command) => command.replace(/\/home\/[^/]+\/\.pyenv\/versions\/[^/]+\/bin\/python3/g, "python3");

export function parseVerification(spec) {
  const headings = [...spec.matchAll(/^## Verification\s*$/gm)];
  if (headings.length !== 1) throw new Error("SPEC must contain exactly one ## Verification section");
  const start = headings[0].index + headings[0][0].length;
  const following = spec.slice(start).search(/^##\s/m);
  const body = following < 0 ? spec.slice(start) : spec.slice(start, start + following);
  const commands = [...body.matchAll(/^- `([^`\n]+)`\s*$/gm)].map((m) => m[1]);
  const commandItems = body.split(/\r?\n/).filter((line) => /^-\s/.test(line));
  if (commandItems.length !== commands.length) throw new Error("Malformed Verification command item");
  if (!commands.length || new Set(commands).size !== commands.length) throw new Error("Verification commands must be non-empty and unique");
  return commands.map(normalizeCommand);
}

const required = ["run_id","started_at","finished_at","duration_ms","command","exit_code","stdout_tail","stderr_tail","timed_out","context"];
export function validateRunArtifact(value) {
  if (!value || typeof value !== "object" || required.some((k) => !(k in value))) throw new Error("Malformed run artifact");
  if (!Number.isFinite(value.duration_ms) || !Number.isFinite(value.exit_code)) throw new Error("Invalid run numbers");
  if (typeof value.run_id !== "string" || !/^[a-z0-9]+$/i.test(value.run_id)) throw new Error("Invalid run ID");
  if (!Date.parse(value.started_at) || !Date.parse(value.finished_at) || Date.parse(value.finished_at) < Date.parse(value.started_at) || Date.parse(value.finished_at) > Date.now() + 5000 || value.context !== "execution") throw new Error("Invalid run context or timestamps");
  if (typeof value.command !== "string" || typeof value.stdout_tail !== "string" || typeof value.stderr_tail !== "string" || typeof value.timed_out !== "boolean") throw new Error("Invalid run fields");
  return value;
}

export async function newestRelevantMtime(root) {
  const include = ["agents","plugins","tests","evals","scripts","skills",".opencode/tool"];
  let newest = 0;
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === "reports" || entry.name === "__pycache__" || entry.name.startsWith(".")) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else newest = Math.max(newest, (await fs.stat(file)).mtimeMs);
    }
  }
  for(const rel of include){const target=path.join(root,rel);try{const stat=await fs.stat(target);if(stat.isDirectory())await walk(target);else newest=Math.max(newest,stat.mtimeMs)}catch{}}
  return newest;
}

export async function evaluate(root, specText) {
  const commands = parseVerification(specText), newest = await newestRelevantMtime(root);
  const dir = path.join(root, ".opencode", "runs");
  let names = []; try { names = await fs.readdir(dir); } catch { return { complete: false, missing: commands }; }
  const seen = new Set(), passing = new Map();
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    let artifact; try { artifact = validateRunArtifact(JSON.parse(await fs.readFile(path.join(dir, name), "utf8"))); }
    catch { return { complete: false, missing: commands, invalid_artifact: name }; }
    if (name !== `${artifact.run_id}.json`) return { complete:false, missing:commands, invalid_artifact:`filename mismatch ${name}` };
    if (seen.has(artifact.run_id)) return { complete: false, missing: commands, invalid_artifact: `duplicate run_id ${artifact.run_id}` }; seen.add(artifact.run_id);
    if (artifact.exit_code === 0 && Date.parse(artifact.finished_at) >= newest) passing.set(normalizeCommand(artifact.command), artifact);
  }
  const missing = commands.filter((command) => !passing.has(command));
  return { complete: missing.length === 0, missing, satisfied: commands.filter((c) => passing.has(c)) };
}

export async function validateMutation(config, result, root, newestMtime) {
  if (!config?.enabled) return true;
  if (!result || !Date.parse(result.generated_at) || Date.parse(result.generated_at) > Date.now() + 5000 || !Number.isFinite(result.score) || result.score < config.score_threshold || !Array.isArray(result.files) || !result.files.length) return false;
  if (Date.parse(result.generated_at) < newestMtime) return false;
  for (const file of result.files) {
    if (typeof file !== "string" || path.isAbsolute(file)) return false;
    const resolved=path.resolve(root,file); if(resolved!==root && !resolved.startsWith(`${root}${path.sep}`)) return false;
    let stat; try { stat = await fs.stat(resolved); } catch { return false; }
    if (!stat.isFile() || stat.mtimeMs > Date.parse(result.generated_at)) return false;
  }
  return true;
}

export function applyCorrection(state, failureClass, dedupeKey) {
  state.corrective_counts ??= {}; state.history ??= []; state.global_count ??= 0;
  if (state.history.some((h) => h.dedupeKey === dedupeKey)) return state;
  state.corrective_counts[failureClass] = (state.corrective_counts[failureClass] ?? 0) + 1;
  state.global_count++; state.history.push({ failureClass, dedupeKey, at: new Date().toISOString() });
  if (state.corrective_counts[failureClass] >= FAILURE_CAP || state.global_count >= GLOBAL_CAP) {
    state.status = "blocked"; state.blocker_reason = `Correction cap reached for ${failureClass}`;
  }
  return state;
}

export async function atomicStateUpdate(file, update) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  let state = {};
  try { state = JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) {
    if (error?.code !== "ENOENT") throw new Error(`Supervisor state corruption at ${file}`, { cause: error });
  }
  const next = await update(structuredClone(state));
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`); await fs.rename(temp, file); return next;
}

const locks = new Map();
export function serializedStateUpdate(file, update) {
  const prior = locks.get(file) ?? Promise.resolve();
  const next = prior.then(() => atomicStateUpdate(file, update));
  locks.set(file, next.catch(() => undefined)); return next;
}

async function sessionInfo(client, sessionID) {
  let parentID;
  try { parentID = (await client?.session?.get?.({ path:{ id:sessionID } }))?.data?.parentID; } catch {}
  let agent;
  try {
    const result=await client?.session?.messages?.({path:{id:sessionID}});
    const messages=result?.data ?? [];
    for(let i=messages.length-1;i>=0;i--){if(messages[i]?.info?.role==="user"&&messages[i]?.info?.agent){agent=messages[i].info.agent;break;}}
  } catch {}
  return {agent,parentID};
}

export default async function Supervisor({ directory, worktree, client }) {
  const root = worktree || directory;
  const stateDir=path.join(root,".opencode","supervisor");
  const stateFile=(runID)=>path.join(stateDir,`${runID}.json`);
  const runBySession=new Map();

  async function existingRun(sessionID) {
    if(runBySession.has(sessionID)) return runBySession.get(sessionID);
    let current=sessionID;
    const visited=new Set();
    while(current && !visited.has(current)){
      visited.add(current);
      try { await fs.access(stateFile(current)); runBySession.set(sessionID,current); return current; } catch (error) { if(error?.code!=="ENOENT") throw error; }
      const info=await sessionInfo(client,current); current=info.parentID;
    }
    return null;
  }

  async function initializeAutonomous(sessionID, agent) {
    if(agent!=="autonomous") return;
    const info=await sessionInfo(client,sessionID);
    if(info.parentID) return;
    const spec=await fs.readFile(path.join(root,"SPEC.md"),"utf8");
    await serializedStateUpdate(stateFile(sessionID),(state)=>{
      if(state.run_id) return state;
      return {run_id:sessionID,spec_fingerprint:fingerprint(spec),satisfied:[],corrective_counts:{},global_count:0,history:[],status:"running",blocker_reason:null};
    });
    runBySession.set(sessionID,sessionID);
  }

  return {
    "chat.params": async (input) => initializeAutonomous(input.sessionID,input.agent),
    event: async (input) => {
    const event = input?.event ?? input;
    if (event?.type === "session.error" && event?.properties?.sessionID) {
      const runID=await existingRun(event.properties.sessionID); if(!runID) return;
      const file=stateFile(runID);
      const key=event.properties.error?.name ?? JSON.stringify(event.properties.error ?? "error");
      let shouldPrompt=false;
      const state=await serializedStateUpdate(file,(state)=>{if(state.status==="blocked"||state.history?.some(h=>h.dedupeKey===key))return state;shouldPrompt=true;return applyCorrection(state,"runtime",key)});
      if(shouldPrompt && state.status!=="blocked" && client?.session?.promptAsync) await client.session.promptAsync({path:{id:runID},body:{parts:[{type:"text",text:"Supervisor: correct the runtime failure and re-run exact verification."}]}}).catch(()=>undefined);
      return;
    }
    const reviewerText = event?.properties?.part?.text ?? event?.properties?.text ?? "";
    if ((event?.type === "message.part.updated" || event?.type === "message.updated") && /REQUEST_CHANGES/.test(reviewerText) && event?.properties?.sessionID) {
      const runID=await existingRun(event.properties.sessionID); if(!runID) return;
      let shouldPrompt=false;
      const state=await serializedStateUpdate(stateFile(runID),(state)=>{if(state.status==="blocked"||state.history?.some(h=>h.dedupeKey==="reviewer-request"))return state;shouldPrompt=true;return applyCorrection(state,"reviewer","reviewer-request")});
      if(shouldPrompt && state.status!=="blocked" && client?.session?.promptAsync) await client.session.promptAsync({path:{id:runID},body:{parts:[{type:"text",text:"Advisory Reviewer requested changes. Address the grounded findings once, then re-run deterministic verification."}]}}).catch(()=>undefined);
      return;
    }
    if (event?.type !== "session.idle" || !event?.properties?.sessionID) return;
    const runID=await existingRun(event.properties.sessionID); if(!runID) return;
    const spec = await fs.readFile(path.join(root, "SPEC.md"), "utf8");
    const verdict = await evaluate(root, spec);
    const file = stateFile(runID);
    const specFingerprint = fingerprint(spec);
    let shouldPrompt=false;
    const updated=await serializedStateUpdate(file, async (state) => {
      if(state.status==="blocked") return state;
      if (!state.run_id || !state.spec_fingerprint) return {...state,status:"blocked",blocker_reason:"Invalid uninitialized run state"};
      if (state.spec_fingerprint !== specFingerprint) return { ...state, status:"blocked", blocker_reason:"SPEC changed; start a new run" };
      let mutation_ok = true;
      try {
        const config=JSON.parse(await fs.readFile(path.join(root,".opencode/mutation.json"),"utf8"));
        if(config.enabled){const result=JSON.parse(await fs.readFile(path.join(root,config.result_path),"utf8")); mutation_ok=await validateMutation(config,result,root,await newestRelevantMtime(root));}
      } catch (error) { if ((await fs.access(path.join(root,".opencode/mutation.json")).then(()=>true).catch(()=>false))) mutation_ok=false; }
      if(verdict.complete && mutation_ok) return { ...state, ...verdict, mutation_ok, status:"complete" };
      const key=JSON.stringify({missing:verdict.missing,invalid:verdict.invalid_artifact,mutation_ok});
      if(!state.history?.some(h=>h.dedupeKey===key)) shouldPrompt=true;
      const corrected=applyCorrection({...state,...verdict,mutation_ok,status:"running",blocker_reason:null},"verification",key);
      return corrected;
    });
    if(shouldPrompt && updated.status!=="blocked" && updated.status!=="complete" && client?.session?.promptAsync) await client.session.promptAsync({path:{id:runID},body:{parts:[{type:"text",text:"Supervisor: deterministic verification is incomplete. Run the exact missing commands and retry."}]}}).catch(()=>undefined);
  }};
}
