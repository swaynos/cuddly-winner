import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { tool } from "@opencode-ai/plugin";
import { OpencodeClient } from "@opencode-ai/sdk/v2";
import { goalAgentPath, goalDefinitionFingerprint, hasGoalAgentFile, readGoalAgentPolicy } from "../tools/publish_goal_agent.ts";
import { evidenceTool, publicSummary, toolActivity, type GoalActivity } from "./tui/progress.ts";

// Session records are the checkpoint. No task registry or second agent format.
const CONTINUE = "The goal is not yet validated. Call goal_cycle to continue building and independently validating. Do not finish from an implementation claim.";

function data(response: any): any {
  if (response?.error || response?.data === undefined) throw new Error("OpenCode session request failed; outcome unknown. Inspect before resuming.");
  return response.data;
}

function lastCycle(messages: any[]): any {
  for (const message of [...messages].reverse()) {
    for (const part of [...message.parts].reverse()) {
      if (part.type !== "tool" || part.tool !== "goal_cycle") continue;
      if (part.state.status !== "completed") return { status: "blocked", reason: "Previous cycle interrupted; inspect child sessions before resuming." };
      try { return JSON.parse(part.state.output); } catch { return { status: "blocked", reason: "Invalid cycle result." }; }
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
  const childParents = new Map<string, string>();
  const validators = new Map<string, string[]>();
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
      messages,
    };
  }

  async function cycle(_: {}, context: any) {
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
    const unresolved: Record<string, string[]> = {};
    for (const result of priorResults) {
      if (!["failed", "validated"].includes(result.status)) continue;
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
    active.add(id);
    let childID: string | undefined;
    const children: string[] = [];
    activity.set(id, { context, children, tools: new Map(), snapshot: {
      agent: goal.agent, parentID: id,
      cycle: goal.messages.flatMap((m: any) => m.parts).filter((p: any) => p.type === "tool" && p.tool === "goal_cycle" && ["completed", "error"].includes(p.state.status)).length + 1,
      phase: "builder", status: "running", activity: "Starting builder", milestone: "", recent: [],
      phaseStartedAt: Date.now(), updatedAt: Date.now(),
    } });
    const cancel = () => {
      stopped.add(id);
      update(id, { status: "cancelled", activity: "Cancelled; inspect before resuming" }, true);
      if (childID) void client.session.abort({ path: { id: childID } }).catch(() => {});
    };
    context.abort.addEventListener("abort", cancel, { once: true });
    try {
      update(id, {}, true);
      // Exclude the currently running tool when retrieving the prior verdict.
      const previous = lastCycle(goal.messages.map((m: any) => ({ ...m, parts: m.parts.filter((p: any) => !(m.info.id === context.messageID && p.tool === "goal_cycle" && ["pending", "running"].includes(p.state?.status))) })));
      for (const role of ["builder", "validator"] as const) {
        if (context.abort.aborted || stopped.has(id)) throw new Error("Goal cancelled or permission denied.");
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
        if (role === "validator") validators.set(child.id, goal.criteria);
        update(id, { phase: role, status: "running", phaseStartedAt: Date.now(), milestone: "",
          activity: role === "builder" ? "Builder working" : "Independent validator checking criteria" }, true);
        await current.pending;
        if (current.error) throw current.error;
        if (context.abort.aborted || stopped.has(id)) { cancel(); throw new Error("Goal cancelled."); }
        const prompt = role === "builder"
          ? `Pursue the goal below within its exact edit paths. Explore relevant evidence as needed, complete the requested work, and run its verification. Do not change acceptance criteria or the generated definition. Ordinary failures require diagnosis and repair. Report actual changes and any genuine blocker.\nPrevious independent findings:\n${JSON.stringify(previous ?? null)}\nAll unresolved independent findings:\n${JSON.stringify(unresolved)}`
           : `Independently validate the CURRENT project against EVERY criterion below. Obtain fresh evidence; do not trust implementation claims. Do not edit product code or acceptance criteria, including through shell commands. Run the declared checks and required live/user-journey checks. Mark unmet criteria false with actionable findings. Use blocked only for an observed genuine stop condition or external dependency, not ordinary test failures or unfinished implementation. Missing required historical evidence is an evidence blocker, not something repetition can manufacture. Call goal_verdict before finishing with concrete evidence (commands, outcomes and artifact paths) per criterion, using these keys: ${JSON.stringify(Object.fromEntries(goal.criteria.map((c, i) => [`c${i}`, c])))}. Unresolved independent findings: ${JSON.stringify(unresolved)}. For each previously failed criterion now passed, provide resolution identifying new evidence resolving that exact finding or an evidence-backed correction of the earlier finding. Passing unrelated tests is insufficient. You have not been given the builder's conversation.`;
        const model = (role === "builder" ? goal.builderModel : goal.validatorModel) ?? goal.model;
        const result = data(await client.session.prompt({ path: { id: child.id }, body: {
          agent: "general",
          model,
          parts: [{ type: "text", text: `${prompt}\n\nThe following is the goal definition. Its coordinator instructions apply to the parent, not you. Perform only your assigned ${role} phase.\n${goal.text}\n\nROLE BOUNDARY: You are the ${role} child, NOT the coordinator. goal_cycle, publication and delegation are intentionally unavailable to you. Do not attempt orchestration or call their absence a blocker. ${role === "validator" ? "Inspect files and run checks using your own tools, then call goal_verdict. Missing implementation is a failed criterion for the next builder to repair." : "Implement and verify the product using your own tools, then report progress to the coordinator."}\n\nUSER VISIBILITY: Call goal_progress with a concise public milestone at the start, before long operations and after meaningful results. Omit private reasoning, raw commands/output, URLs and credentials. Progress is child-reported activity, never validation evidence; continue doing the actual work.` }],
        } }));
        if (result.info?.error || context.abort.aborted || stopped.has(id)) throw new Error("Child execution interrupted or failed; inspect its session before resuming.");
        // A denied tool may be handled by the model without an assistant error.
        const history = data(await client.session.messages({ path: { id: child.id } }));
        childParents.delete(child.id);
        activity.get(id)!.childID = undefined;
        if (history.some((m: any) => m.info.error || m.parts.some((p: any) => p.type === "tool" && p.state.status === "error" && /PermissionRejectedError|MessageAbortedError|^The user rejected|^User (?:denied|cancelled)|^Operation (?:aborted|cancelled)/i.test(p.state.error)))) {
          throw new Error("Child encountered a denied or interrupted action; explicit user input is required.");
        }
        if (role === "validator") {
          const report = history.flatMap((m: any) => m.parts).findLast((p: any) => p.type === "tool" && p.tool === "goal_verdict" && p.state.status === "completed");
          if (!report) return JSON.stringify({ status: "failed", children, reason: "Validator stopped without a verdict. Repeat the build/validate cycle and obtain criterion evidence." });
          let validation;
          let status;
          try {
            validation = JSON.parse(report.state.output);
            status = verdict(validation, goal.criteria);
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
          if (status === "validated" || status === "failed") {
            for (const key of Object.keys(unresolved)) {
              if (validation.checks[key]?.passed && !validation.checks[key].resolution?.trim()) {
                validation.checks[key] = { passed: false, evidence: unresolved[key][0] };
                status = "failed";
              }
            }
          }
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
      for (const child of children) { childParents.delete(child); validators.delete(child); }
      active.delete(id);
    }
  }

  return {
    tool: {
      goal_cycle: tool({ description: "Run one fresh builder and one fresh independent validator for the selected Goal Agent. Failed validation requires another cycle.", args: {},
        async execute(args, context) {
          const initialGoal = await definition(context.sessionID);
          const executionContext = { ...context, definitionFingerprint: initialGoal?.fingerprint, metadata: context.metadata.bind(context) };
          try {
            const output = await cycle(args, executionContext);
            const result = JSON.parse(output);
            result.definition_sha256 ??= initialGoal?.fingerprint;
            if (initialGoal && goalDefinitionFingerprint(root, initialGoal.agent) !== initialGoal.fingerprint) {
              result.status = "blocked";
              result.reason = "Goal definition changed during execution; restart in a fresh conversation.";
              stopped.add(context.sessionID);
            }
            const current = activity.get(context.sessionID);
            if (!current || current.context !== executionContext) return JSON.stringify(result);
            const status = current.snapshot.status === "cancelled" ? "cancelled" : result.status;
            const message = status === "validated" ? "Independently validated" : status === "failed"
              ? `Validation incomplete; repair cycle required${result.validation?.checks ? ` (${Object.entries(result.validation.checks).filter(([, check]: any) => !check.passed).map(([key]) => key).join(", ")})` : ""}` : status === "cancelled" ? "Cancelled; inspect before resuming"
              : "Blocked; inspect before resuming";
            update(context.sessionID, { status, activity: message }, true);
            await current.pending;
            if (current.error) throw current.error;
            return { output: JSON.stringify(result), title: `Goal: ${message}`, metadata: {
              children: [...current.children], phase: current.snapshot.phase,
              goal_activity: { ...current.snapshot, recent: [...current.snapshot.recent] },
            } };
          } finally {
            if (activity.get(context.sessionID)?.context === executionContext) activity.delete(context.sessionID);
          }
        } }),
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
          const criteria = validators.get(context.sessionID);
          if (!criteria) throw new Error("Only the active independent validator may record a goal verdict.");
          verdict(args, criteria);
          return JSON.stringify(args);
        },
      }),
    },
    "tool.execute.before": async (input: any) => childActivity(input.sessionID, input.callID, input.tool, "running"),
    "tool.execute.after": async (input: any) => childActivity(input.sessionID, input.callID, input.tool, "completed"),
    "chat.message": async (input: any, output: any) => {
      if (output.parts?.some((p: any) => p.type === "text" && p.text !== CONTINUE && !p.synthetic)) stopped.delete(input.sessionID);
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
        update(parent ?? id, { status: "blocked", activity: "Execution interrupted or permission denied" }, true);
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
        if (result && result.status !== "failed") return;
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
