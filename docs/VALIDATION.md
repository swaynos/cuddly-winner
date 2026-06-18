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

Run the deterministic agent-value benchmark in default mock mode:

```bash
python3 evals/agent_value/run_benchmark.py --mode mock --out evals/agent_value/results/latest.json
python3 evals/agent_value/score.py evals/agent_value/results/latest.json
python3 -m unittest discover -s evals/agent_value/tests -p "test_*.py"
```

The benchmark compares baseline OpenCode-style behavior with the repo's enhanced
agent workflow on frozen adversarial tasks. It is not a static configuration
check and it is not a general model-intelligence benchmark. It scores observable
artifacts only: verifier results, evidence blocks, reviewer and strategy signals,
spec freshness, progress tracking, immutable-file safety, and honest completion.
The default `mock` mode is deterministic and requires no live LLM credentials.
Optional live OpenCode runs may be added later, but they must remain disposable
and skipped unless credentials and OpenCode are available.

Generated benchmark results are written under `evals/agent_value/results/` and
are non-durable. They are ignored by Git.

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

## Agent-Value Benchmark Responsibilities

`evals/agent_value/` must provide a frozen, reproducible harness that answers a
different question from static validation: whether the custom agent workflow adds
measurable value over a baseline workflow on the same tasks.

The benchmark must:

- run locally in deterministic `mock` mode without live LLM credentials;
- create disposable temp workspaces and never mutate the user's OpenCode config;
- keep fixtures, golden expectations, scorer, and scorer tests immutable via
  `.opencode/immutable.json`;
- write generated run output under `evals/agent_value/results/`;
- report `baseline_score`, `enhanced_score`, and scalar `agent_value_score`;
- penalize polished-but-noncompliant behavior, including stale SPEC use, missing
  evidence, fake reviewer approval, strategy theater, false completion, and
  unsafe immutable-file edits.
- validate Prometheus as a read-only diverge-converge planner, not as an
  ant-style traversal agent: valid Prometheus outputs must either bounce trivial
  requests or return an exact payload with at least two distinct approaches,
  concrete kill-reasons, front-runner validation, and a correct strategy
  directive.

Completion for changes that affect agent behavior, plugin semantics, strategy
selection, or validation should include the benchmark command unless the change
is clearly unrelated to runtime value measurement.

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
truth and `SPEC.md`, when present, is not the canonical long-term requirements
record. Project validation must not require `SPEC.md` to exist.

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
