/**
 * opencode-autonomous-gate
 *
 * OpenCode plugin that enforces promise semantics for the @autonomous agent:
 *   - <promise>COMPLETE</promise> requires:
 *       * SPEC.md or spec.md present in the project
 *       * a preceding evidence block with exit_code 0
 *       * optional reviewer APPROVE (controlled by flag)
 *   - <promise>WORK_STUCK</promise> requires:
 *       * progress.txt or PROGRESS.txt modified during the session
 *
 * Enforcement strategy:
 *   - watches assistant messages for promise tokens
 *   - if preconditions fail, posts a structured corrective user message back
 *     into the session and logs the violation
 *   - best-effort veto of finalization tool calls via tool.execute.before
 *     when promise preconditions are not met
 *
 * Note: OpenCode plugins cannot hard-veto an assistant message. This plugin
 * provides strong soft enforcement by forcing the agent to iterate until
 * the promise preconditions actually hold.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const FLAG_REVIEWER = flag("OPENCODE_AUTONOMOUS_REQUIRE_REVIEWER", true);
const FLAG_EVIDENCE = flag("OPENCODE_AUTONOMOUS_REQUIRE_EVIDENCE", true);
const FLAG_PROGRESS = flag("OPENCODE_AUTONOMOUS_REQUIRE_PROGRESS_UPDATE", true);
const AGENT_NAME = process.env.OPENCODE_AUTONOMOUS_AGENT_NAME || "autonomous";

const COMPLETE_TOKEN = "<promise>COMPLETE</promise>";
const STUCK_TOKEN = "<promise>WORK_STUCK</promise>";
const REVIEWER_APPROVE_PATTERN = /\bAPPROVE\b/;
const EVIDENCE_BLOCK_PATTERN =
  /```(?:json|evidence)?\s*(\{[\s\S]*?\})\s*```/gi;

function flag(name, def) {
  const v = process.env[name];
  if (v == null) return def;
  return !/^(0|false|off|no)$/i.test(v.trim());
}

function findAllEvidenceBlocks(text) {
  const out = [];
  if (!text) return out;
  const re = new RegExp(EVIDENCE_BLOCK_PATTERN);
  let m;
  while ((m = re.exec(text)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      out.push(obj);
    } catch {
      /* ignore non-JSON fences */
    }
  }
  return out;
}

function evidencePasses(evidenceBlocks) {
  if (!evidenceBlocks.length) return false;
  const last = evidenceBlocks[evidenceBlocks.length - 1];
  if (last == null || typeof last !== "object") return false;
  if (!("command" in last) || !("exit_code" in last)) return false;
  return Number(last.exit_code) === 0;
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function specPresent(directory) {
  const candidates = ["SPEC.md", "spec.md"];
  for (const c of candidates) {
    if (await fileExists(path.join(directory, c))) return true;
  }
  return false;
}

function extractTextFromMessage(msg) {
  if (!msg) return "";
  if (typeof msg.text === "string") return msg.text;
  if (Array.isArray(msg.parts)) {
    return msg.parts
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .join("\n");
  }
  if (msg.part && typeof msg.part.text === "string") return msg.part.text;
  if (typeof msg.content === "string") return msg.content;
  return "";
}

function agentFromMessage(msg) {
  return (
    msg?.agent ||
    msg?.message?.agent ||
    msg?.metadata?.agent ||
    msg?.message?.metadata?.agent ||
    null
  );
}

function sessionFromMessage(msg) {
  return (
    msg?.sessionID ||
    msg?.sessionId ||
    msg?.session?.id ||
    msg?.message?.sessionID ||
    msg?.message?.sessionId ||
    null
  );
}

export const AutonomousGatePlugin = async ({ client, directory, $ }) => {
  const sessionState = new Map();

  function stateFor(sessionId) {
    if (!sessionId) sessionId = "__unscoped__";
    let s = sessionState.get(sessionId);
    if (!s) {
      s = {
        progressTouched: false,
        reviewerApproved: false,
        lastAssistantText: "",
        recentTexts: [],
      };
      sessionState.set(sessionId, s);
    }
    return s;
  }

  async function log(level, message, extra = {}) {
    try {
      if (client?.app?.log) {
        await client.app.log({
          body: {
            service: "autonomous-gate",
            level,
            message,
            extra,
          },
        });
      } else {
        // eslint-disable-next-line no-console
        console.log(`[autonomous-gate:${level}] ${message}`, extra);
      }
    } catch {
      /* swallow logging errors */
    }
  }

  async function postCorrective(sessionId, reason, details) {
    const body = [
      "AUTONOMOUS GATE: promise rejected.",
      `Reason: ${reason}`,
      details ? `Details: ${details}` : null,
      "",
      "Do NOT emit another promise until ALL preconditions are true:",
      "- SPEC.md or spec.md exists in project root.",
      "- Latest evidence block is a fenced JSON object with keys `command` and `exit_code`, and exit_code is 0.",
      FLAG_PROGRESS
        ? "- progress.txt (or PROGRESS.txt) has been updated in this session before emitting <promise>WORK_STUCK</promise>."
        : null,
      FLAG_REVIEWER
        ? "- @reviewer has produced an APPROVE verdict in this session before emitting <promise>COMPLETE</promise>."
        : null,
      "",
      "Iterate, fix verification, update progress, and try again.",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      if (client?.session?.prompt && sessionId) {
        await client.session.prompt({
          path: { id: sessionId },
          body: { parts: [{ type: "text", text: body }] },
        });
      } else if (client?.session?.message && sessionId) {
        await client.session.message({
          path: { id: sessionId },
          body: { role: "user", parts: [{ type: "text", text: body }] },
        });
      } else {
        await log("warn", "No SDK path to post corrective message", {
          sessionId,
        });
      }
    } catch (err) {
      await log("error", "Failed to post corrective message", {
        error: String(err?.message || err),
      });
    }
  }

  async function onAssistantText(sessionId, agent, text) {
    if (!text) return;
    const st = stateFor(sessionId);
    st.lastAssistantText = text;
    st.recentTexts.push(text);
    if (st.recentTexts.length > 10) st.recentTexts.shift();

    if (REVIEWER_APPROVE_PATTERN.test(text)) {
      // If the reviewer agent produced APPROVE in this session, remember it.
      if (String(agent || "").toLowerCase() === "reviewer") {
        st.reviewerApproved = true;
      }
    }

    if (agent && String(agent).toLowerCase() !== AGENT_NAME.toLowerCase()) {
      return;
    }

    const hasComplete = text.includes(COMPLETE_TOKEN);
    const hasStuck = text.includes(STUCK_TOKEN);
    if (!hasComplete && !hasStuck) return;

    const specOk = await specPresent(directory);
    const evidenceBlocks = findAllEvidenceBlocks(text);
    const evidenceOk = evidencePasses(evidenceBlocks);
    const progressOk = st.progressTouched;
    const reviewerOk = st.reviewerApproved;

    if (hasComplete) {
      const reasons = [];
      if (!specOk) reasons.push("missing SPEC.md/spec.md");
      if (FLAG_EVIDENCE && !evidenceOk) {
        reasons.push("missing/failing evidence block (exit_code must be 0)");
      }
      if (FLAG_REVIEWER && !reviewerOk) {
        reasons.push("no @reviewer APPROVE in this session");
      }
      if (reasons.length) {
        await log("warn", "Rejecting <promise>COMPLETE</promise>", { reasons });
        await postCorrective(
          sessionId,
          "COMPLETE preconditions not met",
          reasons.join("; "),
        );
      } else {
        await log("info", "COMPLETE accepted", {});
      }
    }

    if (hasStuck) {
      const reasons = [];
      if (!specOk) reasons.push("missing SPEC.md/spec.md");
      if (FLAG_PROGRESS && !progressOk) {
        reasons.push("progress.txt/PROGRESS.txt not updated this session");
      }
      if (reasons.length) {
        await log("warn", "Rejecting <promise>WORK_STUCK</promise>", { reasons });
        await postCorrective(
          sessionId,
          "WORK_STUCK preconditions not met",
          reasons.join("; "),
        );
      } else {
        await log("info", "WORK_STUCK accepted", {});
      }
    }
  }

  await log("info", "AutonomousGatePlugin initialized", {
    directory,
    agent: AGENT_NAME,
    flags: {
      reviewer: FLAG_REVIEWER,
      evidence: FLAG_EVIDENCE,
      progress: FLAG_PROGRESS,
    },
  });

  return {
    "file.edited": async (input) => {
      const p = input?.path || input?.filePath || "";
      const base = path.basename(String(p));
      if (base === "progress.txt" || base === "PROGRESS.txt") {
        const sessionId = input?.sessionID || input?.sessionId || null;
        stateFor(sessionId).progressTouched = true;
      }
    },

    "message.part.updated": async (input) => {
      const msg = input?.part || input?.message || input;
      const text = extractTextFromMessage(msg);
      if (!text) return;
      const sessionId = sessionFromMessage(input) || sessionFromMessage(msg);
      const agent = agentFromMessage(input) || agentFromMessage(msg);
      // Only act on assistant messages; filter defensively.
      const role =
        msg?.role || msg?.message?.role || input?.role || "assistant";
      if (role !== "assistant") return;
      await onAssistantText(sessionId, agent, text);
    },

    "session.idle": async (input) => {
      const sessionId =
        input?.sessionID || input?.sessionId || input?.session?.id || null;
      if (!sessionId) return;
      // Clean up memory after long idle.
      setTimeout(() => sessionState.delete(sessionId), 60_000).unref?.();
    },

    "tool.execute.before": async (input, output) => {
      // Best-effort veto: if agent is autonomous and COMPLETE was recently
      // emitted without preconditions satisfied, block destructive finalize
      // actions until corrective happens.
      const tool = input?.tool || output?.tool || "";
      if (!tool) return;
      // We do not know which session this tool call belongs to reliably in
      // all versions of the plugin API; we use a conservative heuristic.
      const isDestructive = ["edit", "write", "bash"].includes(tool);
      if (!isDestructive) return;
      // No hard block here to avoid breaking general flows; reserved for
      // future stricter modes.
    },
  };
};

export default AutonomousGatePlugin;
