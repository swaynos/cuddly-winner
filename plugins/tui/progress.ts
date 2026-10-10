// Bounded public activity stored on the existing goal_cycle tool part.
export type GoalActivity = {
  agent: string;
  parentID: string;
  cycle: number;
  phase: "coordinator" | "builder" | "validator";
  status: "not_started" | "running" | "waiting" | "failed" | "validated" | "blocked" | "cancelled";
  activity: string;
  milestone: string;
  phaseStartedAt: number;
  updatedAt: number;
  recent: string[];
  verdict?: string;
  retryReason?: string;
  attemptsRemaining?: number;
};

export function publicSummary(value: unknown): string {
  if (typeof value !== "string") throw new Error("Progress requires a short public summary.");
  const text = value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || /https?:\/\/|(?:bearer|password|api[_-]?key|authorization|token)\s*[:=]/i.test(text)) {
    throw new Error("Progress must omit URLs, credentials and raw commands; describe the milestone briefly.");
  }
  return Array.from(text).slice(0, 160).join("");
}

export function evidenceTool(name: string): boolean {
  return ["read", "glob", "grep", "list", "bash", "webfetch", "websearch", "lsp"].includes(name)
    || name.startsWith("cuddly-winner-browser_browser_");
}

export function toolActivity(name: string): string {
  if (name === "read") return "Reading project files";
  if (["glob", "grep", "list"].includes(name)) return "Searching project files";
  if (name === "bash") return "Running a command";
  if (["write", "edit", "apply_patch"].includes(name)) return "Updating project files";
  if (["webfetch", "websearch"].includes(name)) return "Researching references";
  if (name.startsWith("cuddly-winner-browser")) return "Using managed browser";
  if (name === "goal_verdict") return "Recording independent verdict";
  if (name === "goal_handoff") return "Recording builder readiness";
  return "Using a tool";
}

function childBearing(part: any): boolean {
  if (part.type !== "tool" || part.tool !== "goal_cycle" || part.state?.input?.operation === "inspect") return false;
  if (part.state?.metadata?.children?.length) return true;
  try { return !!JSON.parse(part.state?.output).children?.length; } catch { return false; }
}

export function goalActivityForSession(session: any, messages: readonly any[], parts: (id: string) => readonly any[]): GoalActivity | undefined {
  if (!session || session.parentID) return;
  const user = [...messages].reverse().find(m => (m.info ?? m).role === "user");
  const agent = (user?.info ?? user)?.agent ?? session.agent;
  for (const message of [...messages].reverse()) {
    for (const part of [...parts((message.info ?? message).id)].reverse()) {
      if (part.type === "text" && part.metadata?.goal_activity?.status === "not_started") {
        const checkpoint = part.metadata.goal_activity;
        if (checkpoint.agent === agent && checkpoint.parentID === session.id) return checkpoint;
        continue;
      }
      if (part.type !== "tool" || part.tool !== "goal_cycle") continue;
      if (part.state?.input?.operation === "inspect") continue;
      let result;
      try {
        result = JSON.parse(part.state?.output);
        if (["inspected", "invalid_request"].includes(result.status)) continue;
      } catch {}
      const value = part.state?.metadata?.goal_activity ?? (result?.goal_agent ? {
        agent: result.goal_agent, parentID: session.id, cycle: result.children?.length ? 1 : 0,
        phase: "coordinator", status: result.status, activity: result.reason ?? "Goal checkpoint recorded",
        milestone: "", recent: [], phaseStartedAt: part.state.time?.start ?? 0, updatedAt: part.state.time?.end ?? 0,
      } : undefined);
      const historical = ["build", "plan"].includes(agent) && messages.some(m => {
        const info = m.info ?? m;
        return info.role === "user" && info.agent === value?.agent;
      });
      if (!value || (value.agent !== agent && !historical) || value.parentID !== session.id
          || !Number.isInteger(value.cycle) || value.cycle < (value.phase === "coordinator" ? 0 : 1)
          || !["coordinator", "builder", "validator"].includes(value.phase)
          || !["running", "waiting", "failed", "validated", "blocked", "cancelled"].includes(value.status)
          || !Number.isFinite(value.phaseStartedAt) || !Number.isFinite(value.updatedAt)) return;
      try {
        const cancelled = value.status === "cancelled" || ((message.info ?? message).error?.name === "MessageAbortedError"
          && (part.state.status === "error" || value.status !== "validated"));
        return { ...value, activity: publicSummary(value.activity), milestone: value.milestone ? publicSummary(value.milestone) : "",
          ...(result?.admission ? { attemptsRemaining: Math.max(0, result.admission.max_cycles - messages.reduce((count, m) => count
            + parts((m.info ?? m).id).filter(childBearing).length, 0)) } : {}),
          ...(part.state.status === "completed" && result?.status ? { status: result.status } : {}),
          ...(value.verdict ? { verdict: publicSummary(value.verdict) } : {}),
          ...(value.retryReason ? { retryReason: publicSummary(value.retryReason) } : {}),
          recent: Array.isArray(value.recent) ? value.recent.slice(-3).map(publicSummary) : [],
          ...(cancelled ? { status: "cancelled", activity: "Cancelled; inspect before resuming" }
            : part.state.metadata?.coordinator_stop ? { status: "blocked", activity: "Coordinator non-progress; diagnosis required" }
            : part.state.status === "error" ? { status: "blocked", activity: "Execution interrupted; inspect before resuming" } : {}) };
      } catch { return; }
    }
  }
}
