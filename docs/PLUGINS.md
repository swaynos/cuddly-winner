# Plugins

This document defines the plugin layer shipped by the project.

## Plugin Responsibilities

Plugins enforce or observe runtime invariants that prompts alone cannot reliably
guarantee. They provide mechanical backpressure, durable state, and audit signals.

Plugins must not be treated as replacements for agent contracts. Agents still
need clear instructions and permissions. Plugins catch violations or persist
state when the model drifts.

## Immutability Plugin

Location:

```text
plugins/immutability.ts
```

Purpose:

- enforce project-local file mutation rules;
- protect frozen evaluators and canonical files;
- enforce identity-sensitive write rules such as Prometheus-only files;
- reject case variants of canonical filenames when configured.

Configuration lives in target projects at:

```text
.opencode/immutable.json
```

Example:

```json
{
  "readonly": ["prepare.py"],
  "prometheus_only": ["SPEC.md"]
}
```

The immutability plugin operates independently from OpenCode permissions. A tool
may be allowed by permissions and still blocked by plugin policy.

## Autonomous Gate Plugin

Location:

```text
plugins/opencode-autonomous-gate.js
plugins/opencode-autonomous-gate/
```

`opencode-autonomous-gate.js` is the top-level OpenCode plugin entrypoint. The
package directory contains the implementation. Both must be deployed; the wrapper
is what OpenCode auto-discovers at startup.

Purpose:

- enforce `@autonomous` promise semantics;
- require evidence for completion;
- require reviewer approval when configured;
- require progress updates for stuck states;
- require strategy consistency where applicable;
- require fresh Prometheus payload materialization where applicable.
- re-inject an observed Prometheus `SPEC.md` payload when autonomous reports a
  missing spec before materializing the handoff.

The gate plugin activates for the autonomous agent name, normally `autonomous`.
It is a no-op for unrelated agents.

Runtime message observation uses the OpenCode `event` hook for
`message.part.updated` bus events. Agent identity for text parts is resolved from
a `chat.params` session cache because text-part events do not carry the agent
name directly.

Completion requires the configured preconditions. The default contract is:

- a spec file exists;
- verification evidence passes: when `.opencode/tool/run.ts` is installed, a
  passing runner artifact in `.opencode/runs/` is mandatory and transcript
  evidence blocks are not accepted; transcript blocks (fenced JSON with
  `command` and `exit_code: 0`) count only when the runner tool is absent;
- reviewer approval appears in the same session AND postdates the last
  non-progress file edit — an edit after APPROVE invalidates the approval and
  requires a fresh review;
- `progress.txt` exists and records a `Selected: <strategy>` line (waivable via
  `OPENCODE_AUTONOMOUS_REQUIRE_PROGRESS_UPDATE=false`);
- strategy selection is consistent with observed delegation — `Selected:
  karpathy` without an observed `@karpathy` delegation requires harness
  artifacts with real loop content: a non-empty `program.md`, a valid non-empty
  `.opencode/karpathy.json`, and an `experiments.md` containing at least one
  `## Run` entry with `Score:` and `Decision:` lines (touched empty files do
  not pass);
- stale on-disk specs do not replace visible Prometheus payloads.

The workaround-dump detector (no-promise "here's what you'd run yourself"
responses when bash is unavailable) requires the can't-do statement to appear
in prose outside fenced blocks, and does not count fenced evidence blocks as
workaround code — quoted test output containing words like "unavailable" must
not trigger a corrective.

Implementation stuck states require a spec and a recent `progress.txt` update.
A missing-spec `WORK_STUCK` is treated as a bootstrap stop when no Prometheus
payload has been observed in the session. If a Prometheus payload has been
observed, the gate rejects the stuck state and posts the exact payload back into
the session so autonomous can write `SPEC.md` verbatim.

The plugin cannot prevent the text of a promise token from appearing. It reacts
after the message and posts corrective pressure so the agent must continue until
the contract is satisfied.

Corrective messages are part of the developer experience contract. A rejection
must identify the specific failed check, give a concrete next action, and avoid
dumping unrelated preconditions. Broad gate policy may appear in documentation,
but the runtime corrective should be legible to a human supervising the session:

```text
AUTONOMOUS GATE: <promise/reason>.

Failed check(s):
- <specific failed check>

Next action(s):
- <one concrete recovery action>
```

The missing Prometheus payload recovery is intentionally more directive: it must
include the observed `<spec filename="SPEC.md">...</spec>` payload so autonomous
can materialize the handoff without asking the user to reconstruct it.

### Mutation gate

When `.opencode/mutation.json` exists and `enabled: true`, the gate adds a
**mutation-rigor precondition** to `COMPLETE`:

- The result artifact at `result_path` must exist.
- Its `score` must be `>= score_threshold`.
- The result must be fresh: `generated_at` must be newer than the mtime of every
  source file listed in the result's `files` array.

The gate reads the JSON artifact directly; a transcript claim of a passing score
does not satisfy it.

The mutation config itself must be declared `readonly` in `.opencode/immutable.json`
so the implementer cannot lower the threshold or exclude files to game the score.

The gate is inert when `.opencode/mutation.json` is absent or `enabled: false`,
making this feature opt-in per project.

Feature flags:

```text
OPENCODE_AUTONOMOUS_REQUIRE_REVIEWER=true
OPENCODE_AUTONOMOUS_REQUIRE_EVIDENCE=true
OPENCODE_AUTONOMOUS_REQUIRE_PROGRESS_UPDATE=true
OPENCODE_AUTONOMOUS_AGENT_NAME=autonomous
```

## Runner Tool

Location:

```text
.opencode/tool/run.ts
```

Purpose:

- provide deterministic, evidence-producing shell command execution for agents;
- write structured result artifacts that the gate reads as primary evidence;
- eliminate transcript-based evidence claims as the sole verification path.

The runner always spawns `bash -c` (never `$SHELL`) so behavior is identical on
macOS and Linux.

### Invocation

```typescript
run({ command: string, cwd?: string, timeoutSec?: number })
```

Default timeout is 30 seconds.

### Result structure

Each invocation produces a `RunResult`:

```json
{
  "run_id": "<random 8-byte hex>",
  "exit_code": <number>,
  "duration_ms": <number>,
  "stdout_tail": "<last 2000 chars>",
  "stderr_tail": "<last 2000 chars>",
  "timed_out": <boolean>,
  "command": "<exact command run>"
}
```

### Artifact storage

Results are persisted under `.opencode/runs/` in the target project:

```text
.opencode/runs/{run_id}.json   — structured RunResult
.opencode/runs/{run_id}.log    — raw stdout+stderr interleaved
```

The gate plugin reads `.opencode/runs/` as the **primary evidence path**. It
selects the newest artifact by filesystem mtime and checks `exit_code === 0`.
A transcript evidence block (`exit_code: 0` in a fenced JSON block) is accepted
only as fallback when no runner artifacts exist.

### Registration

`run.ts` exports a default async function. OpenCode auto-discovers tools via
the default export.

### When `run.ts` is absent

If `.opencode/tool/run.ts` does not exist in the project, agents should emit
`<promise>BLOCKED</promise>`. The gate verifies the file is genuinely absent
from disk before accepting this BLOCKED state.

## Autonomous Loop Plugin

Location:

```text
plugins/opencode-autonomous-loop.js
plugins/opencode-autonomous-loop/
```

`opencode-autonomous-loop.js` is the top-level OpenCode plugin entrypoint. The
package directory contains the implementation. Both must be deployed; the wrapper
is what OpenCode auto-discovers at startup.

Purpose:

- persist autonomous run state across bounded sessions;
- track lifecycle and iteration state;
- track spec hash and progress touches;
- record promise emissions;
- record selected strategy;
- record observed subagent delegation events, including strategy subagents,
  reviewer, and `@builder` worker messages.

Persisted target-project files:

```text
.opencode/autonomous-loop/runs.json
.opencode/autonomous-loop/status.json
```

The loop plugin makes autonomous sessions resumable and auditable without
turning the agent into an unbounded process.

Runtime message observation uses the OpenCode `event` hook for
`message.part.updated` bus events. Agent identity for text parts is resolved from
a `chat.params` session cache before updating durable run state.

## Supervisor Model

The plugins implement a lightweight supervisor model:

- agents remain bounded workers;
- plugins persist state and enforce gates;
- retries and resumes are based on durable project files;
- runtime audits compare design expectations against actual sessions and tools.

Practical unlimited operation means recoverable progress over many bounded
sessions, not one endless agent run.

## Limitations

- Plugins can observe and correct more easily than they can prevent all bad text.
- Reviewer detection depends on observable reviewer output.
- Runtime strategy proof still requires child sessions, task calls, or artifacts.
- Plugin load behavior depends on OpenCode startup configuration and restart.
- Changes to plugins require restarting OpenCode.

## Validation

Plugin behavior is validated by:

- `node --test tests/plugins/*.test.mjs` for plugin unit coverage;
- `python3 tests/verify_opencode.py --skip-llm` for deployment and startup checks;
- optional LLM-backed checks in `tests/verify_opencode.py` when credentials exist;
- `tests/audit_run.py` and `docs/testing-methodology.md` for real session audits.
