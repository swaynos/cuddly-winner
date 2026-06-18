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
plugins/opencode-autonomous-gate/
```

Purpose:

- enforce `@autonomous` promise semantics;
- require evidence for completion;
- require reviewer approval when configured;
- require progress updates for stuck states;
- require strategy consistency where applicable;
- require fresh Prometheus payload materialization where applicable.

The gate plugin activates for the autonomous agent name, normally `autonomous`.
It is a no-op for unrelated agents.

Completion requires the configured preconditions. The default contract is:

- a spec file exists;
- the message contains a fenced JSON evidence block;
- the evidence block includes `command` and `exit_code: 0`;
- reviewer approval appears in the same session;
- strategy selection is consistent with observed delegation;
- stale on-disk specs do not replace visible Prometheus payloads.

Stuck states require a spec and a recent `progress.txt` update.

The plugin cannot prevent the text of a promise token from appearing. It reacts
after the message and posts corrective pressure so the agent must continue until
the contract is satisfied.

Feature flags:

```text
OPENCODE_AUTONOMOUS_REQUIRE_REVIEWER=true
OPENCODE_AUTONOMOUS_REQUIRE_EVIDENCE=true
OPENCODE_AUTONOMOUS_REQUIRE_PROGRESS_UPDATE=true
OPENCODE_AUTONOMOUS_AGENT_NAME=autonomous
```

## Autonomous Loop Plugin

Location:

```text
plugins/opencode-autonomous-loop/
```

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
