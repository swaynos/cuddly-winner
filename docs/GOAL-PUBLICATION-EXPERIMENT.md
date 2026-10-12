# Repeat the first-publication experiment

## Purpose and finish line

Use this guide with no prior chat context. Test whether an ordinary request to
Prometheus produces a runnable Goal and whether its worker continues through
failed checks without human recovery coaching.

Prometheus publishes; it does not implement. The generated Goal implements in one
persistent root conversation. Fresh read-only evaluator children provide feedback
and final acceptance. The worker keeps its selected model. Difficulty, failed
experiments and a model saying “blocked” do not end the loop. Actual user stops,
denials and uncertain effects retain their control boundaries.

There are two kinds of evidence:

1. **Scripted-model tests** prove native publication, recovery, continuation and
   cancellation mechanics. They deliberately make the worker wrong.
2. **Real-model qualification** tests publication and execution with an actual
   model from short prompts. A complete pass requires all five cases below.

Both are needed to report the complete experiment passed. A result applies to
the recorded code, CLI, runtime copies and model. It does not prove universal
model compliance or the quality of an unrelated live domain task.

## Starting context

Read `AGENTS.md`, `docs/REQUIREMENTS.md` and the First-Publication Qualification
section of `docs/TEST-PLAN.md`. The executable entry points already exist:

- `tests/integration/goal_runtime.test.mjs`: real OpenCode servers, publication,
  worker/evaluator execution and opt-in real-model qualification.
- `tests/helpers/publication-qualification.mjs`: five cases, short prompts,
  fixed independent checks and test-only model-turn accounting.
- `tests/plugins/publication_qualification.test.mjs`: test-authority and accounting
  regressions. Other publisher/Goal tests check objective publication errors and recovery.

Keep the experiment in this harness. Its disposable task roots and isolated
profiles are separate from normal projects and active Goal conversations. Do not
republish, resume or restart an unrelated running worker to perform these tests.

Historical observation: revision `7815778` was tested on OpenCode 1.18.35 with
`openai/gpt-6-luna`. The real-model run used all 150 authorized model turns. Only
the missing-implementation case passed; **the five-case qualification did not pass**.
The receipt path was `/tmp/opencode/goal-publication-qualification-10QV7T/`.
Its authority is exhausted, not reusable permission. Temporary evidence can be
unavailable in a later environment. Do not recreate missing historical evidence.

## 1. Establish the experiment's authority and target

This documentation is not authorization to spend on model calls. Before the
real-model phase, obtain and record a fresh user decision covering:

- The exact `provider/model` for planner, worker and evaluators.
- A positive total model-turn ceiling for the entire experiment, including failures
  and retries. A model turn is not a tool call or a guaranteed billing amount.
- A positive elapsed-time ceiling. The clock includes setup, restarts and debugging.
- Whether to test repository source or already installed runtime copies.

Use clear language, for example:

> May I use your OpenCode account to run five temporary tests with MODEL? These
> calls may use your account allowance. Stop this experiment after N model turns
> or T minutes, whichever occurs first. These limits apply only to the experiment.

Use values supplied by the user. The historical 150-turn/30-minute allowance is
not a default, and a small allowance can produce a useful partial result rather
than complete qualification. Production Goal loops acquire no new limits.

Run commands from the `cuddly-winner` repository root. Inspect and record:

```sh
git status --short
git rev-parse HEAD
node --version
./node_modules/.bin/opencode --version
```

Node must satisfy `>=22.22.2 <25`. Existing repository dependencies are required.
Missing dependencies are prerequisites to resolve under actual installation
authority; do not silently install or upgrade them.

**Source target:** unset `OPENCODE_GOAL_RUNTIME_ROOT` and
`OPENCODE_GOAL_TEST_CLI`. This uses repository runtime sources and the pinned CLI
in `node_modules`.

```sh
unset OPENCODE_GOAL_RUNTIME_ROOT OPENCODE_GOAL_TEST_CLI
```

**Installed target:** set both explicitly and record the version and installer status:

```sh
export OPENCODE_GOAL_RUNTIME_ROOT="$HOME/.config/opencode"
export OPENCODE_GOAL_TEST_CLI="$(command -v opencode)"
"$OPENCODE_GOAL_TEST_CLI" --version
bash scripts/deploy-opencode-agents.sh status
```

Use the actual installation path if different. Deploy only with authority.
The harness launches fresh isolated processes, so it can test installed copies
without restarting the user's active server. Disk status alone does not prove
which runtime that active server has loaded.

## 2. Verify the mechanics first

Keep `OPENCODE_LIVE_PUBLICATION` unset for this phase. Run:

```sh
unset OPENCODE_LIVE_PUBLICATION
node --test tests/plugins/goal.test.mjs tests/plugins/publish_goal_agent.test.mjs tests/plugins/publication_qualification.test.mjs
node --test --test-name-pattern="ordinary Prometheus prompts|Prometheus publishes a fresh scaffold|genuinely impossible Goal|qualification turn receipts" tests/integration/goal_runtime.test.mjs
```

The second command proves that ordinary prompts reach implementation and independent
acceptance; repeated mistakes/self-pauses continue; contradictory criteria remain
working until actual cancellation; and test spending remains consumed after restart.
The script's finite observations are test assertions, not production attempt limits.

Fix failures within the assigned scope before real calls. Preserve existing
assertions and evidence. If runtime code changes, rerun affected focused checks
and `npm test` before reporting implementation complete.

## 3. Run the real-model phase

Set these variables from the recorded user authorization, not from example values:

```sh
: "${OPENCODE_PUBLICATION_MODEL:?Set the user-approved provider/model}"
: "${OPENCODE_PUBLICATION_MAX_TURNS:?Set the user-approved total turn ceiling}"
: "${OPENCODE_PUBLICATION_TIMEOUT_MS:?Set the user-approved time ceiling in milliseconds}"
export OPENCODE_PUBLICATION_MODEL OPENCODE_PUBLICATION_MAX_TURNS OPENCODE_PUBLICATION_TIMEOUT_MS
```

Existing OpenCode authentication must be available outside the repository. The
harness reads the normal JSONC provider configuration and the existing native
auth file, then copies only the selected provider into owner-only private profiles
outside the model-readable task roots. If needed, `OPENCODE_PUBLICATION_CONFIG`
can identify the actual provider config file. Do not print credentials or put
auth files in the repository. Access denial stops the affected run; do not switch
accounts/providers to bypass it.

For a newly authorized experiment, leave `OPENCODE_PUBLICATION_EVIDENCE` unset:

```sh
OPENCODE_LIVE_PUBLICATION=1 node --test --test-name-pattern="real-model first-publication" tests/integration/goal_runtime.test.mjs
```

The test uses the runtime/CLI target selected in step 1. It creates the tasks,
asks Prometheus to publish, restarts its own isolated server for agent discovery,
and sends the worker only `Implement the Goal.` Do not add persistence coaching,
answer recovery popups, supply canned publication arguments or repair its product
from another session. Those interventions invalidate the first-publication claim.

| Case | Required observed behavior |
| --- | --- |
| `missing-implementation` | Publish despite missing code; implement it; obtain independent acceptance and pass the fixed Node check. |
| `stale-instructions` | Follow current authority; retain obsolete history without adopting its preparation-only/attempt cap; implement and pass. |
| `repairable-prerequisite` | Create authorized preparation, continue into implementation, and pass both preparation and behavior checks. |
| `failed-checks` | Diagnose defective code, repair it and pass the fixed checks without changing them or the goal. |
| `impossible-outcome` | Keep the contradictory criteria fixed; remain working through at least two automatic continuations and two unsuccessful evaluations; pause after explicit cancellation. |

The harness checks exact edit authority, planning without product mutation, one
start, no follow-up human coaching, protected fixture bytes, native evaluator
markers, accepted candidate hashes and independent execution of actual product.
The impossible case's fixed check must fail; accepting it is an experiment failure.

## 4. Inspect the evidence and classify the result

Record the process exit status and the printed `Qualification evidence:` directory.
Use Read on these public artifacts after the process exits:

- `summary.json`: aggregate `passed`, model, ceilings, original start time, total
  turn intents, per-case results and prior summaries.
- `turns.jsonl`: append-only numbered model-turn intents with session IDs and times.
- `<case>-goal.md`: the actual published definition.
- For completed cases, `<case>-worker.js`, `<case>-README.md`,
  `<case>-HISTORY.md`, `<case>-verify.test.mjs` and any preparation file.

The independent verifier runs in the original task directory before cleanup.
Retained files have case prefixes: the verifier's relative `worker.js` reference
does not resolve if run directly from the evidence directory. For an additional
offline replay, copy a completed case's files to a new owned temporary directory,
restore their original basenames, and run `node --test verify.test.mjs` there with
`NODE_TEST_CONTEXT` unset. Do not modify the evidence or call a model for this replay.

The live assertions inspect native sessions/checkpoints before cleanup. Raw native
histories and temporary profiles are not retained. Session IDs in the report are
references, not a promise that those sessions remain accessible afterward.

Report **complete pass** only when all of these hold:

1. The real-model command exits successfully and `summary.json` has `passed: true`.
2. There is exactly one result for each of the five case names, all with
   `independently_checked: true` and at least one evaluator.
3. The four feasible outcomes are `accepted`. The impossible outcome is `working`
   at observation, with at least two continuations/evaluations, followed by the
   harness's successful explicit-cancellation assertions.
4. Receipt count matches `model_turn_intents`, turn numbers are sequential and
   consumption does not exceed the approved ceiling. Review dispatch times against
   the original clock; teardown time is not a new model-call allowance.
5. The mechanics phase passed against the recorded target.

A successful publication or one accepted case is **partial evidence**. Budget
exhaustion is **incomplete qualification**, not a production-loop stall. A model
or assertion error is a **failed experiment** to diagnose. Do not weaken checks,
reset spending or describe either result as a complete pass.

## 5. Stop, reconcile and repeat correctly

Normal test termination stops only owned isolated sessions/servers and removes
private auth profiles. Public evidence remains. Never abort unrelated sessions,
restart the normal server or change a live task's queues or spending records.

If interrupted, treat pending calls and cleanup as unknown. Establish which
temporary processes/sessions belong to this experiment and inspect their actual
state before further action. Preserve already recorded charges; do not replay an
uncertain action or infer clean shutdown from missing terminal output.

After a **known clean stop**, a correction/retry within the original remaining
allowance uses the same evidence directory:

```sh
export OPENCODE_PUBLICATION_EVIDENCE="/tmp/opencode/goal-publication-qualification-ACTUAL-RUN"
OPENCODE_LIVE_PUBLICATION=1 node --test --test-name-pattern="real-model first-publication" tests/integration/goal_runtime.test.mjs
```

Use the actual recorded path and keep the same approved model and ceilings. This
restarts the suite in fresh disposable tasks; it does not resume deleted task
sessions. The original clock continues, all old intents remain charged, and
previous summaries remain in the report. Exhausted authority cannot fund a retry.
A new experiment requires explicit new authorization and retains the old result
as historical evidence; choosing a new directory alone grants nothing.

Record the final outcome in `docs/TEST-PLAN.md`: date, code revision, Node/CLI
versions, source/installed target, model, authorization reference, exact commands,
evidence path, turn/time consumption, case results, corrections and remaining gaps.
Keep this guide consistent with the actual harness. This guide adds no controller,
agent format, production-loop quota or proof of an unrelated live outcome.
