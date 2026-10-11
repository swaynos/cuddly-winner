import { checkpoint, transition, type Run } from "./state.ts";
import { captureFiles } from "./evidence.ts";

export function validateVerdict(value: any, criteria: string[], findings: Record<string, string[]>) {
  if (!value || !["checked", "blocked"].includes(value.status)) throw new Error("Record a structured checked or blocked verdict.");
  if (value.status === "blocked") {
    if (typeof value.reason !== "string" || !value.reason.trim()) throw new Error("A blocker requires an observed concrete reason.");
    return value;
  }
  const keys = criteria.map((_, i) => `c${i}`);
  for (const key of keys) {
    const check = value.checks?.[key];
    if (typeof check?.passed !== "boolean" || typeof check.evidence !== "string" || !check.evidence.trim()) throw new Error(`Missing independent evidence for ${key}; correct the report in this evaluator.`);
    if (check.passed && findings[key]?.length && !check.resolution?.trim()) throw new Error(`Resolution required for previously failed ${key}; provide new resolving evidence, not unrelated passing checks.`);
  }
  if (Object.keys(value.checks).some(key => !keys.includes(key))) throw new Error("Unexpected criterion keys; evaluate only the assigned criteria.");
  return value;
}

const evidenceTool = (name: string) => ["read", "glob", "grep", "list", "bash", "webfetch", "websearch", "lsp"].includes(name)
  || name.startsWith("cuddly-winner-browser_browser_");

export async function evaluate({ client, root, goal, run, context, save, markEvaluator, register, unregister }: any) {
  const assignment = run.evaluation;
  const criteria = assignment.mode === "final" ? goal.criteria : [assignment.focus];
  const findings = assignment.mode === "final" ? run.findings : {};
  let childID: string | undefined;
  const cancel = () => {
    if (childID) void client.session.abort({ path: { id: childID } }).catch(() => {});
  };
  context.abort.addEventListener("abort", cancel, { once: true });
  try {
    const response = await client.session.create({ body: { parentID: context.sessionID,
      title: `Goal evaluator: ${goal.agent} (${assignment.mode})`, permission: [
        { permission: "*", pattern: "*", action: "deny" },
        ...["read", "glob", "grep", "list", "webfetch", "websearch", "lsp"].map(permission => ({ permission, pattern: "*", action: "allow" })),
        ...["status", "snapshot", "markdown", "links", "interactive_elements", "count", "search", "get_attribute", "extract", "console_messages", "navigate", "scroll", "wait_for", "wait_for_text"]
          .map(name => ({ permission: `cuddly-winner-browser_browser_${name}`, pattern: "*", action: "allow" })),
        { permission: "bash", pattern: "*", action: goal.policy.bash ? "ask" : "deny" },
        { permission: "goal_verdict", pattern: "*", action: "allow" },
      ] } });
    if (response.error || !response.data?.id) throw new Error("Evaluator creation outcome unknown; inspect children before resuming.");
    childID = response.data.id;
    await save((current: Run) => {
      if (current.state !== "evaluating") throw new Error("Evaluation paused before dispatch.");
      return { ...current, evaluation: { ...current.evaluation!, childID }, updated_at: Date.now() };
    });
    await markEvaluator(childID);
    register(childID, { criteria, findings, parentID: context.sessionID });
    let correction = "";
    // Protocol correction stays in evaluation; it never spends another builder attempt.
    for (let attempt = 0; attempt < 3; attempt++) {
      const prompt = attempt === 0 ? `INDEPENDENT EVALUATOR mode=${assignment.mode}\nYou independently evaluate the actual candidate, not the worker's claims. Do not edit product or task records, submit new jobs, or delegate. Approved shell checks must not mutate product. Inspect existing live outputs/receipts instead of replaying actions. Ordinary failed criteria are actionable feedback, not blockers. Call goal_verdict before returning; correct rejected fields in this session. A feedback pass does not accept the complete Goal. Use keys c0 through c${criteria.length - 1}.\nCRITERIA: ${JSON.stringify(criteria)}\nARTIFACTS: ${JSON.stringify(assignment.artifacts)}\nCANDIDATE HASHES: ${JSON.stringify(assignment.candidate)}\nUNRESOLVED FINAL FINDINGS: ${JSON.stringify(findings)}\nINITIAL WORKTREE: ${JSON.stringify(run.initial_worktree)}\nPreserve pre-existing user work; untracked does not imply new task work. Missing provenance cannot be invented. Synthetic checks do not prove live quality. Read the relevant task instructions and verification below; no worker conversation has been supplied.\n${goal.text.replace(/^---\n[\s\S]*?\n---\n/, "")}`
        : `Evaluation report correction: ${correction}\nContinue this independent evaluation and call goal_verdict. Do not change implementation or repeat external actions.`;
      if (context.abort.aborted) throw new Error("Evaluation cancelled; inspect outcomes before explicit resumption.");
      const parent = await client.session.get({ path: { id: context.sessionID } });
      const active = !parent.error && parent.data ? checkpoint(parent.data) : undefined;
      if (active?.state !== "evaluating" || active.evaluation?.childID !== childID) throw new Error("Evaluation is no longer active; preserve its recorded pause or acceptance.");
      const result = await client.session.prompt({ path: { id: childID }, body: {
        agent: "general", model: goal.validatorModel ?? goal.model, parts: [{ type: "text", text: prompt }],
      }, signal: context.abort });
      if (context.abort.aborted) throw new Error("Evaluation cancelled; inspect outcomes before explicit resumption.");
      if (result.error || !result.data || result.data.info?.error) {
        const error = result.error ?? result.data?.info?.error;
        const kind = typeof error?.name === "string" && /^[A-Za-z]+Error$/.test(error.name) ? error.name : "missing or failed response";
        const ref = /^err_[a-z0-9]+$/.test(error?.data?.ref ?? "") ? ` ${error.data.ref}` : "";
        throw new Error(`Evaluator interrupted or its API outcome unknown (${kind}${ref}); inspect its recorded outcome before resuming.`);
      }
      const messages = await client.session.messages({ path: { id: childID } });
      if (messages.error || !messages.data) throw new Error("Evaluator evidence unavailable.");
      const parts = messages.data.flatMap((m: any) => m.parts);
      const report = parts.findLast((p: any) => p.tool === "goal_verdict" && p.state?.status === "completed");
      try {
        const validation = validateVerdict(report && JSON.parse(report.state.output), criteria, findings);
        const inspected = parts.some((p: any) => p.type === "tool" && evidenceTool(p.tool)
          && (p.state?.status === "completed" || (validation.status === "blocked" && p.state?.status === "error")));
        if (!inspected) throw new Error("Obtain actual inspection/check evidence before reporting acceptance or a blocker.");
        const now = await captureFiles(root, Object.keys(assignment.candidate));
        if (JSON.stringify(now) !== JSON.stringify(assignment.candidate)) throw new Error("Candidate bytes changed during evaluation; request fresh evaluation of the current artifacts.");
        const updated = await save((current: Run) => transition(current, { type: "result", verdict: validation }, Date.now()));
        return { state: updated.state, mode: assignment.mode, validation, childID };
      } catch (error) {
        correction = error instanceof Error ? error.message : String(error);
        if (correction.includes("Candidate bytes changed") || correction.includes("no longer active")) throw error;
      }
    }
    // A protocol watchdog is not a progress or domain-attempt limit.
    const updated = await save((current: Run) => current.state !== "evaluating" || current.evaluation?.childID !== childID ? current
      : { ...current, state: "working", evaluation: undefined,
        feedback: { status: "protocol_error", reason: correction }, updated_at: Date.now() });
    return { state: updated.state, mode: assignment.mode, reason: updated.state === "working"
      ? `Evaluator report incomplete: ${correction}. Request evaluation again; implementation was not restarted.` : updated.reason, childID };
  } finally {
    context.abort.removeEventListener("abort", cancel);
    if (childID) unregister(childID);
  }
}
