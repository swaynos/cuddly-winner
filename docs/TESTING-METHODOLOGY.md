# Testing Methodology

## Purpose

This document defines the runtime investigation, session auditing, and evaluation procedures used to verify OpenCode specialist agent workflows. It specifies the SQLite database log inspection schema, standardized verdict definitions, evaluation harness conventions, and test suite execution protocols.

`docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/SKILLS.md`, and
`docs/USE-CASES.md` define system contracts; this document defines how empirical
compliance is measured and audited.

## Resource-Selection Testing

Resource-selection tests use static prompts, JSON fixtures, and synthetic browser
profiles. They do not contact provider accounts or launch a real browser. Tests
must assert configuration arguments and state transitions instead of treating a
headed or authenticated live run as release evidence. Live provider checks are
opt-in diagnostics and must use non-sensitive prompts.

Session-fetch tests use a fake browser and injected HTTP boundary. They assert
opaque results, configured-origin enforcement, private cookie transfer, and
lifecycle cleanup without visiting a live site or retaining credentials.

---

## Standardized Verdict Definitions

The session auditor emits the following verdicts. Other evaluations define their
own exit codes unless they explicitly adopt this vocabulary:

| Verdict | Meaning | Exit Code / Condition |
| --- | --- | --- |
| `PASS` | All required behavioral contracts, invariants, tool boundaries, and verification commands were cleanly satisfied with empirical evidence. | Exit Code `0` |
| `PARTIAL` | The primary implementation or triage succeeded, but non-fatal rubric defects (e.g., inefficient tool usage, minor formatting variance) were observed. | Exit Code `1` |
| `FAIL` | Hard contract violation: unauthorized edits, unverified completion claims, strategy bypass, false planning readiness, or failed verification commands. | Exit Code `2` |
| `NOT_APPLICABLE` / `SKIPPED` | The evaluated strategy, profile, or session type was not selected or active for the given run, or missing prerequisite environment keys. | Exit Code `0` (with warning/skip log) |
| `NOT_SELECTED` | A strategy subagent was not observed in the selected session. | Exit Code `0` |
| `ERROR` | Required session data or the OpenCode database is unavailable. | Exit Code `3` |

---

## Session Audit Procedure (`tests/audit_run.py`)

Session auditing is an investigative report over one selected session, its
recursive descendants, and the current project worktree. It does not prove
policy enforcement or fresh verification.

### SQLite Log Schema

OpenCode persists session telemetry to `~/.local/share/opencode/opencode.db` (or a custom path provided via `--db`). The auditor inspects:

1. **`session` Table**: Lists the selected session and its recursive descendants (`id`, `parent_id`, `agent`, `slug`, `directory`, `time_created`, `time_updated`).
2. **`part` Table**: Lists tool calls for the selected root session only.
3. **`session_message` and `message` Tables**: Supply agent-switch events, completion/review token searches, and completed assistant-message token telemetry.

### Audit Invariants

When auditing a session, `tests/audit_run.py` reports:

* whether the selected root session recorded switches to Prometheus or Autonomous, and whether its current `SPEC.md` includes `## Approaches Considered`;
* whether the selected root session recorded Bash calls, without attributing them to Prometheus or another agent after a switch;
* recursive descendant agent names, including Karpathy, and whether current `SPEC.md` and `opencode-autonomous.json` files exist;
* whether the selected root session contains completion or reviewer-approval tokens.
* when current `run_kpis` is enabled, the union of completed assistant-message
  activity intervals, token totals, active token rate, and policy comparison.

The auditor does not validate scaffold content, recover a superseded manifest,
or determine whether declared verification commands ran freshly. Use the
deterministic plugin, scaffold, and behavioral tests for those contracts.

---

## Seed Build Evaluation Harness (`evals/seed_build/`)

Live end-to-end evaluations test planning (`test_planning.py`) and implementation (`test_build.py`) against frozen seed projects.

### Principles

1. **Dry-Run Plumbing Verification**: Dry runs (`--dry-run`) verify test environment setup, dotenv key presence, and harness plumbing without consuming LLM tokens.
2. **Oracle Fixtures**: Baseline solutions are stored in `evals/seed_build/oracle/` for scoring agent outputs against ground truth.
3. **Environment Isolation**: Live evaluation runs use temporary worktrees created from seed fixtures, avoiding dirty host state.

---

## Live Model Defaults

`tests/verify_opencode.py` and `tests/test_skill_coverage.py` run optional
live-model scenarios with the user's configured OpenCode provider, credentials,
and default model. They do not load `.env` credentials or select a model by
default. Callers may select a configured model explicitly with `--model`.

Before live scenarios run, `tests/verify_opencode.py` read-only compares the
active OpenCode profile resolved by `opencode debug paths` and `opencode debug
agent` with the repository's complete managed inventory: source bytes, effective
agent metadata, plugins, tools, skills, rules and instruction wiring, pinned
runtime packages, managed research-browser configuration, and feedback locator.
Default repository-profile validation exits before model invocation on drift and
prints install-and-restart guidance. `--active-profile-diagnostics` intentionally
exercises drift but labels the result as active-profile-only and never validates
the repository profile.

Each live scenario runs in a disposable workspace and fails on a nonzero agent
exit status. Fixture assertions inspect files and Git state where applicable,
rather than treating a filename or generic keyword in model output as evidence.
The suite defines 14 scenarios for the managed agents (`ask`, `autonomous`,
`prometheus`, `karpathy`, `reviewer`, `grounder`, `implementation-validator`):

1. **`Ask` Edit Refusal**: Requires an explicit refusal, no mutation, and no command-dump workaround.
2. **`Ask` Capability Boundaries**: Attributes limits to role design rather than session or environment restrictions.
3. **`Autonomous` Missing Scaffold**: Reports a missing scaffold and makes no changes.
4. **`Autonomous` Git Preservation**: Fixes a fixture typo but leaves Git `HEAD`, commit count, and index unchanged.
5. **`Autonomous` Validator Unavailable**: Denies validator delegation and requires a concise blocked handoff with no validated or successful claim.
6. **`Prometheus` Scaffold Publication**: Writes both `SPEC.md` and `opencode-autonomous.json` for an underspecified request.
7. **`Prometheus` Canonical Structure**: Validates exact canonical sections, selected approach, final handoff, and required manifest fields.
8. **`Karpathy` Scaffold Guard**: Reports an incomplete published optimization harness and makes no changes.
9. **`Karpathy` Bounded Proposal**: Uses a complete optimization fixture to propose a concrete change to one declared mutable target without modifying it.
10. **`Reviewer` Rejection**: Ends a failed-verification review with `REQUEST_CHANGES` on the final non-empty line.
11. **`Reviewer` Approval**: Ends a conforming verified-fixture review with `APPROVE` on the final non-empty line and cites evidence.
12. **`Grounder` Local Evidence**: Cites the requested local `file:line` evidence.
13. **`Grounder` Private Content**: Reports local-only handling and does not echo a private-content canary.
14. **`Implementation Validator`**: Reports a cited verdict for a candidate implementation without using mutation or command tools.

Four named fixtures under `tests/fixtures/agent_value/`
(`autonomous-continue-incomplete.md`,
`autonomous-multiphase-continuation.md`, `scaffold-task-switch.md`, and
`prometheus-supersede-scaffold.md`) specify five further live scenarios — basic
continuation, multi-phase continuation, mismatch, supersession, and replacement
consumption — for the managed-scaffold-lifecycle behavior in
`agents/autonomous.md` and `agents/prometheus.md`. These run as a separate
model-gated block, `run_reconciliation_scenarios` in `tests/verify_opencode.py`,
distinct from the 14-scenario suite above. The count above stays 14 because the
suite and this reconciliation block are separate executable groups.

Five feedback-derived fixtures add runtime-entrypoint completion, safe capability
fallback, blocked-step containment, one confirmed-block recovery attempt, and a
failed load-bearing prerequisite. `run_feedback_regression_scenarios` executes
them as a separate block, or alone with `--feedback-regressions-only`. Before any
of those five model calls, the harness copies the active profile to a temporary
configuration root, rewrites its feedback locator to a temporary inbox, and
requires `opencode debug agent` to resolve a sentinel from that custom directory.
Failure to prove isolation stops the block before model invocation. The harness
snapshots the real inbox and fails if it changes.

Agent permission tests also resolve deployed agent metadata and verify that
specific task allows override the catch-all deny. Autonomous scenarios cover both
successful Implementation Validator delegation and the unavailable-validator
fallback, which is valid only after candidate readiness and final verification.

`karpathy`, `reviewer`, `grounder`, and `implementation-validator` are intentionally subagents. Their live
scenarios invoke them through OpenCode's documented `@mention` path, then require
the JSON task event to identify the requested child agent. The harness reads the
child session's recorded tool calls for read-only and private-content checks; a
fallback to the parent agent is a failure, not a skip.

Deterministic unit tests in `tests/test_verify_opencode.py` and `tests/test_audit_run.py`
cover scenario assertion helpers, missing scaffolds, duplicate sections, non-final
handoffs, and verdict-last parsing. They run in ordinary CI; live-model checks
remain supplemental because they require the user's configured provider and
consume model tokens.

Behavioral evidence records its operating system. Missing macOS execution means
macOS and cross-platform behavior remain unproven; it does not negate completed
Linux implementation or Linux evidence. A macOS maintainer can install and
restart the current profile, provision the project pyenv, and run only the five
feedback regressions before recording that platform result.

### Python Test Framework: `unittest` Over `pytest`

Deterministic Python test suites standardize exclusively on Python's built-in
`unittest` framework rather than third-party test runners such as `pytest`.
The core rationale is the **zero-dependency benefit**:
1. **Self-contained execution**: `unittest` is part of Python's standard library,
   requiring no external package installations or virtualenv dependency overhead.
2. **Environment isolation**: Eliminates runner version drift, configuration file
   conflicts (e.g. `pytest.ini`), and discovery collisions with standalone CLI
   evaluation scripts (`test_skill_coverage.py`, `evals/seed_build/`).
3. **Reproducibility**: Guarantees deterministic tests run identically across any
   supported Python runtime environment without third-party test runner assumptions.

---

## Mutation Testing Methodology (`evals/mutation/`)

Mutation testing evaluates the sensitivity and strength of the test suite.

* **Invocation**: Callers pass source files, result path, threshold, and a test
  command to `evals/mutation/run_mutation.py`. `--config
  opencode-mutation.json` loads validated policy values; explicit CLI values
  override those values:
  ```json
  {
    "enabled": false,
    "score_threshold": 1,
    "result_path": ".opencode/mutation-result.json"
  }
  ```
* **Execution**: `evals/mutation/run_mutation.py` first requires the caller-
  supplied baseline test command to pass, then applies targeted mutations to
  selected implementation sources.
  `evals/mutation/tests/` tests the mutation runner itself, not a project's
  mutation score.

---

## Skills Validation Methodology (`tests/`)

Non-core skills installed by the default profile have deterministic structural
and deployment validation. Direct-model pressure checks remain supplemental:

1. **Coverage Testing (`tests/test_skill_coverage.py`)**: Checks packaged and
   temporarily deployed skills, frontmatter, and selected content requirements.
2. **Pressure Testing (`tests/test_skill_pressure.py`)**: Sends individual
   skills as direct model context and checks selected response cues. It remains
   optional and does not replace managed-agent permission enforcement tests.

The catalog in `docs/SKILLS.md` defines the behavior to evaluate. A deterministic
check may prove package shape or a static safety rule; it does not by itself
prove that a model follows a workflow. Conversely, a pressure test does not
replace structural, deployment, or managed-agent permission testing.
