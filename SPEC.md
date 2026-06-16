# Cuddly Winner — Project Reference

`cuddly-winner` is a deployable OpenCode agent suite for spec-driven autonomous
implementation. It packages a core agent roster, loop-strategy subagents,
runtime-enforcement plugins, reusable skills, examples, and a validation suite.

## Repository Layout

```text
.
|-- AGENTS.md                         Project-level agent rules and defaults
|-- README.md                         User-facing workflow and install docs
|-- agents/                           Core agents and hidden strategy subagents
|-- docs/
|   |-- STRATEGY-CONTRACT.md          Contract every strategy subagent must satisfy
|   |-- CONVENTIONS.md                Shell/script portability rules (macOS + Linux)
|   `-- testing-methodology.md        Runtime evidence evaluation procedure
|-- examples/
|   |-- immutable.json.example        Immutability plugin marker template
|   |-- trusted-project.json.example  Project-scoped trusted-mode config template
|   |-- karpathy.json.example         Karpathy loop config template
|   |-- memory-template/              Project-local memory note template
|   `-- ml-loop/                      Runnable Karpathy loop demo (stdlib only)
|-- plugins/
|   |-- immutability.ts               File-mutation enforcement plugin
|   |-- opencode-autonomous-gate/     Promise-semantics enforcement plugin
|   |-- opencode-autonomous-loop/     Durable run-state supervisor plugin
|   `-- shared/evidence.js            Shared evidence-block parser
|-- scripts/
|   `-- deploy-opencode-agents.sh     Install / status / remove the suite
|-- tests/
|   |-- verify_opencode.py            Sandbox-isolated integration validator
|   |-- audit_run.py                  Runtime behavior auditor (DB + artifacts)
|   |-- test_skill_coverage.py        Skill frontmatter and structure validator
|   |-- test_skill_pressure.py        Skill pressure/scenario tests
|   `-- plugins/                      Node plugin unit tests
`-- .opencode/
    |-- strategies.json               Strategy registry
    |-- skills/                       Core reusable skills
    `-- package.json                  Plugin dependency manifest
```

## Agents

Ten core agents in `agents/`. All deployed globally via the deploy script.

| Agent | Mode | Role |
|---|---|---|
| `@ask` | primary | Lightweight question-answering; escalates to `@data-scientist` or `@grounder` for evidence. |
| `@prometheus` | primary | Read-only diverge–converge planner. Returns one vetted `SPEC.md` payload (≥2 candidate approaches, concrete kill-reasons) or bounces trivial work to `@ask`/`@plan`. No `bash`, `edit`, or `write`. |
| `@autonomous` | all | Spec-driven execution agent. Reads `SPEC.md`, records strategy in `progress.txt` before the first edit, executes the checklist, runs verification, calls `@reviewer`, and emits promise tokens only when plugin preconditions hold. |
| `@karpathy` | subagent (hidden) | Metric-driven loop strategy. Measures baseline, noise floor, proposes one change, KEEP/REVERT per iteration. Reference implementation of the strategy contract. |
| `@ralph-wiggum` | subagent (hidden) | Brute-force repeat-until-done strategy. Fresh context each iteration; state in files and git; hard iteration cap. |
| `@octopus` | subagent (hidden) | Coordinator-class strategy. Sole builder; dispatches read-only `@octopus-arm` perception lenses pre-build and post-build; admission-gated. |
| `@octopus-arm` | subagent (hidden) | Read-only perception arm for `@octopus`. Returns one structured perception; cannot build, edit, write, or delegate. |
| `@data-scientist` | subagent (hidden) | NotebookLM-grounded research. Supersedes `@grounder` when a valid project notebook is configured and the NotebookLM MCP connection is authenticated. |
| `@grounder` | subagent (hidden) | Read-only local/external evidence researcher with citations. Fallback when NotebookLM context is unavailable. |
| `@reviewer` | subagent (hidden) | Strict read-only reviewer. Returns `APPROVE` or `REQUEST_CHANGES` with evidence. Invoked by `@autonomous` before `COMPLETE` and by `@karpathy` after each experiment. |

## Strategy System

**Karpathy-first invariant:** Karpathy is mandatory whenever a task is an
iterative optimization/search problem with a scalar metric and a stable frozen
evaluator. Exotic strategies may only be selected after the instrument-first
step fails, with the reason recorded in `progress.txt`.

**Selection precedence:** explicit user instruction > `strategy:` in `SPEC.md` >
`## Autonomous Strategy` in `AGENTS.md` > context default.

**Karpathy is not a label for ordinary implementation.** A test suite is required
verification for `@autonomous`; it is not a Karpathy optimization harness. Karpathy
requires `program.md`, `.opencode/karpathy.json`, a baseline command, a score
source, a noise probe, and identified mutable/immutable targets.

Current registry (`.opencode/strategies.json`):

| Strategy | Status | Applicability |
|---|---|---|
| `karpathy` | reference | Iterative optimization with scalar metric + frozen evaluator; keep only if improvement > 2× noise floor. |
| `ralph-wiggum` | active | Last-resort after instrumentation fails; no automatable verifier; fresh context each iteration. |
| `octopus` | active | Admission-gated coordinator for high-risk, multi-lens tasks where Karpathy is inapplicable. |

Strategy contract requirements (`docs/STRATEGY-CONTRACT.md`):
- `mode: subagent`, `hidden: true`.
- Task posture: allows `reviewer`, denies `*`, plus delegation target.
- Body must contain: applicability, bounded stop criteria, escalation.
- Open-ended strategies are invalid.

Coordinator-class strategies additionally require separated brain/arm permissions,
an admission test, arm count default 3 / cap 8, and a bounded rounds budget (3).

## Prometheus Contract

`@prometheus` is read-only and payload-based:

- Permissions: `bash: deny`, `edit: deny`, `write: deny`.
- Runs the diverge–converge loop internally: generate ≥2 distinct-shape candidates,
  compare, validate the front-runner, silently reconsider if it dies.
- Two exits only: a vetted `<spec filename="SPEC.md">` payload, or a bounce to
  `@ask`/`@plan` for genuinely trivial requests.
- Payload rules: no explanatory prose before the `<spec>` block; all audit material
  inside the payload under `## Approaches Considered`; ends with:
  `Invoke @autonomous to write this SPEC.md verbatim and execute it.`
- `strategy: karpathy` is only valid in a payload when the payload includes the
  Karpathy harness artifacts or the checklist explicitly builds them first.

## Autonomous Contract

`@autonomous` owns implementation and looping:

- Materializes any visible Prometheus `<spec filename="SPEC.md">` payload verbatim
  before implementing. A visible same-session payload takes precedence over the
  on-disk `SPEC.md`.
- Reads `SPEC.md`, mirrors its checklist into `progress.txt`, records strategy
  selection before the first edit (see Karpathy admission gate below).
- Runs perceive → plan → act → observe until the full checklist is done and all
  verification commands last ran exit 0.
- Calls `@reviewer` before `COMPLETE`; iterates on `REQUEST_CHANGES`.

**Karpathy admission gate:** Before recording `Selected: karpathy`, all of the
following must be true (or the SPEC checklist explicitly creates them):

- `program.md` present
- `.opencode/karpathy.json` present
- baseline command defined
- scalar score source and direction defined
- noise probe defined
- mutable and immutable targets identified

`Selected: karpathy` is a commitment to invoke `@karpathy` via the task tool.
For ordinary implementation work, record `Selected: direct`.

**Strategy pivot:** If mid-run the strategy changes, append `## Strategy pivot`
to `progress.txt` with `From:`, `To:`, and `Reason:`.

## Promise Contract

Enforced by `opencode-autonomous-gate`. All three tokens are used by `@autonomous`:

**`<promise>COMPLETE</promise>`** requires all of:
1. A spec file exists.
2. Latest message contains a fenced JSON evidence block with `exit_code: 0`.
3. `@reviewer` produced `APPROVE` in this session (when `task` tool available).
4. `progress.txt` contains a `Selected: <strategy>` line (if `progress.txt` exists).
5. If `Selected: karpathy`: either a `@karpathy` delegation was observed this
   session, or `program.md` + `.opencode/karpathy.json` + `experiments.md` all exist.
6. If a Prometheus `<spec filename="SPEC.md">` payload was observed this session,
   the on-disk `SPEC.md` content must match it.

**`<promise>WORK_STUCK</promise>`** requires: spec file present, `progress.txt`
updated this session, ≥3 documented approaches exhausted.

**`<promise>BLOCKED</promise>`** is the only valid exit when `bash` is unavailable.
Rejected when `bash` is available.

**Workaround dumps** (can't-do statement + code block, no promise token, bash
absent) are intercepted and rejected with a BLOCKED corrective.

Evidence block format (strict):
```json
{
  "command": "<exact command>",
  "exit_code": 0,
  "excerpt": "<tail of stdout/stderr>"
}
```

## Plugins

### `plugins/immutability.ts`

Marker-gated global plugin (no-op unless `.opencode/immutable.json` exists).
Supported rules: `readonly` (all agents denied), `prometheus_only` (only `@prometheus`
allowed), `write_allowlist` (named agent may only write listed files).
Also protects canonical filename casing (e.g. rejects `spec.md` when `SPEC.md` is
declared canonical).

### `plugins/opencode-autonomous-gate/`

Enforces `@autonomous` promise semantics. Watches assistant messages for promise
tokens; posts structured corrective messages when preconditions are unmet.
Tracks per-session state: `reviewerApproved`, `karpathyDelegated`,
`prometheusPayloadHash`, `progressTouched`.

Environment flags (all default `true`):
- `OPENCODE_AUTONOMOUS_REQUIRE_REVIEWER`
- `OPENCODE_AUTONOMOUS_REQUIRE_EVIDENCE`
- `OPENCODE_AUTONOMOUS_REQUIRE_PROGRESS_UPDATE`
- `OPENCODE_AUTONOMOUS_AGENT_NAME` (default `autonomous`)

### `plugins/opencode-autonomous-loop/`

Durable supervisor-state plugin. Persists run state in `.opencode/autonomous-loop/`:
- `runs.json`: per-run records including `selected_strategy`, `spec_hash`,
  `reviewer_approved`, iteration counts, promise counts, and `history` entries
  (progress edits, subagent delegation events, promise tokens).
- `status.json`: machine-readable snapshot for external tooling.

Behaviors:
- Detects stale runs (default 900 s inactivity) and posts recovery nudges.
- Posts continuation nudges when a turn ends with unchecked `[ ]` items in
  `progress.txt` and no promise token.
- Records observed subagent delegation events (`karpathy`, `reviewer`, `octopus`,
  etc.) in run history.
- Parses and persists `Selected:` strategy from `progress.txt` edits.

### `plugins/shared/evidence.js`

Exports `findAllEvidenceBlocks`, `findLastEvidenceBlock`, and `evidencePasses`.
Used by both autonomous plugins to parse fenced JSON evidence blocks.

## Skills

Core skill pack under `.opencode/skills/`:

| Skill | Trigger |
|---|---|
| `project-agent-scaffolding` | Deriving project-local agents/skills from a repo's requirements and architecture. |
| `verification-before-completion` | Requiring fresh command evidence before any completion claim. |
| `systematic-debugging` | Root-cause-first diagnosis of failing tests or runtime errors. |
| `test-driven-development` | Failing-test-first discipline for testable production changes. |
| `subagent-driven-development` | Dispatching focused subagents with explicit briefs and review. |
| `writing-skills` | Creating or revising OpenCode skills with validation. |
| `playwright-image-generation` | Automating web AI image generation/editing safely with Playwright. |
| `local-word-document` | Creating local `.docx` documents from structured content via pandoc. |

Skill validation rules: lowercase kebab-case name matching directory; description
starts with `Use when` or `Use ONLY when`; only supported frontmatter keys accepted.

Note: `local-word-document` is present in `.opencode/skills/` but not yet listed
in `EXPECTED_SKILL_FILES` in `tests/verify_opencode.py`.

## Deployment

`scripts/deploy-opencode-agents.sh` — actions: `install` (default), `status`, `remove`.

Install targets:
- `agents/` (always)
- `plugins/` with `--with-plugins`
- `.opencode/skills/` with `--with-skills`
- `tools/` with `--with-tools` (no `tools/` directory currently exists)

Default mode is symlink; `--mode copy` for copy installs. Existing files are
backed up before symlink install. Config resolution precedence: CLI flags >
environment variables > `.opencode-deploy.local.env` > `opencode debug paths` >
script defaults.

## Examples

| Path | Purpose |
|---|---|
| `examples/immutable.json.example` | Immutability plugin marker template |
| `examples/trusted-project.json.example` | Project-scoped trusted-mode OpenCode config |
| `examples/karpathy.json.example` | Deterministic Karpathy loop config |
| `examples/memory-template/` | Project-local memory note template |
| `examples/ml-loop/` | Runnable stdlib-only Karpathy loop demo (binary classification, baseline ~72%, target ≥85%) |

`examples/ml-loop/` components: frozen evaluator `prepare.py`, mutable target
`train.py`, objectives `program.md`, config `.opencode/karpathy.json`, immutability
marker `.opencode/immutable.json`, score artifact `logs/latest_score.txt`.

## Testing and Verification

```bash
node --test tests/plugins/*.test.mjs       # 58 plugin unit tests
python3 tests/verify_opencode.py --skip-llm # sandbox-isolated integration validator
python3 tests/test_skill_coverage.py --skip-llm
python3 tests/test_skill_pressure.py
```

### `tests/verify_opencode.py`

Sandbox-isolated integration validator. Downloads a fresh OpenCode binary into a
disposable temp dir, installs the suite, and asserts:

- All expected agent files present with correct modes.
- All declared permission rules resolve.
- Plugin and skill files present and well-formed.
- Strategy registry conformance (contract sections, task posture, bounded stop criteria).
- Prometheus read-only handoff contract (bash/edit/write denied, payload format,
  handoff sentence, no prose before payload, same-session materialization, Karpathy
  admission gate).
- Prometheus diverge–converge planning contract (≥2 candidates, bounce, kill-reasons,
  no fan-out language).
- Octopus brain/arm split.
- Gate and loop plugin contract markers (strategy-consistency, spec-freshness,
  karpathy delegation tracking, parseSelectedStrategy, selected_strategy,
  subagent event recording).
- Deploy script install/status/remove behavior.
- Shell script portability via `shellcheck`.
- Optional LLM/plugin hook-fire test (skipped with `--skip-llm`).

Known pre-existing failure: `G. Plugin load` — `immutability.ts` does not appear
in OpenCode startup logs (package plugins are not logged in this mode).

### `tests/plugins/` — Node unit tests (58 tests)

- `evidence.test.mjs`: evidence block parsing.
- `immutability.test.mjs`: readonly, prometheus_only, write_allowlist, case-variant,
  identity resolution (chat.params cache, messages API fallback, parent session walk).
- `autonomous-gate.test.mjs`: COMPLETE/WORK_STUCK/BLOCKED preconditions, workaround-dump
  detection, strategy-consistency enforcement (karpathy with/without artifacts,
  karpathy with delegation, direct, no Selected: line, absent progress.txt),
  spec-freshness enforcement (stale payload, matching payload, no payload).
- `autonomous-loop.test.mjs`: run state persistence, continuation nudge guards,
  parseSelectedStrategy helper.

### `tests/audit_run.py`

On-demand runtime behavior auditor. Queries the OpenCode SQLite database
(`~/.local/share/opencode/opencode.db`) and project artifacts to emit
PASS / PARTIAL / FAIL verdicts for a given project session.

```bash
python3 tests/audit_run.py --project /path/to/project          # most recent autonomous session
python3 tests/audit_run.py --project /path/to/project --list   # list recent sessions
python3 tests/audit_run.py --project /path/to/project --session ses_abc123
```

Verdicts produced: Prometheus (read-only, payload, Approaches Considered),
Autonomous strategy (declared vs. observed, delegation evidence), Karpathy
(baseline, noise floor, KEEP/REVERT in `experiments.md`), Octopus (brain + arm
sessions). Exit codes: 0 = PASS/NA, 1 = PARTIAL, 2 = FAIL, 3 = data error.

## NotebookLM Grounding

Active project notebook: **Cuddly Winner — Loop Strategies**
(`https://notebooklm.google.com/notebook/63e72bfa-9025-435d-909c-1fd35db1d505`)

`@data-scientist` queries this notebook when the NotebookLM MCP connection is
authenticated. `@grounder` is the read-only fallback.

Documented strategy patterns from the notebook (not yet implemented as registered
strategies — each requires a conformant agent, registry entry, and validator
updates per `docs/STRATEGY-CONTRACT.md`):

- Parallel workers via git worktrees
- Steering pipelines (cooperative arbitration)
- Behavior trees (reactive planning)
- Stigmergy / pheromone foraging
- Automatic context compaction
- Commit-and-Reset / Chain-of-Vibes
- Adversarial debate (Hunter/Skeptic/Referee)
- Model-routed specialist swarm (Coordinator/Implementer/Reviewer)
- Preservation assembly-line agents

## Conventions

- `SPEC.md` is uppercase. The immutability plugin rejects case variants.
- Shell commands in specs, `progress.txt`, and agent instructions must be
  POSIX-compatible, explicitly bash-invoked, or delegated to Python. See
  `docs/CONVENTIONS.md`.
- New shell scripts must pass `shellcheck -s bash`.
- Runtime behavior claims require runtime evidence (DB sessions, artifacts);
  agent files alone are design intent, not proof of execution.
- No git commits unless the user explicitly asks.
