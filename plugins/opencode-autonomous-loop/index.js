import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { findLastEvidenceBlock } from "../shared/evidence.js";

const AGENT_NAME = process.env.OPENCODE_AUTONOMOUS_AGENT_NAME || "autonomous";
const RUN_STATE_FILE = path.join(
  ".opencode",
  "autonomous-loop",
  "runs.json",
);
const STATUS_FILE = path.join(
  ".opencode",
  "autonomous-loop",
  "status.json",
);
const STALE_SECONDS = Number(process.env.OPENCODE_AUTONOMOUS_STALE_SECONDS || 900);

const COMPLETE_TOKEN = "<promise>COMPLETE</promise>";
const STUCK_TOKEN = "<promise>WORK_STUCK</promise>";
const BLOCKED_TOKEN = "<promise>BLOCKED</promise>";

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function unixTs() {
  return Math.floor(Date.now() / 1000);
}

export function normalizeSessionId(sessionId) {
  return sessionId || "__unscoped__";
}

export function normalizeRunId(sessionId) {
  const raw = normalizeSessionId(sessionId);
  return raw.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function extractText(msg) {
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

function extractSessionId(msg) {
  return (
    msg?.sessionID ||
    msg?.sessionId ||
    msg?.session?.id ||
    msg?.message?.sessionID ||
    msg?.message?.sessionId ||
    null
  );
}

function extractAgent(msg) {
  return (
    msg?.agent ||
    msg?.message?.agent ||
    msg?.metadata?.agent ||
    msg?.message?.metadata?.agent ||
    null
  );
}

function extractRole(msg) {
  return msg?.role || msg?.message?.role || "assistant";
}

export function jsonSafeParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Returns true if the text contains at least one unchecked Markdown checkbox
 * (a line matching `- [ ]`).  Used to detect an unfinished progress.txt
 * checklist so the plugin can post a continuation nudge.
 */
export function hasUncheckedItems(text) {
  return /^- \[ \]/m.test(text || "");
}

/**
 * Parse the declared strategy from progress.txt content.
 * Returns the strategy string (lowercased) or null if no Selected: line exists.
 */
export function parseSelectedStrategy(text) {
  if (!text) return null;
  const m = text.match(/^Selected:\s*(\S+)/m);
  return m ? m[1].toLowerCase() : null;
}

export const AutonomousLoopPlugin = async ({ client, directory }) => {
  const runsPath = path.join(directory, RUN_STATE_FILE);
  const statusPath = path.join(directory, STATUS_FILE);

  // Tracks the last text hash per session for which a continuation nudge was
  // posted.  Prevents firing duplicate nudges when the same partial turn text
  // is delivered more than once (e.g., streaming updates).
  const lastNudgeTextHash = new Map();

  async function log(level, message, extra = {}) {
    if (client?.app?.log) {
      await client.app.log({
        body: {
          service: "autonomous-loop",
          level,
          message,
          extra,
        },
      });
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`[autonomous-loop:${level}] ${message}`, extra);
  }

  async function loadState() {
    if (!(await fileExists(runsPath))) {
      return { version: 1, runs: {} };
    }
    const raw = await fs.readFile(runsPath, "utf-8");
    const state = jsonSafeParse(raw, { version: 1, runs: {} });
    if (!state.runs || typeof state.runs !== "object") {
      return { version: 1, runs: {} };
    }
    return state;
  }

  async function saveState(state) {
    await fs.mkdir(path.dirname(runsPath), { recursive: true });
    await fs.writeFile(runsPath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  }

  async function writeStatus(state) {
    const now = unixTs();
    const rows = Object.entries(state.runs).map(([id, r]) => ({
      run_id: id,
      status: r.status,
      iterations: r.iterations,
      complete_count: r.complete_count,
      stuck_count: r.stuck_count,
      last_activity: r.last_activity,
      stale_seconds: Math.max(0, now - (r.last_activity || now)),
      spec_present: !!r.spec_present,
      progress_touched: !!r.progress_touched,
      last_error: r.last_error || null,
    }));
    rows.sort((a, b) => (b.last_activity || 0) - (a.last_activity || 0));

    const status = {
      generated_at: now,
      stale_seconds_threshold: STALE_SECONDS,
      active_runs: rows.filter((r) => r.status === "running" || r.status === "blocked")
        .length,
      runs: rows,
    };

    await fs.mkdir(path.dirname(statusPath), { recursive: true });
    await fs.writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf-8");
  }

  async function getSpecHash() {
    const candidates = ["SPEC.md", "spec.md", "docs/SPEC.md", "docs/spec.md"];
    for (const rel of candidates) {
      const full = path.join(directory, rel);
      if (await fileExists(full)) {
        const content = await fs.readFile(full, "utf-8");
        return { spec_present: true, spec_file: rel, spec_hash: hashText(content) };
      }
    }
    return { spec_present: false, spec_file: null, spec_hash: null };
  }

  async function updateRun(sessionId, mutate) {
    const state = await loadState();
    const runId = normalizeRunId(sessionId);
    const now = unixTs();
    const base = state.runs[runId] || {
      run_id: runId,
      session_id: normalizeSessionId(sessionId),
      status: "running",
      iterations: 0,
      complete_count: 0,
      stuck_count: 0,
      progress_touched: false,
      selected_strategy: null,
      spec_present: false,
      spec_file: null,
      spec_hash: null,
      reviewer_approved: false,
      first_seen: now,
      last_activity: now,
      stale_notified_at: null,
      last_error: null,
      history: [],
    };

    const next = mutate(base, now) || base;
    next.last_activity = now;
    state.runs[runId] = next;
    await saveState(state);
    await writeStatus(state);
    return next;
  }

  async function maybePostStaleReminder(sessionId, run) {
    if (!sessionId || run.status !== "running") return;
    const now = unixTs();
    const staleFor = now - (run.last_activity || now);
    if (staleFor < STALE_SECONDS) return;
    if (run.stale_notified_at && now - run.stale_notified_at < STALE_SECONDS) return;

    const body = [
      "AUTONOMOUS LOOP: stale run reminder.",
      `Run id: ${run.run_id}`,
      `Inactive for: ${staleFor}s`,
      "If work is not complete, resume with next checklist item and re-run verification.",
      "If blocked, document attempts in progress.txt and only then emit WORK_STUCK.",
    ].join("\n");

    try {
      if (client?.session?.prompt) {
        await client.session.prompt({
          path: { id: sessionId },
          body: { parts: [{ type: "text", text: body }] },
        });
      }
      await updateRun(sessionId, (r) => ({ ...r, stale_notified_at: now }));
      await log("info", "posted stale reminder", { runId: normalizeRunId(sessionId) });
    } catch (err) {
      await log("warn", "failed posting stale reminder", {
        runId: normalizeRunId(sessionId),
        error: String(err?.message || err),
      });
    }
  }

  /**
   * Post a turn-boundary continuation nudge if progress.txt has unchecked
   * items and we have not already nudged for this exact turn text in this
   * session.  This is the fix for the premature-exit bug: the agent can end
   * a turn silently with open checklist items, because no plugin event fires
   * at a normal turn boundary.  This function fills that gap.
   */
  async function maybePostContinuationNudge(sessionId, turnText) {
    if (!sessionId) return;

    // Check progress.txt for unchecked items.
    const progressCandidates = ["progress.txt", "PROGRESS.txt"];
    let progressContent = null;
    for (const name of progressCandidates) {
      const p = path.join(directory, name);
      if (await fileExists(p)) {
        progressContent = await fs.readFile(p, "utf-8").catch(() => null);
        break;
      }
    }
    if (!progressContent || !hasUncheckedItems(progressContent)) return;

    // Dedup: don't fire for the same turn text twice in the same session.
    const textHash = hashText(turnText);
    const sid = normalizeSessionId(sessionId);
    if (lastNudgeTextHash.get(sid) === textHash) return;
    lastNudgeTextHash.set(sid, textHash);

    const body = [
      "AUTONOMOUS LOOP: unchecked items remain in progress.txt.",
      "You ended a turn without a promise token while the checklist is unfinished.",
      "Do NOT stop. Resume with the next unchecked [ ] item now:",
      "1. Read progress.txt and identify the next open item.",
      "2. Implement it.",
      "3. Run the verification command for that item.",
      "4. Update progress.txt and continue to the next item.",
      "Only emit a promise token (COMPLETE / WORK_STUCK / BLOCKED) when the",
      "entire checklist is done or you have genuinely exhausted all strategies.",
    ].join("\n");

    try {
      if (client?.session?.prompt) {
        await client.session.prompt({
          path: { id: sessionId },
          body: { parts: [{ type: "text", text: body }] },
        });
        await log("info", "posted continuation nudge", { sessionId: sid });
      }
    } catch (err) {
      await log("warn", "failed posting continuation nudge", {
        sessionId: sid,
        error: String(err?.message || err),
      });
    }
  }

  await log("info", "AutonomousLoopPlugin initialized", {
    directory,
    statePath: runsPath,
    statusPath,
    staleSeconds: STALE_SECONDS,
  });

  return {
    "file.edited": async (input) => {
      const p = input?.path || input?.filePath || "";
      const base = path.basename(String(p));
      if (base !== "progress.txt" && base !== "PROGRESS.txt") return;
      const sid = input?.sessionID || input?.sessionId || null;
      const spec = await getSpecHash();

      // Parse the declared strategy from progress.txt for durable tracking.
      let selectedStrategy = null;
      try {
        const content = await fs.readFile(String(p), "utf-8");
        selectedStrategy = parseSelectedStrategy(content);
      } catch {
        // File may not be readable yet; not fatal.
      }

      await updateRun(sid, (r) => ({
        ...r,
        status: "running",
        progress_touched: true,
        selected_strategy: selectedStrategy ?? r.selected_strategy ?? null,
        ...spec,
        history: [
          ...(r.history || []).slice(-49),
          { ts: unixTs(), event: "progress_edited", path: String(p), selected_strategy: selectedStrategy },
        ],
      }));
    },

    "message.part.updated": async (input) => {
      const msg = input?.part || input?.message || input;
      const text = extractText(msg);
      if (!text) return;
      if (extractRole(msg) !== "assistant") return;

      const sid = extractSessionId(input) || extractSessionId(msg);
      const agent = extractAgent(input) || extractAgent(msg);

      // Record observed subagent delegation events (any strategy subagent message).
      // These are stored in the run history for the autonomous parent session.
      const agentLower = String(agent || "").toLowerCase();
      const STRATEGY_AGENTS = ["karpathy", "ralph-wiggum", "octopus", "octopus-arm", "reviewer"];
      if (agentLower !== AGENT_NAME.toLowerCase() && STRATEGY_AGENTS.includes(agentLower)) {
        // Find the most recently active autonomous run to attach the delegation to.
        const state = await loadState().catch(() => ({ version: 1, runs: {} }));
        const runningKeys = Object.keys(state.runs).filter(
          (k) => state.runs[k].status === "running",
        );
        for (const runId of runningKeys) {
          await updateRun(runId, (r) => ({
            ...r,
            history: [
              ...(r.history || []).slice(-49),
              { ts: unixTs(), event: "subagent_message", agent: agentLower },
            ],
          }));
        }
        return;
      }

      if (agentLower !== AGENT_NAME.toLowerCase()) {
        return;
      }

      const spec = await getSpecHash();
      const evidence = findLastEvidenceBlock(text);
      const hasComplete = text.includes(COMPLETE_TOKEN);
      const hasStuck = text.includes(STUCK_TOKEN);
      const hasBlocked = text.includes(BLOCKED_TOKEN);
      const reviewerApproved = /\bAPPROVE\b/.test(text);

      const run = await updateRun(sid, (r) => {
        const history = [...(r.history || [])];
        history.push({
          ts: unixTs(),
          event: "assistant_turn",
          promise: hasComplete ? "COMPLETE" : hasStuck ? "WORK_STUCK" : hasBlocked ? "BLOCKED" : null,
          evidence_exit_code:
            evidence && typeof evidence.exit_code !== "undefined"
              ? Number(evidence.exit_code)
              : null,
        });
        const next = {
          ...r,
          ...spec,
          iterations: (r.iterations || 0) + 1,
          reviewer_approved: r.reviewer_approved || reviewerApproved,
          last_error: null,
          history: history.slice(-50),
        };

        if (hasComplete) {
          next.status = "complete";
          next.complete_count = (r.complete_count || 0) + 1;
          next.last_complete_evidence = evidence || null;
        } else if (hasStuck) {
          next.status = "blocked";
          next.stuck_count = (r.stuck_count || 0) + 1;
        } else if (hasBlocked) {
          next.status = "blocked";
          next.stuck_count = (r.stuck_count || 0) + 1;
          next.last_error = "bash tool unavailable";
        } else {
          next.status = "running";
        }

        if (next.status === "running" && !next.spec_present) {
          next.last_error = "missing spec";
        }
        return next;
      });

      await maybePostStaleReminder(sid, run);

      // -----------------------------------------------------------------------
      // Turn-boundary continuation nudge (premature-exit fix)
      //
      // If @autonomous ends a turn with NO promise token while a spec is
      // present and progress.txt still has unchecked [ ] items, the agent has
      // gone quiet with unfinished work.  Post a corrective nudge telling it
      // to resume the next open item.
      //
      // Guard conditions (do NOT nudge when):
      //   - a promise token is present in this turn
      //   - spec is absent (gate handles the no-spec case)
      //   - progress.txt is absent or has no checkboxes
      //   - all checklist items are already checked
      //   - we already nudged for this exact turn text in this session
      // -----------------------------------------------------------------------
      if (!hasComplete && !hasStuck && !hasBlocked && spec.spec_present) {
        await maybePostContinuationNudge(sid, text);
      }
    },

    "session.idle": async (input) => {
      const sid =
        input?.sessionID || input?.sessionId || input?.session?.id || null;
      if (!sid) return;
      const state = await loadState();
      const runId = normalizeRunId(sid);
      const run = state.runs[runId];
      if (!run) return;
      await maybePostStaleReminder(sid, run);
    },
  };
};

export default AutonomousLoopPlugin;
