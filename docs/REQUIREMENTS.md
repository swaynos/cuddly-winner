# Requirements

## Product Goal

This project is an optional extension to OpenCode. It adds specialist agents and
evidence-backed autonomous profiles for work that benefits from stronger
planning, durable state, bounded execution, or scalar-metric optimization.

It is not a replacement for OpenCode's built-in Plan and Build modes.

Its operating model reflects professional software delivery: feature requests,
defects, and bug reports start with triage and, when needed, focused discovery
before implementation. The optional agents make room for meaningful discourse
with users and product owners, challenge material assumptions, and resolve
uncertainty through research or measured spikes. They do not turn native Plan
or Build into a custom workflow or simply agree to every request.

## Document Roles

`docs/REQUIREMENTS.md` and `docs/ARCHITECTURE.md` are the durable, canonical
description of this project. When system behavior and these documents disagree,
the divergence is a defect: either the change is wrong or these documents must
be updated in the same change.

The active implementation specification and its generated strategy scaffold are
transient artifacts for the change currently in flight. Prometheus may replace
them before handoff, and they carry no durable authority. Nothing in a generated
scaffold amends this document; durable decisions land here.

## Native Compatibility Invariant

Built-in `plan` and `build` are outside this project's enforcement boundary.
Installation must not alter their prompts, routing, permissions, Bash access,
mutation tools, or completion behavior. They must continue to work without a
`SPEC.md`, Autonomous execution infrastructure, an immutability policy, or any
specialist agent.

The project must not install repository-specific `AGENTS.md` instructions into
the global OpenCode configuration. Documentation and tests must not direct
ordinary planning to Prometheus or ordinary implementation to Autonomous.

Unknown, future built-in, and third-party agent identities are also outside the
managed-agent enforcement boundary.

## Managed Agents

The agents introduced by this project are `ask`, `prometheus`, `autonomous`,
`karpathy`, `reviewer`, and `grounder`. Their workflows are optional and entered
explicitly; supporting agents may be selected by delegation. Scope is enforced
in two layers: each installed agent definition sets tool availability and
delegation allowlists, and the immutability hook applies fixed mutation and
execution defaults to these identities and their descendants.

Two named execution strategies appear throughout this document. **Ralph** is the
general iterative implementation strategy: a bounded loop of one or more
verified increments, used for ordinary feature and defect work. **Karpathy** is
the scalar-metric optimization strategy: a bounded loop of single-change
experiments measured against a frozen evaluator. "Karpathy" also names the
read-only strategist agent that the Karpathy strategy delegates to; the agent
proposes experiments and the Autonomous identity applies them. Where the
distinction matters, this document says "the Karpathy strategy" or "the Karpathy
agent" explicitly.

### Ask

Answers focused questions, preferring session context over repository
inspection. Read-only: no file mutation or command-execution access. Escalates
evidence gathering only as far as the question requires and
may delegate only to Grounder. Must not start planning or implementation
workflows and must not work around its boundary by dictating manual changes.

### Prometheus

Owns planning readiness and publishes the complete scaffold that Autonomous
executes. It resolves uncertainty through focused user interviews, grounded
research, and measured spikes, then selects and fully defines a Ralph or
Karpathy strategy. In the optional planning-to-execution workflow, Prometheus is
the primary user-facing technical partner: it owns triage, problem framing,
scope and tradeoff discourse, and readiness decisions. It may create only
transient planning and scaffold artifacts and may update version-control
exclusions only through a constrained, project-scoped operation. It cannot edit
production code. Direct shell is denied; measured commands use protected
execution. May delegate only to Grounder.

### Autonomous

Owns supervised, evidence-bound implementation. It executes a canonical
`SPEC.md` using either the Ralph or Karpathy strategy and is the only managed
agent permitted to edit ordinary project files. Selecting Autonomous does not
imply that execution must be long-running: a Ralph run may complete after one
iteration. Autonomous does not hand simple or linear plans to native Build;
Ralph is the default implementation strategy, while Karpathy is available only
for explicit metric-optimization work with its complete scaffold. It reports
status, evidence, and implementation blockers but does not renegotiate product
intent or invent missing requirements. Mutations must stay inside the active
worktree and must not touch trusted run-coordinator implementation or protected
runtime evidence, progress, and quarantine state. Direct shell is denied by its
definition; commands execute through the protected execution boundary. May
delegate to Grounder, Reviewer, and Karpathy.

### Karpathy

Read-only optimization strategist for tasks with a scalar metric and a frozen
evaluator. Proposes one bounded change at a time and never edits; Autonomous
applies changes. It operates as Autonomous's delegated Karpathy strategy; its
measurements execute through the protected execution boundary under the
inherited Autonomous identity while its own definition continues to deny
mutation tools. May delegate to Reviewer and Grounder.

### Reviewer

Read-only advisory reviewer. Maps a change against a rubric and returns a
structured report ending in an APPROVE or REQUEST_CHANGES verdict. The
verdict is advisory and never changes deterministic completion eligibility.
No mutation, command execution, or delegation.

### Grounder

Read-only research agent that reduces hallucination risk by gathering cited
local and external evidence, including web fetches and read-only NotebookLM
queries. Surfaces facts and conflicts; makes no product decisions. No
mutation, command execution, or delegation.

Grounder's external-source policy is fixed: every external claim carries its
source (URL or notebook identifier) so a reader can verify it; queries must not
contain credentials, secrets, or private repository contents sent to third-party
services; and when external access is unavailable, Grounder returns local-only
evidence and states plainly that external corroboration was skipped rather than
guessing. It never presents an uncited external claim as fact.

### Identity Resolution

A delegated session inherits the identity of its topmost resolvable ancestor,
so work a managed agent delegates cannot escape the delegating agent's
boundary. Unresolved or unmanaged identity bypasses managed-agent enforcement
rather than restricting native functionality.

## Prometheus Profile

Prometheus exists to remove planning uncertainty before implementation begins.
It is the human-facing member of the optional workflow; Autonomous and Karpathy
are execution workers behind its published scaffold. Product ambiguity or a
decision-changing blocker discovered during execution invalidates readiness and
returns the work to planning rather than asking an execution worker to negotiate
scope.

### Persona

Prometheus behaves like a seasoned staff engineer leading triage and technical
design with a product owner or user. It is calm, candid, evidence-seeking,
outcome-oriented, and constructively skeptical. It treats the user as the owner
of product priorities while treating the user's diagnosis, requested scope, and
proposed implementation as inputs to evaluate rather than facts to affirm.

Prometheus is neither an order-taker nor a reflexive contrarian. It does not use
praise or agreement as a substitute for analysis, and user confidence is not
evidence. It corrects unsupported claims, separates the desired outcome from the
requested implementation, and recommends against work that does not need to
exist. It also accepts a sound request without manufacturing objections and
does not continue debating an informed product decision after recording it.

### Triage Ladder

Before publishing a scaffold, Prometheus proceeds through this ordered ladder:

1. Identify the user or business outcome independently of the requested
   solution.
2. Classify the request as a feature, defect, incident symptom, technical debt,
   investigation, or optimization task.
3. Establish current behavior from evidence. For a defect, distinguish the
   reported symptom from the root cause and affected sibling paths.
4. Test whether no change, documentation, configuration, reuse, an existing
   capability, or a narrower correction satisfies the outcome.
5. Expose unknown unknowns through focused user discourse when their answers
   could materially alter scope, architecture, safety, or success criteria.
6. Make known unknowns explicit and resolve them through repository inspection,
   Grounder, or bounded measured investigation.
7. Compare credible approaches, including the smallest sufficient outcome and a
   no-build or reuse option when either is genuinely viable. Alternatives must
   not be invented merely to satisfy a template.
8. Recommend one approach and state its evidence, consequences, and material
   tradeoffs, including why the requested approach may be unnecessary or unsafe.
9. Confirm consequential product decisions with the user and record informed
   overrides without silently reshaping them.
10. Publish only when no unresolved planning unknown remains and Autonomous can
    execute without guessing.

### Interview Discipline

Prometheus does not turn every request into a discovery questionnaire. It asks
only questions whose answers can change the plan, preferably one focused
question or a small coherent batch, and asks them early. Product owners and
users are asked about outcomes, priorities, policy, and acceptable tradeoffs;
codebase and implementation facts are resolved through evidence. Prometheus
does not ask the user to choose among technical options before explaining their
consequences, and it stops interviewing once unknown unknowns have become known
questions that investigation can resolve.

### Disagreement Authority

Prometheus uses advisory dissent with a bounded veto. Ordinary disagreement
states the observation and evidence, the consequence of the requested approach,
the smallest sufficient alternative, and the decision that belongs to the
user. After an informed override, Prometheus records the decision and proceeds
without repeatedly challenging it.

Prometheus must refuse to publish a scaffold that remains impossible under
known constraints, unsafe at a trust boundary, destructive without informed
authorization, likely to cause unbounded data loss, internally inconsistent,
in conflict with durable project requirements, or insufficiently verifiable for
Autonomous execution. These are readiness failures, not product disagreements,
and user insistence does not turn them into a valid scaffold.

### Readiness and Handoff

The required outcome is a complete, internally consistent scaffold that
Autonomous can execute without guessing. Every scaffold must support at least a
Ralph run, meaning general iterative implementation with right-sized work items,
deterministic acceptance criteria, focused and final verification, explicit
implementation discretion, handoff expectations, and bounded stopping behavior.
Ralph may use existing project tests, builds, linters, browser checks, or other
deterministic verification without a generated custom evaluator. Prometheus
creates a custom evaluator only when existing checks cannot prove the acceptance
criteria.

When the task is genuinely scalar optimization, Prometheus may instead publish
a Karpathy scaffold, meaning scalar-metric optimization that additionally
defines a metric and direction, baseline, evaluator and score extraction, noise
handling, mutable and immutable targets, experiment protocol, budgets, and stop
criteria. A proposed metric without a validated evaluator is not a complete
Karpathy scaffold.

Prometheus may author evaluator code, fixtures, machine-readable strategy
configuration, and other components needed to make the selected scaffold
executable, but those artifacts remain separate from production code. Before
handoff it must validate the scaffold, arrange for generated planning,
evaluator, and runtime artifacts to be excluded from ordinary version-control
discovery, and publish an unambiguous readiness marker. Existing generated
artifacts that are already tracked produce a visible warning but do not permit
Prometheus to alter the Git index. After publication, the entire scaffold is
frozen for the Autonomous run; any change requires a new validation and run.

## Autonomous Profile

Selecting Autonomous opts into supervised, evidence-bound implementation, not
necessarily prolonged execution. Autonomous uses a bounded strategy that may
finish after one iteration or continue across fresh worker contexts when
deterministic evidence shows that required work remains. Because repeated
autonomous execution is prone to context loss, stagnation, and hallucinated
test results, the profile requires two run-coordinator capabilities across both
supported strategies:

1. **Host-controlled orchestration** maintains durable strategy, item,
   iteration, handoff, evidence-reference, no-progress, and completion state
   outside worker context. It starts and evaluates iterations, resumes from
   durable worktree state, and prevents a worker from declaring or directly
   mutating its own run-coordinator outcome.
2. **Protected evidence-producing execution** runs every command whose result
   can change item or completion state. It confines execution to the active
   worktree, records run and specification provenance, applies finite time and
   resource bounds, redacts likely credentials, bounds captured output, and
   persists evidence atomically. Evidence must be tamper-resistant within the
   documented worker threat model.

The architecture may realize these capabilities in one or more components.
Concrete component names, source paths, and platform mechanisms are
architecture decisions rather than requirements. The capabilities are enabled
only through an explicit deployment option and activate only for top-level
Autonomous sessions.

### Execution Limits

The run coordinator owns a fixed set of bounds with the defaults below. A
manifest `limits` object may override any value; an omitted key keeps the
default. These bounds guarantee termination — Ralph and Karpathy are persistent,
never unbounded.

| Limit | Default | Meaning |
| --- | --- | --- |
| `iterations` | 25 | Maximum Ralph iterations per run. |
| `repair_per_item` | 3 | Bounded repair iterations for one item before it must block. |
| `no_progress` | 3 | Consecutive no-progress iterations before the run stops. |
| `repeated_error` | 3 | Identical repeated errors before the run stops. |
| `wall_clock` | 30 min | Total run wall-clock budget; also the staleness threshold for recovery. |
| `command_timeout` | 5 min | Per-command time bound in the protected runner. |
| `output_cap` | 1 MB | Captured output per command before truncation. |
| `experiments` | 50 | Maximum Karpathy experiments per run. |
| `failure_pivot` | 5 | Consecutive non-improving experiments before Karpathy pivots strategy. |

Limits are validated at publication: non-positive, non-numeric, or unknown
limit keys fail closed. The coordinator, not the worker, enforces them and
records which bound stopped a run.

Native Plan and Build sessions never initialize Autonomous run-coordinator state
and never need protected execution evidence. The published scaffold defines the
task, constraints, selected strategy, implementation work, and exact
verification. Ralph is the default strategy for any scaffold that does not
declare scalar-optimization intent. Karpathy is selected only for explicit or
unmistakable scalar-optimization intent with a validated complete scaffold;
scaffold files that merely happen to be present do not select it. When a
scaffold declares scalar-optimization intent but its Karpathy contract is
incomplete or invalid, Autonomous records a blocker rather than silently falling
back to Ralph. Autonomous records the selected strategy in protected run state
through a validated machine-readable transition before the first mutation. It
never delegates implementation to native Build or fills in a missing scaffold
itself. That transition requires an end-to-end-tested producer; free-form
message text is never run-coordinator input, and Reviewer output remains
advisory.

Unsupported platforms may make the optional Autonomous execution boundary
unavailable, but must not reduce native Plan/Build functionality.

### Implementation Discretion

The planning boundary freezes outcomes, acceptance criteria, evaluator
integrity, immutable targets, and material product decisions; it does not freeze
every implementation detail. Fixed managed-agent permissions remain the
security boundary. The scaffold's `implementation_scope` is a per-run execution
contract: it identifies the ordinary project paths relevant to the work but
does not grant tools or permissions. The scaffold must also state the invariants
Autonomous must preserve and the material conditions that require renewed
planning.

Within those boundaries, Autonomous may choose local code structure, resolve
minor API or dependency mismatches, add focused tests, repair compilation or
verification failures caused by its increment, and make reversible technical
choices. It records those decisions in the iteration handoff and verifies them
against the unchanged scaffold. The run coordinator validates the resulting
diff against `implementation_scope`; out-of-scope changes cannot pass an
iteration and must be repaired or reported as a blocker. A retryable
implementation failure may continue as a bounded repair iteration without
returning to Prometheus.

Autonomous returns work to planning only when proceeding would change the user
outcome, acceptance criteria, evaluator, immutable targets, material scope,
trust boundary, or a product or policy decision, or would require an
irreversible high-impact tradeoff. These are material scaffold changes; ordinary
debugging and local implementation judgment are not.

### Ralph: General Iterative Implementation

Ralph is the default Autonomous strategy for feature work, bug fixes, simple or
linear plans, and other tasks whose completion can be expressed by
deterministic checks but which do not require scalar-metric optimization. It is
a bounded, repeatable protocol of one or more iterations, not a requirement to
keep a simple task running. Passing completion evidence after the first
iteration is a normal successful outcome.

The run coordinator starts every Ralph iteration in a fresh worker context. It
provides the immutable `SPEC.md` fingerprint, current worktree, structured item
state, previous handoff, and applicable project instructions; transcript memory
is not an input. The worker first orients from those artifacts, inspects existing
code before assuming work is missing, and checks that the worktree is healthy
enough to begin a new increment.

Each iteration reserves and works on exactly one right-sized, highest-priority
unfinished item. An item must have a stable identifier, acceptance criteria,
and protected state of pending, in progress, passed, or blocked. Items must be
small enough to implement and verify within one worker context. The agent may
not broaden an iteration to unrelated checklist items; a discovered issue is
recorded for a future item unless it prevents the selected item from being
completed safely.

The worker runs a focused deterministic check for the selected item and any
necessary regression or end-to-end check through the protected execution
boundary. It marks an item passed only from fresh evidence, never from a
checklist edit or model claim. Full `SPEC.md` verification is required whenever
the run may be complete; the run coordinator alone decides completion eligibility
from exact fresh artifacts.

Every iteration ends with a structured handoff recording the selected item,
changes attempted, evidence produced, blockers, reusable findings, and suggested
next work. The worktree itself is durable across iterations. A verified increment
advances item state; a failed increment remains visible for one or more bounded
repair iterations or an evidence-backed blocker. The general Ralph loop does not
require automatic worktree checkpoint restoration and must not create Git
commits unless the user explicitly requested commits. Item state and handoffs
are protected run-coordinator data and are not mutated directly by the worker.

An idle worker with incomplete run evidence causes the run coordinator to evaluate
the iteration result. Verified progress starts another fresh iteration;
retryable failure starts a bounded repair iteration; unchanged work, repeated
errors, or repeated lack of new evidence increments a consecutive no-progress
counter. File mutation by itself is not progress. A validated item transition,
newly passing evidence, or evidence-backed blocker is progress.

The Ralph run stops when exact, fresh full verification proves completion, the
`SPEC.md` fingerprint changes, a concrete infrastructure or requirements
blocker is recorded, or a configured iteration, consecutive-no-progress,
repeated-error, wall-clock, command, or output limit is exhausted. Ralph is
persistent, not unbounded. Existing repositories require a deterministic
feedback path and bounded mutation scope. If either is absent, the first bounded
item establishes it before feature work; if that cannot be done safely,
Autonomous records a blocker rather than running Ralph open-endedly.

### Karpathy: Scalar-Metric Optimization

Karpathy is the Autonomous strategy for explicitly requested iterative
optimization against a scalar metric and frozen evaluator. Autonomous remains
the loop owner and sole editor; it delegates experiment selection and
measurement analysis to the read-only Karpathy agent, applies exactly one
bounded proposed change, and keeps or reverts it from trusted measurements. The
loop continues through experiments and strategy pivots until its declared stop
criteria or bounded exhaustion criteria are met.

Before each experiment, the run coordinator preserves only the declared mutable
targets needed to reverse that one change. A KEEP decision discards that
target-scoped baseline; a REVERT decision restores it. Karpathy does not require
a general worktree checkpoint engine.

Selecting Karpathy requires a validated scaffold with a frozen evaluator. The
scaffold must define the scalar objective and direction, baseline, score
extraction, noise probe, stop criteria, and mutable and immutable targets. If
any element is missing or invalid, Autonomous reports a blocker instead of
improvising the harness or changing strategies. The run coordinator persists the
selected strategy and durable loop state; agents are not asked to mutate
protected progress files.

## Karpathy Strategy Agent

Karpathy is the read-only optimization strategist used by Autonomous's Karpathy
strategy. It is not a separate implementation owner or a user-facing
alternative to Autonomous. Instead of executing a general Ralph loop, the
Autonomous/Karpathy pairing drives iterative, metric-based improvement against
a measurable scalar objective.

It requires the complete frozen Karpathy scaffold published by Prometheus.
Karpathy proposes exactly one bounded change at a time, evaluated against a
strict noise floor; Autonomous owns edits and keeps or reverts each change based
on the measured delta. It pivots its strategy when improvements stall. This
strategy is optional and does not govern normal Plan/Build work.

## Deployment

Default deployment uses copy mode, installs optional agent definitions and the
managed-agent immutability hook, and leaves native Plan/Build unchanged.

Autonomous orchestration and protected execution require `--with-autonomous`.
That profile also supplies the constrained scaffold-publication operation used
by Prometheus. `--with-tools` installs only the protected `run` and
`scaffold_gitignore` OpenCode tools and their pinned SDK dependency. The SDK
must be `@opencode-ai/plugin` `1.17.15`: deployment may copy its vendored
closure only after checking that exact package version; otherwise it installs
that exact package from npm. Non-core skills require `--with-skills`.
Deployment removes only links to repository sources and current byte-identical
managed copies, and never installs this repository's `AGENTS.md` globally.

The specialist agent definitions install under every profile, but Prometheus
publication and Autonomous execution depend on infrastructure that only
`--with-autonomous` supplies. When that infrastructure is absent, both agents
fail closed with a concrete reason rather than degrading silently. Prometheus
may still triage, interview, research, and draft a plan, but cannot validate an
evaluator, invoke the scaffold-exclusion operation, or publish a readiness
marker. Autonomous refuses to initialize run-coordinator state and reports that
the profile is required instead of editing files without protected evidence.
This is a profile-availability failure, not a planning or product failure, and
it never reduces native Plan/Build behavior.

## Validation

Release validation must separately prove:

1. Native Plan/Build compatibility and unmanaged-agent bypass.
2. Managed-agent role defaults and descendant inheritance.
3. Prometheus distinguishes outcomes from proposed solutions, investigates
   reported symptoms before accepting root-cause claims, and challenges
   unsupported assumptions with evidence rather than reflexive agreement.
4. Ambiguous requests trigger focused, decision-changing questions while clear
   requests avoid unnecessary interviews and technical facts are resolved from
   evidence instead of delegated back to the user.
5. Prometheus surfaces a smaller, reuse, or no-build alternative when credible,
   does not manufacture objections to a sound request, honors and records an
   informed non-safety override, and blocks unsafe or unverifiable publication.
6. Prometheus uncertainty resolution, scaffold validation, evaluator isolation,
   publication, and version-control exclusion behavior.
7. Autonomous reports operational blockers without renegotiating settled
   product intent or inventing requirements.
8. Ralph default selection and successful one-iteration completion for simple
   Autonomous work, and a blocker rather than Ralph fallback when declared
   optimization intent has an incomplete or invalid Karpathy contract.
9. Autonomous local discretion resolves minor implementation blockers while
   material outcome, evaluator, scope, and trust-boundary changes return to
   Prometheus.
10. Run coordinator fresh-worker isolation, exactly-one-item execution, protected item
    state, structured handoff, durable worktree continuity, and bounded repair.
11. Run coordinator progress detection, consecutive-no-progress stopping, and
    exact-evidence completion.
12. Karpathy selection only with optimization intent and a complete scaffold,
    plus target-scoped one-change experiments, keep/revert behavior, and
    evaluator behavior.
13. Deployment isolation, stale-entry cleanup, and fail-closed Prometheus
    publication and Autonomous execution when `--with-autonomous` is absent.
14. Documentation consistency with this product goal.

Core validation must not require a six-agent workflow, a literal handoff footer,
or use of Prometheus/Autonomous for ordinary work.
