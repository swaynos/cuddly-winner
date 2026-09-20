import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { tool } from "@opencode-ai/plugin";
import { directAgentPath, hasDirectAgentFile, readDirectAgentPolicy } from "../tools/publish_direct_agent.ts";

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

export const Goal = async ({ client, directory, worktree }: { client: any; directory: string; worktree: string }) => {
  const root = directory || worktree;
  const active = new Set<string>();
  const scheduled = new Set<string>();
  const stopped = new Set<string>();
  const childParents = new Map<string, string>();
  const validators = new Map<string, string[]>();

  async function definition(sessionID: string) {
    const session = data(await client.session.get({ path: { id: sessionID } }));
    if (session.parentID) return;
    const messages = data(await client.session.messages({ path: { id: sessionID } }));
    const user = [...messages].reverse().find((m: any) => m.info.role === "user")?.info;
    const agent = user?.agent ?? session.agent;
    if (!agent || !hasDirectAgentFile(root, agent)) return;
    const policy = readDirectAgentPolicy(root, agent);
    const text = readFileSync(directAgentPath(root, agent), "utf8");
    const header = parse(text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "");
    const criteria = header?.options?.goal?.criteria;
    if (!Array.isArray(criteria) || !criteria.length || criteria.some((c: unknown) => typeof c !== "string" || !c.trim())) return;
    const slash = header.model?.indexOf("/");
    const model = slash > 0
      ? { providerID: header.model.slice(0, slash), modelID: header.model.slice(slash + 1) }
      : user?.model;
    if (!model) throw new Error("Goal requires a selected execution model.");
    return { agent, text, criteria: criteria as string[], policy, model, messages };
  }

  async function cycle(_: {}, context: any) {
    const id = context.sessionID;
    const goal = await definition(id);
    if (!goal) throw new Error("goal_cycle requires a selected root Direct goal agent.");
    if (active.has(id)) throw new Error("A goal cycle is already running.");
    if (stopped.has(id) || context.abort.aborted) throw new Error("Goal stopped; explicit user input is required to resume.");
    active.add(id);
    let childID: string | undefined;
    const children: string[] = [];
    const cancel = () => {
      stopped.add(id);
      if (childID) void client.session.abort({ path: { id: childID } }).catch(() => {});
    };
    context.abort.addEventListener("abort", cancel, { once: true });
    try {
      // Exclude the currently running tool when retrieving the prior verdict.
      const previous = lastCycle(goal.messages.map((m: any) => ({ ...m, parts: m.parts.filter((p: any) => !(m.info.id === context.messageID && p.tool === "goal_cycle" && ["pending", "running"].includes(p.state?.status))) })));
      for (const role of ["builder", "validator"] as const) {
        if (context.abort.aborted || stopped.has(id)) throw new Error("Goal cancelled or permission denied.");
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
            { permission: "publish_direct_agent", pattern: "*", action: "deny" },
            { permission: "edit", pattern: "*", action: role === "builder" ? "allow" : "deny" },
            { permission: "bash", pattern: "*", action: goal.policy.bash ? "ask" : "deny" },
          ],
        } }));
        childID = child.id;
        children.push(child.id);
        childParents.set(child.id, id);
        if (role === "validator") validators.set(child.id, goal.criteria);
        context.metadata({ title: `Goal ${role}`, metadata: { children: [...children], phase: role } });
        if (context.abort.aborted || stopped.has(id)) { cancel(); throw new Error("Goal cancelled."); }
        const prompt = role === "builder"
          ? `Implement the goal below within its exact edit paths. Run its verification. Do not change acceptance criteria or the generated definition. Ordinary failures require diagnosis and repair. Report actual changes and any genuine blocker.\nPrevious independent findings:\n${JSON.stringify(previous ?? null)}`
          : `Independently validate the CURRENT project against EVERY criterion below. Obtain fresh evidence; do not trust implementation claims. Do not edit product code or acceptance criteria, including through shell commands. Run the declared checks and required live/user-journey checks. Mark unmet criteria false with actionable findings. Use blocked only for a genuine stop condition or external dependency, not ordinary test failures. Call goal_verdict before finishing with concrete evidence (commands, outcomes and artifact paths) per criterion, using these keys: ${JSON.stringify(Object.fromEntries(goal.criteria.map((c, i) => [`c${i}`, c])))}. You have not been given the builder's conversation.`;
        const result = data(await client.session.prompt({ path: { id: child.id }, body: {
          agent: "general", model: goal.model,
          parts: [{ type: "text", text: `${prompt}\n\nThe following is the goal definition. Its coordinator instructions apply to the parent, not you. Perform only your assigned ${role} phase.\n${goal.text}` }],
        } }));
        if (result.info?.error || context.abort.aborted || stopped.has(id)) throw new Error("Child execution interrupted or failed; inspect its session before resuming.");
        // A denied tool may be handled by the model without an assistant error.
        const history = data(await client.session.messages({ path: { id: child.id } }));
        if (history.some((m: any) => m.info.error || m.parts.some((p: any) => p.type === "tool" && p.state.status === "error" && /reject|denied|abort|cancel/i.test(p.state.error)))) {
          throw new Error("Child encountered a denied or interrupted action; explicit user input is required.");
        }
        if (role === "validator") {
          const report = history.flatMap((m: any) => m.parts).findLast((p: any) => p.type === "tool" && p.tool === "goal_verdict" && p.state.status === "completed");
          if (!report) return JSON.stringify({ status: "failed", children, reason: "Validator stopped without a verdict. Repeat the build/validate cycle and obtain criterion evidence." });
          const validation = JSON.parse(report.state.output);
          const status = verdict(validation, goal.criteria);
          if (status === "blocked") stopped.add(id);
          if (status === "validated" && !history.some((m: any) => m.parts.some((p: any) => p.type === "tool" && p.tool !== "goal_verdict" && p.state.status === "completed"))) {
            return JSON.stringify({ status: "failed", children, reason: "Validator claimed success without obtaining tool evidence. Obtain independent evidence before reporting success." });
          }
          return JSON.stringify({ status, children, validation });
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
      goal_cycle: tool({ description: "Run one fresh builder and one fresh independent validator for the selected Direct goal. Failed validation requires another cycle.", args: {}, execute: cycle }),
      goal_verdict: tool({
        description: "Record independent criterion evidence. Available only inside the active goal validator session.",
        args: {
          status: tool.schema.enum(["checked", "blocked"]),
          reason: tool.schema.string(),
          checks: tool.schema.record(tool.schema.string(), tool.schema.object({ passed: tool.schema.boolean(), evidence: tool.schema.string().min(1) })),
        },
        async execute(args, context) {
          const criteria = validators.get(context.sessionID);
          if (!criteria) throw new Error("Only the active independent validator may record a goal verdict.");
          verdict(args, criteria);
          return JSON.stringify(args);
        },
      }),
    },
    "chat.message": async (input: any, output: any) => {
      if (output.parts?.some((p: any) => p.type === "text" && p.text !== CONTINUE && !p.synthetic)) stopped.delete(input.sessionID);
    },
    event: async ({ event }: any) => {
      const id = event.properties?.sessionID;
      if (!id) return;
      if (event.type === "session.error" || (event.type === "permission.replied" && event.properties.reply === "reject")) {
        stopped.add(childParents.get(id) ?? id);
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
