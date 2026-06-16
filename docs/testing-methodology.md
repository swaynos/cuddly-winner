# Testing Methodology: OpenCode Agent Runtime Behavior

This document defines how to validate whether the cuddly-winner multi-agent
workflow is executing as designed, not just configured. It supersedes the
ad-hoc `temp_testing-validation-strategy.md` and `temp_runtime-validation-report.md`
files, which have been deleted.

---

## Core Principle

**Configuration proves capability. Logs prove execution.**

A valid evaluation must distinguish:

- **Designed behavior** — what `agents/*.md`, `.opencode/strategies.json`,
  `AGENTS.md`, and `docs/` say should happen.
- **Observed behavior** — what OpenCode logs, database sessions, child sessions,
  tool calls, and `progress.txt` show actually happened.

If design and runtime evidence disagree, runtime evidence is authoritative. Do not
infer behavior from design intent when runtime evidence is absent.

---

## Evidence Sources

Consult in this order. Later sources corroborate earlier ones.

### 1. OpenCode SQLite database

```text
~/.local/share/opencode/opencode.db
```

This is the most reliable evidence source. Key tables:

**`session`** — one row per session, including `parent_id` for child sessions.

```bash
# Recent project sessions
sqlite3 -readonly ~/.local/share/opencode/opencode.db "
SELECT id, parent_id, agent, slug,
       datetime(time_created/1000,'unixepoch','localtime') AS created
FROM session
WHERE directory='<PROJECT_PATH>'
ORDER BY time_created DESC LIMIT 20;"

# Child sessions for a known session (strongest evidence of subagent invocation)
sqlite3 -readonly ~/.local/share/opencode/opencode.db "
SELECT id, parent_id, agent, slug,
       datetime(time_created/1000,'unixepoch','localtime') AS created
FROM session
WHERE id='<SESSION_ID>' OR parent_id='<SESSION_ID>'
ORDER BY time_created;"
```

**`session_message`** — agent switches, model switches, and system messages.

```bash
sqlite3 -readonly ~/.local/share/opencode/opencode.db "
SELECT datetime(time_created/1000,'unixepoch','localtime') AS t,
       type, json_extract(data,'$.agent') AS agent
FROM session_message
WHERE session_id='<SESSION_ID>' AND type='agent-switched'
ORDER BY seq;"
```

**`part`** — individual tool calls with inputs.

```bash
# Tool call timeline for a session
sqlite3 -readonly ~/.local/share/opencode/opencode.db "
SELECT datetime(time_created/1000,'unixepoch','localtime') AS t,
       json_extract(data,'$.tool') AS tool,
       substr(json_extract(data,'$.state.input.filePath')
              || json_extract(data,'$.state.input.command'),'',60) AS hint
FROM part
WHERE session_id='<SESSION_ID>'
  AND json_extract(data,'$.type')='tool'
ORDER BY time_created;"

# Check for task tool calls (subagent invocations)
sqlite3 -readonly ~/.local/share/opencode/opencode.db "
SELECT count(*) FROM part
WHERE session_id='<SESSION_ID>'
  AND json_extract(data,'$.tool')='task';"
```

### 2. OpenCode log files

```text
~/.local/share/opencode/log/
```

Useful for agent stream lines and plugin events not yet in the DB. Search for:

```text
agent=prometheus  agent=autonomous  agent=karpathy
agent=ralph-wiggum  agent=octopus  agent=octopus-arm
service=task  plugin=autonomous-gate  plugin=autonomous-loop
```

### 3. Project runtime artifacts

Consult after DB and logs:

- `progress.txt` — must contain `## Strategy / Selected:` before first edit.
- `experiments.md` — Karpathy run records (baseline, noise, KEEP/REVERT).
- `SPEC.md` — should match the Prometheus payload that was handed off.
- `.opencode/karpathy.json` — present only if Karpathy loop was set up.

---

## Strong vs Weak Evidence

### Strong evidence (counts as proof of execution)

- Child session rows with `parent_id=<target_session_id>` and `agent` matching
  an expected subagent.
- `part` rows where `tool='task'` and the input names a subagent.
- `progress.txt` `## Strategy / Selected:` entry written during the run (check
  file timestamp vs session start).
- `experiments.md` metric entries with KEEP/REVERT decisions for Karpathy.
- Structured Octopus arm perceptions with Lens/Severity/Evidence/DedupKey.

### Weak / insufficient evidence (do not count as proof)

- Agent files were read (`read` tool calls targeting `agents/*.md`).
- Strategy files exist or list a strategy.
- README or SPEC describes an intended workflow.
- An agent has permission to call a subagent but no `task` call is in the DB.
- A prompt mentions a methodology (ant-foraging, diverge–converge) but no
  corresponding delegation or artifact exists.
- Repeated primary-agent turns in one session without child sessions.

---

## Expected Runtime Behaviors

### Prometheus: diverge–converge planning

Under the current design, Prometheus is read-only and sequential. It does not
spawn child sessions or fan out. The diverge–converge loop runs internally within
the model; the only observable artifact is the payload it returns.

**What to check:**

| Check | Strong signal | Weak signal |
|---|---|---|
| Ran as `agent=prometheus` | `session_message` agent-switched row | — |
| Read-only: no edit/write/bash | `part` table: zero edit/write/bash rows | — |
| Returned a SPEC payload with `## Approaches Considered` | `SPEC.md` contains the section with ≥2 entries | SPEC.md exists but no section |
| Bounce executed correctly | User message contains the bounce text; no payload produced | — |
| Delegated research | `part` rows with `tool='task'` and `data-scientist` or `grounder` as target | — |

**Verdict format:**

```text
Prometheus verdict: PASS | PARTIAL | FAIL | NOT_APPLICABLE
Evidence: <DB rows, artifact content, or log lines>
Interpretation: <why this matches or does not match the current contract>
```

### Autonomous: strategy selection and execution

Autonomous must record a strategy before its first edit, then delegate to the
selected strategy subagent when required.

**What to check:**

| Check | Strong signal | Weak signal |
|---|---|---|
| Strategy recorded before first edit | `progress.txt` has `## Strategy / Selected:` and the timestamp precedes the first `edit` part row | `progress.txt` exists |
| Karpathy hard rule followed | Child session with `agent=karpathy` | SPEC.md lists `strategy: karpathy` |
| Direct execution justified | `progress.txt` states `Selected: direct` with reason | No strategy entry |
| SPEC materialized verbatim | `SPEC.md` content matches Prometheus payload | `SPEC.md` was written |
| `task` calls present when strategy delegates | `part` rows: `tool='task'` | — |

**Strategy selection verdict format:**

```text
Autonomous strategy verdict: PASS | PARTIAL | FAIL | NOT_APPLICABLE
Expected strategy: <from SPEC.md directive, AGENTS.md, or user instruction>
Observed strategy: <from progress.txt or "none recorded">
Evidence: <DB rows or artifact references>
Interpretation: <whether selection was correct and recorded>
```

### Karpathy execution

Only applicable when `agent=karpathy` child sessions exist.

| Check | Strong signal |
|---|---|
| Karpathy launched | Child session with `agent=karpathy` and `parent_id=<autonomous_session>` |
| `program.md` read | `part` row: `tool='read'`, target `program.md` |
| Baseline recorded | `experiments.md` contains `Run 0 — Baseline` |
| Noise floor recorded | `experiments.md` contains noise floor entry |
| KEEP/REVERT decisions | `experiments.md` run entries with Decision field |
| Reviewer called | Child session with `agent=reviewer` spawned from karpathy session |

### Octopus execution

Only applicable when `agent=octopus` child sessions exist. Octopus is NOT
considered to have executed correctly unless all of the following are present:

1. Child session with `agent=octopus` from an Autonomous parent.
2. Child sessions with `agent=octopus-arm` from the Octopus session.
3. Pre-build arm phase (arms dispatched before the brain makes edits).
4. Post-build arm phase (arms dispatched after the brain's edits).
5. Each arm session produced a structured perception (Lens, Severity, Evidence,
   DedupKey, Recommendation).
6. No arm session contains `edit` or `write` tool calls (read-only contract).
7. All `edit`/`write` in the Octopus session come from the brain, not the arms.

```text
Octopus verdict: PASS | PARTIAL | FAIL | NOT_SELECTED
Evidence: <DB child sessions, part rows, perception artifacts>
Interpretation: <whether coordinator-class behavior actually occurred>
```

---

## Evaluation Procedure

### Step 1 — Identify the target session

```bash
sqlite3 -readonly ~/.local/share/opencode/opencode.db "
SELECT id, agent, slug, datetime(time_created/1000,'unixepoch','localtime') AS created
FROM session
WHERE directory='<PROJECT_PATH>'
ORDER BY time_updated DESC LIMIT 10;"
```

Record: session ID, initial agent, time window, project path.

### Step 2 — Check for child sessions

```bash
sqlite3 -readonly ~/.local/share/opencode/opencode.db "
SELECT count(*) AS child_count FROM session WHERE parent_id='<SESSION_ID>';"
```

Zero children means no subagents ran. Skip Steps 4–5 and go directly to verdict.

### Step 3 — Build the tool-call timeline

```bash
sqlite3 -readonly ~/.local/share/opencode/opencode.db "
SELECT datetime(time_created/1000,'unixepoch','localtime') AS t,
       json_extract(data,'$.tool') AS tool
FROM part
WHERE session_id='<SESSION_ID>'
  AND json_extract(data,'$.type')='tool'
ORDER BY time_created;"
```

Combine with agent-switch events from `session_message` to map which agent was
active during which tool calls.

### Step 4 — Validate Prometheus (if involved)

Check tool calls during the Prometheus phase (between agent-switched to prometheus
and the next agent-switched). Confirm: read/grep only, no edit/write/bash/task
unless research delegation was appropriate.

### Step 5 — Validate Autonomous strategy selection

Check `progress.txt` for `## Strategy / Selected:`. Cross-reference with the
`strategy:` field in `SPEC.md` and `AGENTS.md`. If the strategy required delegation,
check for a matching child session.

### Step 6 — Validate strategy subagent (if applicable)

Follow the Karpathy or Octopus checklist above against child session data and
runtime artifacts.

### Step 7 — Material difference verdict

Decide: did this run exercise the multi-agent architecture in an observable way,
or was it one primary agent making sequential tool calls?

```text
Material difference verdict: YES | NO | PARTIAL
Summary: <one paragraph>
Strongest supporting evidence: <specific DB rows, artifact content, log lines>
Strongest contrary evidence: <specific DB rows or absence of expected signals>
```

---

## Pass/Fail Rubric

### Full Pass

- Prometheus returned a payload with ≥2 `## Approaches Considered` entries, each
  rejected one with a concrete kill-reason.
- `@autonomous` recorded `## Strategy / Selected:` before its first edit.
- The selected strategy ran as a subagent (child session present).
- For Karpathy: baseline, noise floor, and KEEP/REVERT records are in `experiments.md`.
- For Octopus: pre-build and post-build arm phases present; arms read-only; brain
  sole builder.
- All runtime artifacts corroborate logs.

### Partial Pass

- Prometheus ran read-only and sequential; payload present but `## Approaches
  Considered` is thin or missing.
- `@autonomous` recorded a strategy but did not delegate to a subagent when one
  was required.
- A strategy subagent was launched but did not complete its contract (e.g. Octopus
  dispatched arms but only one phase).

### Fail

- No child sessions; no `task` tool calls.
- No `## Strategy / Selected:` in `progress.txt`.
- Direct `@autonomous` edits replaced strategy delegation without a recorded reason.
- Octopus expected but no `agent=octopus` session exists.

---

## Reporting Template

```text
Runtime Validation Report
Generated: <ISO timestamp>

Target session: <session id> (slug: <slug>)
Time window:    <start> – <end> (localtime)
Project:        <path>

---

Prometheus verdict: PASS | PARTIAL | FAIL | NOT_APPLICABLE
Evidence:
- <specific DB row / artifact line>
Interpretation:
- <one or two sentences>

Autonomous strategy verdict: PASS | PARTIAL | FAIL | NOT_APPLICABLE
Expected strategy: <strategy or "not specified">
Observed strategy: <strategy or "none recorded">
Evidence:
- <specific DB row / artifact line>
Interpretation:
- <one or two sentences>

Karpathy verdict:    PASS | PARTIAL | FAIL | NOT_SELECTED
Octopus verdict:     PASS | PARTIAL | FAIL | NOT_SELECTED
Evidence:
- <specific DB rows or "not applicable">

Material difference verdict: YES | NO | PARTIAL
Summary:
<one paragraph — did this run exercise the multi-agent architecture observably?>
Strongest supporting evidence: <references>
Strongest contrary evidence:   <references>

Follow-up recommendations:
- <only if needed>
```

---

## Reference: Baseline Report (2026-06-15)

The first evaluation run against this methodology produced the following verdicts
for an internal session, window 10:16–10:28 (localtime).
This was the run that diagnosed the gap between configuration and runtime behavior
that led to the Prometheus diverge–converge refactor and the strategy-recording
requirement.

**Prometheus:** PARTIAL — ran read-only, sequential read/grep only; no `task`,
no child sessions. Correct by design (read-only contract), but no diverge–converge
artifact was observable (the contract was not yet implemented).

**Autonomous strategy:** FAIL — direct edit/write/bash with zero `task` calls; no
`## Strategy / Selected:` entry in `progress.txt`. Root cause: strategy recording
was prompt-level only with no enforcement. Both issues were addressed in the
Prometheus and Autonomous contract updates that followed.

**Octopus:** NOT_SELECTED — correctly; task failed the admission test.

**Material difference:** NO — one primary session, sequential tool calls.
0 child sessions, 0 `task` calls, 0 strategy-subagent sessions in the entire DB.

This baseline documents the known gap and is the reference against which future
runs should be compared to confirm the contracts are holding.
