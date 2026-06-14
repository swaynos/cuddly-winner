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

### `@prometheus` — Planner with a discovery sandbox

`@prometheus` classifies incoming work into one of two planning tracks and
produces the right artifacts for `@autonomous` to execute.

**Planning tracks:**
- **SPEC track** — implementation/refactor/bugfix work produces `SPEC.md`.
- **Karpathy track** — metric-driven optimization produces `program.md`,
  `.opencode/karpathy.json`, and `.opencode/immutable.json`.

**Discovery intake.** When a pitch is vague or its critical assumptions are
untested, `@prometheus` runs a bounded spike loop in an ephemeral sandbox
(`/tmp/prometheus-spike`) before writing the spec. The sandbox is a temp dir
outside the project; `@prometheus` has free `bash` and `edit` access inside it.
The discovery loop follows an ant-foraging model: surface hidden assumptions,
rank by criticality (make-or-break first), run the cheapest test first, mark
findings proportionally, and let unconfirmed paths evaporate via
milestone-gating. The default spike format is Wizard-of-Oz — simulate the
expensive capability cheaply before building it. The only persistent
project-facing output is `SPEC.md` (and planning siblings); everything in the
sandbox is disposable.

**Enforcement note.** `edit`/`write` tools are config-blocked outside the
sandbox and planning artifacts. Bash side-effects (a script writing to disk)
are not interceptable by the permission layer — the sandbox is a behavioral and
config contract, not an OS-level hermetic jail.

**Persistent outputs:** `SPEC.md`, `program.md`, `experiments.md`,
`.opencode/karpathy.json`, `.opencode/immutable.json`, `AGENTS.md`.

**Permissions:** `bash: ask` (with broad sandbox allows), `edit`/`write`
scoped to planning artifacts and `/tmp/prometheus-spike/**`, `webfetch: allow`,
`question: allow`. `task` allows only `@data-scientist` and `@grounder`.

---

### `@autonomous` — Builder and loop owner

`@autonomous` reads `SPEC.md` and executes every item in its Implementation
Checklist, running verification commands after each change and looping until
all verification exits 0. It owns looping — it reads the strategy directive
from `AGENTS.md` and invokes the appropriate strategy subagent.

**Strategy selection precedence:**
1. Explicit user instruction in the session.
2. `strategy:` field in `SPEC.md`.
3. `## Autonomous Strategy` directive in `AGENTS.md`.
4. Context-based classification (with the Karpathy hard rule applied).

**Karpathy hard rule.** When a task has (or can be given) a scalar metric and a
stable frozen evaluator, `@autonomous` must invoke `@karpathy`. It attempts to
instrument unmeasurable tasks toward measurability before reaching for an exotic
strategy.

**Loop continuity.** The `opencode-autonomous-loop` plugin tracks run state and
posts a continuation nudge when `@autonomous` ends a turn with unchecked
`progress.txt` items and no promise token — preventing silent abandonment.

**Promise contract** (enforced by `opencode-autonomous-gate`):
- `COMPLETE` requires a spec, a green evidence block, and `@reviewer` APPROVE.
- `WORK_STUCK` requires `progress.txt` updated with documented attempts.
- `BLOCKED` is only valid when `bash` is unavailable.

**Permissions:** `bash: ask` (with broad test/build allows), `task` allows
`@data-scientist`, `@grounder`, `@reviewer`, `@karpathy`, `@ralph-wiggum`.

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

Not user-facing. Users invoke `@autonomous`; the strategy directive in `AGENTS.md`
routes to `@karpathy` when appropriate.

---

### `@ralph-wiggum` — Brute-force loop strategy (hidden subagent)

Invoked by `@autonomous` for tasks with no automatable verifier where
brute-force repetition is the right approach. Each iteration reads the current
repo state fresh, attempts progress, commits, and exits. Memory is files and
git history; the LLM context is fresh each iteration. Bounded by a hard
30-iteration cap and a concrete completion check evaluated at the start of
every round.

---

### `@data-scientist` — NotebookLM-grounded researcher (hidden subagent)

Read-only. Queries a project-specified NotebookLM notebook via the NotebookLM
MCP and returns cited evidence. Used by `@prometheus`, `@autonomous`, and
`@ask` when the project context identifies a valid notebook and the MCP
connection is authenticated. Falls back to `@grounder` when unavailable.

The repo's registered notebook is `cuddly-winner-loop-strategies`
(`63e72bfa-9025-435d-909c-1fd35db1d505`), which contains research on loop
strategies, ant-foraging biology, Karpathy/autoresearch, Agile SPIKEs, and
related material.

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
preconditions are not met. Detects and intercepts workaround-dump responses.
Auto-disables the reviewer and evidence requirements when the relevant tools are
unavailable in the session.

### `opencode-autonomous-loop`

Treats each `@autonomous` session as a bounded worker. Persists run state
(`runs.json`, `status.json`) in `.opencode/autonomous-loop/`. Tracks iterations,
promise emissions, spec presence, and progress-file touches per session. Posts
a **continuation nudge** when `@autonomous` ends a turn with unchecked `[ ]`
items in `progress.txt` and no promise token — the primary defence against
premature loop exit. Nudge is deduplicated per turn and cannot busy-loop.

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
to `docs/STRATEGY-CONTRACT.md`: `mode: subagent`, `hidden: true`, `task` allows
`autonomous` + `reviewer` and denies `*`, and the body contains Applicability /
Stop criteria / Escalation sections. Strategies are registered in
`.opencode/strategies.json`.

The selection principle: **force nondeterminism into a deterministic check.**
Karpathy is mandatory when a frozen scalar evaluator exists or can be
constructed. Instrument toward measurability before reaching for an exotic
strategy. Exotic strategies are an admission the task resisted a deterministic
check.

Current registry:

| Strategy | Status | When |
|---|---|---|
| `karpathy` | reference | Scalar metric + frozen evaluator exist or can be constructed. Mandatory. |
| `ralph-wiggum` | active | No automatable verifier; brute-force repeat-until-done. |

---

## Key files

| File | Owner | Purpose |
|---|---|---|
| `SPEC.md` | `@prometheus` | Current task specification for `@autonomous`. |
| `AGENTS.md` | `@prometheus` | Persistent operating contract: git rules, agent routing, autonomous strategy directive. |
| `progress.txt` | `@autonomous` | Runtime run log: checklist, attempts, verification results, strategy selection. |
| `program.md` | `@prometheus` | Karpathy loop objective, metric, constraints, stop criteria. |
| `.opencode/karpathy.json` | `@prometheus` | Deterministic Karpathy loop configuration. |
| `.opencode/immutable.json` | project | Per-project file mutation rules for the immutability plugin. |
| `.opencode/strategies.json` | project | Strategy registry. |
| `docs/STRATEGY-CONTRACT.md` | project | Contract every strategy subagent must satisfy. |
| `foraging-log.md` | `@prometheus` | Discovery spike session log (sandbox artifact, may exist in project root after intake). |

---

## Verification

The test suite covers agents, permissions, skills, plugins, and the strategy
contract without model API keys:

```bash
node --test tests/plugins/*.test.mjs       # plugin unit tests (48 checks)
python3 tests/verify_opencode.py --skip-llm  # agent/permission/registry integration
```

The validator runs checks A (preflight), A2 (strategy registry + contract),
A3 (Prometheus sandbox contract), B–G (binary, isolation, deploy, agent list,
permissions, plugin load), skipping H (plugin hook fires) and I (Prometheus
identity) in `--skip-llm` mode. The `plugin_load` check (G) requires a live
OpenCode startup log and fails deterministically in `--skip-llm` mode; this is
a known, pre-existing limitation unrelated to the agent or plugin code.
