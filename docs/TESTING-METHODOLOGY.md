# Testing Methodology

## Purpose

This document defines the runtime investigation, session auditing, and evaluation procedures used to verify OpenCode specialist agent workflows. It specifies the SQLite database log inspection schema, standardized verdict definitions, evaluation harness conventions, and test suite execution protocols.

`docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, and `docs/USE-CASES.md` define system contracts; this document defines how empirical compliance is measured and audited.

---

## Standardized Verdict Definitions

Every automated or manual evaluation emits one of the following standardized verdicts:

| Verdict | Meaning | Exit Code / Condition |
| --- | --- | --- |
| `PASS` | All required behavioral contracts, invariants, tool boundaries, and verification commands were cleanly satisfied with empirical evidence. | Exit Code `0` |
| `PARTIAL` | The primary implementation or triage succeeded, but non-fatal rubric defects (e.g., inefficient tool usage, minor formatting variance) were observed. | Exit Code `1` |
| `FAIL` | Hard contract violation: unauthorized edits, unverified completion claims, strategy bypass, false planning readiness, or failed verification commands. | Exit Code `2` |
| `NOT_APPLICABLE` / `SKIPPED` | The evaluated strategy, profile, or session type was not selected or active for the given run, or missing prerequisite environment keys. | Exit Code `0` (with warning/skip log) |

---

## Session Audit Procedure (`tests/audit_run.py`)

Session auditing automates the manual investigation of OpenCode agent runs by querying SQLite database logs and worktree state.

### SQLite Log Schema

OpenCode persists session telemetry to `~/.local/share/opencode/opencode.db` (or a custom path provided via `--db`). The auditor inspects:

1. **`session` Table**: Tracks session ancestry (`id`, `parent_id`, `agent`, `slug`, `directory`, `time_created`, `time_updated`).
2. **`part` Table**: Tracks message and tool call parts (`session_id`, `data`). Extract tool names, input file paths, commands, and patterns via SQLite JSON functions (`json_extract`).

### Audit Invariants

When auditing a session, `tests/audit_run.py` verifies:

* **Ancestry & Identity Isolation**: The topmost managed ancestor's boundary is respected across all child sessions. Read-only roles (`ask`, `karpathy`, `reviewer`, `grounder`) produce no mutation or process tool calls.
* **Scaffold Integrity**: For Karpathy/Ralph sessions, `SPEC.md` and `opencode-autonomous.json` exist and pass `tools/validate_scaffold.ts`.
* **Execution Evidence**: Autonomous sessions execute exact verification commands freshly through native Bash before completing.

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

* **Configuration**: `opencode-mutation.json` defines configuration settings:
  ```json
  {
    "enabled": false,
    "score_threshold": 1,
    "result_path": ".opencode/mutation-result.json"
  }
  ```
* **Execution**: `evals/mutation/run_mutation.py` applies targeted mutations to implementation sources and runs unit tests (`evals/mutation/tests/`) to ensure the test suite detects mutations.

---

## Skills Validation Methodology (`tests/`)

Non-core skills installed via `--with-skills` are evaluated using two dedicated test suites:

1. **Coverage Testing (`tests/test_skill_coverage.py`)**: Verifies that every packaged skill directory under `skills/` contains valid markdown frontmatter, required skill contracts, and readable instruction sets.
2. **Pressure Testing (`tests/test_skill_pressure.py`)**: Exercises agent prompt loading under complex, multi-skill pressure scenarios to ensure skill instructions do not override core role boundaries or permission constraints.
