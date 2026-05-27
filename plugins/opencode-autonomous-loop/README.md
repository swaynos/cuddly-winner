# opencode-autonomous-loop

Durable supervisor-state plugin for bounded `@autonomous` sessions.

## Model

- Controller-equivalent logic lives in plugin hooks and persisted run state.
- Worker-equivalent unit is a bounded autonomous session turn.
- Durable store is project-local JSON state under `.opencode/autonomous-loop/`.

This is not literal infinite execution in one process. It is practical
"unlimited" behavior by supervising disposable, resumable work units.

## Persisted state

- `.opencode/autonomous-loop/runs.json`
- `.opencode/autonomous-loop/status.json`

State includes run/session id, status, iteration counters, spec presence/hash,
progress-touch markers, last activity, and recent history.

## Runtime rules

- Idempotency: run ids are stable per session and normalized for safe reuse.
- Checkpointing: state is written on each relevant message or file edit event.
- Stale detection: inactive runs are flagged after `OPENCODE_AUTONOMOUS_STALE_SECONDS`.
- Recovery prompt: plugin posts a machine-readable reminder to resume work.
- Backpressure boundary: `@autonomous` remains bounded; plugin maintains continuity.

## Environment

- `OPENCODE_AUTONOMOUS_AGENT_NAME` (default `autonomous`)
- `OPENCODE_AUTONOMOUS_STALE_SECONDS` (default `900`)
