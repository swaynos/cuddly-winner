# Cuddly Winner — Agent Suite Specification

This document is the authoritative reference for the cuddly-winner multi-agent
OpenCode workflow. It describes what the system is, how it is designed to work,
what each component must do, and how to verify it. When agents say "read the
spec," this is the file they mean.

---

## Problem

Building software with an AI assistant has two persistent failure modes:

1. **Greedy planning.** The planner commits to the first plausible approach and
   writes a spec around it. The user either rubber-stamps the recommendation or
   redoes the planning work themselves.
2. **Unverified looping.** The executor runs a loop — writing code, running tests,
   fixing failures — but the strategy is implicit, the choices are unrecorded, and
   it is impossible to tell after the fact why a particular path was taken or
   whether the right strategy was chosen.

This project is a solution to both. It separates planning from execution, forces
planning to consider multiple approaches before committing, and forces execution to
record and follow an explicit loop strategy.

---

## What this project is

A multi-agent OpenCode workflow divided along a strict plan/build line:

- `@prometheus` plans and delivers a vetted decision.
- `@autonomous` materializes the plan and executes it in a bounded loop.
- Specialist subagents handle measurement, research, review, and strategy execution.
- Plugins enforce contracts between agents.

---

## Agents

### `@prometheus` — Diverge–converge planner

`@prometheus` is the front-door planning agent. Its reason to exist is to prevent
the greedy-first-idea failure mode: it generates ≥2 genuinely distinct candidate
approaches, compares their tradeoffs, validates the front-runner, and silently
reconsiders from the candidate set if it dies. The user receives a single vetted
recommendation, not a menu.

**Two exits only:**

1. **Decision** — a `<spec filename="SPEC.md">...</spec>` payload with ≥2
   candidates considered, each rejected one with a concrete kill-reason.
2. **Bounce** — a refusal for requests too trivial to benefit from diverge–converge
   planning, with a redirect to `@ask` or `@plan` and an invitation for the user
   to supply alternatives Prometheus may have missed.

There is no third exit. Trivial means bounce, not a single-approach shortcut.

**The diverge–converge loop (internal and silent):**

1. Diverge — enumerate ≥2 approaches that differ in shape, not in tuning.
2. Compare — assess tradeoffs, assumptions, cost, risk, blast radius side by side.
3. Validate the front-runner — confirm assumptions survive reading the repo, docs,
   and constraints. If empirical validation (running code) is needed, note it; do
   not run it — it becomes the first `@autonomous` checklist item.
4. Reconsider if it dies — return to the candidate set and promote the next
   strongest candidate. Repeat until one survives. The death is logged in
   `## Approaches Considered`, not surfaced to the user.

**Contract invariants:**
- Read-only: `bash: deny`, `edit: deny`, `write: deny`.
- Payload-based: every project-facing output is a response payload, never a file
  write.
- 12 declared permission rules (unchanged from current).
- Every SPEC-track payload must contain `## Approaches Considered` with ≥2 entries;
  every rejected entry must have a concrete kill-reason tied to a constraint or
  finding.
- `task` allows only `@data-scientist` and `@grounder`.

**Bounce message (canonical form):**

> "This is straightforward enough that Prometheus isn't the right tool. There's
> one clear path here and no real alternatives to weigh — bring this to `@ask`
> for a quick answer or `@plan` to map out the steps. If you think there are
> competing approaches I'm missing, describe them and I'll weigh them."

---

### `@autonomous` — Builder and loop owner

`@autonomous` materializes Prometheus payloads and executes against `SPEC.md` in a
bounded loop. It owns strategy selection and records it before acting.

**Materialization (first action when payload present):**

If the user message contains `<spec filename="SPEC.md">...</spec>`, write the
enclosed content verbatim to `SPEC.md` before doing anything else. Do not
summarize, reinterpret, or improve the payload. Overwrite an existing `SPEC.md`
if it differs.

**Strategy selection (required before first loop iteration):**

Record in `progress.txt` before the first edit:

```
## Strategy
Selected: <strategy name>
Reason: <one sentence — why this strategy>
```

Selection precedence (highest to lowest):
1. Explicit user instruction in the current session.
2. `strategy:` field in `SPEC.md`.
3. `## Autonomous Strategy` directive in `AGENTS.md`.
4. Context-based classification under the Karpathy hard rule.

**Karpathy hard rule:** If the task has (or can be given) a scalar metric and a
stable frozen evaluator, `@autonomous` MUST invoke `@karpathy`. Instrument before
going exotic; exotic strategies require a recorded reason why instrumentation is
impossible.

**Promise contract (enforced by plugin):**
- `COMPLETE` requires: spec present, green evidence block, reviewer APPROVE.
- `WORK_STUCK` requires: spec present, `progress.txt` updated, ≥3 documented approaches exhausted.
- `BLOCKED` is the only exit when `bash` is unavailable.

---

### `@karpathy` — Metric optimization loop (hidden subagent)

Invoked by `@autonomous` when a task has a scalar metric and a stable frozen
evaluator. Drives structured iterative improvement: one change per iteration,
KEEP only if improvement exceeds 2× noise floor, strategy pivot after 3
consecutive REVERTs, stop after 3 distinct pivots fail. Delegates implementation
back to `@autonomous`; owns the strategy decisions.

---

### `@ralph-wiggum` — Brute-force repeat loop (hidden subagent)

Last resort among loop strategies: only after instrumentation is genuinely
impossible. Each iteration reads the current repo state, makes one attempt,
commits, and exits. Memory is files and git. Hard cap of 30 iterations.

---

### `@octopus` (brain) + `@octopus-arm` (arms) — Coordinator-class strategy (hidden)

For high-risk, multi-lens tasks where a single reviewer pass would miss things.
Admission-gated: Karpathy must be inapplicable, ≥3 distinct non-overlapping risk
lenses must exist, and the cost of missing something must be meaningful.

`@octopus` is the sole builder: it derives personas, dispatches `@octopus-arm`
lenses (pre-build SPEC sensing → build → post-build implementation sensing),
integrates evidence-backed perceptions, and builds. Default 3 arms, max 8, 3
rounds. Never routes arms through `@autonomous`.

`@octopus-arm` is a read-only persona lens: `edit: deny`, `write: deny`, no
`task`. Returns exactly one structured perception per invocation:

```
ARM <persona> PERCEPTION
Lens / Phase / Sensed / Severity / Evidence / Confidence / Actionability / DedupKey / Recommendation
```

---

### `@grounder` — Read-only research (hidden subagent)

Gathers cited local and external evidence. Invoked by `@prometheus` or
`@autonomous` when planning or implementation depends on project facts, third-party
APIs, or undocumented behavior outside the repo.

### `@data-scientist` — NotebookLM-backed research (hidden subagent)

Supersedes `@grounder` when a valid project notebook and NotebookLM MCP connection
are available.

### `@reviewer` — Read-only critic (hidden subagent)

Returns `APPROVE` or `REQUEST_CHANGES` with evidence. Invoked by `@autonomous`
before `COMPLETE` and by `@karpathy` after each experiment.

### `@ask` — Quick answers (primary)

For short, contextual questions where the user wants a concise answer without
planning or implementation.

---

## Plugins

### `opencode-autonomous-gate`

Enforces `@autonomous` promise preconditions. Rejects `COMPLETE` unless: spec
exists, latest message contains a green evidence block (`exit_code: 0`), and
`@reviewer` has produced `APPROVE` in the session (when the `task` tool is
available). Rejects `WORK_STUCK` unless spec exists and `progress.txt` was updated
this session. Intercepts workaround-dump behavior (can't-do statement + code block
without `BLOCKED` token) and injects a corrective.

### `opencode-autonomous-loop`

Tracks run state per session. Posts a continuation nudge when `@autonomous` ends a
turn with unchecked `[ ]` items in `progress.txt` and no promise token. Posts a
stale reminder after 15 minutes of inactivity. Prevents silent abandonment.

### `immutability.ts`

Enforces per-project file mutation rules declared in `.opencode/immutable.json`.
Marker-gated: no-op unless the marker file exists. Supports `readonly` (no agent
may edit), `prometheus_only` (only `@prometheus` may write — note: not recommended
for planning artifacts under the new payload handoff model; use `readonly` for
genuinely frozen files), and per-agent `write_allowlist`. Resolves agent identity
from a `chat.params` session cache with `parentID` chain walk for subagent sessions.

---

## Strategy registry

`.opencode/strategies.json` declares all loop strategies. `@autonomous` reads this
to discover selectable strategies. The Karpathy hard rule always overrides registry
presence on measurable tasks.

| Strategy | Status | When |
|---|---|---|
| `karpathy` | reference | Mandatory when scalar metric + frozen evaluator exist |
| `ralph-wiggum` | active | Last resort; no automatable verifier; after instrumentation fails |
| `octopus` | active | Admission-gated; high-risk multi-lens tasks only |

---

## Prometheus → Autonomous handoff

1. `@prometheus` conducts a diverge–converge loop internally.
2. It returns a `<spec filename="SPEC.md">` payload ending with:
   `Invoke @autonomous to write this SPEC.md verbatim and execute it.`
3. The user invokes `@autonomous` with the payload in the message.
4. `@autonomous` writes the payload verbatim to `SPEC.md` as its first action.
5. `@autonomous` records `## Strategy / Selected: <strategy>` in `progress.txt`.
6. `@autonomous` executes the checklist, delegates to the selected strategy
   subagent if required, runs verification, invokes `@reviewer`, and emits
   `COMPLETE`.

---

## Runtime validation principle

**Configuration proves capability. Logs prove execution.**

Design documents, agent files, and strategy registry entries describe intended
behavior. They are not evidence that behavior occurred. Runtime evidence comes from:
- OpenCode logs (`~/.local/share/opencode/log/`)
- SQLite DB sessions: `session`, `session_message`, `part` tables
- Project artifacts: `progress.txt`, `experiments.md`, `SPEC.md`

A run is materially different from a normal single-agent session only if logs show
child sessions, `task` tool calls to named subagents, strategy entries in
`progress.txt`, metric records in `experiments.md`, or structured arm perceptions.

See `docs/testing-methodology.md` for the full evaluation procedure and reporting
template.

---

## Key files

| File | Owner | Purpose |
|---|---|---|
| `SPEC.md` | `@autonomous` | Project specification (this file). Materialized from Prometheus payloads; updated on scope changes. |
| `AGENTS.md` | project | Operating contract: git rules, agent routing, autonomous strategy directive. |
| `progress.txt` | `@autonomous` | Runtime run log: strategy selection, checklist, attempts, verification results. |
| `program.md` | `@autonomous` | Karpathy loop objective, metric, constraints, stop criteria (materialized from Prometheus payload). |
| `.opencode/karpathy.json` | `@autonomous` | Deterministic Karpathy loop configuration (materialized from Prometheus payload). |
| `.opencode/immutable.json` | project | Per-project file mutation rules for the immutability plugin. |
| `.opencode/strategies.json` | project | Strategy registry. |
| `docs/STRATEGY-CONTRACT.md` | project | Contract every strategy subagent must satisfy. |
| `docs/testing-methodology.md` | project | Runtime validation procedure and reporting template. |

---

## Acceptance Criteria

All of the following must hold on the current main branch:

1. `agents/prometheus.md` has `bash: deny`, `edit: deny`, `write: deny` in its
   frontmatter permission block.
2. `agents/prometheus.md` contains the diverge–converge loop, ≥2 candidate
   requirement, bounce protocol referencing `@ask`/`@plan`, and `## Approaches
   Considered` as a required payload section.
3. `agents/autonomous.md` contains the SPEC payload materialization rule (write
   `<spec filename="SPEC.md">` content verbatim before implementing) and the
   `## Strategy` / `Selected:` recording requirement.
4. `agents/karpathy.md`, `agents/ralph-wiggum.md`, `agents/octopus.md`,
   `agents/octopus-arm.md` conform to `docs/STRATEGY-CONTRACT.md`.
5. The immutability plugin (`plugins/immutability.ts`) is marker-gated; no
   Prometheus-specific always-active guards.
6. `python3 tests/verify_opencode.py --skip-llm` passes checks A–F (the only
   known failure is `plugin_load` at G, which requires a live OpenCode startup log
   and is pre-existing).
7. `node --test tests/plugins/*.test.mjs` passes with no failures.

---

## Verification

```bash
python3 tests/verify_opencode.py --skip-llm
node --test tests/plugins/*.test.mjs
rg -n "Approaches Considered" agents/prometheus.md
rg -n "at least 2|≥2" agents/prometheus.md
rg -n "@ask|@plan" agents/prometheus.md
rg -ni "ant-foraging|like ants" agents/prometheus.md || echo "ok: foraging language removed"
rg -n "verbatim to" agents/autonomous.md
rg -n "## Strategy" agents/autonomous.md
```

---

## Change Log

- 2026-06-15: Prometheus diverge–converge planning contract implemented.
  Replaced ant-foraging with explicit silent loop; added `## Approaches Considered`
  required payload section; bounce protocol added; validator check A3b added.
- 2026-06-15: Unified project specification. Folded the Prometheus-only SPEC.md
  and the full project description into one document. Validation principle and
  testing methodology reference added. All completed checklist items carry forward
  as documented current state.
