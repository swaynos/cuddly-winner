import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { parse } from "yaml";
import { tool } from "@opencode-ai/plugin";
import { OpencodeClient } from "@opencode-ai/sdk/v2";
import { goalAgentPath, goalDefinitionFingerprint, hasGoalAgentFile, readGoalAgentPolicy } from "../tools/publish_goal_agent.ts";
import { evidenceTool, publicSummary, toolActivity, type GoalActivity } from "./tui/progress.ts";

// Session records are the checkpoint. No task registry or second agent format.
const CONTINUE = "The goal is not yet validated. Diagnose the unresolved finding. Call goal_cycle with a concrete repair and expected new evidence within the admitted bounds. Do not finish from an implementation claim.";

type CycleRequest = {
  alignment?: "confirmed" | "clarification_required";
  completion_target?: string;
  authorized_actions?: string;
  max_cycles?: number;
  max_stalled_cycles?: number;
  finding?: string;
  repair?: string;
  expected_evidence?: string;
};

type BuilderHandoff = { status: "ready" | "unfinished" | "blocked"; evidence: string; remaining: string[] };

function builderHandoff(value: any): BuilderHandoff {
  if (!value || !["ready", "unfinished", "blocked"].includes(value.status)
    || typeof value.evidence !== "string" || !value.evidence.trim() || value.evidence.length > 4000
    || !Array.isArray(value.remaining) || value.remaining.length > 8
    || value.remaining.some((item: unknown) => typeof item !== "string" || !item.trim() || item.length > 1000)) {
    throw new Error("Builder handoff requires a status, concrete evidence and at most eight remaining actions.");
  }
  if ((value.status === "ready") !== (value.remaining.length === 0)) {
    throw new Error("Ready handoffs must have no remaining work; unfinished or blocked handoffs must name the next action or needed decision.");
  }
  return value;
}

function checkResolutions(validation: any, unresolved: Record<string, string[]>) {
  if (validation.status !== "checked") return;
  const missing = Object.keys(unresolved).filter(key => validation.checks[key]?.passed && !validation.checks[key].resolution?.trim());
  if (missing.length) throw new Error(`Resolution required for previously failed ${missing.join(", ")}. Supply new evidence resolving that exact finding or an evidence-backed correction; the verdict has not been accepted.`);
}

const git = promisify(execFile);
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

// Read-only, bounded provenance. Hashes never imply an unavailable historical baseline.
async function initialWorktree(root: string, files: string[]) {
  const baseline: any = { captured_at: new Date().toISOString(), files: {}, status: [], limitations: [] };
  try {
    const { stdout } = await git("git", ["-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, timeout: 10000, maxBuffer: 1024 * 1024 });
    const entries = stdout.split("\0");
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      const change: any = { status: entry.slice(0, 2), path: entry.slice(3) };
      if (/[RC]/.test(change.status)) change.original_path = entries[++i];
      baseline.status.push(change);
    }
    if (baseline.status.length > 512) {
      baseline.status = baseline.status.slice(0, 512);
      baseline.limitations.push("Initial status exceeds 512 paths. Unlisted changes have no attribution baseline.");
    }
  } catch {
    baseline.limitations.push("Initial Git status unavailable. Do not infer scope attribution from later status alone.");
  }
  let remaining = 16 * 1024 * 1024;
  const selected = [...new Set([...files, ...baseline.status.map((entry: any) => entry.path)])];
  if (selected.length > 512) baseline.limitations.push("Hash capture exceeds 512 paths. Unlisted files have no byte baseline.");
  for (const file of selected.slice(0, 512)) {
    const target = path.resolve(root, file);
    if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) continue;
    try {
      const stat = lstatSync(target);
      if (!realpathSync(target).startsWith(`${realpathSync(root)}${path.sep}`) || !stat.isFile() || stat.size > remaining) {
        baseline.files[file] = { state: "unhashed" };
        continue;
      }
      const bytes = readFileSync(target);
      remaining -= bytes.length;
      baseline.files[file] = { state: "present", size: bytes.length, sha256: sha256(bytes) };
    } catch (error: any) {
      baseline.files[file] = { state: error?.code === "ENOENT" ? "absent" : "unavailable" };
    }
  }
  return baseline;
}

function failureSignature(result: any): string {
  if (result.builder_handoff?.status === "unfinished") return "builder-unfinished";
  return sha256(JSON.stringify(result.validation?.status === "checked" && Object.keys(result.validation.checks ?? {}).length
    ? Object.entries(result.validation.checks).filter(([, check]: any) => !check.passed).sort(([a], [b]) => a.localeCompare(b)).map(([key, check]: any) => [key, check.evidence])
    : result.reason));
}

function data(response: any): any {
  if (response?.error || response?.data === undefined) throw new Error("OpenCode session request failed; outcome unknown. Inspect before resuming.");
  return response.data;
}

function lastCycle(messages: any[]): any {
  for (const message of [...messages].reverse()) {
    for (const part of [...message.parts].reverse()) {
      if (part.type !== "tool" || part.tool !== "goal_cycle") continue;
      if (part.state.status !== "completed") return { status: "blocked", reason: "Previous cycle interrupted; inspect child sessions before resuming." };
      try {
        const result = JSON.parse(part.state.output);
        return part.state.metadata?.coordinator_stop ? { ...result, status: "blocked", reason: part.state.metadata.coordinator_stop } : result;
      } catch { return { status: "blocked", reason: "Invalid cycle result." }; }
    }
  }
}

function verdict(result: any, criteria: string[]): "validated" | "failed" | "blocked" {
  if (!result || !["checked", "blocked"].includes(result.status)) throw new Error("Validator did not return a structured verdict.");
  if (result.status === "blocked") {
    if (!result.reason?.trim()) throw new Error("Validator blocker has no explanation.");
    return "blocked";
  }
  for (let i = 0; i < criteria.length; i++) {
    const check = result.checks?.[`c${i}`];
    if (typeof check?.passed !== "boolean" || !check.evidence?.trim()) throw new Error("Validator omitted criterion evidence.");
  }
  return criteria.every((_, i) => result.checks[`c${i}`].passed) ? "validated" : "failed";
}

function configuredModel(value: unknown, label: string): { providerID: string; modelID: string } | undefined {
  if (value === undefined) return;
  if (typeof value !== "string" || !/^[^\s/]+\/[^\s]+$/.test(value)) {
    throw new Error(`${label} must be a provider/model identifier.`);
  }
  const slash = value.indexOf("/");
  return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
}

export const Goal = async ({ client, directory, worktree }: { client: any; directory: string; worktree: string }) => {
  const root = directory || worktree;
  // V1 plugin metadata is an unexecuted Effect in the pinned registry bridge.
  // Reuse its authenticated transport with the pinned SDK's part-update API.
  const partClient = client._client ? new OpencodeClient({ client: client._client }) : undefined;
  const active = new Set<string>();
  const scheduled = new Set<string>();
  const stopped = new Set<string>();
  const interruptions = new Map<string, string>();
  const childParents = new Map<string, string>();
  const builders = new Set<string>();
  const validators = new Map<string, { criteria: string[]; unresolved: Record<string, string[]> }>();
  const activity = new Map<string, { context: any; snapshot: GoalActivity; children: string[]; childID?: string; tools: Map<string, string>; published?: boolean; pending?: Promise<void>; error?: unknown }>();

  function update(id: string, changes: Partial<GoalActivity>, remember = false) {
    const current = activity.get(id);
    if (!current) return;
    if (current.published && Object.entries(changes).every(([key, value]) => current.snapshot[key as keyof GoalActivity] === value)) return;
    const next = { ...current.snapshot, ...changes, updatedAt: Date.now() };
    const entry = changes.milestone ? publicSummary(`Reported: ${next.milestone}`) : next.activity;
    if (remember && entry !== current.snapshot.recent.at(-1)) next.recent = [...current.snapshot.recent, entry].slice(-3);
    current.snapshot = next;
    current.published = true;
    const value = { title: `Goal ${next.phase}: ${next.activity}`, metadata: {
      definition_sha256: current.context.definitionFingerprint,
      cycle_evidence: current.context.cycleEvidence,
      children: [...current.children], phase: next.phase, goal_activity: { ...next, recent: [...next.recent] },
    } };
    if (!partClient) current.context.metadata(value);
    else current.pending = (current.pending ?? Promise.resolve()).then(async () => {
      const messages = data(await client.session.messages({ path: { id } }));
      const part = messages.find((m: any) => m.info.id === current.context.messageID)?.parts.find((p: any) => p.type === "tool" && p.callID === current.context.callID);
      if (!part || part.state.status !== "running") return;
      const response = await partClient.part.update({ sessionID: id, messageID: part.messageID, partID: part.id,
        directory: root, part: { ...part, state: { ...part.state, ...value } } });
      if (response.error) throw new Error("Live Goal activity update failed");
    }).catch((error: unknown) => { current.error = error; });
  }

  function childActivity(sessionID: string, callID: string, name: string, status: string) {
    const parent = childParents.get(sessionID);
    const current = parent && activity.get(parent);
    if (!current || current.childID !== sessionID || stopped.has(parent) || name === "goal_progress") return;
    if (status === "running") current.tools.set(callID, toolActivity(name));
    else current.tools.delete(callID);
    update(parent, { status: "running", activity: [...current.tools.values()].at(-1)
      ?? (status === "error" ? "Tool reported a failure; investigating" : "Tool finished; reviewing results") });
  }

  async function definition(sessionID: string) {
    const session = data(await client.session.get({ path: { id: sessionID } }));
    if (session.parentID) return;
    const messages = data(await client.session.messages({ path: { id: sessionID } }));
    const user = [...messages].reverse().find((m: any) => m.info.role === "user")?.info;
    const agent = user?.agent ?? session.agent;
    if (!agent || !hasGoalAgentFile(root, agent)) return;
    const policy = readGoalAgentPolicy(root, agent);
    const text = readFileSync(goalAgentPath(root, agent), "utf8");
    const header = parse(text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "");
    const goalOptions = header?.options?.goal;
    const criteria = goalOptions?.criteria;
    if (!Array.isArray(criteria) || !criteria.length || criteria.some((c: unknown) => typeof c !== "string" || !c.trim())) return;
    const model = user?.model;
    if (!model?.providerID || !model?.modelID) throw new Error("Goal requires a selected execution model.");
    return {
      agent,
      fingerprint: goalDefinitionFingerprint(root, agent),
      text,
      criteria: criteria as string[],
      policy,
      model,
      builderModel: configuredModel(goalOptions.builder_model, "builder_model"),
      validatorModel: configuredModel(goalOptions.validator_model, "validator_model"),
      contextPaths: [...text.matchAll(/^- Read `([^`]+)`\.$/gm)].map(match => match[1]),
      messages,
    };
  }

  async function cycle(request: CycleRequest, context: any) {
    const id = context.sessionID;
    const goal = await definition(id);
    if (!goal) throw new Error("goal_cycle requires a selected root Goal Agent.");
    const priorResults = goal.messages.flatMap((m: any) => m.parts).filter((p: any) => p.tool === "goal_cycle" && p.state?.status === "completed").map((p: any) => {
      try { return JSON.parse(p.state.output); } catch { return {}; }
    });
    if (priorResults.some((result: any) => result.definition_sha256 !== goal.fingerprint)) {
      stopped.add(id);
      return JSON.stringify({ status: "blocked", reason: "Goal definition changed or prior cycles are unbound. Restart OpenCode and use a fresh conversation; prior validation cannot validate this definition.", definition_sha256: goal.fingerprint });
    }
    // The current running tool is not a previous interrupted cycle.
    const previous = lastCycle(goal.messages.map((m: any) => ({ ...m, parts: m.parts.filter((p: any) => !(m.info.id === context.messageID && p.tool === "goal_cycle" && ["pending", "running"].includes(p.state?.status))) })));
    const block = (reason: string) => {
      stopped.add(id);
      return JSON.stringify({ status: "blocked", reason, definition_sha256: goal.fingerprint });
    };
    // Custom-tool bridges do not uniformly enforce the advertised Zod bounds.
    for (const [key, limit] of [["completion_target", 1000], ["authorized_actions", 1000], ["finding", 1000], ["repair", 160], ["expected_evidence", 1000]] as const) {
      const value = request[key];
      if (value !== undefined && (typeof value !== "string" || !value.trim() || value.length > limit)) return block(`Invalid ${key}: provide 1..${limit} characters.`);
    }
    for (const key of ["max_cycles", "max_stalled_cycles"] as const) {
      const value = request[key];
      if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 100)) return block(`Invalid ${key}: provide an integer from 1 to 100.`);
    }
    const parts = goal.messages.flatMap((message: any) => message.parts);
    const recorded = parts.filter((part: any) => part.tool === "goal_cycle" && ["completed", "error"].includes(part.state?.status));
    const checkpoint = recorded.find((part: any) => part.state.metadata?.cycle_evidence)?.state.metadata;
    if (checkpoint && checkpoint.definition_sha256 !== goal.fingerprint) return block("Checkpoint definition changed. Restart OpenCode and use a fresh conversation.");
    const admission = priorResults.find((result: any) => result.admission)?.admission ?? checkpoint?.cycle_evidence.admission;
    const first = !admission;
    if (first && priorResults.some((result: any) => result.children?.length)) return block("Previous run lacks admission and initial provenance. Use a fresh session. A new snapshot cannot establish historical preservation.");
    if (request.alignment === "clarification_required") {
      return block("Execution mismatch. Resolve the requested completion target and authorized actions before orchestration. Revise the definition if needed, then restart in a fresh session.");
    }
    if (first && (request.alignment !== "confirmed" || !request.completion_target?.trim() || !request.authorized_actions?.trim()
      || !Number.isInteger(request.max_cycles) || request.max_cycles! < 1
      || !Number.isInteger(request.max_stalled_cycles) || request.max_stalled_cycles! < 1 || request.max_stalled_cycles! > request.max_cycles!)) {
      return block("Admission required. State the aligned completion target, authorized actions, max_cycles and max_stalled_cycles. Resolve material ambiguity before starting children.");
    }
    const admitted = admission ?? { completion_target: request.completion_target, authorized_actions: request.authorized_actions,
      max_cycles: request.max_cycles, max_stalled_cycles: request.max_stalled_cycles };
    const interruptedAttempts = recorded.filter((part: any) => part.state.status === "error" && part.state.metadata?.children?.length).length;
    const completed = priorResults.filter((result: any) => result.admission && result.children?.length);
    const priorIndex = goal.messages.findLastIndex((message: any) => message.parts.some((part: any) => part.tool === "goal_cycle" && !["pending", "running"].includes(part.state?.status)));
    const handback = goal.messages.slice(priorIndex + 1).some((message: any) => message.info.role === "user" && message.parts.some((part: any) => part.type === "text" && !part.synthetic && part.text !== CONTINUE));
    // The fallback bridge cannot update completed tool metadata. Its persisted
    // continuation history must enforce the same stop on explicit calls/reload.
    const nudges = goal.messages.slice(priorIndex + 1).filter((message: any) => message.info.role === "user"
      && message.parts.some((part: any) => part.type === "text" && part.text === CONTINUE)).length;
    if (!handback && nudges >= admitted.max_stalled_cycles) return block("Coordinator non-progress. Inspect before explicit resumption.");
    if (previous?.status === "blocked" && (!handback || request.alignment !== "confirmed")) return block("Previous outcome remains blocked or unknown. Inspect its evidence before explicit resumption.");
    if (completed.length + interruptedAttempts >= admitted.max_cycles) return block("Cycle bound reached. Diagnose unresolved findings and report the needed decision. The goal remains incomplete.");
    const repairing = previous?.status === "failed" || (previous?.validation?.status === "checked" && Object.values(previous.validation.checks).some((check: any) => !check.passed));
    const unfinished = previous?.builder_handoff?.status === "unfinished";
    if (!first && repairing && !unfinished && (![request.finding, request.repair, request.expected_evidence].every(value => value?.trim())
      || (previous.validation?.status === "checked" && !Object.entries(previous.validation.checks).some(([key, check]: any) => !check.passed && new RegExp(`\\b${key}\\b`).test(request.finding!))))) {
      return block("Repair diagnosis required. Identify an unresolved criterion key, a concrete repair and expected new resolving evidence. Do not repeat tests without a repair hypothesis.");
    }
    const unresolved: Record<string, string[]> = {};
    for (const result of priorResults) {
      if (result.validation?.status !== "checked") continue;
      for (let i = 0; i < goal.criteria.length; i++) {
        const key = `c${i}`, check = result.validation?.checks?.[key];
        if (check?.passed === false && typeof check.evidence === "string") {
          const findings = unresolved[key] ??= [];
          if (!findings.includes(check.evidence)) findings.push(check.evidence);
        } else if (check?.passed === true && check.resolution?.trim()) delete unresolved[key];
      }
    }
    if (active.has(id)) throw new Error("A goal cycle is already running.");
    if (stopped.has(id) || context.abort.aborted) throw new Error("Goal stopped; explicit user input is required to resume.");
    const retry = unfinished ? {
      finding: "Builder returned with unfinished authorized work; independent validation has not started.",
      repair: "Continue the unfinished builder work within the existing authority.",
      expected_evidence: previous.builder_handoff.remaining.join("\n"),
    } : repairing ? { finding: request.finding, repair: request.repair, expected_evidence: request.expected_evidence } : undefined;
    const retryReason = retry ? publicSummary(retry.repair!) : "";
    const latestVerdict = [...priorResults].reverse().find((result: any) => result.validation?.status === "checked"
      || (result.validation?.status === "blocked" && result.status === "blocked"));
    active.add(id);
    let childID: string | undefined;
    const children: string[] = [];
    const baseline = priorResults.find((result: any) => result.initial_worktree)?.initial_worktree
      ?? parts.find((part: any) => part.tool === "goal_cycle" && part.state?.metadata?.cycle_evidence?.initial_worktree)?.state.metadata.cycle_evidence.initial_worktree
      ?? await initialWorktree(root, [...goal.policy.edit_paths, ...goal.contextPaths]);
    context.cycleEvidence = { admission: admitted, initial_worktree: baseline,
      ...(retry ? { retry } : {}) };
    activity.set(id, { context, children, tools: new Map(), snapshot: {
      agent: goal.agent, parentID: id,
      cycle: goal.messages.flatMap((m: any) => m.parts).filter((p: any) => p.type === "tool" && p.tool === "goal_cycle" && ["completed", "error"].includes(p.state.status)).length + 1,
      phase: "builder", status: "running", activity: "Starting builder", milestone: "", recent: [],
      phaseStartedAt: Date.now(), updatedAt: Date.now(),
      verdict: latestVerdict?.validation?.status === "checked" ? `${latestVerdict.status === "validated" ? "validated" : "failed"} (${Object.entries(latestVerdict.validation.checks).filter(([, check]: any) => !check.passed).map(([key]) => key).join(", ")})`
        : latestVerdict?.validation?.status === "blocked" ? "blocked" : "none",
      retryReason,
    } });
    const cancel = () => {
      stopped.add(id);
      interruptions.set(id, "Observed cancellation. Inspect child evidence before resuming.");
      update(id, { status: "cancelled", activity: "Cancelled; inspect before resuming" }, true);
      if (childID) void client.session.abort({ path: { id: childID } }).catch(() => {});
    };
    context.abort.addEventListener("abort", cancel, { once: true });
    try {
      update(id, {}, true);
      for (const role of ["builder", "validator"] as const) {
        if (context.abort.aborted || stopped.has(id)) throw new Error(interruptions.get(id) ?? "Goal stopped. Inspect before resuming.");
        if (goalDefinitionFingerprint(root, goal.agent) !== goal.fingerprint) throw new Error("Goal definition changed; restart in a fresh conversation.");
        const child = data(await client.session.create({ body: {
          parentID: id, title: `Goal ${role}: ${goal.agent}`,
          permission: [
            { permission: "read", pattern: "*", action: "allow" },
            { permission: "glob", pattern: "*", action: "allow" },
            { permission: "grep", pattern: "*", action: "allow" },
            { permission: "list", pattern: "*", action: "allow" },
            { permission: "task", pattern: "*", action: "deny" },
            { permission: "goal_cycle", pattern: "*", action: "deny" },
            { permission: "goal_verdict", pattern: "*", action: role === "validator" ? "allow" : "deny" },
            { permission: "goal_handoff", pattern: "*", action: role === "builder" ? "allow" : "deny" },
            { permission: "goal_progress", pattern: "*", action: "allow" },
            { permission: "publish_goal_agent", pattern: "*", action: "deny" },
            { permission: "edit", pattern: "*", action: role === "builder" ? "allow" : "deny" },
            { permission: "bash", pattern: "*", action: goal.policy.bash ? "ask" : "deny" },
          ],
        } }));
        childID = child.id;
        children.push(child.id);
        childParents.set(child.id, id);
        const current = activity.get(id)!;
        current.childID = child.id;
        current.tools.clear();
        if (role === "validator") validators.set(child.id, { criteria: goal.criteria, unresolved });
        else builders.add(child.id);
        update(id, { phase: role, status: "running", phaseStartedAt: Date.now(), milestone: "",
          activity: role === "builder" ? "Builder working" : "Independent validator checking criteria" }, true);
        await current.pending;
        if (current.error) throw current.error;
        if (context.abort.aborted) { cancel(); throw new Error("Observed cancellation. Inspect before resuming."); }
        if (stopped.has(id)) throw new Error(interruptions.get(id) ?? "Child stopped. Inspect before resuming.");
        let prompt = role === "builder"
          ? `Pursue the goal below within its exact edit paths. Acceptance criteria are implementation and verification obligations, not an inspection checklist. Complete authorized work, including required execution, before handing off as ready. Preparation, metadata edits and a report do not finish missing implementation. Do not change acceptance criteria or the generated definition. Ordinary failures require diagnosis and repair. Call goal_handoff before finishing: ready only when no authorized work remains before independent validation; unfinished with concrete next actions otherwise; blocked only for an observed genuine stop. Honest zero progress is allowed.\nUnresolved independent findings:\n${JSON.stringify(unresolved)}`
            : `Independently validate the CURRENT project against EVERY criterion below. Obtain fresh evidence; do not trust implementation claims. Do not edit product code or acceptance criteria, including through shell commands. Run the declared checks and required live/user-journey checks. Mark unmet criteria false with actionable findings. Use blocked only for an observed genuine stop condition or external dependency, not ordinary test failures or unfinished implementation. Missing required historical evidence is an evidence blocker, not something repetition can manufacture. Call goal_verdict before finishing with concrete evidence (commands, outcomes and artifact paths) per criterion. Number the acceptance criteria in their published order using keys c0 through c${goal.criteria.length - 1}. Unresolved independent findings: ${JSON.stringify(unresolved)}. For each previously failed criterion now passed, provide resolution identifying new evidence resolving that exact finding or an evidence-backed correction of the earlier finding. Passing unrelated tests is insufficient. You have not been given the builder's conversation.`;
        prompt += role === "builder"
          ? "\nPREREQUISITES: Preparation is part of this run. Inspect current inputs and durable readiness evidence; prepare missing or stale prerequisites within the goal's policy, verify readiness, then continue directly into authorized iterative work. Record dependencies and readiness evidence so fresh children can resume. Reuse verified preparation, refresh only affected dependencies when inputs change, and invalidate dependent evidence while preserving unaffected work and history. Do not stop at preparation unless explicitly requested as the finish line. For scaffolding-only scope, implement and test the preparation-to-work transition without unauthorized execution. Missing authority or an observed unavailable dependency is a blocker; unknown side effects require inspection before any retry."
          : "\nPREREQUISITES: Independently check preparation readiness and dependency evidence against current inputs, including reuse and invalidation after changes. Preparation alone does not satisfy an execution outcome. For scaffolding-only scope, verify the implemented preparation-to-work transition with permitted tests; respect explicit preparation-only scope and do not perform unauthorized execution. Missing or stale preparation that the builder can repair within policy is a failed criterion, not an external blocker.";
        prompt += `\nADMITTED TASK: ${JSON.stringify(admitted)}\nREPAIR HYPOTHESIS: ${JSON.stringify(context.cycleEvidence.retry ?? null)}\nINITIAL WORKTREE: ${JSON.stringify(baseline)}\nAttribute changes against this initial evidence. Dirty status and untracked files alone do not prove task mutations. Preserve pre-existing user changes and deletions. Required unavailable historical bytes remain a specific evidence blocker. This baseline proves only the captured state, not earlier history or concurrent authorship. Builder task files and milestones are not independent verdicts. Synthetic checks cannot prove live quality. For visual outcomes, inspect fresh output bytes per dimension. Define protected anatomy and intended edit regions in native source coordinates. If a criterion requires live quality, mark it failed without fresh live outputs and independent visual evidence. Do not substitute synthetic evidence.`;
        if (unfinished && role === "builder") prompt += `\nUNFINISHED BUILDER CHECKPOINT: ${JSON.stringify(previous.builder_handoff)}\nContinue these actions; this checkpoint is not acceptance evidence.`;
        const model = (role === "builder" ? goal.builderModel : goal.validatorModel) ?? goal.model;
        const result = data(await client.session.prompt({ path: { id: child.id }, body: {
          agent: "general",
          model,
          parts: [{ type: "text", text: `${prompt}\n\nThe following is the goal definition body; its policy remains enforced through ancestry. Its coordinator instructions apply to the parent, not you. Perform only your assigned ${role} phase.\n${goal.text.replace(/^---\n[\s\S]*?\n---\n/, "")}\n\nROLE BOUNDARY: You are the ${role} child, NOT the coordinator. goal_cycle, publication and delegation are intentionally unavailable to you. Do not attempt orchestration or call their absence a blocker. ${role === "validator" ? "Inspect files and run checks using your own tools, then call goal_verdict. Missing implementation is a failed criterion for the next builder to repair. Fix any rejected verdict fields before finishing." : "Your phase includes requested implementation and verification, not only planning/preparation. Use your own tools and call goal_handoff; it does not establish acceptance."}\n\nUSER VISIBILITY: Call goal_progress with a concise public milestone at the start, before long operations and after meaningful results. Omit private reasoning, raw commands/output, URLs and credentials. Progress is child-reported activity, never validation evidence; continue doing the actual work.` }],
        } }));
        if (context.abort.aborted || stopped.has(id)) throw new Error(interruptions.get(id) ?? "Child stopped. Inspect its session before resuming.");
        if (result.info?.error) throw new Error(result.info.error.name === "MessageAbortedError"
          ? "Observed child abort. Its action outcome is unknown. Inspect before resuming."
          : "Observed child failure. Inspect its session before resuming.");
        // A denied tool may be handled by the model without an assistant error.
        const history = data(await client.session.messages({ path: { id: child.id } }));
        childParents.delete(child.id);
        activity.get(id)!.childID = undefined;
        const errors = history.flatMap((m: any) => [m.info.error?.name, ...m.parts.filter((p: any) => p.type === "tool" && p.state.status === "error").map((p: any) => p.state.error)]).filter(Boolean);
        if (errors.some((error: string) => /PermissionRejectedError|^The user rejected|^User denied/i.test(error))) throw new Error("Observed permission denial. Explicit user input is required.");
        if (errors.some((error: string) => /MessageAbortedError|^User cancelled|^Operation (?:aborted|cancelled)/i.test(error))) throw new Error("Observed child abort. Inspect action outcomes before resuming.");
        if (history.some((m: any) => m.info.error)) throw new Error("Observed child failure. Inspect before resuming.");
        if (goalDefinitionFingerprint(root, goal.agent) !== goal.fingerprint) throw new Error("Goal definition changed during execution; restart in a fresh conversation.");
        if (role === "builder") {
          const report = history.flatMap((m: any) => m.parts).findLast((p: any) => p.type === "tool" && p.tool === "goal_handoff" && p.state.status === "completed");
          let handoff: BuilderHandoff;
          try { handoff = builderHandoff(report && JSON.parse(report.state.output)); }
          catch (error) {
            handoff = { status: "unfinished", evidence: `Builder returned without a valid handoff: ${error instanceof Error ? error.message : String(error)}`,
              remaining: ["Inspect the builder's actual work, complete authorized implementation and verification, then record goal_handoff."] };
          }
          const inspected = history.some((m: any) => m.parts.some((p: any) => p.type === "tool" && evidenceTool(p.tool)
            && (p.state.status === "completed" || (handoff.status === "blocked" && p.state.status === "error"))));
          if (handoff.status !== "unfinished" && !inspected) handoff = {
            status: "unfinished", evidence: "Builder claimed readiness or a blocker without attempting the required inspection/checks.",
            remaining: ["Obtain concrete tool evidence for readiness or an observed external stop; missing implementation is authorized unfinished work."] };
          if (handoff.status !== "ready") {
            if (handoff.status === "blocked") stopped.add(id);
            return JSON.stringify({ status: handoff.status === "blocked" ? "blocked" : "failed", children, builder_handoff: handoff,
              reason: handoff.status === "blocked" ? handoff.evidence : "Builder unfinished; continue authorized work in a fresh builder before validation." });
          }
        }
        if (role === "validator") {
          const report = history.flatMap((m: any) => m.parts).findLast((p: any) => p.type === "tool" && p.tool === "goal_verdict" && p.state.status === "completed");
          if (!report) return JSON.stringify({ status: "failed", children, reason: "Validator stopped without a verdict. Repeat the build/validate cycle and obtain criterion evidence." });
          let validation;
          let status;
          try {
            validation = JSON.parse(report.state.output);
            status = verdict(validation, goal.criteria);
            checkResolutions(validation, unresolved);
          } catch (error) {
            return JSON.stringify({ status: "failed", children, reason: `Invalid completed validator report; repair the validation protocol: ${error instanceof Error ? error.message : String(error)}` });
          }
          const inspected = history.some((m: any) => m.parts.some((p: any) => p.type === "tool"
            && evidenceTool(p.tool)
            && ["completed", "error"].includes(p.state.status)));
          if (status === "blocked" && !inspected) {
            return JSON.stringify({ status: "failed", children, validation, reason: "Validator declared a blocker without inspecting or attempting a check. Child orchestration tools are intentionally unavailable; obtain concrete external-stop evidence or mark unfinished work failed." });
          }
          if (status === "blocked") stopped.add(id);
          if (status === "validated" && !history.some((m: any) => m.parts.some((p: any) => p.type === "tool" && evidenceTool(p.tool) && p.state.status === "completed"))) {
            return JSON.stringify({ status: "failed", children, reason: "Validator claimed success without obtaining tool evidence. Obtain independent evidence before reporting success." });
          }
          if (goalDefinitionFingerprint(root, goal.agent) !== goal.fingerprint) throw new Error("Goal definition changed during execution; restart in a fresh conversation.");
          return JSON.stringify({ status, children, validation, definition_sha256: goal.fingerprint });
        }
      }
    } catch (error) {
      stopped.add(id);
      return JSON.stringify({ status: "blocked", children, reason: error instanceof Error ? error.message : String(error) });
    } finally {
      context.abort.removeEventListener("abort", cancel);
      for (const child of children) { childParents.delete(child); builders.delete(child); validators.delete(child); }
      active.delete(id);
    }
  }

  return {
    tool: {
      goal_cycle: tool({ description: "Run a fresh builder, then an independent validator only after a ready handoff. Unfinished builders resume within admitted bounds. First confirm target, authority and bounds; diagnose failed validation before repair.", args: {
        alignment: tool.schema.enum(["confirmed", "clarification_required"]).optional(),
        completion_target: tool.schema.string().min(1).max(1000).optional(),
        authorized_actions: tool.schema.string().min(1).max(1000).optional(),
        max_cycles: tool.schema.number().int().min(1).max(100).optional(),
        max_stalled_cycles: tool.schema.number().int().min(1).max(100).optional(),
        finding: tool.schema.string().min(1).max(1000).optional(),
        repair: tool.schema.string().min(1).max(160).optional(),
        expected_evidence: tool.schema.string().min(1).max(1000).optional(),
      },
        async execute(args, context) {
          const initialGoal = await definition(context.sessionID);
          const executionContext: any = { ...context, definitionFingerprint: initialGoal?.fingerprint, metadata: context.metadata.bind(context) };
          try {
            const output = await cycle(args, executionContext);
            const result = JSON.parse(output);
            Object.assign(result, executionContext.cycleEvidence);
            result.definition_sha256 ??= initialGoal?.fingerprint;
            if (result.status === "failed" && result.admission) {
              const records = initialGoal!.messages.flatMap((message: any) => message.parts).filter((part: any) => part.tool === "goal_cycle");
              const prior = records.filter((part: any) => part.state?.status === "completed").map((part: any) => {
                try { return JSON.parse(part.state.output); } catch { return {}; }
              });
              let stalled = 1;
              for (const old of [...prior].reverse()) {
                if (old.status !== "failed" || failureSignature(old) !== failureSignature(result)) break;
                stalled++;
              }
              const interrupted = records.filter((part: any) => part.state?.status === "error" && part.state.metadata?.children?.length).length;
              const cycles = prior.filter((old: any) => old.admission && old.children?.length).length + interrupted + 1;
              if (stalled >= result.admission.max_stalled_cycles || cycles >= result.admission.max_cycles) {
                const failure = result.reason;
                result.status = "blocked";
                result.reason = stalled >= result.admission.max_stalled_cycles
                  ? `Non-progress: ${stalled} consecutive ${result.builder_handoff?.status === "unfinished" ? "unfinished builder attempts" : "identical independent findings"}. Diagnose contradictions, inaccessible repairs or missing evidence. Report a concrete resolving decision before resuming.`
                   : "Cycle bound reached with unresolved findings. Diagnose remaining failures and report the needed decision.";
                if (failure) result.reason += ` Last failure: ${failure}`;
                stopped.add(context.sessionID);
              }
            }
            if (initialGoal && goalDefinitionFingerprint(root, initialGoal.agent) !== initialGoal.fingerprint) {
              result.status = "blocked";
              result.reason = "Goal definition changed during execution; restart in a fresh conversation.";
              stopped.add(context.sessionID);
            }
            const current = activity.get(context.sessionID);
            if (!current || current.context !== executionContext) return JSON.stringify(result);
            const status = current.snapshot.status === "cancelled" ? "cancelled" : result.status;
            const message = status === "validated" ? "Independently validated" : status === "failed"
              ? result.builder_handoff?.status === "unfinished" ? "Builder unfinished; validation not started"
                : `Validation incomplete; repair cycle required${result.validation?.checks ? ` (${Object.entries(result.validation.checks).filter(([, check]: any) => !check.passed).map(([key]) => key).join(", ")})` : ""}` : status === "cancelled" ? "Cancelled; inspect before resuming"
              : result.reason?.startsWith("Non-progress:") ? "Non-progress; diagnosis required"
              : result.reason?.startsWith("Cycle bound reached") ? "Cycle bound reached; diagnosis required"
              : result.reason?.includes("permission denial") ? "Permission denied; inspect before resuming"
              : "Blocked; inspect before resuming";
            update(context.sessionID, { status, activity: message,
              ...(result.validation?.status === "checked" ? { verdict: `${Object.values(result.validation.checks).every((check: any) => check.passed) && result.status === "validated" ? "validated" : "failed"} (${Object.entries(result.validation.checks).filter(([, check]: any) => !check.passed).map(([key]) => key).join(", ")})` }
                : result.validation?.status === "blocked" && result.status === "blocked" ? { verdict: "blocked" } : {}),
            }, true);
            await current.pending;
            if (current.error) throw current.error;
            return { output: JSON.stringify(result), title: `Goal: ${message}`, metadata: {
              definition_sha256: result.definition_sha256, cycle_evidence: executionContext.cycleEvidence,
              children: [...current.children], phase: current.snapshot.phase,
              goal_activity: { ...current.snapshot, recent: [...current.snapshot.recent] },
            } };
          } finally {
            if (activity.get(context.sessionID)?.context === executionContext) activity.delete(context.sessionID);
          }
        } }),
      goal_handoff: tool({
        description: "Record a builder checkpoint before returning. Ready permits independent checking, not acceptance; unfinished work resumes in a fresh bounded attempt.",
        args: {
          status: tool.schema.enum(["ready", "unfinished", "blocked"]),
          evidence: tool.schema.string().min(1).max(4000),
          remaining: tool.schema.array(tool.schema.string().min(1).max(1000)).max(8),
        },
        async execute(args, context) {
          const parent = childParents.get(context.sessionID);
          if (!builders.has(context.sessionID) || !parent || activity.get(parent)?.childID !== context.sessionID || stopped.has(parent)) {
            throw new Error("Only the active Goal builder may record a handoff.");
          }
          return JSON.stringify(builderHandoff(args));
        },
      }),
      goal_progress: tool({
        description: "Report a short public milestone from the active Goal builder or validator. This is not validation evidence.",
        args: { summary: tool.schema.string().min(1).max(160) },
        async execute(args, context) {
          const parent = childParents.get(context.sessionID);
          const current = parent && activity.get(parent);
          if (!current || current.childID !== context.sessionID || !active.has(parent) || stopped.has(parent)) {
            throw new Error("Only the active Goal child may report progress.");
          }
          const summary = publicSummary(args.summary);
          update(parent, { milestone: summary }, true);
          return "Public milestone recorded; independent evidence is still required.";
        },
      }),
      goal_verdict: tool({
        description: "Record independent criterion evidence. Available only inside the active goal validator session.",
        args: {
          status: tool.schema.enum(["checked", "blocked"]),
          reason: tool.schema.string(),
          checks: tool.schema.record(tool.schema.string(), tool.schema.object({ passed: tool.schema.boolean(), evidence: tool.schema.string().min(1), resolution: tool.schema.string().min(1).optional() })),
        },
        async execute(args, context) {
          const validator = validators.get(context.sessionID);
          const parent = childParents.get(context.sessionID);
          if (!validator || !parent || activity.get(parent)?.childID !== context.sessionID || stopped.has(parent)) throw new Error("Only the active independent validator may record a goal verdict.");
          verdict(args, validator.criteria);
          checkResolutions(args, validator.unresolved);
          return JSON.stringify(args);
        },
      }),
    },
    "tool.execute.before": async (input: any) => childActivity(input.sessionID, input.callID, input.tool, "running"),
    "tool.execute.after": async (input: any) => childActivity(input.sessionID, input.callID, input.tool, "completed"),
    "chat.message": async (input: any, output: any) => {
      if (output.parts?.some((p: any) => p.type === "text" && p.text !== CONTINUE && !p.synthetic)) {
        stopped.delete(input.sessionID);
        interruptions.delete(input.sessionID);
      }
    },
    event: async ({ event }: any) => {
      const part = event.properties?.part;
      const id = event.properties?.sessionID ?? part?.sessionID;
      if (!id) return;
      if (event.type === "message.part.updated" && part?.type === "tool" && ["running", "completed", "error"].includes(part.state?.status)) {
        childActivity(id, part.callID ?? part.id, part.tool, part.state.status);
      }
      const parent = childParents.get(id);
      if (parent && ["permission.asked", "permission.updated", "question.asked"].includes(event.type)) {
        update(parent, { status: "waiting", activity: "Waiting for user permission or answer" }, true);
      }
      if (parent && ["permission.replied", "question.replied", "question.rejected"].includes(event.type)) {
        update(parent, { status: "running", activity: "User response received; continuing" });
      }
      if (event.type === "session.error" || (event.type === "permission.replied" && event.properties.reply === "reject")) {
        stopped.add(childParents.get(id) ?? id);
        const reason = event.type === "permission.replied" || event.properties.error?.name === "PermissionRejectedError"
          ? "Observed permission denial. Explicit user input is required."
          : event.properties.error?.name === "MessageAbortedError" ? "Observed child abort. Inspect action outcomes before resuming."
          : "Observed session failure. Action outcomes are unknown. Inspect before resuming.";
        interruptions.set(parent ?? id, reason);
        update(parent ?? id, { status: "blocked", activity: event.type === "permission.replied" ? "Permission denied; inspect before resuming" : "Session failed; inspect before resuming" }, true);
        return;
      }
      if (event.type !== "session.idle" || stopped.has(id) || scheduled.has(id) || active.has(id)) return;
      scheduled.add(id);
      try {
        const goal = await definition(id);
        if (!goal || stopped.has(id)) return;
        const last = goal.messages.at(-1);
        if (last?.info.role !== "assistant" || last.info.error || !last.info.finish) return;
        const result = lastCycle(goal.messages);
        if (result && result.definition_sha256 !== goal.fingerprint) {
          stopped.add(id);
          await client.tui?.showToast?.({ body: { title: "Goal definition changed", message: "Restart OpenCode and use a fresh conversation. Previous validation is not applicable.", variant: "error" } });
          return;
        }
        if (!result || result.status !== "failed") return;
        const cycleIndex = goal.messages.findLastIndex((message: any) => message.parts.some((part: any) => part.tool === "goal_cycle"));
        const nudges = goal.messages.slice(cycleIndex + 1).filter((message: any) => message.info.role === "user" && message.parts.some((part: any) => part.type === "text" && part.text === CONTINUE)).length;
        if (result.admission && nudges >= result.admission.max_stalled_cycles) {
          stopped.add(id);
          const reason = "Coordinator non-progress. Repeated completion attempts did not start the required diagnosed repair. Inspect before explicit resumption.";
          if (partClient) {
            const message = goal.messages[cycleIndex];
            const part = message.parts.findLast((part: any) => part.tool === "goal_cycle");
            const response = await partClient.part.update({ sessionID: id, messageID: message.info.id, partID: part.id,
              directory: root, part: { ...part, state: { ...part.state, metadata: { ...part.state.metadata, coordinator_stop: reason } } } });
            if (response.error) throw new Error("Coordinator stop checkpoint failed.");
          }
          await client.tui?.showToast?.({ body: { title: "Goal incomplete", message: reason, variant: "error" } });
          return;
        }
        // Yield until the idle event's runner has released its session lock.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (stopped.has(id)) return;
        const response = await client.session.promptAsync({ path: { id }, body: {
          agent: goal.agent, model: goal.model, parts: [{ type: "text", text: CONTINUE }],
        } });
        if (response.error) throw new Error("Continuation submission failed.");
      } catch {
        // Unknown API outcomes are never replayed automatically.
        stopped.add(id);
        await client.tui?.showToast?.({ body: { title: "Goal incomplete", message: "Continuation could not be established. Inspect the session before explicitly resuming.", variant: "error" } }).catch(() => {});
      } finally {
        scheduled.delete(id);
      }
    },
  };
};
