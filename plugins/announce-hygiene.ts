/**
 * Stop local Qwen models seeding their own "announce then stop" failure.
 *
 * The failure: the model writes a sentence promising an action ("Let me fix the
 * mock:") and ends the turn without emitting the tool call. OpenCode replays
 * assistant text back into the conversation, so each occurrence becomes an
 * in-context example of a turn ending that way, and the model copies itself.
 * Measured on ollama-heavy/qwen36-35b-coding by replaying a recorded turn:
 *
 *   history intact                 13/74  (17.6%)
 *   seeded turns removed            0/74  ( 0.0%)   p = 0.000069
 *   intact + system prompt rule     2/50  ( 4.0%)   p = 0.019
 *
 * Removing the seeded turns is the complete fix; the prompt rule alone only
 * reduces the rate. Both are applied here. The rule limits how often a new
 * seed is created, the transform removes any that already exist.
 *
 * Scope: only assistant turns produced by a provider whose id begins "ollama".
 * Claude and GPT never showed this in 24,000 recorded turns, so their history
 * is left alone. Removal cannot orphan a tool result, because a turn holding
 * any tool part is never a candidate.
 *
 * Loader note: OpenCode calls every exported function in a plugin file as a
 * plugin factory, passing { directory, worktree, client }. An exported helper
 * that assumes its own argument type therefore throws during load and takes
 * the whole file down with it. Export the factory and nothing else. The guard
 * at the top of parseRunKpis in autonomous-kpis.ts exists for the same reason.
 *
 * See callisto-system-setup/docs/decisions/
 *   2026-09-04-qwen-announce-then-stop-is-self-seeded.md
 */

import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where each removal is recorded. Resolved per call, not at module load, so an
 * override set after import still applies. A module-level constant here silently
 * wrote test output into the production record.
 */
function auditPath(): string {
  return process.env.OPENCODE_ANNOUNCE_HYGIENE_AUDIT ??
    join(homedir(), ".local/share/opencode/announce-hygiene.jsonl");
}

const RULE = [
  "Intent and action must not be separated. If your reply says you will read,",
  "edit, run, check, or verify something, the tool call for it belongs in this",
  "same turn. Never end a turn with only a description of what you are about to",
  "do next. If there is nothing left to call, report the result instead.",
].join(" ");

const PROMISE_PHRASES = ["Let me ", "I'll fix", "I will fix", "Let's fix"];

type Part = { type?: string; text?: string };
type Info = {
  role?: string;
  finish?: string;
  providerID?: string;
  modelID?: string;
  id?: string;
  sessionID?: string;
};
type Entry = { info?: Info; parts?: Part[] };

/**
 * Whether a turn or request belongs to a local model.
 *
 * This is a prefix match on the provider id from `config.json` and nothing
 * more. It is a naming convention, not enforcement. Keep provider ids for
 * local endpoints prefixed `ollama` or this plugin stops applying.
 *
 * Nothing better is available. `experimental.chat.messages.transform`, which
 * is where the actual repair happens, receives `input: {}`. No model, no
 * session, no config. The only provider signal anywhere in that hook is the
 * `providerID` string stamped on each message, so a match on that string is
 * the only lever there is.
 *
 * Matching today: `ollama` (callisto:11436), `ollama-heavy` (callisto:11435),
 * `ollama-local` (127.0.0.1:11434), and `ollama-light` which appears in older
 * recorded sessions.
 *
 * It fails in two directions, and they are not equally bad:
 *
 * - A local provider named something else, say `qwen-box`, is not covered. The
 *   plugin silently does nothing. The symptom is the audit file staying empty
 *   while sessions still stall, so check that file before assuming the fix is
 *   live.
 * - A remote provider named `ollama-something` would be covered wrongly and
 *   would have turns deleted from its history. Since the action here is
 *   removing messages, this is the worse error of the two.
 *
 * The prefix is a deliberate choice, so that adding another local endpoint
 * needs no edit here. Two stricter designs were considered and rejected for
 * now: an explicit allowlist of provider ids, and deriving the set at plugin
 * init by asking `client` for the provider config and keeping those whose
 * `baseURL` resolves to localhost or the LAN host. The second is the only
 * option where "local" means local rather than "starts with those six
 * letters". Switch to it, or to the allowlist, the moment a provider that is
 * not a local Ollama endpoint gets a name beginning `ollama`.
 */
function isLocalProvider(providerID: unknown): boolean {
  return typeof providerID === "string" && providerID.startsWith("ollama");
}

/**
 * Final assistant text that promises an action instead of taking one.
 *
 * Deliberately narrow. A looser version matched "let me know and I will
 * verify", which is a model correctly waiting on the user, and flagged
 * legitimate endings on every provider.
 */
function announceShape(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const trimmed = text.replace(/\s+$/, "");
  if (!trimmed) return false;
  if (trimmed.endsWith(":")) return true;
  const tail = trimmed.slice(-120);
  return PROMISE_PHRASES.some((phrase) => tail.includes(phrase));
}

/** True when this recorded turn is a seeded announce-then-stop. */
function isSeededTurn(entry: Entry): boolean {
  const info = entry?.info;
  if (!info || info.role !== "assistant" || info.finish !== "stop") return false;
  if (!isLocalProvider(info.providerID)) return false;
  const parts = Array.isArray(entry?.parts) ? entry.parts : [];
  if (parts.some((part) => part?.type === "tool")) return false;
  const text = parts
    .filter((part) => part?.type === "text")
    .map((part) => part?.text ?? "")
    .join("");
  return announceShape(text);
}

/**
 * Provider id for the current request. Only feeds the system-prompt half; the
 * messages hook gets no model and must use the per-turn `providerID` instead.
 * Two shapes are accepted because the SDK `Model` type is not pinned here.
 */
function providerOf(model: unknown): string | undefined {
  if (!model || typeof model !== "object") return undefined;
  const candidate = model as Record<string, any>;
  if (typeof candidate.providerID === "string") return candidate.providerID;
  const provider = candidate.provider;
  if (provider && typeof provider === "object" && typeof provider.id === "string") {
    return provider.id;
  }
  return undefined;
}

async function audit(record: Record<string, unknown>): Promise<void> {
  try {
    await appendFile(auditPath(), JSON.stringify({ at: new Date().toISOString(), ...record }) + "\n");
  } catch {
    // Auditing is best effort. Never let it break a request.
  }
}

export const AnnounceHygiene = async () => {
  return {
    /**
     * Drop seeded turns from the history sent to the model.
     *
     * The hook receives no model context, so scoping is done per turn from the
     * providerID recorded on the turn that produced it. That is the right
     * granularity anyway: a Qwen turn is the thing that contaminates, whoever
     * is being asked to continue from it.
     */
    "experimental.chat.messages.transform": async (
      _input: unknown,
      output: { messages: Entry[] },
    ) => {
      const messages = output?.messages;
      if (!Array.isArray(messages) || messages.length < 2) return;

      const dropped: string[] = [];
      // Never touch the final entry. It is the turn being continued from.
      const kept = messages.filter((entry, index) => {
        if (index === messages.length - 1) return true;
        if (!isSeededTurn(entry)) return true;
        dropped.push(entry.info?.id ?? `index:${index}`);
        return false;
      });

      if (!dropped.length) return;
      output.messages = kept;
      await audit({
        hook: "messages.transform",
        sessionID: messages[0]?.info?.sessionID,
        before: messages.length,
        after: kept.length,
        dropped,
      });
    },

    /**
     * Append the intent/action rule, for local models only. Partial on its own
     * but cheap, and it reduces how often a new seed is produced.
     */
    "experimental.chat.system.transform": async (
      input: { model?: unknown; sessionID?: string },
      output: { system: string[] },
    ) => {
      if (!isLocalProvider(providerOf(input?.model))) return;
      if (!Array.isArray(output?.system)) return;
      if (output.system.some((s) => s.includes("Intent and action must not be separated"))) return;
      output.system.push(RULE);
    },

    /**
     * Test seam. Not a hook name OpenCode dispatches, so it is inert at
     * runtime, and it keeps the predicates reachable without exporting
     * functions the loader would try to call as factories.
     */
    __selftest: { announceShape, isSeededTurn, providerOf, RULE },
  };
};
