# Cuddly Winner — Agent Capabilities

This document describes the current capabilities of the cuddly-winner
autonomous agent suite. It is a reference, not a roadmap.

---

## What this project is

A multi-agent OpenCode workflow. The agents divide work along a strict
plan/build line: `@prometheus` plans and validates; `@autonomous` builds and
loops; specialist subagents handle measurement, research, review, and strategy
execution. Plugins enforce the contracts between them.

---

## Agents

### `@prometheus` — Read-only planner

`@prometheus` classifies incoming work into one of two planning tracks and
returns the right artifact payloads for `@autonomous` to materialize and execute.

**Planning tracks:**
- **SPEC track** — implementation/refactor/bugfix work returns a complete
  `<spec filename="SPEC.md">...</spec>` payload.
- **Karpathy track** — metric-driven optimization returns a `SPEC.md`
  instrumentation payload first, or explicit artifact payloads for `program.md`,
  `.opencode/karpathy.json`, and `.opencode/immutable.json` when the loop is
  already fully specified.

**Discovery intake.** When a pitch is vague or its critical assumptions are
untested, `@prometheus` runs a read-only discovery loop before returning the
spec payload. It uses repository reads, user questions, web research,
`@data-scientist`, or `@grounder`. If validation requires executable probes,
the probe is specified in the `SPEC.md` payload for `@autonomous`; Prometheus
does not run it.

**Autonomous strategy directive.** On every intake, `@prometheus` includes a
`strategy:` field or `## Autonomous Strategy` section inside the `SPEC.md`
payload, recording the strategy directive (`karpathy` by default, or an exotic
strategy if instrumentation is genuinely impossible) and a one-line rationale.

**Persistent outputs:** none. Prometheus returns response payloads only.

**Permissions:** `read`/`glob`/`grep`/`list`/`question`/`webfetch: allow`,
`bash`/`edit`/`write: deny`. `task` allows only `@data-scientist` and
`@grounder`. 15 declared rules.

---

### `@autonomous` — Builder and loop owner

`@autonomous` first materializes any Prometheus `<spec filename="SPEC.md">`
payload from the user message by writing it verbatim to `SPEC.md`. It then reads
`SPEC.md` and executes every item in its Implementation Checklist, running
verification commands after each change and looping until all verification exits
0. It owns looping — it reads the strategy directive from the spec or `AGENTS.md`
and invokes the appropriate strategy subagent.

**Strategy selection precedence:**
1. Explicit user instruction in the session.
2. `strategy:` field in `SPEC.md`.
3. `## Autonomous Strategy` directive in `AGENTS.md`.
4. Context-based classification (with the Karpathy hard rule applied).

**Karpathy hard rule.** When a task has (or can be given) a scalar metric and a
stable frozen evaluator, `@autonomous` must invoke `@karpathy`. It attempts to
instrument unmeasurable tasks toward measurability before reaching for an exotic
strategy. Exotic strategies are a last resort; the reason must be recorded in
`progress.txt`.

**Strategy registry.** `@autonomous` reads `.opencode/strategies.json` to
discover selectable strategies. Registry presence never overrides the Karpathy
hard rule.

**Loop continuity.** The `opencode-autonomous-loop` plugin tracks run state and
posts a continuation nudge when `@autonomous` ends a turn with unchecked
`progress.txt` items and no promise token — preventing silent abandonment.

**Promise contract** (enforced by `opencode-autonomous-gate`):
- `COMPLETE` requires a spec, a green evidence block (`exit_code: 0`), and
  `@reviewer` APPROVE (when reviewer/task available).
- `WORK_STUCK` requires `progress.txt` updated with documented attempts.
- `BLOCKED` is only valid when `bash` is unavailable.

**Permissions:** `bash: ask` (with broad test/build allows), `task` allows
`@data-scientist`, `@grounder`, `@reviewer`, `@karpathy`, `@ralph-wiggum`,
`@octopus`. 23 declared rules.

---

### `@karpathy` — Karpathy loop strategy (hidden subagent)

Invoked by `@autonomous` when a task has a scalar metric and a stable frozen
evaluator. Drives structured, iterative improvement: establish baseline,
measure noise floor, propose exactly one change, measure, KEEP if improvement
exceeds 2× noise floor, REVERT otherwise. Delegates non-trivial implementation
back to `@autonomous`. Calls `@reviewer` after each run.

Reads `program.md` and optionally `.opencode/karpathy.json` for deterministic
loop configuration. Stops when `program.md`'s stop criteria are met, or after
3 distinct strategy pivots each fail to produce a KEEP decision.

Not user-facing. Users invoke `@autonomous`; the strategy directive in
`AGENTS.md` routes to `@karpathy` when appropriate.

---

### `@ralph-wiggum` — Brute-force loop strategy (hidden subagent)

Invoked by `@autonomous` for tasks with no automatable verifier where
brute-force repetition is the right approach. Each iteration reads the current
repo state fresh, attempts progress, commits, and exits. Memory is files and
git history; the LLM context is fresh each iteration. Bounded by a hard
30-iteration cap and a concrete completion check evaluated at the start of
every round.

---

### `@octopus` (brain) + `@octopus-arm` (arms) — Parallel-perception strategy (hidden subagents)

Coordinator-class strategy, split into two agents:

**`@octopus` — the brain, and the sole builder.** It has `edit`/`write`/build
permissions and owns all project mutation. It derives task-specific personas
from the SPEC, dispatches read-only `@octopus-arm` lenses, integrates their
perceptions, and builds. It dispatches arms directly via `task: octopus-arm` —
never through `@autonomous` (which would cause recursion and break read-only
enforcement).

**`@octopus-arm` — a read-only persona lens.** `edit`/`write` denied, no `task`
delegation, read-only bash only. Each arm feels one perspective of the SPEC or
implementation and returns a structured perception: lens, phase, sensed
risk/gap, severity, **evidence** (a concrete anchor or "SPEC-only inference"),
**confidence**, **actionability** (FIX_NOW / DOCUMENT / IGNORE), and a
**DedupKey** so repeated concerns are suppressed across rounds. Each arm must
"pay rent" — a perception without evidence is rejected.

**Admission test (run before choosing Octopus).** All must hold: Karpathy does
not apply; the task has ≥3 distinct non-overlapping risk lenses; the cost of
missing something is meaningful; a single reviewer pass would likely miss
something. Octopus is not a default strategy — for measurable tasks use Karpathy;
for small low-risk features use a normal build + single `@reviewer` pass.

**Two sensing phases around one build:**
1. **Pre-build:** arms feel the SPEC; the brain integrates perceptions into a
   sharper plan.
2. **Build once, informed** — the brain is the sole implementer.
3. **Post-build:** arms feel the actual implementation; the brain revises until
   perceptions are clean or the rounds budget is exhausted.

Bounded: **default 3 arms** (escalate toward the cap of 8 only when the SPEC
justifies more distinct lenses); 3 build→feel→revise rounds. Suited to
high-risk, multidimensional tasks: auth flows, parsers, migrations, public APIs,
compatibility changes.

### `@data-scientist` — NotebookLM-grounded researcher (hidden subagent)

Read-only. Queries a project-specified NotebookLM notebook via the NotebookLM
MCP and returns cited evidence. Used by `@prometheus`, `@autonomous`, and
`@ask` when the project context identifies a valid notebook and the MCP
connection is authenticated. Falls back to `@grounder` when unavailable.

The repo's registered notebook is `cuddly-winner-loop-strategies`
(`63e72bfa-9025-435d-909c-1fd35db1d505`), which contains research on loop
strategies, ant-foraging biology, Karpathy/autoresearch, Agile SPIKEs,
adversarial-debate pipelines, GRPO/verifiable-rewards, and related material.

---

### `@grounder` — Read-only RAG researcher (hidden subagent)

Read-only fallback for evidence gathering when NotebookLM context is absent,
invalid, or unnecessary. Returns cited local and external evidence. Cannot
mutate files. `@data-scientist` supersedes it when a valid notebook and MCP
connection exist.

---

### `@reviewer` — Read-only critic (hidden subagent)

Read-only. Returns `APPROVE` or `REQUEST_CHANGES` with evidence. Called by
`@autonomous` (as a gate before COMPLETE) and `@karpathy` (after each
measurement run). The rubric is passed by the caller — acceptance criteria for
`@autonomous`, loop objective + measurements for `@karpathy`.

---

### `@ask` — Quick-question agent

Answers short questions from session context first, then code context only when
needed. Avoids implementation workflows. Uses a tool-escalation ladder: session
context → clarify → minimal direct evidence → `@data-scientist` (if valid
notebook) → `@grounder`. Read-only; no edits, no bash mutations.

---

## Plugins

### `opencode-autonomous-gate`

Enforces `@autonomous`'s promise contract. Monitors assistant messages for
promise tokens and posts a structured corrective back into the session when
preconditions are not met. Detects and intercepts workaround-dump responses
(can't-do statement + code block without a promise token). Auto-disables the
reviewer and evidence requirements when the relevant tools are unavailable.

### `opencode-autonomous-loop`

Treats each `@autonomous` session as a bounded worker. Persists run state
(`runs.json`, `status.json`) in `.opencode/autonomous-loop/`. Tracks iterations,
promise emissions, spec presence, and progress-file touches per session. Posts
a **continuation nudge** when `@autonomous` ends a turn with unchecked `[ ]`
items in `progress.txt` and no promise token — the primary defence against
premature loop exit. Nudge is deduplicated per turn and cannot busy-loop. Also
posts a stale reminder after 15 minutes of inactivity.

### `immutability.ts`

Enforces per-project file mutation rules declared in `.opencode/immutable.json`.
Supports `readonly` (no agent may edit), `prometheus_only` (only `@prometheus`
may write), and per-agent `write_allowlist`. Resolves agent identity from a
`chat.params` session cache (with `parentID` chain walk for subagent sessions)
so child/delegated sessions inherit the originating agent's identity correctly.
Applies a C1 fail-closed policy: unknown identity only blocks files explicitly
named in a rule; uncovered files are allowed.

---

## Skills

Skills are reusable process playbooks loaded by agents when a task matches
their trigger. Core skills distributed by this repo:

| Skill | Trigger |
|---|---|
| `project-agent-scaffolding` | Deriving project-local agents or skills from a repo's requirements and recurring workflows. |
| `verification-before-completion` | Any task where a completion claim must be backed by fresh command evidence. |
| `systematic-debugging` | Diagnosing a failing test, runtime error, or unexplained behavior. |
| `test-driven-development` | Making a testable production behavior change, bug fix, or API change. |
| `subagent-driven-development` | Executing a plan with independent tasks that can be delegated in parallel. |
| `writing-skills` | Creating, revising, or validating an OpenCode skill. |
| `playwright-image-generation` | Automating web AI image generation or editing with Playwright/CDP. |
| `local-word-document` | Creating a local Word (.docx) document from notes or structured content. |

---

## Strategy framework

Loop strategies are hidden subagents that `@autonomous` invokes. Each conforms
to `docs/STRATEGY-CONTRACT.md` and is registered in `.opencode/strategies.json`.

**Two strategy classes:**

**Single-agent strategies** — one subagent drives the loop alone.
Required contract: `mode: subagent`, `hidden: true`, `task` allows
`autonomous` + `reviewer` and denies `*`, body contains Applicability / Stop
criteria / Escalation sections.

**Coordinator-class strategies** — split into a **brain** (sole builder, has
`edit`/`write`, dispatches arms) and read-only **perception arms** (persona
lenses; no `edit`/`write`, no delegation). The brain dispatches arms directly
(never through `@autonomous`). Arms return evidence-backed perceptions; the brain
owns all mutation. Adding a coordinator strategy requires a `task: <brain>: allow`
entry in `@autonomous`, and the brain must allow its arm (`task: <arm>: allow`).

**The selection principle: force nondeterminism into a deterministic check.**
Karpathy is mandatory when a frozen scalar evaluator exists or can be
constructed. Instrument toward measurability before reaching for an exotic
strategy. Exotic strategies are an admission the task resisted a deterministic
check.

**Current registry:**

| Strategy | Class | Status | When |
|---|---|---|---|
| `karpathy` | single-agent | reference | Scalar metric + frozen evaluator — mandatory. |
| `ralph-wiggum` | single-agent | active | No automatable verifier; brute-force sequential. |
| `octopus` (+`octopus-arm`) | coordinator | active | High-risk, multi-lens tasks; brain builds, read-only arms perceive. Admission-gated; default 3 arms, 3 rounds. |

---

## Key files

| File | Owner | Purpose |
|---|---|---|
| `SPEC.md` | `@prometheus` | Current task specification for `@autonomous` (or capability reference when no active task). |
| `AGENTS.md` | `@prometheus` | Persistent operating contract: git rules, agent routing, autonomous strategy directive. |
| `progress.txt` | `@autonomous` | Runtime run log: checklist, attempts, verification results, strategy selection. |
| `program.md` | `@prometheus` | Karpathy loop objective, metric, constraints, stop criteria. |
| `.opencode/karpathy.json` | `@prometheus` | Deterministic Karpathy loop configuration. |
| `.opencode/immutable.json` | project | Per-project file mutation rules for the immutability plugin. |
| `.opencode/strategies.json` | project | Strategy registry. |
| `docs/STRATEGY-CONTRACT.md` | project | Contract every strategy subagent must satisfy. |
| `docs/strategy-template.md` | project | Copy-to-create scaffold for new strategy subagents. |

---

## Verification

The test suite covers agents, permissions, skills, plugins, and the strategy
contract without model API keys:

```bash
node --test tests/plugins/*.test.mjs       # plugin unit tests
python3 tests/verify_opencode.py --skip-llm  # agent/permission/registry integration
```

The validator runs checks A (preflight), A2 (strategy registry + contract),
A3 (Prometheus read-only handoff contract), A4 (Octopus brain/arm split), B–G
(binary, isolation, deploy, agent list, permissions, plugin load), skipping H
(plugin hook fires) and I (Prometheus identity) in `--skip-llm` mode.

The `plugin_load` check (G) requires a live OpenCode startup log and fails
deterministically in `--skip-llm` mode; this is a known, pre-existing
limitation unrelated to agent or plugin code. All other checks pass.
