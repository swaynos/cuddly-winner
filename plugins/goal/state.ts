export const RUNTIME = "persistent-worker-v1";
export const CHECKPOINT = "cuddly_winner_goal";
export type Run = {
  runtime_contract: typeof RUNTIME;
  agent: string;
  definition_sha256: string;
  state: "working" | "evaluating" | "paused" | "accepted";
  completion_target: string;
  authorized_actions: string;
  initial_worktree: any;
  updated_at: number;
  reason?: string;
  paused_after_user?: string;
  resumed_after_user?: string;
  paused_at?: number;
  findings: Record<string, string[]>;
  pending_actions?: Record<string, { tool: string; callID: string }>;
  continuation?: { messageID: string; after: string };
  evaluation?: { mode: "feedback" | "final"; focus?: string; childID?: string; artifacts: string[]; candidate: any };
  feedback?: any;
  validation?: any;
  accepted_candidate?: any;
};

export function checkpoint(session: any): Run | undefined {
  const value = session.metadata?.[CHECKPOINT];
  if (value === undefined) return;
  const record = (input: any) => input && typeof input === "object" && !Array.isArray(input);
  if (!record(value) || value.runtime_contract !== RUNTIME || typeof value.agent !== "string"
    || !/^[a-f0-9]{64}$/.test(value.definition_sha256)
    || !["working", "evaluating", "paused", "accepted"].includes(value.state)
    || typeof value.completion_target !== "string" || !value.completion_target.trim()
    || typeof value.authorized_actions !== "string" || !value.authorized_actions.trim()
    || !record(value.initial_worktree?.files) || !record(value.findings)
    || (value.pending_actions !== undefined && !record(value.pending_actions)) || !Number.isFinite(value.updated_at)) {
    throw new Error("Invalid Goal checkpoint; inspect original evidence. Never reset authority or counters to recover.");
  }
  return value;
}

export function transition(run: Run, event: { type: "pause"; reason: string } | { type: "resume" }
  | { type: "evaluate"; evaluation: NonNullable<Run["evaluation"]> }
  | { type: "result"; verdict: any }, now = run.updated_at): Run {
  if (run.state === "accepted") return run;
  const next = { ...run, updated_at: now };
  if (event.type === "pause") return run.state === "paused" ? run
    : { ...next, state: "paused", reason: event.reason, continuation: undefined };
  if (event.type === "resume") {
    if (run.state !== "paused") throw new Error("Only a paused run needs resumption.");
    return { ...next, state: "working", reason: undefined, resumed_after_user: run.paused_after_user,
      paused_after_user: undefined, paused_at: undefined, evaluation: undefined, pending_actions: {}, continuation: undefined };
  }
  if (event.type === "evaluate") {
    if (run.state !== "working" || Object.keys(run.pending_actions ?? {}).length) throw new Error("Finish active task actions before evaluating a stable candidate.");
    return { ...next, state: "evaluating", evaluation: event.evaluation, continuation: undefined };
  }
  if (run.state !== "evaluating" || !run.evaluation) throw new Error("Evaluation is no longer active; its report cannot establish acceptance.");
  // A model's inability to proceed is feedback, not a control-plane stop.
  // Cancellation, denial and uncertain effects are paused by runtime evidence.
  if (event.verdict.status === "blocked") return { ...next, state: "working", reason: undefined, evaluation: undefined,
    ...(run.evaluation.mode === "final" ? { validation: event.verdict } : { feedback: event.verdict }) };
  const final = run.evaluation.mode === "final";
  const passed = Object.values(event.verdict.checks).every((check: any) => check.passed);
  const findings = { ...run.findings };
  if (final) for (const [key, check] of Object.entries(event.verdict.checks) as any) {
    if (check.passed) delete findings[key];
    else findings[key] = [...new Set([...(findings[key] ?? []), check.evidence])];
  }
  return { ...next, state: final && passed ? "accepted" : "working", findings, reason: undefined,
    ...(final ? { validation: event.verdict } : { feedback: event.verdict }),
    ...(final && passed ? { accepted_candidate: run.evaluation.candidate } : {}), evaluation: undefined };
}

export function pauseIntent(messages: any[], continuationText: string, consumedUserID?: string) {
  const human = messages.findLast((m: any) => m.info.role === "user" && m.parts.some((p: any) =>
    p.type === "text" && !p.synthetic && p.text !== continuationText));
  const text = human?.parts.filter((p: any) => p.type === "text" && !p.synthetic).map((p: any) => p.text).join(" ") ?? "";
  if (human?.info.id === consumedUserID) return false;
  return text.split(/[.!;\n]+/).some((sentence: string) => !/\?|\b(?:do not|don't|never|not)\b/i.test(sentence)
    && /^\s*(?:please\s+|I\s+(?:want|need)\s+you\s+to\s+)?(?:pause|stop|cancel)(?:(?:\s+(?:the|this|my))?\s+(?:goal|run|worker|work|task|execution)\b|\s*$)/i.test(sentence));
}

export function recoverableModelError(error: any) {
  if (["ContextOverflowError", "StructuredOutputError"].includes(error?.name)) return true;
  const code = error?.data?.statusCode;
  return error?.name === "APIError" && Number.isInteger(code) && code >= 400 && code < 600
    && ![401, 403].includes(code);
}

// Resume is a human-control boundary, not an interpretation of compaction prose.
// Native Question replies are tool receipts and do not create a new user message.
export function resumeIntent(run: Run, messages: any[], continuationText: string) {
  const human = messages.findLast((m: any) => m.info.role === "user" && m.parts.some((p: any) =>
    p.type === "text" && !p.synthetic && p.text !== continuationText));
  const text = human?.parts.filter((p: any) => p.type === "text" && !p.synthetic).map((p: any) => p.text).join(" ") ?? "";
  const fresh = !!human && human.info.id !== run.paused_after_user;
  const affirmative = fresh && /\b(resume|continue|authorize)\b/i.test(text)
    && !/\?|\b(what|why|when|whether|can|could|should)\b/i.test(text)
    && !/\b(?:do not|don't|never|cannot|can't|will not|won't|not)\b[^.!?;\n]*\b(?:resume|continue|authoriz\w*|resum\w*|continu\w*)\b/i.test(text)
    && !/\b(?:resume|continue)\b[^.!?;\n]*\b(?:not authorized|not allowed|forbidden)\b/i.test(text);
  const receipt = messages.flatMap(m => m.parts).findLast((p: any) => p.type === "tool" && p.tool === "question"
    && p.state?.status === "completed" && Number.isFinite(p.state.time?.end)
    && p.state.time.end > (run.paused_at ?? run.updated_at)
    && p.state.input?.questions?.some((q: any) => q.header === "Resume Goal"));
  if (receipt && (!Number.isFinite(human?.info.time?.created) || receipt.state.time.end >= human.info.time.created)) {
    const questions = receipt.state.input.questions;
    const indexes = questions.map((q: any, index: number) => q.header === "Resume Goal" ? index : -1).filter((index: number) => index >= 0);
    const index = indexes[0];
    const answers = receipt.state.metadata?.answers?.[index];
    return { fresh: true, confirmed: indexes.length === 1
      && questions[index].options?.some((o: any) => o.label === "Resume Goal")
      && Array.isArray(answers) && answers.length === 1 && answers[0] === "Resume Goal" };
  }
  return { fresh, confirmed: affirmative };
}
