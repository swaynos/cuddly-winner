# Cuddly Winner | OpenCode Loop Agents

A multi-agent autonomous workflow for OpenCode.

## Agents

| Agent | Mode | Role |
|---|---|---|
| `@prometheus` | primary | Interviews you and writes `SPEC.md`. Nothing else. |
| `@router` | primary | No-edit request classifier that routes to the right workflow. |
| `@autonomous` | primary + subagent | Executes against `SPEC.md` in a relentless loop until done. |
| `@karpathy` | primary | Structured iterative improvement: one change, measure, keep or revert. |
| `@grounder` | subagent (hidden) | Read-only RAG/grounding researcher with cited local and external evidence. |
| `@reviewer` | subagent (hidden) | Read-only critic. Returns `APPROVE` or `REQUEST_CHANGES` with evidence. |

## Assumptions

- OpenCode is installed and connected to a model provider.
- macOS or Linux with a working shell. (Windows: use WSL.)

## Repository Layout

```text
.
|-- agents/
|   |-- autonomous.md
|   |-- grounder.md
|   |-- karpathy.md
|   |-- prometheus.md
|   |-- router.md
|   `-- reviewer.md
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

Also install the immutability plugin:

```bash
./scripts/deploy-opencode-agents.sh install --with-plugins
```

Verify deployment:

```bash
./scripts/deploy-opencode-agents.sh status
./scripts/deploy-opencode-agents.sh status --with-plugins
```

Remove:

```bash
./scripts/deploy-opencode-agents.sh remove --with-plugins
```

## Workflow: Prometheus → Autonomous

1. Open a project in OpenCode. Tab to `@prometheus` or type `@prometheus`.
2. Prometheus interviews you (batched questions, 3–5 per turn) until it has
   enough to write a complete, testable spec.
3. It writes `SPEC.md` and stops. That is its entire job.
4. Tab to `@autonomous` (or type `@autonomous`).
5. Autonomous reads `SPEC.md`, implements the checklist, runs the verification
   commands after each change, and loops until everything passes.
6. Before declaring done, it spawns `@reviewer` with the spec and a change
   summary. If the reviewer returns `REQUEST_CHANGES`, it keeps going.
7. When `@reviewer` returns `APPROVE`, autonomous writes a completion summary
   and stops.

If `SPEC.md` is missing when you invoke `@autonomous`, it will tell you to run
`@prometheus` first.

## Workflow: Router -> Specialist

Use `@router` when you know what you want but not which workflow should handle it.
Router never edits files. It classifies the request and hands you a concise next
prompt for `@prometheus`, `@autonomous`, `@karpathy`, or `@grounder`.

## Workflow: Grounding / RAG

`@grounder` is a read-only subagent for evidence gathering. `@prometheus` and
`@autonomous` can invoke it when requirements or implementation depend on current
docs, third-party APIs, or uncertain project conventions. Its output separates
local context, external context, risks, and a recommendation with citations.

## Workflow: Karpathy Loop

Use `@karpathy` when you have a measurable target and want to iterate toward it
with discipline — not flailing, not over-planning.

Required: `program.md` in the project root with the loop objective, metric,
constraints, and stop criteria.

Optional but recommended: `.opencode/karpathy.json` for deterministic, repeatable
loop configuration (exact commands, score source, noise probe). Copy and adapt:

```bash
cp examples/karpathy.json.example .opencode/karpathy.json
```

Karpathy's process:
1. Reads `program.md` and `karpathy.json`. Restates objective and stop criteria.
2. Establishes a baseline measurement.
3. Measures the noise floor (3+ runs with varied seeds).
4. Proposes exactly one change, states the hypothesis.
5. Delegates implementation to `@autonomous` if non-trivial.
6. Runs the measurement. Keeps if improvement > 2× noise floor; reverts otherwise.
7. Calls `@reviewer` with loop rubric and measurement.
8. Repeats until stop criteria are met or 3 consecutive runs with no KEEP.

If `program.md` is missing, Karpathy will tell you to create it first.

## Conventions

**`SPEC.md` is uppercase.** The immutability plugin rejects lowercase variants
(`spec.md`, `Spec.md`) when the marker declares `SPEC.md` as canonical. This
prevents case-insensitive filesystem drift between contributors.

**Status language.** No XML ceremony. Agents report completion with a plain
summary. Blocked agents end their message with `STATUS: BLOCKED — <reason>`.

**Subagents are composable.** `@grounder` can support planning or implementation
with cited evidence. `@reviewer` is spawned by `@autonomous` and `@karpathy` for
reflection and final quality gates.

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

## Autonomous Gate Plugin

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
  `bash: deny`; `@reviewer` and `@grounder` stay read-only — regardless of what
  the project config says.

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

`examples/ml-loop/` is a complete, runnable example of `@karpathy` applied to a
small binary classification problem. No dependencies beyond Python stdlib.

```bash
cd examples/ml-loop
opencode
# then: @karpathy
```

The baseline logistic regression scores ~70–75%. The loop's goal is to reach
≥85% accuracy by making one targeted change per iteration. See
`examples/ml-loop/README.md` for the expected trajectory.

The agent itself is domain-agnostic — the ML example just happens to have a
clean frozen/mutable split and a scalar metric to optimize.

## Verify

Check that all agents, permissions, and the immutability plugin resolve correctly
against a fresh OpenCode install — without touching your real `~/.config/opencode`:

```bash
python3 tests/verify_opencode.py
```

This downloads the latest OpenCode binary into a disposable temp directory, installs
this repo's agents and plugin there, and asserts:

- Every agent loads with the correct mode (`primary`, `subagent`, `all`).
- Every declared permission rule is present in the resolved permission table.
- The immutability plugin appears in OpenCode's startup logs.
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
