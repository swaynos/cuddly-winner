# Testing Methodology

## Purpose

This document defines the runtime investigation, session auditing, and evaluation procedures used to verify OpenCode specialist agent workflows. It specifies the SQLite database log inspection schema, standardized verdict definitions, evaluation harness conventions, and test suite execution protocols.

`docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, and `docs/USE-CASES.md` define system contracts; this document defines how empirical compliance is measured and audited.

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

Session auditing is an investigative report over one selected session, its direct
children, and the current project worktree. It does not reconstruct a complete
run or prove policy enforcement.

### SQLite Log Schema

OpenCode persists session telemetry to `~/.local/share/opencode/opencode.db` (or a custom path provided via `--db`). The auditor inspects:

1. **`session` Table**: Lists the selected session and its direct children (`id`, `parent_id`, `agent`, `slug`, `directory`, `time_created`, `time_updated`).
2. **`part` Table**: Lists tool calls for the selected root session only.
3. **`session_message` and `message` Tables**: Supply agent-switch events and completion/review token searches for the selected root session.

### Audit Invariants

When auditing a session, `tests/audit_run.py` reports:

* whether the selected root session recorded switches to Prometheus or Autonomous, and whether its current `SPEC.md` includes `## Approaches Considered`;
* whether the selected root session recorded Bash calls, without attributing them to Prometheus or another agent after a switch;
* direct child-session agent names, including Karpathy, and whether current `SPEC.md` and `opencode-autonomous.json` files exist; and
* whether the selected root session contains completion or reviewer-approval tokens.

The auditor does not recursively inspect descendants, validate scaffold content,
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
agent` with the repository's managed agents, immutability plugin, and any
installed workflow tools. Drift is reported as a warning, not a test failure:
live scenarios intentionally exercise the active profile and never install,
overwrite, or repair it.

Each live scenario runs in a disposable workspace and fails on a nonzero agent
exit status. Fixture assertions inspect files and Git state where applicable,
rather than treating a filename or generic keyword in model output as evidence.
The suite defines 12 scenarios for all 6 managed agents (`ask`, `autonomous`,
`prometheus`, `karpathy`, `reviewer`, `grounder`):

1. **`Ask` Edit Refusal**: Requires an explicit refusal, no mutation, and no command-dump workaround.
2. **`Ask` Capability Boundaries**: Attributes limits to role design rather than session or environment restrictions.
3. **`Autonomous` Missing Scaffold**: Reports a missing scaffold and makes no changes.
4. **`Autonomous` Auto-Commit Prevention**: Fixes a fixture typo but leaves Git `HEAD` and commit count unchanged without an explicit commit request.
5. **`Prometheus` Scaffold Publication**: Writes both `SPEC.md` and `opencode-autonomous.json` for an underspecified request.
6. **`Prometheus` Canonical Structure**: Validates exact canonical sections, selected approach, final handoff, and required manifest fields.
7. **`Karpathy` Scaffold Guard**: Reports both missing scaffold files and makes no changes.
8. **`Karpathy` Bounded Proposal**: Uses a complete optimization fixture to propose a concrete change to one declared mutable target without modifying it.
9. **`Reviewer` Rejection**: Ends a failed-verification review with `REQUEST_CHANGES` on the final non-empty line.
10. **`Reviewer` Approval**: Ends a conforming verified-fixture review with `APPROVE` on the final non-empty line and cites evidence.
11. **`Grounder` Local Evidence**: Cites the requested local `file:line` evidence.
12. **`Grounder` Private Content**: Reports local-only handling and does not echo a private-content canary.

`karpathy`, `reviewer`, and `grounder` are intentionally subagents. Current
OpenCode CLI direct invocations fall back to Build for those roles; their
scenarios are reported as `SKIP` in that runtime rather than falsely attributing
Build output to them. Their permission and prompt contracts remain
deterministically checked by `tests/verify_opencode.py`; parent-child behavioral
coverage requires an OpenCode subagent-session integration fixture.

Deterministic unit tests in `tests/test_verify_opencode.py` cover the scenario
assertion helpers, including missing scaffolds, duplicate sections, non-final
handoffs, and verdict-last parsing. They run in ordinary CI; live-model checks
remain supplemental because they require the user's configured provider and
consume model tokens.

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

Non-core skills installed via `--with-skills` have deterministic structural and
deployment validation. Direct-model pressure checks remain supplemental:

1. **Coverage Testing (`tests/test_skill_coverage.py`)**: Checks packaged and
   temporarily deployed skills, frontmatter, and selected content requirements.
2. **Pressure Testing (`tests/test_skill_pressure.py`)**: Sends individual
   skills as direct model context and checks selected response cues. It remains
   optional and does not replace managed-agent permission enforcement tests.
