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
