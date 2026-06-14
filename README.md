# Cuddly Winner | OpenCode Loop Agents

A multi-agent autonomous workflow for OpenCode.

## Agents

| Agent | Mode | Role |
|---|---|---|
| `@ask` | primary | Quick questions and concise answers from session context first. |
| `@prometheus` | primary | Front-door planner: interviews, runs discovery spikes in an ephemeral sandbox to validate assumptions, produces evidence-backed `SPEC.md` or Karpathy loop artifacts, and records the autonomous strategy directive in `AGENTS.md`. |
| `@autonomous` | primary + subagent | Executes against `SPEC.md` in a relentless loop until done. Owns looping — selects and invokes the appropriate loop strategy subagent. |
| `@karpathy` | subagent (hidden) | Karpathy loop strategy — mandatory when a task has a scalar metric and a stable frozen evaluator. |
| `@ralph-wiggum` | subagent (hidden) | Ralph Wiggum loop strategy — brute-force repeat-until-done; fresh context each iteration; memory is files + git; bounded by a hard iteration cap. For tasks that resist instrumentation. |
| `@data-scientist` | subagent (hidden) | NotebookLM-backed research and analysis. Supersedes `@grounder` when a valid project notebook and NotebookLM MCP connection are available. |
| `@grounder` | subagent (hidden) | Read-only RAG/grounding researcher with cited local and external evidence. |
| `@reviewer` | subagent (hidden) | Read-only critic. Returns `APPROVE` or `REQUEST_CHANGES` with evidence. |

## Assumptions

- OpenCode is installed and connected to a model provider.
- macOS or Linux with a working shell. (Windows: use WSL.)

## Repository Layout

```text
.
|-- agents/
|   |-- ask.md
|   |-- autonomous.md
|   |-- data-scientist.md
|   |-- grounder.md
|   |-- karpathy.md
|   |-- prometheus.md
|   `-- reviewer.md
|-- .opencode/
|   `-- skills/                       Core OpenCode skills distributed by this repo
|-- plugins/
|   |-- immutability.ts                 Global plugin — enforces per-project file rules
|   `-- opencode-autonomous-gate/       Plugin package — enforces @autonomous promise contract
|-- examples/
|   |-- immutable.json.example  Marker file template for the immutability plugin
|   |-- karpathy.json.example   Deterministic loop config template for @karpathy
|   |-- trusted-project.json.example  Pre-authorize agents for a trusted project
|   `-- ml-loop/                Complete runnable @karpathy example (pure Python, no deps)
|       |-- prepare.py          Frozen evaluator — do not edit
|       |-- train.py            Mutable target — agent improves this
|       |-- program.md          Loop objective, constraints, stop criteria
|       `-- .opencode/          Per-project config (karpathy.json + immutable.json)
|-- scripts/
|   `-- deploy-opencode-agents.sh
`-- .opencode-deploy.local.env.example
```

## Install

Deploy agents globally (symlinked by default):

```bash
./scripts/deploy-opencode-agents.sh install
```

Also install core skills and the immutability plugin:

```bash
./scripts/deploy-opencode-agents.sh install --with-skills --with-plugins
```

Verify deployment:

```bash
./scripts/deploy-opencode-agents.sh status
./scripts/deploy-opencode-agents.sh status --with-skills --with-plugins
```

Remove:

```bash
./scripts/deploy-opencode-agents.sh remove --with-skills --with-plugins
```

## Workflow: Prometheus Intake

Start with `@prometheus` when you are not sure whether work should be
spec-driven execution or a metric optimization loop.

Prometheus classifies and outputs one of two paths, and always records an
`## Autonomous Strategy` directive in `AGENTS.md`:

1. **SPEC path** (implementation/refactor/bugfix):
   - Writes `SPEC.md`
   - Records strategy directive in `AGENTS.md` (default: `karpathy` where measurable, otherwise `auto`)
   - Handoff: run `@autonomous`

2. **Karpathy path** (iterative metric optimization):
   - Writes `program.md`
   - Writes `.opencode/karpathy.json`
   - Writes `.opencode/immutable.json`
   - Records `strategy: karpathy` in `AGENTS.md`
   - Optional: initializes `experiments.md`
   - Handoff: run `@autonomous` (which invokes `@karpathy` internally)

If Karpathy intent is clear but instrumentation is missing, Prometheus writes a
`SPEC.md` for instrumentation and includes proposed code in markdown code blocks.
It does not write executable source files itself; run `@autonomous` first.

## Workflow: Prometheus -> Autonomous

1. Open a project in OpenCode. Tab to `@prometheus` or type `@prometheus`.
2. Prometheus interviews you (batched questions, 3–5 per turn) until it has
   enough to write a complete, testable spec.
3. It writes `SPEC.md`, records the strategy directive in `AGENTS.md`, and stops.
4. Tab to `@autonomous` (or type `@autonomous`).
5. Autonomous reads `SPEC.md` and the `AGENTS.md` strategy directive. If the
   strategy is `karpathy` (and a scalar metric + frozen evaluator exist), it
   invokes `@karpathy` to run the loop. Otherwise it executes the SPEC checklist
   directly, running verification commands after each change.
6. Before declaring done, it spawns `@reviewer` with the spec and a change
   summary. If the reviewer returns `REQUEST_CHANGES`, it keeps going.
7. When `@reviewer` returns `APPROVE`, autonomous writes a completion summary
   and stops.

If `SPEC.md` is missing when you invoke `@autonomous`, it will tell you to run
`@prometheus` first.

## Workflow: Quick Questions (`@ask`)

Use `@ask` for short, contextual questions where you want a concise answer and
do not want planning or implementation.

- `@ask` uses session context first, then code context only when needed.
- It avoids edits, bash, and implementation workflows.
- It uses a tool-escalation ladder: session context -> clarify intent -> minimal
  direct evidence -> `@data-scientist` for valid NotebookLM-backed research,
  otherwise `@grounder` for broad/noisy research.
- It is tool-light by default (not tool-never): web/local evidence is used only
  when the wording implies it.
- If evidence is missing, it can invoke `@data-scientist` or `@grounder` and
  return a compact summary.

When to use `@ask` vs others:

- Use `@ask` for “what does this mean?”, “did we already do X?”, and quick tradeoff checks.
- Use `plan` (built-in) when you explicitly want an implementation plan.
- Use `plan` with the `project-agent-scaffolding` skill when you want project-local agents or skills for the current repo.
- Use `@prometheus` when you need a new or improved `SPEC.md` or loop setup artifacts.
- Use `@autonomous` when a `SPEC.md` exists and you want execution — it handles both spec-driven work and metric loops (selecting `@karpathy` automatically when the strategy calls for it).
- Use `@data-scientist` when the task is evidence gathering itself and the
  project specifies a valid NotebookLM notebook with an authenticated MCP
  connection; otherwise use `@grounder`.
- Use `@reviewer` for formal approve/request-changes review.

## Workflow: Project Agent Scaffolding

Use `plan` with the `project-agent-scaffolding` skill when you want local
OpenCode support tailored to a target repo's stack, risks, and recurring
workflows.

This keeps a **core + project pack** model:

- This repo provides the stable global core agents and skills.
- Target repos can add project-local definitions under `.opencode/agents/` and
  `.opencode/skills/`.
- Project-local definitions capture domain, stack, team, or repo-specific needs.
- Proven project-local definitions can become promotion candidates, but only with
  explicit user approval.
- Do not add a global `@project-curator` by default; if a repo needs guided
  curation, add a curator/bootstrap agent to that repo's `.opencode/agents/`
  only after approval.

Typical use cases:

- Create a `@billing-reviewer` for a SaaS repo with risky Stripe webhook logic.
- Add an `@a11y-reviewer` for a frontend repo where accessibility is often missed.
- Archive an obsolete project-local agent with broad permissions.
- Generate `.opencode/agents/README.md` so humans know which local agent to invoke.

Scaffolding rules:

- It inventories project context and existing `.opencode/` definitions first.
- It proposes `add`, `update`, `keep`, `archive`, `delete`, and
  `promote-candidate` classifications before editing.
- It asks approval before creating, updating, archiving, or deleting files.
- It archives by default; deletion requires explicit confirmation.
- It writes routing guidance in `.opencode/AGENTS.md` or
  `.opencode/agents/README.md`.
- It reminds you to restart OpenCode after agent, skill, plugin, or config changes.

## Agent Skills

Agents are the team roster; skills are the reusable process handbook. The core
skills in `.opencode/skills/` encode discipline that agents can load when a task
matches the trigger.

| Skill | Use |
|---|---|
| `project-agent-scaffolding` | Derive project-local agents or skills from requirements, architecture, risks, or recurring workflows. |
| `verification-before-completion` | Require fresh command or inspection evidence before completion claims. |
| `systematic-debugging` | Diagnose failures with root-cause-first debugging before fixes. |
| `test-driven-development` | Enforce failing-test-first discipline for testable production changes. |
| `subagent-driven-development` | Dispatch focused subagents with explicit briefs, escalation, and review. |
| `writing-skills` | Create or revise skills with validation and pressure scenarios. |
| `playwright-image-generation` | Automate web AI image generation/editing safely with Playwright/CDP, verified image capture, failure recording, and dataset protection. |

OpenCode loads agents, skills, plugins, and config at startup. Quit and restart
OpenCode after changing any of these files.

## Workflow: Grounding / RAG

Project NotebookLM notebook:
https://notebooklm.google.com/notebook/63e72bfa-9025-435d-909c-1fd35db1d505

`@data-scientist` is the preferred grounding subagent when the project context
specifies a NotebookLM notebook and the NotebookLM MCP connection is valid. It
queries NotebookLM with the required `Referencing the 'Role/Instructions' note,
analyze...` preface, then separates notebook evidence, local facts, analysis,
risks, and a recommendation.

`@grounder` remains the read-only fallback for evidence gathering when NotebookLM
context is absent, invalid, ambiguous, or unnecessary. `@prometheus` and
`@autonomous` can invoke either subagent when requirements or implementation
depend on current docs, third-party APIs, uncertain project conventions, or
project knowledge outside the repo.

## Looping Strategy: Karpathy-First

`@autonomous` owns looping. It selects a strategy based on context, with this
precedence: explicit user instruction > `strategy:` field in `SPEC.md` >
`## Autonomous Strategy` directive in `AGENTS.md` > context-based default.

**The core principle: force nondeterminism into a deterministic check.**

The Karpathy strategy is mandatory whenever a task has (or can be given) a
scalar metric and a stable frozen evaluator. It converts "is this better?" into
a repeatable hard yes/no by measuring baseline → noise floor → keep only if
improvement exceeds 2× noise. This discipline is the goal; exotic strategies are
a last resort.

**Instrument before going exotic.** When a task is not naturally measurable,
`@autonomous` first attempts to add a scalar metric and a frozen evaluator. Only
if that genuinely fails may it select a different strategy — and it must record
why in `progress.txt`.

**Exotic strategies are named subagents** that `@autonomous` invokes only after
the instrument-first step has failed. An exotic strategy is an admission that
the task resisted a deterministic check. Current exotic strategies:

| Strategy | When to use |
|---|---|
| Ralph Wiggum | Brute-force repeat-until-done for tasks with no meaningful scalar metric — high variability, no stable evaluator, or purely creative/exploratory work. |

Future strategies (animal-kingdom, game-design AI, refined practice) follow the
same pattern: each is a hidden subagent `@autonomous` can invoke, documented
here when added.

## Workflow: Karpathy Loop (via `@autonomous`)

Use `@prometheus` to set up the loop artifacts, then run `@autonomous`.
`@autonomous` reads the strategy directive from `AGENTS.md` and invokes
`@karpathy` internally when the strategy is `karpathy`.

Required: `program.md` in the project root with the loop objective, metric,
constraints, and stop criteria.

Optional but recommended: `.opencode/karpathy.json` for deterministic, repeatable
loop configuration (exact commands, score source, noise probe). Copy and adapt:

```bash
cp examples/karpathy.json.example .opencode/karpathy.json
```

Karpathy's process (executed by the `@karpathy` strategy subagent):
1. Reads `program.md` and `karpathy.json`. Restates objective and stop criteria.
2. Establishes a baseline measurement.
3. Measures the noise floor (3+ runs with varied seeds).
4. Proposes exactly one change, states the hypothesis.
5. Delegates implementation to `@autonomous` if non-trivial.
6. Runs the measurement. Keeps if improvement > 2× noise floor; reverts otherwise.
7. Calls `@reviewer` with loop rubric and measurement.
8. Repeats until stop criteria are met or 3 consecutive runs with no KEEP.

If `program.md` is missing, Karpathy will tell you to create it first.

## Strategy-Authoring Framework

New loop strategies are added as **hidden subagents** that conform to a shared
contract. The framework has four parts:

- **Contract** (`docs/STRATEGY-CONTRACT.md`) — the required shape of any strategy
  subagent: `mode: subagent` + `hidden: true` frontmatter, a `task` posture that
  allows `autonomous` + `reviewer` and denies everything else, and three
  mandatory body sections: **applicability**, **bounded stop criteria**, and
  **escalation**. Open-ended / "run forever" strategies are forbidden by the
  contract.
- **Registry** (`.opencode/strategies.json`) — a declarative list of strategies
  with `name`, `agent`, `applicability`, and `status` (`active` / `reference` /
  `planned`). `@autonomous` reads this to discover selectable strategies.
  `karpathy` is the `reference` entry; `ralph-wiggum` is a `planned` slot.
- **Template** (`docs/strategy-template.md`) — a copy-to-create scaffold with
  every required section as fill-in placeholders.
- **Validation** — `tests/verify_opencode.py` loads the registry and fails any
  non-conformant or open-ended strategy.

**Adding a strategy requires no edit to `@autonomous`.** Drop a conformant agent
file in `agents/` (or `.opencode/agents/`), add a registry entry with status
`active`, and restart OpenCode. The registry never overrides the Karpathy hard
rule: if a task is measurable, Karpathy is mandatory regardless of what else the
registry lists.

`@karpathy` is the reference implementation — read it alongside the contract when
authoring a new strategy.

## Conventions

**`SPEC.md` is uppercase.** The immutability plugin rejects lowercase variants
(`spec.md`, `Spec.md`) when the marker declares `SPEC.md` as canonical. This
prevents case-insensitive filesystem drift between contributors.

**Status language.** No XML ceremony. Agents report completion with a plain
summary. Blocked agents end their message with `STATUS: BLOCKED — <reason>`.

**Subagents are composable.** `@data-scientist` can support planning or
implementation with NotebookLM-backed cited evidence when valid notebook context
exists; `@grounder` handles the non-NotebookLM fallback. `@reviewer` is spawned
by `@autonomous` and `@karpathy` for reflection and final quality gates.

**`@reviewer` is composable.** Both `@autonomous` and `@karpathy` spawn it.
The caller passes the rubric as Task input — acceptance criteria for Autonomous,
loop objectives + measurements for Karpathy. Reviewer adapts its grading to
whatever rubric it receives.

## Immutability Plugin

The `plugins/immutability.ts` plugin enforces file-level rules per project.
It is a no-op unless `.opencode/immutable.json` exists in the project.

Copy and adapt the example:

```bash
mkdir -p .opencode
cp examples/immutable.json.example .opencode/immutable.json
```

Supported rules:

```json
{
  "readonly":          ["prepare.py"],   // no agent may edit
  "prometheus_only":   ["SPEC.md"],      // only @prometheus may edit
  "write_allowlist": {
    "prometheus":      ["SPEC.md"]       // @prometheus may ONLY write this file
  }
}
```

The plugin also rejects case-variants of canonical filenames (e.g. `spec.md`
when `SPEC.md` is declared).

## Autonomous Plugins

This repo ships two autonomous-related plugins under `plugins/`:

- `immutability.ts` enforces per-project file mutation rules.
- `opencode-autonomous-gate/` enforces `@autonomous` promise semantics.
- `opencode-autonomous-loop/` persists run state across bounded autonomous sessions.

### Autonomous Gate Plugin

`plugins/opencode-autonomous-gate/` is a global OpenCode plugin that enforces the
@autonomous agent's promise contract. It activates automatically once deployed
(`--with-plugins`) and is a no-op for any agent other than `@autonomous`.

What it enforces:

- `<promise>COMPLETE</promise>` is only accepted when:
  - `SPEC.md` or `spec.md` is present in the project root
  - The assistant message contains a fenced JSON evidence block with
    `command` and `exit_code: 0`
  - `@reviewer` has produced `APPROVE` in the same session
- `<promise>WORK_STUCK</promise>` is only accepted when:
  - A spec file is present
  - `progress.txt` (or `PROGRESS.txt`) has been updated in this session

If preconditions fail, the plugin posts a structured corrective user message
back into the session telling the agent exactly what to fix.

Feature flags (environment variables, defaults shown):

- `OPENCODE_AUTONOMOUS_REQUIRE_REVIEWER=true`
- `OPENCODE_AUTONOMOUS_REQUIRE_EVIDENCE=true`
- `OPENCODE_AUTONOMOUS_REQUIRE_PROGRESS_UPDATE=true`
- `OPENCODE_AUTONOMOUS_AGENT_NAME=autonomous`

Evidence block format (strict):

```json
{
  "command": "python -m pytest -q",
  "exit_code": 0,
  "excerpt": "...tail of output..."
}
```

Limitations:

- The plugin cannot prevent the promise token from being emitted; it reacts
  immediately after, forcing the agent to iterate until preconditions hold.
- Reviewer detection matches a literal `APPROVE` token produced by `@reviewer`
  in the same session.

### Autonomous Loop Plugin

`plugins/opencode-autonomous-loop/` is a companion plugin that treats each
`@autonomous` session as a bounded worker and persists supervisor-style state in
project files.

Persisted files:

- `.opencode/autonomous-loop/runs.json` (durable per-run/session state)
- `.opencode/autonomous-loop/status.json` (machine-readable status snapshot)

What it tracks:

- Run lifecycle (`running`, `blocked`, `complete`)
- Iteration counts per session/run id
- Spec presence/hash (`SPEC.md`, `spec.md`, `docs/SPEC.md`, `docs/spec.md`)
- `progress.txt` touch events and promise emissions
- Last evidence block metadata when `COMPLETE` is emitted

This gives a durable orchestration surface without turning `@autonomous` itself
into an infinite process. The agent remains the bounded implementation engine;
the plugin acts as lightweight supervisor state.

Durability rules (operational contract):

- Treat each autonomous session as a disposable worker, never a forever process.
- Use deterministic run keys (`run_id` + sequence/iteration) so retries are idempotent.
- Checkpoint progress after each successful step instead of batching updates.
- Keep short activity leases and detect stale runs with heartbeat-style inactivity checks.
- Requeue retryable failures with exponential backoff + jitter; cap retries per item.
- Use a circuit-breaker pause for repeated systemic failures before resuming.

Practical "unlimited" means:

- Restarting OpenCode does not lose progress.
- Stalled sessions are detected and resumed.
- Retryable failures recover automatically later.
- Duplicate work is minimized by durable run keys and persisted state.

## Trusted Project Mode

By default, agents prompt for permission before running shell commands, editing
files, or fetching URLs. In projects where you trust the agent to run without
interruption, you can pre-authorize everything at the project level.

Copy the template:

```bash
mkdir -p .opencode
cp examples/trusted-project.json.example .opencode/opencode.json
```

This creates a project-scoped `opencode.json` that pre-authorizes `bash`, `edit`,
`write`, `read`, and `webfetch` without prompting. Paths outside the project still
require confirmation (`external_directory: ask`).

**Important interactions:**

- **Per-agent permissions still win.** Agent files declare their own `permission:`
  blocks that take precedence over this project config. `@prometheus` stays
  `bash: deny`; `@reviewer`, `@data-scientist`, and `@grounder` stay read-only —
  regardless of what the project config says.

- **Immutability plugin still fires.** `.opencode/immutable.json` rules are enforced
  by a plugin hook, not a permission rule. `edit: allow` in the project config does
  not let an agent overwrite a `readonly` or `prometheus_only` file.

- **Restart required.** opencode loads config at startup. Quit and restart after
  creating the file.

- **Sudo is unaffected.** `bash: allow` stops opencode from prompting. If a command
  requires sudo, the OS still enforces its own password requirement.

**Git hygiene:** Consider adding `.opencode/opencode.json` to `.gitignore` in shared
repos so contributors can opt in individually rather than inheriting your trust level.

## Karpathy Loop Example

`examples/ml-loop/` is a complete, runnable example of the Karpathy loop strategy
applied to a small binary classification problem. No dependencies beyond Python stdlib.
Invoke `@autonomous` (it reads the `AGENTS.md` strategy directive and delegates
to `@karpathy` automatically):

```bash
cd examples/ml-loop
opencode
# then: @autonomous
```

The baseline logistic regression scores ~70–75%. The loop's goal is to reach
≥85% accuracy by making one targeted change per iteration. See
`examples/ml-loop/README.md` for the expected trajectory.

The agent itself is domain-agnostic — the ML example just happens to have a
clean frozen/mutable split and a scalar metric to optimize.

## Verify

Check that all agents, permissions, and plugins resolve correctly
against a fresh OpenCode install — without touching your real `~/.config/opencode`:

```bash
node --test tests/plugins/*.test.mjs
python3 tests/test_skill_coverage.py --skip-llm
python3 tests/verify_opencode.py
```

This downloads the latest OpenCode binary into a disposable temp directory, installs
this repo's agents and plugin there, and asserts:

- Every agent loads with the correct mode (`primary`, `subagent`, `all`).
- Every declared permission rule is present in the resolved permission table.
- All expected plugins appear in OpenCode's startup logs.
- The deploy script's install, status, and remove actions all behave correctly.

If `OPENAI_API_KEY` is available, the script also makes one cheap LLM call to
confirm the plugin's hook actually blocks forbidden file edits end-to-end. The
validator auto-loads `OPENAI_API_KEY` from `.env` or `.opencode-deploy.local.env`
if it is not already exported in your shell. Skip this check with `--skip-llm`.

The sandbox is deleted on exit. Pass `--keep-sandbox` to inspect it on failure.

## Local Config

```bash
cp .opencode-deploy.local.env.example .opencode-deploy.local.env
```

Override deploy paths without passing CLI flags every time.
