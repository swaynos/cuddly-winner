# Validation

This document defines the validation model for the project.

## Validation Principle

Static validation proves the project is configured to behave correctly. Runtime
validation proves an actual OpenCode session behaved correctly.

Both are required. Do not infer runtime behavior from configuration alone.

## Standard Commands

Run plugin unit tests:

```bash
node --test tests/plugins/*.test.mjs
```

Run the OpenCode suite validator without LLM-backed checks:

```bash
python3 tests/verify_opencode.py --skip-llm
```

Run the full validator when model credentials are available:

```bash
python3 tests/verify_opencode.py
```

Run a runtime audit for a known project/session:

```bash
python3 tests/audit_run.py --project /path/to/project --session <session-id>
```

## Static Validator Responsibilities

`tests/verify_opencode.py` must check:

- Python/runtime preflight;
- required agent files;
- required skill files and skill metadata;
- required plugin files;
- required docs files;
- required root `AGENTS.md` rules;
- shell script linting when shellcheck is available or required;
- strategy registry structure;
- strategy-subagent contract conformance;
- Prometheus read-only handoff markers;
- Autonomous spec materialization markers;
- Karpathy admission gate markers;
- Octopus brain/arm markers;
- sandboxed OpenCode path isolation;
- deployment script install/status/remove behavior;
- resolved agent modes;
- resolved permission rules;
- plugin startup logs;
- optional plugin hook behavior with a real LLM provider.

The validator must run in a disposable sandbox and never mutate the user's real
OpenCode configuration.

## Expected Agent Validation

The validator should assert the expected core agent roster and mode:

- `ask`: primary
- `prometheus`: primary
- `autonomous`: all
- `karpathy`: subagent
- `ralph-wiggum`: subagent
- `octopus`: subagent
- `octopus-arm`: subagent
- `data-scientist`: subagent
- `grounder`: subagent
- `reviewer`: subagent
- `builder`: subagent

It should assert the permission posture that makes each role safe. Read-only
agents must deny edit/write paths. Strategy and worker agents must deny arbitrary
task delegation.

## Documentation Validation

The validator must require the canonical docs architecture:

- `docs/README.md`
- `docs/REQUIREMENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/AGENT-ARCHITECTURE.md`
- `docs/WORKFLOWS.md`
- `docs/STRATEGY-CONTRACT.md`
- `docs/PLUGINS.md`
- `docs/VALIDATION.md`
- `docs/CONVENTIONS.md`
- `docs/strategy-template.md`
- `docs/testing-methodology.md`

It must also require `AGENTS.md` to state that `docs/` is the durable source of
truth and `SPEC.md` is not the canonical long-term requirements record.

## Runtime Audit Responsibilities

Runtime audits should inspect OpenCode evidence sources in order:

- SQLite session rows;
- child session rows;
- task tool calls;
- session messages and agent switches;
- OpenCode logs;
- project runtime artifacts such as `progress.txt`, `experiments.md`, and
  `.opencode/autonomous-loop/*.json`.

Strong evidence includes child sessions with expected agents, task tool calls,
strategy entries recorded before edits, Karpathy experiment records, and
structured Octopus perceptions.

Weak evidence includes agent files existing, README/SPEC intent, permissions
being present, or prompts mentioning a methodology without observable execution.

## Known Failure Handling

Known pre-existing failures must be documented with the exact check name and
reason. They should not be silently ignored in docs or final summaries.

At the time this documentation architecture was introduced, a known validator
issue existed where `plugin_load` could fail because one plugin did not appear in
startup logs. That is not a license to ignore unrelated failures.

## Completion Bar

A change is ready only when:

- relevant docs are updated;
- static validation passes or only documented known failures remain;
- plugin tests pass when plugin behavior changed;
- runtime audit guidance is updated when runtime semantics changed;
- OpenCode restart requirements are communicated after agent, skill, plugin, or
  config-time changes.
