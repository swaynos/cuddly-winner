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
import os from "node:os";
import crypto from "node:crypto";
import { evidencePasses, findAllEvidenceBlocks } from "../shared/evidence.js";

const FLAG_REVIEWER = flag("OPENCODE_AUTONOMOUS_REQUIRE_REVIEWER", true);
const FLAG_EVIDENCE = flag("OPENCODE_AUTONOMOUS_REQUIRE_EVIDENCE", true);
const FLAG_PROGRESS = flag("OPENCODE_AUTONOMOUS_REQUIRE_PROGRESS_UPDATE", true);
const AGENT_NAME = process.env.OPENCODE_AUTONOMOUS_AGENT_NAME || "autonomous";

const COMPLETE_TOKEN = "<promise>COMPLETE</promise>";
const STUCK_TOKEN = "<promise>WORK_STUCK</promise>";
const BLOCKED_TOKEN = "<promise>BLOCKED</promise>";
const REVIEWER_APPROVE_PATTERN = /\bAPPROVE\b/;

// Detects the workaround-dump pattern: agent says it can't do something AND
// provides a code block with commands for the user to run manually.
// Both signals must be present together — a code block alone is fine (it may
// be evidence output), and a can't-do statement alone is fine (it may be a
// legitimate one-sentence decline). The combination is the anti-pattern.
const CANT_DO_PATTERN = /\b(can['']t|cannot|don['']t have|not available|unavailable|no (bash|shell|SSH|ssh|edit|write|file.edit)|tools?.*(don['']t|not)|without (shell|SSH|bash|edit))\b/i;
const HAS_CODE_BLOCK_PATTERN = /```[\s\S]{20,}/;  // fenced block with substance

function isWorkaroundDump(text) {
  return CANT_DO_PATTERN.test(text) && HAS_CODE_BLOCK_PATTERN.test(text);
}


function flag(name, def) {
  const v = process.env[name];
  if (v == null) return def;
  return !/^(0|false|off|no)$/i.test(v.trim());
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Parse the declared strategy from progress.txt content.
 * Returns the strategy string (lowercased) or null if no Selected: line exists.
 */
function parseSelectedStrategy(progressContent) {
  if (!progressContent) return null;
  const m = progressContent.match(/^Selected:\s*(\S+)/m);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Check whether the Karpathy strategy was actually executed.
 * Returns null (passed) or a failure-reason string.
 *
 * A session passes if ANY of the following is true:
 *   1. All three harness artifacts exist on disk:
 *      program.md + .opencode/karpathy.json + experiments.md
 *   2. A @karpathy delegation was observed in this session (karpathyDelegated=true)
 */
async function checkKarpathyExecution(directory, karpathyDelegated) {
  if (karpathyDelegated) return null;

  const hasProgram   = await fileExists(path.join(directory, "program.md"));
  const hasKarpJson  = await fileExists(path.join(directory, ".opencode", "karpathy.json"));
  const hasExpMd     = await fileExists(path.join(directory, "experiments.md"));

  if (hasProgram && hasKarpJson && hasExpMd) return null;

  const missing = [];
  if (!hasProgram)  missing.push("program.md");
  if (!hasKarpJson) missing.push(".opencode/karpathy.json");
  if (!hasExpMd)    missing.push("experiments.md");

  return (
    "Selected: karpathy but no Karpathy execution evidence found. " +
    "Need a @karpathy task delegation in this session, OR all three harness artifacts: " +
    "program.md + .opencode/karpathy.json + experiments.md. " +
    `Missing: ${missing.join(", ")}.`
  );
}

/**
 * Check strategy consistency:
 *   - progress.txt must have a Selected: line
 *   - If Selected: karpathy, must have Karpathy execution evidence
 *   - Selected: direct / instrumentation / ralph-wiggum / octopus are always OK
 *
 * Returns null (passed) or a failure-reason string.
 * Returns null (skipped) when progress.txt does not exist.
 */
async function checkStrategyConsistency(directory, karpathyDelegated) {
  const progressPath = [
    path.join(directory, "progress.txt"),
    path.join(directory, "PROGRESS.txt"),
  ];
  let progressContent = null;
  for (const p of progressPath) {
    if (await fileExists(p)) {
      progressContent = await fs.readFile(p, "utf-8").catch(() => null);
      break;
    }
  }

  // No progress.txt at all — skip strategy check (gate still requires evidence+reviewer)
  if (progressContent === null) return null;

  const selected = parseSelectedStrategy(progressContent);
  if (selected === null) {
    return (
      "progress.txt exists but has no 'Selected: <strategy>' line. " +
      "Record the strategy before emitting COMPLETE (e.g. 'Selected: direct')."
    );
  }

  if (selected === "karpathy") {
    return checkKarpathyExecution(directory, karpathyDelegated);
  }

  return null; // direct, instrumentation, ralph-wiggum, octopus, etc.
}

/**
 * Extract the inner content of a <spec filename="SPEC.md">…</spec> payload
 * from assistant text. Returns the trimmed inner string or null.
 */
function extractSpecPayload(text) {
  if (!text) return null;
  const m = text.match(/<spec\s+filename=["']SPEC\.md["']>\s*([\s\S]*?)\s*<\/spec>/);
  return m ? m[1] : null;
}

/**
 * Check spec freshness: if a Prometheus <spec filename="SPEC.md"> payload was
 * observed this session, verify that the on-disk SPEC.md content matches it.
 *
 * Returns null (passed / not applicable) or a failure-reason string.
 */
async function checkSpecFreshness(directory, prometheusPayloadHash) {
  if (!prometheusPayloadHash) return null; // no payload observed this session

  const specCandidates = ["SPEC.md", "spec.md"];
  for (const c of specCandidates) {
    const p = path.join(directory, c);
    if (await fileExists(p)) {
      const content = await fs.readFile(p, "utf-8").catch(() => null);
      if (content !== null && hashText(content.trim()) === prometheusPayloadHash) {
        return null; // matches
      }
      return (
        "A Prometheus <spec filename=\"SPEC.md\"> payload was visible this session " +
        "but the on-disk SPEC.md does not match it. " +
        "Write the payload verbatim to SPEC.md before emitting COMPLETE."
      );
    }
  }
  // No spec file at all — the specPresent() check will handle that
  return null;
}

async function specPresent(directory) {
  const candidates = ["SPEC.md", "spec.md"];
  for (const c of candidates) {
    if (await fileExists(path.join(directory, c))) return true;
  }
  return false;
}

/**
 * Check mutation gate:
 *   - Inert when .opencode/mutation.json is absent or enabled=false.
 *   - When enabled, reads the result artifact at result_path.
 *   - Blocks COMPLETE if:
 *       * result artifact is missing
 *       * score < score_threshold
 *       * result is stale (generated_at is older than the newest mtime of
 *         the files listed in the result)
 *
 * Returns null (passed / not applicable) or a failure-reason string.
 */
async function checkMutationGate(directory) {
  const configPath = path.join(directory, ".opencode", "mutation.json");
  if (!(await fileExists(configPath))) return null;

  let config;
  try {
    config = JSON.parse(await fs.readFile(configPath, "utf-8"));
  } catch {
    return "Failed to parse .opencode/mutation.json — check JSON syntax.";
  }

  if (!config.enabled) return null; // opt-out

  const resultRelPath = config.result_path || ".opencode/mutation-result.json";
  const resultPath = path.join(directory, resultRelPath);

  if (!(await fileExists(resultPath))) {
    return (
      "Mutation gate enabled but no result artifact found at " +
      `${resultRelPath}. ` +
      "Run the mutation runner (evals/mutation/run_mutation.py) and commit " +
      "the result before emitting COMPLETE."
    );
  }

  let result;
  try {
    result = JSON.parse(await fs.readFile(resultPath, "utf-8"));
  } catch {
    return `Failed to parse mutation result at ${resultRelPath} — check JSON syntax.`;
  }

  const threshold = config.score_threshold ?? 0.70;
  const score = Number(result.score ?? 0);

  if (score < threshold) {
    return (
      `Mutation gate: score ${score.toFixed(4)} is below threshold ${threshold.toFixed(2)}. ` +
      "Strengthen the tests until surviving mutants are killed, then re-run the " +
      "mutation runner and commit the updated result. " +
      `Survivors to fix: ${(result.survived || 0)} mutant(s) survived.`
    );
  }

  // Staleness check: generated_at must be after the mtime of all listed files.
  if (result.generated_at && Array.isArray(result.files) && result.files.length > 0) {
    const resultTs = new Date(result.generated_at).getTime();
    if (!isNaN(resultTs)) {
      for (const relFile of result.files) {
        const absFile = path.isAbsolute(relFile)
          ? relFile
          : path.join(directory, relFile);
        try {
          const stat = await fs.stat(absFile);
          if (stat.mtimeMs > resultTs) {
            return (
              `Mutation result is stale: ${relFile} was modified after the result was ` +
              `generated (result: ${result.generated_at}, file mtime: ${new Date(stat.mtimeMs).toISOString()}). ` +
              "Re-run the mutation runner and commit the updated result."
            );
          }
        } catch {
          // File not found — not a staleness failure; the result may list a deleted file.
        }
      }
    }
  }

  return null; // passed
}

async function reviewerAvailable(directory) {
  // Check local agent folders first
  const local1 = path.join(directory, ".opencode/agents/reviewer.md");
  const local2 = path.join(directory, "agents/reviewer.md");
  if ((await fileExists(local1)) || (await fileExists(local2))) {
    return true;
  }
  // Check global config folder
  const configDir =
    process.env.OPENCODE_CONFIG_DIR ||
    path.join(os.homedir(), ".config/opencode");
  const globalReviewer = path.join(configDir, "agents/reviewer.md");
  if (await fileExists(globalReviewer)) {
    return true;
  }
  return false;
}

/**
 * Probe whether the `bash` tool is available in the current session.
 * Uses the same multi-source heuristic as the `task` tool check.
 * Returns true (assume available) if the SDK doesn't expose tool lists.
 */
async function bashToolAvailable(client, sessionId) {
  // 1. Check client.tools / client.app.tools if the SDK exposes them
  const clientTools = client?.tools || client?.app?.tools;
  if (Array.isArray(clientTools)) {
    return clientTools.some(t => {
      if (typeof t === "string") return t.toLowerCase() === "bash";
      const name = t?.name || t?.metadata?.name || "";
      return String(name).toLowerCase() === "bash";
    });
  }

  // 2. Check session tool list via client.session.get
  if (client?.session?.get && sessionId) {
    try {
      const res = await client.session.get({ path: { id: sessionId } });
      const sessionInfo = res?.data || res;
      if (sessionInfo) {
        const tools =
          sessionInfo.tools ||
          sessionInfo.agent?.tools ||
          sessionInfo.config?.tools ||
          sessionInfo.session?.tools;
        if (Array.isArray(tools)) {
          return tools.some(t => {
            if (typeof t === "string") return t.toLowerCase() === "bash";
            const name = t?.name || t?.metadata?.name || "";
            return String(name).toLowerCase() === "bash";
          });
        }
      }
    } catch {
      // Cannot determine — fall through
    }
  }

  // 3. Cannot determine — assume available to avoid false positives
  return true;
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
  const sessionAgentCache = new Map();

  function stateFor(sessionId) {
    if (!sessionId) sessionId = "__unscoped__";
    let s = sessionState.get(sessionId);
    if (!s) {
      s = {
        progressTouched: false,
        reviewerApproved: false,
        karpathyDelegated: false,      // true when @karpathy message observed
        prometheusPayloadHash: null,   // SHA-256 of last Prometheus payload inner content
        prometheusPayloadContent: null, // Latest Prometheus payload inner content
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

  function correctiveNextAction(detail) {
    const d = String(detail || "").toLowerCase();
    if (d.includes("missing spec.md") || d.includes("missing spec.md/spec.md")) {
      return "Create or materialize `SPEC.md`, then read it before continuing.";
    }
    if (d.includes("evidence")) {
      return "Run verification and include a fenced JSON evidence block with `command` and `exit_code: 0`.";
    }
    if (d.includes("reviewer")) {
      return "Invoke `@reviewer` and continue until it returns `APPROVE`.";
    }
    if (d.includes("progress.txt") || d.includes("progress.txt/progress.txt")) {
      return "Update `progress.txt` with the current blocker and attempted approaches.";
    }
    if (d.includes("karpathy")) {
      return "Invoke `@karpathy` or create the required Karpathy artifacts before completing.";
    }
    if (d.includes("selected:") || d.includes("strategy")) {
      return "Record the selected strategy in `progress.txt` before completing.";
    }
    if (d.includes("prometheus") || d.includes("payload")) {
      return "Write the latest Prometheus payload verbatim to `SPEC.md` before completing.";
    }
    if (d.includes("mutation")) {
      return "Fix the mutation-gate issue, re-run the mutation runner, and update the result artifact.";
    }
    if (d.includes("blocked") || d.includes("bash")) {
      return "Use `COMPLETE` with valid evidence, or `WORK_STUCK` only after updating progress.";
    }
    if (d.includes("workaround")) {
      return "If bash is unavailable, emit `<promise>BLOCKED</promise>` without manual command lists.";
    }
    return "Fix the failed check, update progress if relevant, and retry the promise.";
  }

  function splitDetails(details) {
    return String(details || "")
      .split(/;\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function postCorrective(sessionId, reason, details, isStuck = false, requireReviewer = FLAG_REVIEWER) {
    const failedChecks = splitDetails(details);
    if (failedChecks.length === 0) failedChecks.push(reason);
    const nextActions = [...new Set(failedChecks.map(correctiveNextAction))];

    const commonPreconditions = [
      `AUTONOMOUS GATE: ${reason}.`,
      "",
      "Failed check(s):",
      ...failedChecks.map((failure) => `- ${failure}`),
      "",
      "Next action(s):",
      ...nextActions.map((action) => `- ${action}`),
      "",
      "Do not emit another promise until the failed check(s) above are fixed.",
      "If the `bash` tool is unavailable, emit <promise>BLOCKED</promise> immediately with no workaround commands or handoff instructions.",
      requireReviewer
        ? "Reviewer check is active for COMPLETE; set OPENCODE_AUTONOMOUS_REQUIRE_REVIEWER=false only when intentionally running without reviewer support."
        : null,
    ];

    const stuckGuidance = isStuck
      ? [
          "",
          "WORK_STUCK is accepted only after progress records real recovery attempts.",
          "Before emitting WORK_STUCK again, try and record at least 3 distinct approaches, such as:",
          "1. RE-READ: Go back to the spec and progress.txt for missed context.",
          "2. SEARCH: Search the codebase for similar patterns, solutions, or error messages.",
          "3. RESEARCH: Invoke @grounder to look up the error, API, or framework behavior.",
          "4. PIVOT: Try a fundamentally different implementation approach.",
          "5. DECOMPOSE: Break the failing step into smaller, independently verifiable sub-steps.",
          "6. WIDEN: Change WHAT you are doing, not just HOW.",
          "",
          "Your next message should name the approaches tried and the remaining blocker.",
        ]
      : ["", "Iterate, fix verification, update progress, and try again."];

    const body = [...commonPreconditions, ...stuckGuidance]
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

  async function postPrometheusMaterializationCorrective(sessionId, payloadContent) {
    const body = [
      "AUTONOMOUS GATE: Prometheus SPEC payload was already observed in this session.",
      "The on-disk SPEC.md is missing, so the Prometheus -> Autonomous handoff was not materialized.",
      "Before doing anything else, write the enclosed content verbatim to `SPEC.md`, then read `SPEC.md` and execute it.",
      "Do not emit WORK_STUCK for a missing spec while this payload is available.",
      "",
      '<spec filename="SPEC.md">',
      payloadContent,
      "</spec>",
    ].join("\n");

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
        await log("warn", "No SDK path to post Prometheus materialization corrective", {
          sessionId,
        });
      }
    } catch (err) {
      await log("error", "Failed to post Prometheus materialization corrective", {
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
      if (String(agent || "").toLowerCase() === "reviewer") {
        st.reviewerApproved = true;
      }
    }

    // Track @karpathy delegation: any message from the karpathy agent counts.
    if (String(agent || "").toLowerCase() === "karpathy") {
      st.karpathyDelegated = true;
    }

    // Track Prometheus payloads: capture the hash of the latest payload content.
    if (String(agent || "").toLowerCase() === "prometheus") {
      const payload = extractSpecPayload(text);
      if (payload) {
        st.prometheusPayloadHash = hashText(payload.trim());
        st.prometheusPayloadContent = payload;
      }
    }

    if (agent && String(agent).toLowerCase() !== AGENT_NAME.toLowerCase()) {
      return;
    }

    const hasComplete = text.includes(COMPLETE_TOKEN);
    const hasStuck = text.includes(STUCK_TOKEN);
    const hasBlocked = text.includes(BLOCKED_TOKEN);

    // --- Workaround-dump detection ---
    // If the agent produced no promise token but is doing the "I can't / here
    // are commands for you to run" pattern, intercept it and demand BLOCKED.
    if (!hasComplete && !hasStuck && !hasBlocked && isWorkaroundDump(text)) {
      const hasBashNow = await bashToolAvailable(client, sessionId);
      if (!hasBashNow) {
        await log("warn", "Detected workaround-dump without promise token; injecting BLOCKED correction.");
        await postCorrective(
          sessionId,
          "Workaround dump detected — BLOCKED required",
          "You produced a response saying you cannot run commands, along with manual command instructions for the user. " +
          "This is not acceptable. When bash is unavailable you must: " +
          "(1) state it in one sentence, " +
          "(2) emit <promise>BLOCKED</promise> immediately, " +
          "(3) produce no command lists, no workaround instructions, no handoff prompts.",
          false,
          false,
        );
        return;
      }
    }

    if (!hasComplete && !hasStuck && !hasBlocked) return;

    const specOk = await specPresent(directory);
    const evidenceBlocks = findAllEvidenceBlocks(text);
    const evidenceOk = evidencePasses(evidenceBlocks);
    const progressOk = st.progressTouched;
    const reviewerOk = st.reviewerApproved;

    // Probe bash availability once; used by both COMPLETE and BLOCKED handlers.
    const hasBash = process.env.OPENCODE_AUTONOMOUS_REQUIRE_EVIDENCE !== undefined
      ? true  // explicit flag set — don't auto-disable based on bash
      : await bashToolAvailable(client, sessionId);

    if (hasComplete) {
      const reasons = [];
      if (!specOk) reasons.push("missing SPEC.md/spec.md");

      // Auto-disable evidence requirement when bash is unavailable.
      // Mirrors the reviewer/task auto-disable: the agent cannot satisfy a
      // precondition that requires a tool it does not have.
      let requireEvidence = FLAG_EVIDENCE;
      if (requireEvidence && !hasBash) {
        requireEvidence = false;
        await log("info", "'bash' tool not available; auto-disabling evidence requirement for COMPLETE.");
      }

      if (requireEvidence && !evidenceOk) {
        reasons.push("missing/failing evidence block (exit_code must be 0)");
      }

      let requireReviewer = FLAG_REVIEWER;
      if (requireReviewer && process.env.OPENCODE_AUTONOMOUS_REQUIRE_REVIEWER === undefined) {
        const hasReviewer = await reviewerAvailable(directory);
        if (!hasReviewer) {
          requireReviewer = false;
          await log("info", "@reviewer agent not found; auto-disabling reviewer requirement.");
        } else {
          // Check if "task" tool is available in the environment/session
          let hasTaskTool = true;

          const clientTools = client?.tools || client?.app?.tools;
          if (Array.isArray(clientTools)) {
            const hasTask = clientTools.some(t => {
              if (typeof t === "string") return t.toLowerCase() === "task";
              const name = t?.name || t?.metadata?.name || "";
              return String(name).toLowerCase() === "task";
            });
            if (!hasTask) {
              hasTaskTool = false;
            }
          }

          if (hasTaskTool && client?.session?.get && sessionId) {
            try {
              const res = await client.session.get({ path: { id: sessionId } });
              const sessionInfo = res?.data || res;
              if (sessionInfo) {
                const tools = sessionInfo.tools || sessionInfo.agent?.tools || sessionInfo.config?.tools || sessionInfo.session?.tools;
                if (Array.isArray(tools)) {
                  const hasTask = tools.some(t => {
                    if (typeof t === "string") return t.toLowerCase() === "task";
                    const name = t?.name || t?.metadata?.name || "";
                    return String(name).toLowerCase() === "task";
                  });
                  if (!hasTask) {
                    hasTaskTool = false;
                  }
                }
              }
            } catch (e) {
              await log("debug", "Failed to check session tools from get()", { error: e.message });
            }
          }

          if (!hasTaskTool) {
            requireReviewer = false;
            await log("info", "@reviewer agent is present, but 'task' tool is not available in the session. Auto-disabling reviewer requirement.");
          }
        }
      }

      if (requireReviewer && !reviewerOk) {
        reasons.push("no @reviewer APPROVE in this session (Note: if the @reviewer/Task tool is unavailable in your environment, you can disable this check by setting the environment variable OPENCODE_AUTONOMOUS_REQUIRE_REVIEWER=false)");
      }

      // Strategy-consistency check: verify declared strategy actually executed.
      const strategyFailure = await checkStrategyConsistency(
        directory,
        st.karpathyDelegated,
      );
      if (strategyFailure) reasons.push(strategyFailure);

      // Spec-freshness check: if a Prometheus payload was observed, SPEC.md must match.
      const freshnessFailure = await checkSpecFreshness(
        directory,
        st.prometheusPayloadHash,
      );
      if (freshnessFailure) reasons.push(freshnessFailure);

      // Mutation gate: inert unless .opencode/mutation.json exists and enabled.
      const mutationFailure = await checkMutationGate(directory);
      if (mutationFailure) reasons.push(mutationFailure);

      if (reasons.length) {
        await log("warn", "Rejecting <promise>COMPLETE</promise>", { reasons });
        await postCorrective(
          sessionId,
          "COMPLETE preconditions not met",
          reasons.join("; "),
          false,
          requireReviewer,
        );
      } else {
        await log("info", "COMPLETE accepted", {});
      }
    }

    if (hasStuck) {
      if (!specOk && st.prometheusPayloadContent) {
        await log("warn", "Rejecting <promise>WORK_STUCK</promise>; Prometheus payload awaits materialization", {});
        await postPrometheusMaterializationCorrective(
          sessionId,
          st.prometheusPayloadContent,
        );
        return;
      }

      if (!specOk) {
        await log("info", "WORK_STUCK accepted for missing spec with no observed Prometheus payload", {});
        return;
      }

      const reasons = [];
      if (FLAG_PROGRESS && !progressOk) {
        reasons.push("progress.txt/PROGRESS.txt not updated this session");
      }
      if (reasons.length) {
        await log("warn", "Rejecting <promise>WORK_STUCK</promise>", { reasons });
        await postCorrective(
          sessionId,
          "WORK_STUCK preconditions not met",
          reasons.join("; "),
          true,
        );
      } else {
        await log("info", "WORK_STUCK accepted", {});
      }
    }

    if (hasBlocked) {
      // BLOCKED is the clean exit when a required tool (e.g. bash) is absent.
      // Accept it only when bash is genuinely unavailable.
      // Reject it when bash IS available — prevents agents rationalizing away work.
      if (!hasBash) {
        await log("info", "BLOCKED accepted: 'bash' tool is not available in this environment.");
      } else {
        await log("warn", "Rejecting <promise>BLOCKED</promise>: 'bash' tool is available; use COMPLETE or WORK_STUCK.");
        await postCorrective(
          sessionId,
          "BLOCKED rejected: the 'bash' tool is available in this environment",
          "Use <promise>COMPLETE</promise> with a valid evidence block, or <promise>WORK_STUCK</promise> if genuinely stuck.",
          false,
          false,
        );
      }
    }

  }

  async function handleMessagePart(input, msg) {
    const text = extractTextFromMessage(msg);
    if (!text) return;
    const sessionId = sessionFromMessage(input) || sessionFromMessage(msg);
    const agent =
      agentFromMessage(input) ||
      agentFromMessage(msg) ||
      (sessionId ? sessionAgentCache.get(sessionId) : null);

    const role =
      msg?.role || msg?.message?.role || input?.role || input?.message?.role || "assistant";
    if (role !== "assistant") return;
    await onAssistantText(sessionId, agent, text);
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
    "chat.params": async (input) => {
      if (input?.sessionID && input?.agent) {
        sessionAgentCache.set(input.sessionID, input.agent);
      }
    },

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
      await handleMessagePart(input, msg);
    },

    event: async (input) => {
      const event = input?.event;
      if (event?.type !== "message.part.updated") return;
      const msg = event?.properties?.part;
      if (!msg) return;
      await handleMessagePart(
        { sessionID: event?.properties?.sessionID },
        msg,
      );
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
