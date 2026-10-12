import { readFileSync, realpathSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parse } from "yaml";
import { tool } from "@opencode-ai/plugin";
import { OpencodeClient } from "@opencode-ai/sdk/v2";
import { activeWorktree, goalAgentPath, goalDefinitionFingerprint, hasGoalAgentFile, readGoalAgentPolicy } from "../tools/publish_goal_agent.ts";
import { RUNTIME, CHECKPOINT, checkpoint, transition, resumeIntent, pauseIntent, recoverableModelError, type Run } from "./goal/state.ts";
import { canonical, captureFiles, initialWorktree } from "./goal/evidence.ts";
import { evaluate, validateVerdict } from "./goal/evaluation.ts";

const CONTINUE = "Continue the admitted Goal in this same worker conversation. Inspect current goal_run status when needed; earlier tool results may be stale. Correct bad tool arguments and retry. Failed experiments, missing implementation, evaluator blockers and apparently impossible outcomes require further diagnosis, exploration or repair, not a self-declared pause. Keep working without time, attempt or stall limits, using existing findings and permitted alternatives. Seek independent feedback when useful and final evaluation when the actual outcome is ready. Preserve user-set resource ceilings and permissions; do not repeat prohibited actions or replay unknown external actions.";
const actionTool = (name: string) => ["write", "edit", "apply_patch", "bash"].includes(name)
  || (/browser_/.test(name) && /click|upload|evaluate|press_key|download|save_media|screenshot/.test(name));
// Native apply_patch emits these only before its write phase. Other failures
// can follow partial effects; an error is not generally a completion receipt.
const noEffectFailure = (name: string, error: string) => /^(?:Error:\s*)?ImmutabilityGuard:/.test(error)
  || (name === "apply_patch" && /^(?:Error:\s*)?(?:apply_patch verification failed:|patch rejected: empty patch$|patchText is required$)/.test(error));
const data = (response: any) => {
  if (response?.error || response?.data === undefined) throw new Error("OpenCode request outcome unknown; inspect before resuming.");
  return response.data;
};

export const Goal = async ({ client, directory, worktree }: any) => {
  const root = activeWorktree(directory, worktree);
  const metadataClient = client._client ? new OpencodeClient({ client: client._client }) : client;
  const locks = new Map<string, Promise<any>>();
  const scheduled = new Set<string>();
  const dispatching = new Set<string>();
  const activeTools = new Set<string>();
  const evaluators = new Map<string, any>();
  const liveEvaluations = new Set<string>();

  async function locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    locks.set(id, next);
    try { return await next; } finally { if (locks.get(id) === next) locks.delete(id); }
  }
  async function session(id: string) { return data(await client.session.get({ path: { id } })); }
  async function save(id: string, change: (run: Run | undefined) => Run | Promise<Run>) {
    return locked(id, async () => {
      const current = await session(id);
      const before = checkpoint(current);
      const next = await change(before);
      if (next.state === "paused" && before?.state !== "paused") {
        next.paused_at = next.updated_at;
        const messages = data(await client.session.messages({ path: { id } }));
        next.paused_after_user = messages.findLast((m: any) => m.info.role === "user"
          && m.parts.some((p: any) => p.type === "text" && !p.synthetic && p.text !== CONTINUE))?.info.id;
      }
      const response = await metadataClient.session.update({ sessionID: id, directory: root,
        metadata: { ...current.metadata, [CHECKPOINT]: next } });
      const stored = data(response);
      if (JSON.stringify(stored.metadata?.[CHECKPOINT]) !== JSON.stringify(next)) throw new Error("Goal checkpoint did not persist; execution must pause.");
      return next;
    });
  }
  async function definition(id: string, historical = false) {
    const current = await session(id);
    if (current.parentID) return;
    const messages = data(await client.session.messages({ path: { id } }));
    const user = messages.findLast((m: any) => m.info.role === "user")?.info;
    const selected = user?.agent ?? current.agent;
    const recorded = checkpoint(current);
    const agent = historical && recorded ? recorded.agent : selected;
    if (!agent || !hasGoalAgentFile(root, agent)) return;
    const text = readFileSync(goalAgentPath(root, agent), "utf8");
    const header = parse(text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "");
    const options = header?.options?.goal;
    if (options?.runtime !== RUNTIME) throw new Error("Retired coordinator Goal definition; explicitly republish for the persistent worker. Historical stops and limits are not reset.");
    if (!Array.isArray(options.criteria) || !options.criteria.length || options.criteria.some((c: any) => typeof c !== "string" || !c.trim())) throw new Error("Goal definition has no fixed acceptance criteria.");
    const model = user?.model;
    const override = options.validator_model;
    if (override !== undefined && (typeof override !== "string" || !/^[^\s/]+\/[^\s]+$/.test(override))) throw new Error("Invalid evaluator model.");
    return { agent, selected, text, model, criteria: options.criteria, policy: readGoalAgentPolicy(root, agent),
      fingerprint: goalDefinitionFingerprint(root, agent), messages,
      contextPaths: [...text.matchAll(/^- Read `([^`]+)`\.$/gm)].map(m => m[1]),
      validatorModel: override ? { providerID: override.slice(0, override.indexOf("/")), modelID: override.slice(override.indexOf("/") + 1) } : undefined };
  }
  async function reconcile(id: string) {
    const current = checkpoint(await session(id));
    if (!current || current.state === "accepted" || current.state === "paused") return current;
    const unknownAction = Object.values(current.pending_actions ?? {}).some((action: any) => !activeTools.has(`${id}:${action.callID}`));
    const continuation = current.continuation && !dispatching.has(id);
    if (unknownAction || (current.state === "evaluating" && !liveEvaluations.has(id)) || continuation) {
      return save(id, async (run: Run | undefined) => {
        if (!run || run.state === "paused" || run.state === "accepted") return run!;
        // Recheck live ownership under the session lock, not a stale get response.
        const unknown = Object.values(run.pending_actions ?? {}).some((action: any) => !activeTools.has(`${id}:${action.callID}`))
          || (run.state === "evaluating" && !liveEvaluations.has(id));
        if (unknown) return transition(run, { type: "pause", reason: "Interrupted action or evaluation outcome unknown. Inspect actual receipts and child evidence before explicit reconciled resumption." }, Date.now());
        if (run.continuation && !dispatching.has(id)) {
          const messages = data(await client.session.messages({ path: { id } }));
          if (!messages.some((m: any) => m.info.id === run.continuation!.messageID)) return transition(run, { type: "pause", reason: "Continuation dispatch outcome unknown; inspect history before explicit resumption." }, Date.now());
          return { ...run, continuation: undefined, updated_at: Date.now() };
        }
        return run;
      });
    }
    return current;
  }
  async function markEvaluator(childID: string, parentID: string, fingerprint: string) {
    const child = await session(childID);
    if (child.parentID !== parentID) throw new Error("Unexpected evaluator ancestry; inspect before resuming.");
    const marker = { parentID, definition_sha256: fingerprint };
    const old = child.metadata?.cuddly_winner_evaluator;
    if (old && (old.parentID !== parentID || old.definition_sha256 !== fingerprint)) throw new Error("Evaluator identity conflicts with this Goal; inspect original records.");
    if (old) return;
    const stored = data(await metadataClient.session.update({ sessionID: childID, directory: root,
      metadata: { ...child.metadata, cuddly_winner_evaluator: marker } }));
    if (JSON.stringify(stored.metadata?.cuddly_winner_evaluator) !== JSON.stringify(marker)) throw new Error("Evaluator role did not persist; no evaluation may start.");
  }
  async function childrenIdle(id: string, fingerprint: string) {
    const children = data(await client.session.children({ path: { id }, signal: AbortSignal.timeout(10000) }));
    const statuses = data(await client.session.status({ signal: AbortSignal.timeout(10000) }));
    const idle = children.every((child: any) => child.parentID === id && !["busy", "retry"].includes(statuses[child.id]?.type)
      && (!statuses[child.id] || statuses[child.id].type === "idle"));
    // Recover the read-only role even for an orphan from an uncertain create.
    if (idle) for (const child of children) await markEvaluator(child.id, id, fingerprint);
    return idle;
  }
  async function inspect(id: string, includeBaseline = false) {
    try {
      const goal = await definition(id, true);
      const run = await reconcile(id);
      let acceptanceCurrent;
      if (run?.state === "accepted" && run.accepted_candidate) acceptanceCurrent = JSON.stringify(await captureFiles(root, Object.keys(run.accepted_candidate))) === JSON.stringify(run.accepted_candidate);
      return { runtime_contract: RUNTIME, state: run?.state ?? "not_started", goal_agent: run?.agent ?? goal?.agent,
        selected_agent: goal?.selected, definition_matches: !run || goal?.fingerprint === run.definition_sha256,
        reason: run?.reason, feedback: run?.feedback, validation: run?.validation, findings: run?.findings,
        evaluation: run?.evaluation ? { mode: run.evaluation.mode, childID: run.evaluation.childID } : undefined,
        pending_actions: run?.pending_actions, acceptance_current: acceptanceCurrent,
        ...(includeBaseline && run ? { initial_worktree: run.initial_worktree } : {}),
        completion_target: run?.completion_target, authorized_actions: run?.authorized_actions };
    } catch (error) { return { runtime_contract: RUNTIME, state: "unknown", reason: error instanceof Error ? error.message : String(error) }; }
  }
  async function inspectPredecessor(id: string, predecessorID: string) {
    try {
      const caller = await session(id);
      const current = checkpoint(caller);
      const goal = current ? undefined : await definition(id);
      const agent = current?.agent ?? (goal?.selected === goal?.agent ? goal?.agent : undefined);
      const fingerprint = current?.definition_sha256 ?? goal?.fingerprint;
      if (!agent || caller.parentID || id === predecessorID) throw new Error("Not a root predecessor inspection");
      const previous = data(await client.session.get({ path: { id: predecessorID }, signal: AbortSignal.timeout(10000) }));
      const run = checkpoint(previous);
      if (!run || previous.id !== predecessorID || previous.parentID || run.agent !== agent
          || typeof caller.projectID !== "string" || previous.projectID !== caller.projectID
          || typeof previous.directory !== "string" || realpathSync(previous.directory) !== realpathSync(root)) {
        throw new Error("Predecessor must belong to the same task and worktree");
      }
      const children = data(await client.session.children({ path: { id: predecessorID }, signal: AbortSignal.timeout(10000) }));
      const statuses = data(await client.session.status({ signal: AbortSignal.timeout(10000) }));
      if (!Array.isArray(children) || !statuses || typeof statuses !== "object" || Array.isArray(statuses)
          || children.some((child: any) => child.parentID !== predecessorID)) throw new Error("Invalid session status response");
      // The native status map omits idle sessions. Only a successful status read
      // permits treating an absent entry as idle; timestamps are never evidence.
      const activity = statuses[predecessorID]?.type ?? "idle";
      if (!["idle", "busy", "retry"].includes(activity)) throw new Error("Unknown predecessor activity");
      const readOnly = children.filter((child: any) => {
        const marker = child.metadata?.cuddly_winner_evaluator;
        return marker?.parentID === predecessorID && marker.definition_sha256 === run.definition_sha256
          && !child.metadata?.[CHECKPOINT];
      });
      const pending = Object.keys(run.pending_actions ?? {}).length;
      return { runtime_contract: RUNTIME, predecessor: {
        session_id: predecessorID, state: run.state, runtime_status: activity,
        definition_matches: run.definition_sha256 === fingerprint,
        pending_action_count: pending, evaluation_pending: !!run.evaluation,
        continuation_pending: !!run.continuation, read_only_evaluator_count: readOnly.length,
        unverified_child_count: children.length - readOnly.length,
        can_continue: activity === "idle" && ["paused", "accepted"].includes(run.state)
          && pending === 0 && !run.evaluation && !run.continuation && children.length === readOnly.length,
      } };
    } catch {
      // Never expose another conversation's content, credentials, baseline or
      // transport error body, and never reconcile/mutate another session.
      return { runtime_contract: RUNTIME, predecessor: { session_id: predecessorID,
        state: "unknown", can_continue: false, reason: "Predecessor status unavailable or outside the same task/worktree; no continuation established." } };
    }
  }
  async function pause(id: string, reason: string, observed = false) {
    const current = checkpoint(await session(id));
    if (!current || current.state === "accepted") return;
    if (current.state === "paused") {
      if (observed) await save(id, run => run!.reason?.startsWith("Observed permission denial") ? run!
        : { ...run!, reason, updated_at: Date.now() });
      return;
    }
    await save(id, run => {
      if (run!.state === "paused" && observed && !run!.reason?.startsWith("Observed permission denial")) return { ...run!, reason, updated_at: Date.now() };
      return transition(run!, { type: "pause", reason }, Date.now());
    });
    if (current.evaluation?.childID) await client.session.abort({ path: { id: current.evaluation.childID } }).catch(() => {});
  }
  async function completedAction(id: string, callID: string) {
    const key = `${id}:${callID}`;
    if (!activeTools.has(key)) return;
    try { await save(id, run => {
      const pending = { ...run!.pending_actions }; delete pending[callID];
      return { ...run!, pending_actions: pending, updated_at: Date.now() };
    }); } finally { activeTools.delete(key); }
  }

  return {
    tool: {
      goal_run: tool({ description: "Start a persistent Goal once before mutation; inspect, honor an explicit user pause, or explicitly resume its recorded state. Model-declared blockers do not pause a working run: correct tool mistakes and keep exploring permitted work. Inspect with predecessor_session_id before or after start for read-only native status of a prior root of the same task/worktree; baseline content is always excluded. Partial work and failed experiments continue in the same worker without attempt quotas.", args: {
        operation: tool.schema.enum(["start", "inspect", "pause", "resume"]),
        completion_target: tool.schema.string().min(1).max(4000).optional(),
        authorized_actions: tool.schema.string().min(1).max(4000).optional(),
        reason: tool.schema.string().min(1).max(4000).optional(),
        reconciled: tool.schema.boolean().optional(),
        include_baseline: tool.schema.boolean().optional(),
        predecessor_session_id: tool.schema.string().min(1).optional(),
      }, async execute(args, context) {
        const id = context.sessionID;
        if (args.predecessor_session_id !== undefined) {
          if (args.operation !== "inspect") {
            const run = checkpoint(await session(id));
            throw new Error(`State: ${run?.state ?? "not_started"}. Predecessor inspection is inspect-only. Next: retry operation="inspect" with predecessor_session_id; start/resume control only your current session.`);
          }
          return JSON.stringify(await inspectPredecessor(id, args.predecessor_session_id));
        }
        if (args.operation === "inspect") return JSON.stringify(await inspect(id, args.include_baseline === true));
        const goal = await definition(id);
        if (!goal || goal.selected !== goal.agent) throw new Error("Select the root persistent Goal before starting or resuming work.");
        let run = await reconcile(id);
        if (run && run.definition_sha256 !== goal.fingerprint) throw new Error("Goal definition changed; republish explicitly and use a fresh loaded conversation. Prior acceptance is not applicable.");
        if (run?.state === "accepted") return JSON.stringify(await inspect(id));
        if (args.operation === "pause") {
          if (!run) throw new Error('State: not_started. No admitted Goal to pause. Next: call goal_run(operation="start", completion_target=..., authorized_actions=...) before mutation; no resume confirmation is needed.');
          if (run.state !== "paused" && !pauseIntent(goal.messages, CONTINUE, run.resumed_after_user)) return JSON.stringify({
            runtime_contract: RUNTIME, state: run.state, pause_applied: false,
            reason: "No explicit user stop or runtime-observed boundary established a pause. Correct recoverable errors, inspect current status and continue permitted work; model-declared blockers or impossible outcomes are not stopping conditions.",
            next_action: run.state === "evaluating" ? "Wait for the current evaluation; its findings return to this worker." : "Correct the failed call or experiment and continue the existing authorized work; nothing needs resuming.",
          });
          await pause(id, args.reason?.trim() || "User requested a pause; explicit resumption required.");
          return JSON.stringify(await inspect(id));
        }
        if (args.operation === "resume") {
          if (!run) throw new Error('State: not_started. Nothing needs resuming. Next: call goal_run(operation="start", completion_target=..., authorized_actions=...) once before mutation.');
          if (run.state === "working") throw new Error("State: working. Nothing needs resuming. Next: correct the prior call or experiment and continue permitted work in this worker.");
          if (run.state === "evaluating") throw new Error("State: evaluating. An independent evaluation is active. Next: wait for its result, then use its findings; do not resume or overlap it.");
          if (!args.reconciled || !resumeIntent(run, goal.messages, CONTINUE).confirmed) throw new Error('State: paused. Explicit user resumption and reconciled action outcomes are required; a status question does not resume work. Next: inspect receipts and obtain a fresh real user resume request or native Resume Goal answer, then call resume with reconciled=true.');
          if (!(await childrenIdle(id, run.definition_sha256))) throw new Error("Previous evaluator is active or its activity is unknown; establish inactivity first.");
          const human = goal.messages.findLast((m: any) => m.info.role === "user" && m.parts.some((p: any) => p.type === "text" && !p.synthetic && p.text !== CONTINUE));
          run = await save(id, current => ({ ...transition(current!, { type: "resume" }, Date.now()), resumed_after_user: human?.info.id }));
          return JSON.stringify({ runtime_contract: RUNTIME, state: run.state });
        }
        if (args.operation !== "start") throw new Error("Unknown Goal operation.");
        if (run) return JSON.stringify(await inspect(id));
        if (![args.completion_target, args.authorized_actions].every(v => typeof v === "string" && v.trim() && v.length <= 4000)) throw new Error("Start requires the actual completion target and existing authorized actions. This interpretation grants no new permissions.");
        if (goal.messages.some((m: any) => m.parts.some((p: any) => p.tool === "goal_cycle"))) throw new Error("Historical coordinator run detected; explicit republication/new conversation is required, without resetting historical task limits.");
        const baseline = await initialWorktree(root, [...goal.policy.edit_paths, ...goal.contextPaths]);
        run = await save(id, existing => {
          if (existing) throw new Error("Goal already started; inspect its existing admission.");
          return { runtime_contract: RUNTIME, agent: goal.agent, definition_sha256: goal.fingerprint, state: "working",
            completion_target: args.completion_target!, authorized_actions: args.authorized_actions!, initial_worktree: baseline,
            findings: {}, pending_actions: {}, updated_at: Date.now() };
        });
        return JSON.stringify({ runtime_contract: RUNTIME, state: run.state, worktree: root, completion_target: run.completion_target, authorized_actions: run.authorized_actions });
      } }),
      goal_evaluate: tool({ description: "Obtain fresh independent feedback on a concrete candidate or final acceptance of the entire Goal. Failed feedback returns to this same worker; no builder handoff or cycle limit.", args: {
        mode: tool.schema.enum(["feedback", "final"]),
        focus: tool.schema.string().min(1).max(4000).optional(),
        artifacts: tool.schema.array(tool.schema.string().min(1)).min(1).max(256).describe("Paths only: exact canonical worktree-relative files, e.g. worker.js. Do not append descriptions, hashes or judgments to filenames. Put evaluation questions in focus; supply actual inspectable files, not directories."),
      }, async execute(args, context) {
        const id = context.sessionID;
        const goal = await definition(id);
        if (!goal) throw new Error("Only the selected root Goal may request evaluation.");
        const run = await reconcile(id);
        if (!run) throw new Error('State: not_started. Start the matching Goal before evaluation. Next: call goal_run(operation="start", completion_target=..., authorized_actions=...) before mutation, implement the candidate, then evaluate.');
        if (run.definition_sha256 !== goal.fingerprint) throw new Error(`State: ${run.state}. Evaluation requires the matching Goal definition; this definition changed. Next: explicitly republish and use a fresh loaded conversation; repeating start cannot replace existing authority.`);
        if (run.state === "accepted") return JSON.stringify(await inspect(id));
        if (run.state !== "working" || Object.keys(run.pending_actions ?? {}).length || liveEvaluations.has(id)) throw new Error(`State: ${run.state}. Finish active task actions/evaluation before requesting a stable candidate check. Next: inspect current goal_run status; wait for owned actions/evaluation, or reconcile receipts and explicitly resume if paused. Do not replay uncertain effects.`);
        if (!["feedback", "final"].includes(args.mode) || !Array.isArray(args.artifacts) || !args.artifacts.length
          || args.artifacts.length > 256 || args.artifacts.some(p => !canonical(p)) || (args.mode === "feedback" && !args.focus?.trim())) throw new Error("State: working. Supply canonical candidate artifact paths and an explicit feedback focus, or request final evaluation. Next: correct these arguments and retry; no evaluator was dispatched and nothing needs resuming.");
        if (!goal.model?.providerID || !goal.model?.modelID) throw new Error("Independent evaluation requires the selected worker model.");
        // Reserve the evaluation before any asynchronous snapshot work. Concurrent
        // requests must neither overlap nor pause an existing evaluation.
        if (liveEvaluations.has(id)) throw new Error("An independent evaluation is already active.");
        liveEvaluations.add(id);
        let started = false;
        let dispatched = false;
        try {
          await save(id, current => transition(current!, { type: "evaluate", evaluation: { ...args, candidate: {} } }, Date.now()));
          started = true;
          // Final checks include baseline inputs/user work, without demanding a
          // builder-created checksum manifest. Root mutation is already frozen.
          const preserved = args.mode === "final" ? Object.entries(run.initial_worktree.files)
            .filter(([, value]: any) => value.state === "present").map(([file]) => file) : [];
          const candidate = await captureFiles(root, [...goal.policy.edit_paths, ...args.artifacts, ...preserved]);
          const unavailable = Object.keys(candidate).filter(file => candidate[file].state === "unavailable");
          if (unavailable.length) throw new Error(`Candidate evidence unavailable at ${JSON.stringify(unavailable)}. Next: inspect these paths and supply individual inspectable files within authority; directory/symlink references cannot establish acceptance. Missing files remain explicit absence, not fabricated evidence.`);
          const assigned = await save(id, current => {
            if (current!.state !== "evaluating") throw new Error("Evaluation paused during snapshot capture.");
            return { ...current!, evaluation: { ...current!.evaluation!, candidate }, updated_at: Date.now() };
          });
          dispatched = true;
          return JSON.stringify(await evaluate({ client, root, goal, run: assigned, context,
            markEvaluator: (child: string) => markEvaluator(child, id, goal.fingerprint),
            save: (change: any) => save(id, current => {
              if (goalDefinitionFingerprint(root, goal.agent) !== current!.definition_sha256) throw new Error("Definition changed during evaluation; prior verdict cannot accept it.");
              return change(current);
            }), register: (child: string, assignment: any) => evaluators.set(child, assignment), unregister: (child: string) => evaluators.delete(child) }));
        } catch (error) {
          if (!started) throw error; // A rejected transition did not start work.
          if (!dispatched) {
            const recovered = await save(id, current => current!.state === "evaluating"
              ? { ...current!, state: "working", evaluation: undefined, updated_at: Date.now() } : current!);
            throw new Error(`State: ${recovered.state}. ${error instanceof Error ? error.message : String(error)} No evaluator was dispatched; inspect current status and correct the candidate references.`);
          }
          await pause(id, error instanceof Error ? error.message : String(error));
          return JSON.stringify(await inspect(id));
        } finally { liveEvaluations.delete(id); }
      } }),
      goal_verdict: tool({ description: "Record independent evidence for the assigned criteria. Only the active evaluator can call this. Correct missing fields here rather than restarting implementation.", args: {
        status: tool.schema.enum(["checked", "blocked"]), reason: tool.schema.string(),
        checks: tool.schema.record(tool.schema.string(), tool.schema.object({ passed: tool.schema.boolean(), evidence: tool.schema.string().min(1), resolution: tool.schema.string().min(1).optional() })),
      }, async execute(args, context) {
        const assignment = evaluators.get(context.sessionID);
        if (!assignment) throw new Error("Only the active independent evaluator may record a verdict.");
        const run = checkpoint(await session(assignment.parentID));
        if (run?.state !== "evaluating" || run.evaluation?.childID !== context.sessionID) throw new Error("Evaluation is paused or no longer active.");
        return JSON.stringify(validateVerdict(args, assignment.criteria, assignment.findings));
      } }),
    },
    "tool.execute.before": async (input: any, output: any) => {
      if (input.tool === "question" && output?.args?.questions?.some((q: any) => q.header === "Resume Goal")) {
        const goal = await definition(input.sessionID);
        if (goal) {
          const run = await reconcile(input.sessionID);
          if (run?.state !== "paused") throw new Error(`Goal is ${run?.state ?? "not_started"}; no Resume Goal confirmation is needed. Inspect current status, start if unadmitted, otherwise correct the error and continue permitted work.`);
        }
      }
      if (!actionTool(input.tool)) return;
      const goal = await definition(input.sessionID);
      if (!goal) return; // Native sessions and evaluators use their own permissions/guard.
      await reconcile(input.sessionID);
      const key = `${input.sessionID}:${input.callID}`;
      activeTools.add(key);
      try { await save(input.sessionID, run => {
        if (!run || run.state !== "working" || run.definition_sha256 !== goal.fingerprint) throw new Error(`Goal mutation requires its matching working checkpoint (${run?.state ?? "not started"}${run?.reason ? `: ${run.reason}` : ""}); inspect before resuming.`);
        return { ...run, pending_actions: { ...run.pending_actions, [input.callID]: { tool: input.tool, callID: input.callID } }, updated_at: Date.now() };
      }); } catch (error) { activeTools.delete(key); throw error; }
    },
    "tool.execute.after": async (input: any) => {
      await completedAction(input.sessionID, input.callID);
    },
    "chat.message": async (input: any) => {
      const run = checkpoint(await session(input.sessionID));
      if (run?.continuation?.messageID && run.continuation.messageID === input.messageID) await save(input.sessionID, current => ({ ...current!, continuation: undefined, updated_at: Date.now() }));
    },
    "experimental.session.compacting": async (input: any, output: any) => {
      const run = checkpoint(await session(input.sessionID));
      const goal = await definition(input.sessionID);
      if (run && goal?.selected === run.agent) output.context.push(`Persistent Goal checkpoint remains authoritative in session metadata. State=${run.state}; definition=${run.definition_sha256}. Preserve unresolved findings, important experiment results and uncertainty. Inspect with goal_run; do not infer acceptance from summaries or reset authority. Current findings: ${JSON.stringify(run.findings)}; latest feedback: ${JSON.stringify(run.feedback ?? null)}.`);
    },
    "experimental.compaction.autocontinue": async (input: any, output: any) => {
      const run = checkpoint(await session(input.sessionID));
      const selected = input.agent ?? (await definition(input.sessionID))?.selected;
      if (run && selected === run.agent) {
        // Working continuation has one owner. For a paused Goal, native core may
        // finish processing a fresh human request/answer, but cannot resume work.
        const goal = await definition(input.sessionID);
        if (run.state === "working" || run.state === "evaluating"
          || (run.state === "paused" && !resumeIntent(run, goal!.messages, CONTINUE).fresh)) output.enabled = false;
      }
    },
    event: async ({ event }: any) => {
      const part = event.properties?.part;
      const id = event.properties?.sessionID ?? part?.sessionID;
      if (!id) return;
      if (event.type === "message.part.updated" && part?.type === "tool" && part.state?.status === "error") {
        const key = `${id}:${part.callID}`;
        if (activeTools.has(key)) {
          const action = checkpoint(await session(id))?.pending_actions?.[part.callID];
          if (action?.tool === part.tool && noEffectFailure(part.tool, String(part.state.error))) await completedAction(id, part.callID);
          else { activeTools.delete(key); await reconcile(id); }
        }
        return;
      }
      if (event.type === "session.error" || (event.type === "permission.replied" && event.properties.reply === "reject")) {
        const child = evaluators.get(id);
        const denied = event.type === "permission.replied" || event.properties.error?.name === "PermissionRejectedError";
        const cancelled = event.properties.error?.name === "MessageAbortedError";
        const parentID = child?.parentID ?? (await session(id)).parentID ?? id;
        const run = checkpoint(await session(parentID));
        if (!denied && !cancelled && recoverableModelError(event.properties.error)
          && run && !Object.keys(run.pending_actions ?? {}).length && !run.continuation
          && (child || run.state === "working")) return;
        await pause(parentID, denied ? "Observed permission denial; explicit user resumption required."
          : cancelled ? "Observed cancellation; inspect action outcomes before explicit resumption."
            : "Observed session failure; inspect unknown action outcomes before explicit resumption.", denied || (cancelled && parentID === id));
        return;
      }
      if (event.type !== "session.idle" || scheduled.has(id)) return;
      scheduled.add(id);
      try {
        const goal = await definition(id);
        if (!goal) return;
        const run = await reconcile(id);
        if (!run || run.state !== "working" || run.definition_sha256 !== goal.fingerprint) return;
        if (pauseIntent(goal.messages, CONTINUE, run.resumed_after_user)) { await pause(id, "User requested a stop; explicit resumption required."); return; }
        const last = goal.messages.at(-1);
        if (last?.info.role !== "assistant" || (!last.info.finish && !last.info.error)) return;
        if (last.info.error && !recoverableModelError(last.info.error)) return;
        if (run.continuation) {
          const exists = goal.messages.some((m: any) => m.info.id === run.continuation!.messageID);
          if (!exists) { await pause(id, "Continuation dispatch outcome unknown; inspect history before explicit resumption."); return; }
          await save(id, current => ({ ...current!, continuation: undefined, updated_at: Date.now() }));
        }
        await new Promise(resolve => setTimeout(resolve, last.info.error ? 1000 : 0));
        const statuses = data(await client.session.status({ signal: AbortSignal.timeout(10000) }));
        if (statuses[id] && statuses[id].type !== "idle") return;
        const messageID = `msg_${Date.now().toString(16)}${randomBytes(9).toString("hex")}`;
        dispatching.add(id);
        await save(id, current => {
          if (current!.state !== "working") throw new Error("Run stopped before continuation.");
          return { ...current!, continuation: { messageID, after: last.info.id }, updated_at: Date.now() };
        });
        const selected = await definition(id);
        if (!selected || selected.agent !== goal.agent || checkpoint(await session(id))?.state !== "working") return;
        const response = await client.session.promptAsync({ path: { id }, body: {
          messageID, agent: goal.agent, model: goal.model, parts: [{ type: "text", text: CONTINUE, synthetic: true }],
        } });
        if (response.error) throw new Error("Continuation submission outcome unknown.");
      } catch (error) {
        await pause(id, error instanceof Error ? error.message : String(error)).catch(() => {});
      } finally { dispatching.delete(id); scheduled.delete(id); }
    },
  };
};
