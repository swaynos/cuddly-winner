# Feedback: Custom Ralph And Generated Task Execution On A Website Crawler

## Context

This feedback compares an observed project-specific Ralph runner with the
current generated-agent design for a website crawler. It omits the target site,
collected content, private goal, local paths, credentials, and session ids.

The crawler performs an open-ended sequence of related work:

- discover pages and routes from public sources;
- fetch content while respecting pacing and temporary access failures;
- reject incomplete or duplicate captures;
- preserve provenance for accepted captures;
- group related pages and assess group completeness;
- run downstream evaluation only after required gates pass;
- repair crawler code and tests when defects block progress.

The crawler keeps state in a local database. One pass may discover routes,
capture pages, retry failures, validate data, repair code, or document a blocker.
One useful pass is not expected to complete the whole crawl.

Progress can be summarized with five domain-neutral counters:

- **Inventory:** records known to the crawler, including uncaptured discoveries.
- **Valid artifacts:** unique, complete, source-grounded captures.
- **Gate-ready artifacts:** valid captures that meet every downstream gate.
- **Complete groups:** related-page groups assessed as complete.
- **Downstream outputs:** completed evaluations from gate-ready data.

## Observed Custom Ralph Runner

The project-specific runner accepts a pass budget. It starts a fresh OpenCode
agent session for every pass with a fixed model. Each session reads durable
project rules, a broad pass prompt, and prior run records. It may crawl, retry,
validate data, repair code, run tests, or change approach from persisted state.

The runner reads the database before and after every pass. It records the five
counters, their deltas, process exit status, full transcript, and a pass report.
Agent prose cannot replace the database measurement.

By default, a failed or idle pass does not end the configured run. The runner
records it and starts the next fresh session. Finding one useful result also does
not prove project completion.

State continuity comes from the database, worktree, durable documentation, and
prior run records. It does not depend on one conversation retaining the entire
history.

## Current Generated-Agent Design

Prometheus now publishes a task-specific package under `.opencode/`: a
schema-v1 registry, task manifest, durable brief, and project-local agent
definition. It chooses `direct`, `ralph`, or `optimization` from the task's
evidence. The generated agent starts after an OpenCode restart in a new
conversation and acts from the worktree and published files.

For this crawler, `ralph` is the relevant strategy when each pass has independent
before-and-after progress evidence. The package must state the pass budget,
state paths, measurements, failed-pass treatment, run-wide stops, final outcome
evidence, and who starts later passes. A useful pass remains distinct from final
delivery.

`scripts/task-loop.mjs` can start those later passes. It runs one fresh named
generated-agent process per pass with no prompt message, records optional state
counters and JSONL evidence, and applies only configured pass, idle, wall-time,
and failure stops. It is a developer script, not part of the installed profile.
It does not decide whether the crawler outcome is accepted.

The current design also allows a bounded `direct` session for one closed task
and `optimization` when the metric, evaluator, targets, noise policy, budget,
and keep-or-revert rule are complete. These strategy contracts replace the need
for one universal executor profile.

## Evidence Needed To Diagnose A Handoff

The available report establishes an outcome gap, but it does not establish why
a prior single-session attempt stopped. A diagnosis needs the planning decision,
published package, actual runtime profile, tool events, project-state changes,
and exact stop condition from the same incident.

Without that packet, a reader cannot distinguish:

- an infeasible acceptance condition;
- a missing or stale installed profile;
- an untried permitted tool path;
- an enforced permission boundary;
- a failed continuation decision;
- a correct response to a declared stop.

### Planning Evidence

For each incident, retain a privacy-safe account of what Prometheus knew before
publication:

- the abstract outcome and required crawler phases;
- baseline values for each domain counter;
- acquisition and feasibility measurements, including access limits;
- the selected strategy and rejected credible alternatives;
- core acceptance conditions and any numeric threshold;
- pass, run-wide, failure, and escalation stops;
- exact verification commands and the evidence each command proves.

This matters when an acceptance condition depends on an empirical prerequisite.
In the observed work, the baseline had no records passing one required external
evidence gate, while a later plan required a much larger gate-ready corpus. The
same plan required an early stop if no permitted acquisition path could supply
that evidence. A complete record must show whether Prometheus established the
prerequisite, redesigned the outcome, or blocked publication.

### Generated Execution Evidence

For each run, retain:

- the deployed Cuddly Winner and OpenCode revisions;
- the generated agent name and exact package bytes;
- the model, invocation, approval mode, pass budget, and time limits;
- the available tools, operations, and enforced edit and Bash boundaries;
- starting state, pass transitions, database deltas, and command results;
- the final worktree, package hashes, final evidence, and exact stop reason.

At least one observed attempt used an installed profile older than its source
checkout. Another passed library checks while required runtime entrypoints were
absent. A useful packet must preserve both deployment and runtime evidence so a
source-contract issue is not confused with profile drift or weak verification.

### Chronology

The incidents span more than one project revision. Every packet must state
whether the failed run happened before or after the relevant publication,
continuation, runtime-entrypoint, fallback, and blocker rule existed in the
installed profile.

Without chronology, a historical failure can be mistaken for current behavior,
or a source-level repair can be assumed present in an older installation.

## Sanitized Handoff Packet

Each incident needs one self-contained packet with no target-site name, source
text, local path, session id, credential, or private goal.

| Packet section | Required contents |
| --- | --- |
| Abstract request | A multi-phase crawl that must discover, capture, validate, evaluate, and publish bounded results. |
| Starting state | The five counters, active pass state, pending phase, and retry or cooldown state. |
| Prometheus decision | Feasibility evidence, selected strategy, acceptance conditions, limits, stops, and exact verification. |
| Published package | Registry entry, agent definition, manifest, brief, hashes, and publication time. |
| Execution environment | Deployed revisions, model, permissions, plugins, tools, available operations, and approval results. |
| Execution trace | Ordered phases or passes, commands and tools used, persisted deltas, and failed or skipped operations. |
| Stop boundary | The exact acceptance condition, stop rule, blocker, or verification result that ended the run. |
| Contract assessment | Whether the stop followed the package, left ordinary in-scope work, or exposed a failed prerequisite. |
| Follow-up status | Whether a later project version changed the related contract, deployment, fixture, or test. |

Agent reports are useful summaries, but they cannot replace database
measurements, package bytes, installed identity, tool availability, and command
results.

## Incident Separation

The prior single-session attempts should not be treated as one failure mode.

| Incident type | Observed state | What the packet must establish |
| --- | --- | --- |
| Intermediate-phase stop | Persisted work remained and no final output existed after a successful bounded batch. | Whether the selected strategy required another pass, whether a run-wide stop applied, and who owned the next launch. |
| Runtime-entrypoint gap | Library checks passed while required command or plugin entrypoints were absent. | Whether the package required those entrypoints, whether final verification loaded them, and whether the active profile could discover them. |
| Acquisition-path stop | Direct acquisition failed before required data existed. | Which permitted paths were available, which were tried, and whether all safe alternatives were exhausted. |
| Explicit prerequisite stop | A required evidence or access prerequisite was absent. | Whether it was established before publication, declared as a stop, and checked before dependent work. |

Each incident must be assessed against the contract and installed profile in
force at the time. Evidence does not support one common cause yet.

## Observed Custom Ralph Outcomes

The custom runner recorded these results across three runs:

| Run | Recorded passes | Inventory | Valid artifacts | Gate-ready artifacts | Complete groups | Downstream outputs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 10 | 835 to 990 | 484 to 653 | 0 to 0 | 15 to 15 | 0 to 0 |
| B | 227 | 1,000 to 1,254 | 663 to 917 | 0 to 0 | 15 to 15 | 0 to 0 |
| C | 35 | 1,254 to 238,174 | 917 to 3,752 | 0 to 15 | 15 to 31 | 0 to 0 |

All 10 passes in Run A and all 35 passes in Run C recorded process exit status
0. Run B recorded 227 passes. These are database measurements, not claims from
an agent report.

The Run C inventory increase includes discoveries, not 236,920 validated
captures. Valid artifacts increased by 2,835. Discovery volume and useful
crawler output are different measures.

Downstream outputs remained zero. The runs show repeated persisted progress
across fresh sessions and several crawler stages, but not completion of the
downstream outcome.

## Prior Single-Session Outcomes

Three historical attempts tried to implement or resume comparable crawler work
within one root execution session:

- One stopped while persisted state still reported `work_remaining`. It had
  imported 83 routes and recorded 4,440 discoveries, but produced no final
  result.
- One stopped with a red final audit after reaching 42 valid captures and 38
  gate-ready records. It produced no final result.
- One stopped with no completed crawler cycle and no downstream-ready records.
  Its handoff described the worktree as incomplete and not committable.

The attempts produced partial controller, preflight, acquisition, or recovery
work and reported incomplete or failed states. None delivered the requested
crawler outcome. These observations are historical evidence, not a contract for
a shipped agent.

## Objective Comparison

| Dimension | Observed custom runner | Current generated `ralph` design |
| --- | --- | --- |
| Unit of execution | One fresh session per configured pass | One fresh named generated-agent process per configured pass |
| Task input | Broad pass prompt plus project state | Published schema-v1 task package plus project state |
| Work selection | Agent chooses the next useful action | Package states the pass work-selection rule |
| Progress evidence | Runner reads domain counters before and after | Project state command supplies counters before and after |
| Failed pass | Recorded; later configured passes continue | Recorded; continue by default unless configured otherwise |
| Stop condition | Pass count and project-specific runner rules | Pass, idle, wall-time, failure, and run-wide rules from the package and loop options |
| Final acceptance | Outside the runner | Task-defined evidence, not loop exit status |
| Deployment | Project-specific runner | Loop stays outside the managed profile; agent package is project-local |

The observed custom runner sustained repeated measured progress. The current
generated design now has the contracts needed to model that loop without a
universal executor, but the cited crawler data did not come from a controlled run of
the current design. No outcome comparison should claim otherwise.

## Expected Crawler Contract

A generated `ralph` package for this crawler should:

- separate one useful pass from whole-crawl completion;
- record the five counters independently before and after every pass;
- preserve transcripts and JSONL records without treating prose as progress;
- continue after isolated failed or idle passes unless a run-wide stop applies;
- treat controller or package work as partial progress, not crawler output;
- define final evidence for gate-ready data and downstream outputs.

A bounded `direct` package is suitable only when one invocation has a closed,
verifiable outcome. An `optimization` package is suitable only when its metric
and evaluator measure the intended crawler result rather than a proxy such as
inventory size.

## Limits

This was not a controlled experiment. The observed runs differed in starting
database, model, token budget, permissions, tools, site access, duration, scope,
and pass count. Process exit status 0 means a process ended normally, not that
the crawler goal was complete. A large inventory increase does not imply valid
or gate-ready output.

The evidence supports one narrow conclusion: the custom runner repeatedly
resumed measured incremental work, while the three historical single-session
attempts stopped with partial work and no requested final outcome. It does not
establish the cause. A controlled run of the current generated `ralph` package,
with one sanitized packet per incident, is still required.
