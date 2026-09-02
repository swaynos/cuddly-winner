# Feedback: Custom Ralph and Autonomous on a Website Crawler

## Context

This feedback compares two autonomous execution approaches used on a website
crawler. It omits the crawler's target website, the content being collected,
the user's end goal, and other private project details.

The crawler performs an open-ended sequence of related tasks:

- Discover pages and routes from public website sources.
- Fetch page content while respecting pacing and temporary access failures.
- Reject incomplete or duplicate captures.
- Preserve source provenance for accepted captures.
- Group related pages and assess whether each group is complete.
- Run downstream evaluation only after a capture passes the required gates.
- Repair crawler code and tests when implementation defects block progress.

The crawler persists its state in a local database. Work is incremental: one
agent pass may discover routes, capture pages, retry prior failures, validate
existing captures, improve crawler code, or document a blocker. No single pass
is expected to complete the whole crawl.

Progress can be summarized with five domain-neutral counters:

- **Inventory:** records known to the crawler, including uncaptured discoveries.
- **Valid artifacts:** unique, complete, source-grounded captures.
- **Gate-ready artifacts:** valid captures that meet every downstream gate.
- **Complete groups:** related-page groups assessed as complete.
- **Downstream outputs:** completed evaluations produced from gate-ready data.

## Approach A: Custom Ralph Runner

The project-specific Ralph runner accepts a configured number of passes. It
starts a fresh OpenCode agent session for every pass and uses a fixed model.
Each session reads the durable project rules, a broad pass prompt, and prior run
records. It may crawl, retry, validate data, repair code, run tests, or change
strategy according to the current persisted state.

The runner, rather than the agent, reads the database before and after every
pass. It records the five counters, their deltas, the process exit code, the
full agent transcript, and a separate pass report. The agent's prose cannot
replace the runner's database measurement.

A failed or unproductive pass does not stop the configured run. The runner
records the result and starts the next fresh session. Finding a useful result,
encountering a blocked path, or reporting no change also does not end the run.
Ralph is an incremental worker, not a project-completion gate.

State continuity comes from the database, worktree, durable documentation, and
prior run records. It does not depend on retaining one agent's context across
the whole run.

## Approach B: Cuddly Winner Autonomous

Cuddly Winner Autonomous is a generic scaffold-driven implementation agent. It
reads a published specification and manifest that define implementation scope,
acceptance criteria, required outputs, invariants, escalation conditions, and
exact verification commands.

Autonomous works within one root execution session. After each bounded step, it
is expected to inspect the remaining scope and continue ordinary in-scope work.
It treats focused checks as intermediate gates rather than completion evidence.
A successful result requires all requested outcomes and checklist items, fresh
passage of every declared final command, and an independent validator handoff.

Autonomous stops when the full scaffold is complete or when a required step is
proven impossible with the tools and permissions available in that session. A
structural blocker produces a handoff to the user rather than another fresh
execution pass. Continuing after that handoff requires another invocation.

The optional Autonomous KPI mechanism measures session usage. It does not
measure crawler-domain progress, create persisted progress state, prompt an
idle session, or extend a completed session. Crawler counters and progress
claims therefore come from commands and reports executed within the agent's
workflow unless the project supplies a separate measurement controller.

## Is This Enough To Diagnose The Handoff?

No. This report is sufficient to establish an outcome gap. It is not sufficient
to diagnose a Prometheus-to-Autonomous handoff.

The report describes the custom runner and the resulting database changes, but
it does not preserve the planning input or the execution envelope for an
Autonomous attempt. A reader cannot determine whether a stopped attempt was
caused by an infeasible published scaffold, a continuation failure, missing
runtime deployment, an untried permitted tool path, a permission boundary, or a
correct response to an explicit escalation condition.

### Missing Prometheus Evidence

The report needs a privacy-safe account of what Prometheus knew before it
published each scaffold:

- The abstract requested outcome and the required crawler phases.
- Baseline counts for each domain counter.
- Results of any acquisition or feasibility pilot, including sustainable
  capacity, access limits, and untried authorized paths.
- The selected implementation approach and rejected alternatives.
- Each core acceptance condition, especially any numeric or evidence threshold.
- Each escalation trigger and the condition that should produce a failed,
  blocked, or stopped cycle.
- The verification commands and what they prove.

This is needed because an acceptance condition can depend on an empirical
prerequisite. In the observed cases, the baseline had no records passing a
required external-evidence gate, while a later scaffold made a substantially
larger gate-ready corpus a core acceptance condition. The same scaffold also
required an early stop when no authorized acquisition path could provide the
needed evidence. Without the planning record, a reader cannot determine whether
Prometheus established that prerequisite, identified it as a planning blocker,
or published an execution task that was already unable to meet a core outcome.

### Missing Autonomous Execution Evidence

For each attempt, the report needs:

- The deployed Cuddly Winner revision and the deployed Autonomous agent version.
- The model, invocation text, approval mode, token and time limits, and whether
  a continuation controller was enabled.
- The tools and operations exposed to the session, including permitted headless
  access paths.
- The plugin and command entrypoints actually installed and discoverable at run
  time, not merely present in a source checkout.
- The starting persisted state, phase transitions, database deltas, commands
  attempted, command results, and the exact stop condition.
- The final worktree state, validator status, and whether the next required
  phase remained ordinary in-scope work.

At least one observed attempt used an installed profile that was older than the
source profile. Another passed library-level checks while required runtime
entrypoints were absent. The report's current generic account omits both facts,
so it cannot distinguish a source-contract issue from deployment drift or a
verification gap.

### Missing Chronology

The incidents span more than one version of Cuddly Winner. Some earlier
failures led to later continuation, runtime-entrypoint, fallback, and
terminal-recovery rules and fixtures. The report must state, for every incident,
whether the failing run occurred before or after the relevant rule was deployed.

Without this chronology, a reader may attribute a historical failure to the
current source contract, or assume that a source-level repair was available to a
stale installed profile.

## Sanitized Handoff Packets

Each Autonomous incident should have one self-contained, sanitized handoff
packet. It should contain the following information and no target-site name,
source text, local path, session identifier, credentials, or private user goal.

| Packet section | Required contents |
| --- | --- |
| Abstract request | A multi-phase website crawl that must discover, capture, validate, evaluate, and publish bounded results. |
| Starting state | The five domain counters, active cycle state, pending phase, and known retry or cooldown state. |
| Prometheus decision | Feasibility evidence, selected approach, core acceptance conditions, escalation triggers, and exact verification. |
| Execution environment | Deployed revision, agent version, model, permissions, enabled plugins, available tool operations, and approval results. |
| Execution trace | Ordered phase transitions, commands and tool operations attempted, persisted deltas, and failed or skipped operations. |
| Stop boundary | The exact checklist item, acceptance condition, escalation trigger, or verification result that caused the final status. |
| Contract assessment | Whether the stop followed the published scaffold, left ordinary in-scope work, or revealed an unmet load-bearing prerequisite. |
| Follow-up status | Whether a later Cuddly Winner version changed the relevant contract, deployment, fixture, or test. |

Agent reports remain useful summaries, but they cannot substitute for this
packet. The database measurement, scaffold bytes, deployed agent identity,
tool availability, and command results are the necessary comparison evidence.

## Incident Separation

The observed Autonomous attempts should not be treated as one failure mode.

| Incident type | Observed state | What a diagnostic packet must establish |
| --- | --- | --- |
| Intermediate-phase stop | Persisted work remained and no final output existed after a successful bounded batch. | Whether the scaffold required continuation, whether a declared escalation trigger existed, and whether the session stopped despite ordinary in-scope work remaining. |
| Runtime-entrypoint gap | Library-level checks passed while required command or plugin entrypoints were absent at runtime. | Whether Prometheus required the entrypoints, whether final verification checked actual runtime loading, and whether the deployed profile could discover them. |
| Acquisition-path stop | Direct acquisition failed and the attempt stopped before producing the required data. | Which authorized paths were exposed, which were attempted, their concrete results, and whether all safe alternatives were exhausted. |
| Explicit prerequisite stop | A required evidence or access prerequisite was absent, preventing later phases. | Whether the prerequisite was established before publication, whether it was a declared escalation condition, and whether the stop occurred before dependent downstream work. |

Each incident can then be assessed against the contract in force at that time.
It should not be used to infer a common cause without evidence.

## Observed Custom Ralph Outcomes

The custom runner recorded these results across three runs:

| Run | Recorded passes | Inventory | Valid artifacts | Gate-ready artifacts | Complete groups | Downstream outputs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 10 | 835 to 990 | 484 to 653 | 0 to 0 | 15 to 15 | 0 to 0 |
| B | 227 | 1,000 to 1,254 | 663 to 917 | 0 to 0 | 15 to 15 | 0 to 0 |
| C | 35 | 1,254 to 238,174 | 917 to 3,752 | 0 to 15 | 15 to 31 | 0 to 0 |

All 10 passes in Run A and all 35 passes in Run C recorded process exit code 0.
Run B recorded 227 passes. The table reports database state measured by the
runner, not counts claimed by an agent report.

The inventory increase in Run C includes newly discovered records, not 236,920
validated captures. The valid-artifact counter increased by 2,835 during that
run. This distinction matters because discovery volume and usable crawler
output are not the same result.

These records do not show completion of the crawler's downstream work.
Downstream outputs remained at zero. They do show repeated persisted progress
across fresh sessions and across more than one stage of the crawler pipeline.

## Observed Autonomous Outcomes

Three Autonomous attempts were used to implement or resume equivalent crawler
work from published scaffolds:

- One attempt stopped while persisted state still reported `work_remaining`.
  It had imported 83 routes and recorded 4,440 discovered occurrences, but it
  did not produce the scaffold's requested final result.
- One attempt stopped with a red final audit after reaching 42 valid captures
  and 38 gate-ready records. It did not produce the requested final result.
- One attempt stopped with no completed crawler cycle and no downstream-ready
  records. Its final handoff described the worktree as incomplete and not
  committable.

Across the three attempts, Autonomous produced partial controller, scaffold,
preflight, acquisition, or recovery work and then returned a handoff. Each
handoff reported an incomplete or failed state rather than claiming successful
completion. None of the attempts completed the requested crawler outcome.

## Objective Comparison

| Dimension | Custom Ralph runner | Cuddly Winner Autonomous |
| --- | --- | --- |
| Unit of execution | One fresh session per configured pass | One scaffold-driven root session per invocation |
| Primary objective | Make one useful incremental change per pass | Complete every required scaffold outcome or prove a blocker |
| State continuity | Database, worktree, durable docs, and prior run records | Root-session context, worktree, scaffold, and project state |
| Work selection | Agent chooses the next useful action from measured state | Agent follows bounded scaffold scope and acceptance criteria |
| Progress evidence | Runner independently reads domain counters before and after each pass | Agent runs project commands; optional KPIs measure usage, not domain progress |
| Pass failure | Recorded; later configured passes continue | A proven required blocker ends the invocation with a handoff |
| Stop condition | Exhaust the configured pass count | Complete and verify the scaffold, or report a proven blocker |
| Completion role | Not a completion gate | Strict completion and validation gate |
| Recovery after a halt | Next fresh pass starts automatically | Another user or controller invocation is required |

For this crawler, the custom runner produced more repeated, independently
measured state changes. The Autonomous attempts preserved partial work and
reported incomplete states, but stopped before delivering their requested final
outcomes. This is an observed outcome difference, not a diagnosis of why the
difference occurred.

## Expected Behavior

An Autonomous approach used as a Ralph-style crawler runner should make its
iteration contract explicit. In particular:

- Distinguish success of one useful pass from completion of the whole crawl.
- Record crawler-domain counters independently before and after each pass.
- Preserve transcripts and reports without treating prose as progress evidence.
- Continue later configured passes after an isolated failed or blocked pass
  unless a declared run-wide stop condition has been reached.
- Treat supporting controller or scaffold work as partial progress, not as the
  requested crawler result.

If Autonomous remains a strict one-invocation completion agent instead, its
result should be assessed under that contract rather than described as a Ralph
loop. A blocked handoff is honest and useful evidence, but it is not continued
autonomous execution.

## What Worked

The custom runner separated agent reports from independent measurements,
preserved pass-level evidence, and continued through unproductive passes.

The Autonomous attempts preserved the worktree and persisted checkpoints, ran
local checks, and reported red or incomplete states instead of claiming final
success.

Both approaches retained useful partial work. Only the custom runner, in these
observations, repeatedly resumed the incremental crawler workload without a new
user invocation.

## Limits of This Comparison

This was not a controlled experiment. The two approaches ran at different
times and did not necessarily share the same starting database, model, token
budget, permissions, available tools, website access, run duration, or exact
scope. The number of passes also differed substantially.

Process exit code 0 means that an agent process ended normally; it does not mean
that the crawler goal was complete. A large inventory increase does not mean
that every discovered record became a valid artifact. A truthful blocked
Autonomous handoff is not a successful crawler outcome, but it is preferable to
a false completion claim.

The evidence supports only this conclusion: under the observed conditions, the
custom pass runner sustained independently measured incremental progress, while
the cited scaffold-driven Autonomous invocations stopped with partial work and
without their requested final outcomes. It does not establish the cause of that
difference.

It also does not yet establish a diagnosis of the Prometheus-to-Autonomous
handoff. That requires one sanitized handoff packet per incident, with the
published planning decision and the actual execution environment preserved next
to the observed outcome.
