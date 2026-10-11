// Read-only presentation of the current root's persistent-worker checkpoint.
export type GoalActivity = {
  agent: string;
  state: "working" | "evaluating" | "paused" | "accepted";
  reason?: string;
  feedback?: string;
  validation?: string;
  evaluation?: { mode: "feedback" | "final"; focus?: string; childID?: string };
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

function summary(value: unknown): string | undefined {
  try { return publicSummary(value); } catch { return; }
}

function findings(value: any): string | undefined {
  if (!value || !["checked", "blocked"].includes(value.status)) return;
  if (value.status === "blocked") return summary(`blocked${summary(value.reason) ? `: ${summary(value.reason)}` : ""}`);
  const checks = Object.entries(value.checks ?? {}).filter(([key, check]: any) =>
    /^c\d+$/.test(key) && typeof check?.passed === "boolean");
  if (!checks.length) return;
  const failed = checks.filter(([, check]: any) => !check.passed);
  const selected = failed.length ? failed : checks;
  const evidence = selected.map(([key, check]: any) => {
    const text = summary(check.evidence);
    return text ? `${key}: ${text}` : key;
  }).join("; ");
  return summary(`${failed.length ? "failed" : "passed"} (${selected.map(([key]) => key).join(", ")}): ${evidence}`);
}

export function goalActivityForSession(session: any, _messages: readonly any[] = [], _parts?: (id: string) => readonly any[]): GoalActivity | undefined {
  if (!session || session.parentID) return;
  const value = session.metadata?.cuddly_winner_goal;
  if (value?.runtime_contract !== "persistent-worker-v1"
    || !["working", "evaluating", "paused", "accepted"].includes(value.state)
    || !summary(value.agent) || !/^[a-f0-9]{64}$/.test(value.definition_sha256 ?? "")) return;
  const reason = summary(value.reason);
  const feedback = findings(value.feedback);
  const validation = findings(value.validation);
  const evaluation = value.state === "evaluating" && ["feedback", "final"].includes(value.evaluation?.mode)
    ? { mode: value.evaluation.mode, ...(summary(value.evaluation.focus) ? { focus: summary(value.evaluation.focus) } : {}),
      ...(typeof value.evaluation.childID === "string" ? { childID: value.evaluation.childID } : {}) } : undefined;
  return { agent: summary(value.agent)!, state: value.state,
    ...(reason ? { reason } : {}), ...(feedback ? { feedback } : {}), ...(validation ? { validation } : {}),
    ...(evaluation ? { evaluation } : {}) };
}
