# Workflows

This document defines the durable user and agent workflows for the project.

## Quick Questions

Use `@ask` for quick contextual questions, catch-up summaries, and small tradeoff
checks where no implementation or formal planning is required.

`@ask` should answer from session context first, then inspect local evidence only
when needed. It should avoid edits, broad shell use, and implementation workflows.

## Planning: Prometheus Intake

Use `@prometheus` when the work needs a new or improved implementation spec,
loop setup, or requirements clarification.

Prometheus must:

- remain read-only;
- interview in batches when requirements are unclear;
- gather local or external evidence through allowed read/research tools;
- consider at least two distinct approaches for non-trivial work;
- reject alternatives with concrete kill-reasons;
- return a complete payload rather than partial notes;
- include an autonomous strategy directive.

Prometheus has two primary tracks.

### SPEC Track

For implementation, refactor, bugfix, documentation architecture, and validation
work, Prometheus returns:

```text
<spec filename="SPEC.md">
...
</spec>
```

The payload must be complete enough for `@autonomous` to materialize and execute.
Prometheus should not include explanatory prose before the payload block when the
next step is execution.

### Karpathy Setup Track

For metric optimization loops that are already well specified, Prometheus may
return payloads for:

- `program.md`
- `.opencode/karpathy.json`
- `.opencode/immutable.json`
- optional `experiments.md` starter content

If the task is intended for Karpathy but lacks instrumentation, Prometheus should
return a `SPEC.md` payload for adding the metric and frozen evaluator first.

## Execution: Prometheus To Autonomous

The standard execution workflow is:

1. User runs `@prometheus`.
2. Prometheus returns a complete payload.
3. User runs `@autonomous`.
4. Autonomous materializes the visible Prometheus payload to `SPEC.md` verbatim.
5. Autonomous reads `SPEC.md` and records strategy selection in `progress.txt`.
6. Autonomous executes directly or invokes the selected strategy subagent.
7. Autonomous verifies after changes.
8. When `.opencode/mutation.json` is present and enabled, autonomous runs the
   mutation runner diff-scoped, feeds surviving mutants back as failing test
   requirements, and commits the result artifact before proceeding to review.
9. Autonomous calls `@reviewer` with the spec, diff summary, and evidence.
10. Autonomous continues on `REQUEST_CHANGES` or completes on `APPROVE` plus valid
    evidence (and a passing mutation result when required).

If no `SPEC.md` exists and there is no current visible spec payload,
`@autonomous` should tell the user to run `@prometheus` first.

## Test-Rigor Lifecycle (when mutation gate is enabled)

When a project has `.opencode/mutation.json` with `enabled: true`, autonomous
must follow this additional sequence to prevent the "self-graded paper" failure
(writing weak tests that pass only because they don't challenge the implementation):

1. **Red-first:** author tests before implementation; confirm they fail first.
2. **Review:** get tests reviewed against the spec acceptance criteria.
3. **Freeze:** add tests and `.opencode/mutation.json` to `readonly` in
   `.opencode/immutable.json`.
4. **Implement:** write code until frozen tests go green.
5. **Mutation run:** execute `evals/mutation/run_mutation.py` diff-scoped; feed
   survivors back as failing targets until kill score ≥ threshold.
6. **Commit result:** write the JSON result artifact; the gate reads it.
7. **Complete:** emit `COMPLETE` once gate, reviewer, and evidence all pass.

There is no implementer unfreeze path. A genuinely wrong frozen test requires
re-running the test-authoring and review cycle, recorded in `progress.txt`.

If no `SPEC.md` exists and there is no current visible spec payload,
`@autonomous` should tell the user to run `@prometheus` first.

## Direct Autonomous Execution

Direct execution is appropriate when the task has clear acceptance criteria,
normal verification commands, and no need for iterative metric optimization.

Autonomous must still:

- record `Selected: direct` and the reason in `progress.txt`;
- follow the implementation checklist;
- verify changes;
- call reviewer before completion;
- provide strict evidence for the gate plugin.

Direct execution is not a shortcut around accountability.

## Karpathy Loop Workflow

Use Karpathy when a scalar metric and stable frozen evaluator exist or can be
created.

Required runtime inputs:

- `program.md` with objective, metric, constraints, and stop criteria;
- a frozen evaluator command or script;
- mutable target files separate from frozen evaluation code;
- optional `.opencode/karpathy.json` for deterministic command configuration.

Karpathy execution:

1. Read loop objective and configuration.
2. Establish baseline score.
3. Measure noise floor with repeated runs.
4. Propose one hypothesis and one change.
5. Delegate non-trivial implementation back to `@autonomous` when appropriate.
6. Run measurement.
7. Keep only improvements above the configured threshold, normally greater than
   `2x` noise floor.
8. Revert or discard non-improvements.
9. Call reviewer with loop evidence.
10. Repeat until stop criteria or stuck criteria are reached.

`Selected: karpathy` is invalid unless Karpathy was actually invoked or the run
contains equivalent Karpathy artifacts.

## Exotic Strategy Workflow

Exotic strategies are last resort. Autonomous may select an exotic strategy only
after attempting to instrument a deterministic check and documenting why that is
not feasible.

When an exotic strategy is selected:

- record the selection and reason in `progress.txt`;
- invoke the corresponding hidden strategy subagent;
- ensure the strategy is bounded;
- record strategy failure or pivot reasons;
- return to Karpathy if the task becomes measurable.

## Octopus Workflow

Octopus is a coordinator-class strategy used only when its admission test is met.

Expected flow:

1. `@autonomous` invokes `@octopus`.
2. `@octopus` confirms the task warrants a coordinator strategy.
3. `@octopus` derives distinct persona lenses from the spec.
4. `@octopus` dispatches `@octopus-arm` sessions for pre-build perception.
5. Arms return structured evidence-backed perceptions.
6. `@octopus` integrates perceptions and builds as the sole mutating agent.
7. `@octopus` dispatches post-build arms.
8. `@octopus` revises within bounded rounds or escalates.
9. Reviewer is called according to strategy contract.

Arms never edit, write, or delegate.

## Research Workflow

Use `@data-scientist` when a valid project NotebookLM notebook and authenticated
NotebookLM MCP connection exist. It should query NotebookLM and separate notebook
evidence, local facts, analysis, risks, and recommendation.

Use `@grounder` when NotebookLM context is absent, invalid, ambiguous, or
unnecessary. Grounder gathers cited local and external evidence without editing.

Research subagents support planning and implementation. They do not decide final
completion.

## Review Workflow

`@reviewer` receives a caller-provided rubric. For Autonomous, the rubric is the
SPEC acceptance criteria and change summary. For Karpathy, the rubric is the loop
objective, measurement, and keep/revert evidence.

Reviewer returns either:

```text
APPROVE
```

or:

```text
REQUEST_CHANGES
```

with findings and evidence. The caller must continue on `REQUEST_CHANGES`.

## Worker Delegation Workflow

`@autonomous` may delegate component-scoped implementation units to `@builder`.
This is an optimization and context-control mechanism, not a prerequisite for
ordinary implementation. If the OpenCode runtime does not expose subagent
delegation to `@autonomous`, it should implement directly, record that delegation
was unavailable, and continue unless the SPEC is explicitly a delegation smoke
test.

The workflow is:

1. Autonomous interprets the full spec.
2. Autonomous identifies a bounded unit whose local implementation can be
   separated from global completion authority.
3. Autonomous sends a brief with objective, expected file set, constraints,
   verification signal, and return format.
4. Builder implements within the scope and reports changes plus local evidence.
5. Builder stops and reports if the work requires scope expansion.
6. Autonomous inspects the diff and reruns final verification.
7. Autonomous updates progress/checklist state only after its own verification.

Parallel builder delegation is allowed only for disjoint declared file sets. If
two units may touch the same file or shared state, they must be serialized.

## Documentation Workflow

When changing stable project behavior, update durable docs in the same change.

The expected sequence is:

1. Identify whether the change alters requirements, architecture, workflows,
   agent taxonomy, plugin semantics, validation, or conventions.
2. Update the corresponding document under `docs/`.
3. Update `README.md` if the public overview or quickstart changed.
4. Update tests or validator checks when the documentation describes an
   enforceable invariant.
5. Run validation.

`SPEC.md` may include the current implementation plan, but it is not sufficient
as the durable record.
