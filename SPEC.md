# Project Cleanup Plan

## Objective

Rein in the project by removing architectural overlap, retiring obsolete concepts, clarifying ownership, and aligning the implementation with `docs/REQUIREMENTS.md`.

The goal is not to redesign the system.

The goal is to reduce it to the smallest coherent architecture that still protects the four project failure modes:

1. Completion lying
2. Restart fragility
3. Unbounded spend
4. Plan drift

Do not add new features, agents, strategies, abstractions, or workflows during this cleanup.

---

## Operating Rules

Follow these rules throughout the cleanup.

1. Prefer deletion over modification.
2. Prefer consolidation over abstraction.
3. Do not preserve a component solely because it already exists.
4. Do not introduce new architecture unless required to implement an explicit invariant in `docs/REQUIREMENTS.md`.
5. Every retained component must have one clear responsibility.
6. Every responsibility must have one accountable owner.
7. Prompt text is not enforcement.
8. Enforcement must be traceable to the runner, immutability hook, or supervisor.
9. Do not auto-commit.
10. Update durable documentation in the same change as behavior.
11. **Strangler first, then delete.** Build and validate the replacement before
    removing the component it replaces. Never leave completion unenforced during
    a phase transition.
12. **Commit checkpoints.** Stop, verify, and get human sign-off at five natural
    boundaries, listed in execution order: (a) after the safe deletions land
    (Steps 3.1–3.2), (b) after the Prometheus rewrite (Phase 5), (c) after the
    supervisor is green and the gate/loop cutover completes (Phases 6–7 plus
    Steps 3.3–3.6), (d) after deploy repairs (Phase 12), (e) after the final
    audit (Phase 15).
13. **Interleave test updates with deletions.** When a phase deletes a component,
    update `tests/verify_opencode.py` and relevant test files in the same change.
    Do not defer all test repair to Phase 13.

---

## Execution Order

The phases below are grouped by concern, not by execution sequence. Steps
3.3–3.6 depend on later phases and must not land in phase order. Execute in
this dependency order:

1. Phase 0 (Spike A), then Phases 1–2 (baseline and responsibility map).
2. Steps 3.1–3.2 — deletions nothing else depends on.
3. Phase 4 — runner hardening and the immutability-hook allowlist extension
   (Step 4.0).
4. Phase 5 — Prometheus rewrite and atomic permission swap.
5. Phases 6–7 — build and validate the supervisor.
6. Cutover: Steps 3.3–3.6 — remove payload grammar, transcript evidence, the
   gate/loop plugins, and the stale eval suites.
7. Phases 8–10 — advisory agents, Karpathy, failure semantics.
8. Phases 11–13 — docs, deployment, validation suite.
9. Phases 14–15 — deletion audit and final consistency audit.

---

## Phase 0: Run the Pre-Cleanup Spike

### Step 0.1: Spike A — Agent attribution

Before any phase proceeds, verify that the immutability hook can reliably
attribute writes to child or subagent sessions spawned by `@prometheus`.

Create `.spike/attribution-check/QUESTION.md` containing:

```
Question: Can the immutability hook attribute a write by a child session
that @prometheus delegates to — identifying prometheus (or its child
session) as the originating agent — when that write targets a path outside
SPEC.md and .spike/**?

Kill criterion: the hook observes and logs the originating agent identity
for the delegated write, and denies it. Denial alone is insufficient:
today's hook denies readonly paths agent-blind, so a bare denial would not
prove the attribution that the write_allowlist mechanism (Step 4.0)
requires. If agent identity is not observable for delegated writes, the
Prometheus write-surface design must be revised before implementation
begins.
```

Run the spike. Record the result in `SPEC.md`'s `## Grounding` section.

**If attribution works:** proceed per the Execution Order above.

**If attribution fails:** stop. Revise `docs/REQUIREMENTS.md` and this plan
before any implementation phases run. The Prometheus write-surface confinement
(Phases 4.3 and 5.x) depends entirely on this working.

---

## Phase 1: Establish the Cleanup Baseline

### Step 1.1: Read the durable requirements

Read:

* `docs/REQUIREMENTS.md`
* every other file under `docs/`
* all agent definitions
* all plugin implementations
* all deployment scripts
* all validation tests
* all files under `.opencode/`
* the repository `README`
* the current `SPEC.md`, if present

Treat `docs/REQUIREMENTS.md` as authoritative when repository behavior conflicts with older documentation or implementation.

Do not modify files yet.

### Step 1.2: Inventory the architecture

Create a temporary working inventory containing every:

* agent
* plugin
* tool
* strategy
* configuration file
* persisted state file
* evidence format
* completion signal
* routing mechanism
* deployment artifact
* validation command
* documentation file

For each item, record:

* path
* purpose
* current owner
* whether it is required by `docs/REQUIREMENTS.md`
* which of the four failure modes it addresses
* whether another component already serves the same purpose
* whether it is enforced or only described in prompt text

Do not commit this inventory unless it remains useful as durable documentation.

### Step 1.3: Identify current test and validation commands

Determine the complete set of commands currently used to validate the repository.

Run the existing validation suite before making changes.

Record:

* passing commands
* failing commands
* skipped tests
* missing dependencies
* tests that describe obsolete behavior

Do not repair unrelated failures unless they block the cleanup.

---

## Phase 2: Build a Responsibility Map

### Step 2.1: Assign one responsibility to each required component

Use the following target ownership model.

| Component | Sole primary responsibility |
| --- | --- |
| `@prometheus` | Produce an evidence-backed `SPEC.md` |
| `@autonomous` | Execute `SPEC.md` and own completion |
| `@karpathy` | Run measurable optimization loops delegated by `@autonomous` |
| `@reviewer` | Provide advisory critique |
| `@grounder` | Gather cited evidence |
| `@ask` | Answer contextual questions outside the execution workflow |
| Runner tool | Execute commands and write trusted evidence artifacts |
| Immutability hook | Enforce file write restrictions |
| Supervisor plugin | Evaluate completion, enforce corrective caps, and persist run state |

### Step 2.2: Detect overlapping ownership

Search the repository for cases where more than one component owns the same responsibility.

Pay particular attention to:

* completion decisions
* verification execution
* evidence writing
* spec creation
* spec mutation
* strategy selection
* reviewer enforcement
* corrective retries
* durable state
* write protection
* deployment of the runner
* restart recovery

For every overlap, choose the owner defined in the table above.

Remove or narrow the competing implementation.

### Step 2.3: Detect unowned behavior

Identify behavior described in documentation or prompts that has no deterministic owner.

Classify each instance as one of:

* required and missing
* obsolete and removable
* advisory only
* implementation detail that should not be a requirement

Do not leave required behavior enforced only by prompt wording.

---

## Phase 3: Remove Obsolete Architecture

### Step 3.1: Remove agents not listed in the requirements

Delete:

* `@builder`
* `@data-scientist`
* any other agent not listed under the required six agents

Also remove all references to deleted agents from:

* prompts
* routing instructions
* tests
* deployment scripts
* configuration files
* `README` sections
* strategy documents
* examples
* validation logic

Do not leave compatibility aliases unless required by an explicit documented migration need.

Before deleting, reassign the two capabilities that currently live only on
these agents:

* **Karpathy implementer.** `@karpathy` currently delegates code edits to
  `@builder`. Grant `@karpathy` direct edit capability (or confirm it already
  has it) and remove `builder` from its task allowlist in the same change.
  The Karpathy loop must remain able to apply its one-change-per-iteration
  edits after builder is gone.
* **NotebookLM access.** The `notebooklm_*` permissions exist only on
  `@data-scientist`. Migrate the read-only subset to `@grounder` (Step 8.3
  expects Grounder to handle NotebookLM). Do not migrate mutation
  permissions.

Update the task allowlists of `@ask`, `@prometheus`, `@autonomous`, and
`@karpathy`, all of which currently reference deleted agents.

### Step 3.2: Remove obsolete strategy infrastructure

The project does not require:

* a strategy registry
* a strategy contract document
* a strategy template

Locate and remove infrastructure that exists only to support those concepts.

This may include:

* `.opencode/strategies.json`
* strategy schemas
* strategy registration logic
* strategy discovery code
* validation tests for a registry
* documentation describing a registry as required
* templates for adding strategies

Retain only the minimum routing logic required for:

* direct execution
* `strategy: karpathy`

Do not preserve Ralph Wiggum, Octopus, or other experimental strategies unless they are explicitly restored to `docs/REQUIREMENTS.md` before implementation.

Note: `.opencode/strategies.json` already registers only `karpathy`. Ralph
Wiggum and Octopus survive only in prose and code references (README,
`docs/testing-methodology.md`, `tests/audit_run.py`, the gate and loop
plugins). The registry deletion is small; the terminology sweep (Step 11.4)
and test updates are where the work is.

### Step 3.3: Remove payload grammar and materialization behavior

Delete all support for:

* `<spec filename="SPEC.md">`
* structured spec payload extraction
* gate-side spec reinjection
* `@autonomous` payload materialization
* transcript-derived spec creation

The required handoff is:

1. `@prometheus` writes `SPEC.md`
2. `@autonomous` reads `SPEC.md`

Update all prompts, tests, plugins, examples, and docs to reflect that direct disk handoff.

### Step 3.4: Remove transcript-based completion evidence

Delete support for:

* fenced JSON evidence blocks
* workaround dump detection
* transcript parsing for command results
* reviewer verdict text as a completion condition
* promise token wording as evidence of success

The completion gate must use disk state only.

Promise tokens may remain as user-facing status signals only if they are required by the current OpenCode interaction contract. They must not influence completion.

### Step 3.5: Merge gate and loop behavior into the supervisor

**Strangler order — mandatory.** The supervisor must be built and validated
(Phases 6–7) before the gate and loop plugins are deleted. Do not delete
`plugins/opencode-autonomous-gate/` or `plugins/opencode-autonomous-loop/`
until the supervisor passes its full test suite. Leaving completion unenforced
during a phase transition violates Operating Rule 11.

The migration sequence:

1. Build `plugins/opencode-autonomous-supervisor/` (Phases 6–7).
2. Validate supervisor in isolation (Phase 13 subset).
3. Cut over: remove gate/loop plugins and their root shims.
4. Re-run full suite to confirm nothing regressed.

Cutover timing: the gate/loop deletion lands at commit checkpoint (c), and
the supervisor takes effect at the OpenCode restart performed at that
checkpoint. Do not delete the gate/loop plugins mid-session — the executing
session would strand itself with no active completion gate until restart.

The supervisor must own:

* disk-only completion evaluation
* corrective injection
* corrective caps
* blocked-state transitions
* durable run state
* restart recovery

Avoid keeping wrapper plugins that provide no independent behavior.

### Step 3.6: Delete stale eval suites

Delete:

* `evals/agent_value/` — scores compliance with payload and materialization
  concepts removed in this cleanup. Dead on Phase 3 landing.
* `evals/plan_outcome/` — reads a ledger written only by the gate plugin.
  Dead when the gate plugin is removed.

Remove the four `evals/agent_value/**` readonly entries from
`.opencode/immutable.json`. (`evals/plan_outcome` has no readonly entries —
do not expect any.)

Retain and update:

* `evals/mutation/` — required by the mutation gate invariant.
* `evals/seed_build/` — E2E oracle harness mapping to Phase 13 scenarios.
  This is a structural rework, not a rename: `test_planning.py` extracts a
  `<spec>` payload from stdout (`_extract_spec_payload`,
  `spec_source: payload_in_stdout`) and `oracle/planning_checks.py` scores a
  "single complete SPEC payload." After Phase 5, Prometheus writes `SPEC.md`
  to disk — the harness must inspect the file on disk instead of capturing a
  stdout payload, in addition to removing stale agent names.

---

## Phase 4: Normalize the Trusted Computing Base

### Step 4.0: Extend the immutability hook with agent-scoped write allowlists

Grounding correction (Spike A audit): `plugins/immutability.ts` already
implements this mechanism — `write_allowlist`, `prometheus_only`, and the
agent-identity resolver all exist and pass their unit tests. This step is
therefore verification, not new code. Confirm the following behavior holds
and close the one coverage gap (write_allowlist denial attributed through a
delegated child session):

* support a `write_allowlist` map keyed by agent name, restricting that
  agent's writes to the listed path patterns
* deny writes outside the allowlist for a listed agent, regardless of
  prompt-level permissions
* keep `readonly` semantics unchanged for agents without an allowlist entry

This is new trusted-computing-base code and is gated on Spike A (Phase 0):
if the hook cannot attribute writes from delegated child sessions, this
design must be revised first.

Add tests for allowed paths, denied paths, and non-listed agents before any
Phase 5 step depends on this mechanism.

### Step 4.1: Make the runner the sole evidence writer

The current `run.ts` records `command`, `exit_code`, and `run_id` but is
missing three required fields: `started_at`, spike-context detection, and the
`QUESTION.md` pre-check. All three must be added as new code, not
configuration.

Verify and implement:

* `.opencode/tool/run.ts` is the only mechanism that writes execution evidence into `.opencode/runs/`
* agents cannot directly create trusted execution artifacts
* artifact schemas are deterministic
* the exact executed command string is recorded (with normalization rule for Python interpreter paths per `docs/REQUIREMENTS.md`)
* `exit_code` is recorded
* `started_at` is recorded (new field — required for freshness gate)
* spike and execution contexts write to separate locations (new behavior)
* spike context refuses to execute without `QUESTION.md` present (new behavior)

Remove `plugins/shared/evidence.js` — the transcript evidence parser — as an
alternate evidence-writing mechanism after verifying nothing else imports it.

### Step 4.2: Enforce execution context separation

Implement and validate:

* spike runs write to `.spike/<spike-id>/runs/`
* execution runs write to `.opencode/runs/`
* the completion gate reads only `.opencode/runs/`
* spike artifacts can never satisfy execution verification

Add tests that deliberately attempt to use spike artifacts as execution evidence and confirm failure.

### Step 4.3: Enforce the Prometheus write surface

The immutability hook must restrict `@prometheus` to:

* `SPEC.md`
* `.spike/**`

Prometheus must not be able to modify:

* source files
* tests
* project configuration
* `.opencode/runs/`
* supervisor state
* frozen evaluator files
* immutable test files

Add direct validation coverage for allowed and denied paths.

### Step 4.4: Protect frozen evaluator and mutation files

When immutable configuration declares files readonly, ensure the hook prevents modification regardless of the agent’s prompt-level edit permission.

Validate protection for:

* frozen tests
* frozen evaluators
* mutation configuration
* other explicitly immutable files

---

## Phase 5: Implement the Prometheus Spike Contract

### Step 5.1: Require a spike question before execution

Before the runner executes any spike-context command, require:

`.spike/<spike-id>/QUESTION.md`

The file must contain:

* a falsifiable question
* a kill criterion

Reject spike execution when the file is missing or invalid.

### Step 5.2: Enforce project-local spike isolation

Before the first spike write, Prometheus must ensure `.spike/` is covered by the project `.gitignore`.

The implementation must not silently commit spike code.

Add validation for:

* missing `.gitignore` entry
* existing valid entry
* nested project behavior, if supported

### Step 5.2a: Land permissions and allowlist atomically

The Prometheus rewrite involves two interdependent changes that must land in
the same commit:

1. **Frontmatter permission flip** — add `write: allow` (scoped to `SPEC.md`
   and `.spike/**`) and `bash: allow` (scoped to spike commands); remove
   `bash: deny`.
2. **Immutability allowlist entry** — add a `write_allowlist` entry for
   `prometheus` in `.opencode/immutable.json` restricting writes to `SPEC.md`
   and `.spike/**`.

Permissions-first leaves Prometheus unconfined. Allowlist-first leaves it
unable to write `SPEC.md`. Neither partial state is safe. Stage both changes
and verify together before any other Phase 5 step.

Note: today `@prometheus` has `write: deny` and the gate plugin silently writes
`SPEC.md` on its behalf. Deleting the gate without this atomic swap leaves
nobody able to write `SPEC.md`.

### Step 5.3: Align the Prometheus prompt with the requirements

Update `@prometheus` so it:

* uses diverge-converge planning
* validates front-runners through spikes
* records measured findings in `SPEC.md`
* treats spike code as disposable
* writes a complete `SPEC.md`
* ends with exactly:

```
Invoke @autonomous to execute SPEC.md.
```

Remove instructions that conflict with this workflow.

### Step 5.4: Define required SPEC sections

Ensure the Prometheus prompt produces at least:

* Grounding
* Approaches Considered
* Acceptance Criteria
* Verification
* Implementation Checklist

If strategy selection is required, document a minimal machine-readable representation for `strategy: karpathy`.

Do not add a general strategy schema.

---

## Phase 6: Make Completion Fully Deterministic

### Step 6.1: Parse verification commands from disk

The supervisor must read the commands declared in `SPEC.md` under:

`## Verification`

It must not use transcript content as the source of truth.

Define deterministic parsing rules.

Reject ambiguous or malformed verification sections instead of guessing.

### Step 6.2: Require exact command matches

A verification command is satisfied only when a runner artifact contains the exact declared command string.

Do not normalize commands in ways that could allow a different command to satisfy the requirement.

Document any unavoidable normalization, such as line-ending handling.

### Step 6.3: Require successful exit codes

A command passes only when:

`exit_code: 0`

Missing, malformed, interrupted, or nonzero artifacts fail the gate.

### Step 6.4: Require fresh artifacts

An artifact is fresh only when its `started_at` is newer than the most recent modification to any tracked project file.

Implement this calculation deterministically.

Clarify and test:

* untracked files
* ignored files
* `.spike/`
* `.opencode/runs/`
* supervisor state
* documentation changes
* clock precision
* equal timestamps

Avoid freshness logic that invalidates itself when the runner writes an artifact.

### Step 6.5: Add failure-class corrective caps

The supervisor must track corrective attempts by failure class.

Default cap: `3`

After the cap is exceeded:

* set the run status to blocked
* persist the failure class
* persist the corrective count
* stop injecting messages
* do not automatically resume
* remain quiet until user intervention

Add tests for independent caps across different failure classes.

### Step 6.6: Enforce the mutation gate (opt-in)

When `.opencode/mutation.json` has `enabled: true`, the supervisor must block completion until a valid mutation artifact exists.

The supervisor must enforce:

* Tests were authored in a red-first phase before implementation began.
* Tests are reviewed and frozen via `.opencode/immutable.json` readonly.
* The mutation runner executed diff-scoped, producing a committed artifact at `result_path`.
* `kill_score` meets `score_threshold`.
* The mutation configuration is frozen.

The gate must read the committed artifact, not transcript claims.

Sequencing note: `.opencode/immutable.json` currently lists
`.opencode/mutation.json` as readonly while the file does not exist. If
readonly denies creation, the gate can never be enabled. Define the
enablement procedure explicitly: remove the readonly entry while mutation
gating is disabled, then create the configuration and re-add the readonly
entry in the same change ("create, then freeze").

---

## Phase 7: Make Run State Durable

### Step 7.1: Define the durable state model

Persist state under:

`.opencode/autonomous-loop/`

At minimum, preserve:

* run identifier
* current status
* selected strategy
* corrective counts by failure class
* satisfied verification commands
* blockers
* last known failure
* relevant timestamps

Do not persist redundant transcript summaries.

### Step 7.2: Restore state after restart

Simulate plugin and OpenCode restarts.

Confirm that restart does not reset:

* corrective counts
* blocked state
* satisfied verification state
* strategy selection
* known blockers

No completion verdict may exist only in memory.

### Step 7.3: Decide the role of `progress.txt`

Retain `progress.txt` only if it provides durable human-readable execution history that is not already available in supervisor state.

If retained, define its responsibility narrowly:

* record strategy selection before the first edit
* record pivots
* record blockers
* record attempted approaches
* record stuck states as they happen

The supervisor must not treat `progress.txt` as trusted completion evidence.

If these needs are fully served by structured supervisor state, remove `progress.txt` and update `docs/REQUIREMENTS.md` accordingly.

Do not retain it by habit.

---

## Phase 8: Simplify Advisory Agents

### Step 8.1: Make reviewer behavior advisory only

Ensure `@reviewer`:

* cannot edit project files
* returns only advisory findings
* uses `APPROVE` or `REQUEST_CHANGES`
* never directly controls the completion gate

A `REQUEST_CHANGES` result may trigger one bounded corrective attempt, subject to the supervisor cap.

Remove any plugin logic that requires reviewer approval.

### Step 8.2: Minimize reviewer integration

Keep reviewer invocation only where explicitly required:

* before `@autonomous` claims completion
* after each Karpathy run

Do not add reviewer stages elsewhere.

Do not create reviewer-specific evidence formats unless needed for human inspection.

### Step 8.3: Restrict Grounder to evidence gathering

Ensure `@grounder`:

* has `edit: deny`
* gathers local or external evidence
* cites sources
* handles NotebookLM only when valid context is available
* does not own planning
* does not own completion
* does not mutate project state

Remove routing logic that gives Grounder broader authority.

### Step 8.4: Isolate the Ask Agent

Ensure `@ask`:

* has `edit: deny`
* cannot be delegated to from within the execution loop by `@autonomous`
* exists solely for user-initiated contextual Q&A

---

## Phase 9: Constrain the Karpathy Loop

### Step 9.1: Validate admission requirements

Allow Karpathy delegation only when all required inputs exist:

* `strategy: karpathy` in `SPEC.md`
* `program.md`
* `.opencode/karpathy.json`
* frozen evaluator
* runner tool

When any prerequisite is missing, do not silently fall back while preserving the Karpathy label.

Report the run as blocked or require explicit correction of the spec.

Note: `docs/REQUIREMENTS.md` lists only the first four admission inputs; the
runner tool is an addition. Add it to the REQUIREMENTS Karpathy admission
list in the same change (its own rules require the table to be updated
before new admission conditions are enforced).

### Step 9.2: Enforce the loop protocol

The Karpathy loop must:

1. establish a baseline
2. measure the noise floor with at least three varied runs
3. propose exactly one change per iteration
4. state a hypothesis before the change
5. measure the result
6. keep the change only when improvement exceeds twice the noise floor
7. revert otherwise
8. invoke reviewer after each run
9. stop when the declared stop criteria are met
10. stop after three distinct strategy pivots fail to produce a `KEEP` decision

Add tests for each stop condition.

### Step 9.3: Remove Karpathy-adjacent generic abstractions

Do not generalize Karpathy into a framework for arbitrary loop strategies.

Remove abstractions whose only purpose is anticipated future strategies.

Retain only what the current Karpathy contract requires.

---

## Phase 10: Normalize Failure Semantics

### Step 10.1: Define explicit failure classes

Add or refine durable documentation for at least:

* invalid SPEC
* malformed Verification section
* missing runner
* missing dependency
* failed verification
* stale evidence
* impossible acceptance criterion
* broken verifier
* missing Karpathy harness
* evaluator failure
* mutation threshold failure
* corrective cap exceeded
* immutable file violation
* restart recovery failure

`docs/REQUIREMENTS.md` currently defines 13 failure classes; "impossible
acceptance criterion" and "broken verifier" are not among them. Add them to
the REQUIREMENTS failure-class table in the same change that introduces them
here.

### Step 10.2: Assign each failure an owner and outcome

Use this model as a starting point.

| Failure | Owner | Required outcome |
| --- | --- | --- |
| Invalid or incomplete `SPEC.md` | Prometheus | Rewrite before execution |
| Missing runner | Autonomous | `BLOCKED` |
| Failed or stale verification | Autonomous | Corrective attempt |
| Corrective cap exceeded | Supervisor | Persist blocked, stop |
| Missing Karpathy harness | Autonomous | `BLOCKED` |
| Broken evaluator | Karpathy | `BLOCKED` |
| Immutable file violation | Immutability hook | Deny write |
| Reviewer request | Autonomous or Karpathy | One bounded attempt |
| Restart | Supervisor | Restore durable state |

Do not allow multiple components to independently choose different outcomes for the same failure.

---

## Phase 11: Clean Documentation

### Step 11.1: Make `docs/REQUIREMENTS.md` describe stable invariants

Remove stale concepts and ensure it accurately describes the final system.

Do not add speculative future architecture.

### Step 11.2: Maintain the two-file doc structure

`docs/REQUIREMENTS.md` is already written. Create or update `docs/ARCHITECTURE.md`
only. There is no `docs/IMPLEMENTATION.md` — concrete paths, schemas, and
deployment behavior live in `docs/REQUIREMENTS.md` under "Required Components."

#### `docs/REQUIREMENTS.md`

Contains:

* purpose and failure modes
* stable invariants
* required responsibilities and failure classes
* non-requirements
* rebuild bar
* concrete paths, artifact schemas, plugin names, deployment behavior

#### `docs/ARCHITECTURE.md`

Contains:

* component relationships
* control flow
* trust boundaries
* state transitions
* completion flow (disk-only gate)
* spike flow (Prometheus → `.spike/` → SPEC.md → Autonomous)
* Karpathy flow

Do not duplicate content between the two documents. If a fact belongs in both,
it belongs only in `docs/REQUIREMENTS.md`.

The `docs/` directory currently contains 11 files. Dispose of the nine extra
files explicitly:

| File | Disposition |
| --- | --- |
| `docs/STRATEGY-CONTRACT.md` | Delete (Step 3.2) |
| `docs/strategy-template.md` | Delete (Step 3.2) |
| `docs/AGENT-ARCHITECTURE.md` | Merge agent taxonomy and authority boundaries into `docs/ARCHITECTURE.md`, then delete |
| `docs/PLUGINS.md` | Merge surviving plugin behavior (immutability hook, supervisor) into `docs/ARCHITECTURE.md`; drop gate/loop content; delete |
| `docs/WORKFLOWS.md` | Merge surviving control flow into `docs/ARCHITECTURE.md`; drop the payload workflow; delete |
| `docs/VALIDATION.md` | Move the canonical validation command list into `docs/REQUIREMENTS.md`; delete |
| `docs/CONVENTIONS.md` | Move the pyenv/virtualenv policy and shell portability rules into `docs/REQUIREMENTS.md`; delete |
| `docs/testing-methodology.md` | Delete — built around `evals/agent_value/`, which Step 3.6 removes |
| `docs/README.md` | Delete — a reading-order index is unnecessary for two files |

### Step 11.3: Update README

The `README` should explain the project at a high level.

It must not describe deleted agents, removed strategies, obsolete plugins, payload grammar, or transcript evidence.

Keep the core explanation small:

1. Prometheus creates `SPEC.md`
2. Autonomous executes it
3. Runner records evidence
4. Supervisor decides completion
5. Immutability enforces boundaries
6. Karpathy handles measurable optimization loops

### Step 11.4: Remove stale examples and comments

Search the full repository for obsolete terminology.

At minimum, search for:

* builder
* data-scientist
* Ralph
* Octopus
* strategy registry
* strategy contract
* payload
* materialize
* evidence block
* workaround dump
* gate plugin
* loop plugin
* reviewer gate
* auto-commit

Inspect every result and remove or update stale references.

---

## Phase 12: Align Deployment

### Step 12.1: Install the runner by default into the global tools directory

The runner lives at `.opencode/tool/run.ts` in this repository. The deploy
script's `--with-tools` flag currently reads from `${REPO_ROOT}/tools/` which
does not exist. Fix the source path to `.opencode/tool/`.

Move runner installation out of the `--with-tools` opt-in flag into the default
install set. `@autonomous` emits `BLOCKED` when the runner is absent; it must
not require a flag to be present after a standard deploy.

Deploy destination: the global OpenCode tools directory (same target as agents
and plugins). Evidence artifacts remain per-project because the runner resolves
paths from the working directory.

Validate:

* correct source path (`.opencode/tool/run.ts`)
* correct destination (global OpenCode tools directory)
* idempotent installation
* updates to an existing installation
* failure behavior when source is missing

### Step 12.2: Install only required components

The deployment output should include only the supported agents, plugins, tools, and configuration.

Remove installation of deleted or experimental components.

### Step 12.3: Promote skills to top-level source directory

Move `.opencode/skills/` to `skills/` at the repository root. `.opencode/skills/`
is the runtime-consumption path, not the source of truth; skills buried there
look like local config rather than a deliverable.

Steps:

1. Move `.opencode/skills/` → `skills/` at repo root.
2. Update the deploy script's `--with-skills` source path from
   `.opencode/skills/` to `skills/`.
3. Verify global deploy installs skills to the correct destination.
4. Confirm skills previously installed globally are not duplicated or broken.
5. Preserve project-local runtime consumption: OpenCode discovers project
   skills at `.opencode/skills/`. Either symlink `.opencode/skills` →
   `../skills` or verify the runtime also discovers `skills/` at the repo
   root. Do not silently break local skill loading.

Skills are not subject to the four-failure-mode deletion audit.

### Step 12.4: Validate clean-project deployment

Create a temporary clean project.

Run the deployment process.

Confirm that the installed system can:

* run Prometheus
* create spike directories
* enforce Prometheus write restrictions
* write `SPEC.md`
* run Autonomous
* execute verification through the runner
* write execution artifacts
* evaluate completion
* persist blocked state

---

## Phase 13: Rebuild the Validation Suite

### Step 13.1: Delete tests for obsolete behavior

Remove tests whose only purpose is validating:

* removed agents
* removed strategy registries
* payload grammar
* transcript evidence
* reviewer gating
* separate gate and loop plugins
* materialization
* auto-commit behavior

Do not rewrite obsolete tests merely to preserve coverage counts.

Scope note: `tests/verify_opencode.py` (~2,300 lines) asserts builder and
data-scientist in its expected-agent tables, validates the strategy registry,
requires payload grammar in the Prometheus prompt, and asserts gate/loop
plugin internals by function name — expect a rewrite, not an edit.
`tests/audit_run.py` audits transcript promise tokens, Prometheus payloads,
and ralph/octopus delegation; rewrite it against supervisor disk state, or
delete it if the Phase 7 state files cover its purpose.

### Step 13.2: Add required structural tests

Verify:

* all six required agent files exist
* frontmatter is valid
* required permission posture is present
* Prometheus and Autonomous contain required workflow markers
* Reviewer and Grounder have `edit: deny`
* removed agents do not exist

### Step 13.3: Add trusted computing base tests

Verify:

* Prometheus write scope
* immutable evaluator protection
* runner evidence schema
* exact command matching
* exit-code handling
* freshness handling
* spike and execution artifact segregation
* missing `QUESTION.md` rejection
* supervisor loading
* corrective cap behavior
* durable state after restart
* blocked-state quiet behavior

### Step 13.4: Add end-to-end scenarios

At minimum, test:

#### Successful direct execution

* valid SPEC
* direct strategy
* passing fresh artifacts
* advisory reviewer
* completion allowed

#### Failed verification followed by correction

* initial failure
* corrective injection
* new passing artifact
* completion allowed

#### Repeated failure

* same failure class reaches cap
* run becomes blocked
* no further injection

#### Restart recovery

* partial progress
* plugin restart
* state restored
* counters preserved

#### Spike isolation

* Prometheus produces passing spike command
* no execution artifact exists
* completion remains blocked

#### Invalid Karpathy label

* spec declares Karpathy
* harness missing
* no silent direct execution
* run blocked

---

## Phase 14: Perform the Deletion Audit

For every remaining component, answer all three questions:

1. Which of the four failure modes does this address?
2. Why can an existing component not already address it?
3. What observable behavior breaks if this component is removed?

Delete any component that lacks strong answers.

Pay special attention to:

* convenience agents
* wrapper plugins
* registries
* templates
* duplicated state files
* duplicated evidence formats
* compatibility layers
* unused schemas
* prompt-only enforcement
* speculative extension points

---

## Phase 15: Final Consistency Audit

### Step 15.1: Verify one source of truth per concept

Confirm that there is exactly one authoritative definition for:

* required agents
* completion
* evidence
* freshness
* corrective caps
* blocked state
* Prometheus write scope
* spike protocol
* Karpathy admission
* mutation gating
* deployment contents
* validation commands

Remove competing definitions.

### Step 15.2: Verify implementation against requirements

For each invariant in `docs/REQUIREMENTS.md`, identify:

* enforcing component
* implementation path
* validation test
* current passing status

Any invariant without all four is incomplete.

### Step 15.3: Resolve the implementation status table

Update each in-flight item as it is completed.

When all listed items are implemented and validated, delete the implementation status table as instructed by the requirements.

### Step 15.4: Run the full suite

Run:

* repository validation
* unit tests
* integration tests
* deployment test
* clean-project end-to-end test
* type checking
* linting
* any documented audit commands

Do not claim completion with failing or skipped required checks.

Ordering rule for freshness: land every documentation and bookkeeping edit
(the Spike A grounding entry, the Step 15.3 status-table resolution, the
Phase 15.5 report) before producing the final verification artifacts. Run
the suite once to gather results, write the report and remaining bookkeeping
edits, then produce the final fresh verification artifacts as the last write
action of the run. Any tracked-file modification after the last verification
run invalidates artifact freshness under Step 6.4.

### Step 15.5: Produce a cleanup report

Create a concise final report containing:

* components deleted
* components merged
* responsibilities narrowed
* behavior changes
* docs updated
* tests added or removed
* unresolved blockers
* validation commands and results
* remaining deviations from `docs/REQUIREMENTS.md`

Do not auto-commit.

---

## Grounding

Dry-run findings recorded 2026-07-10 (pre-execution audit of this plan
against the repository):

* `.opencode/tool/run.ts` records `run_id`, `exit_code`, `duration_ms`,
  `stdout_tail`, `stderr_tail`, `timed_out`, `command` — no `started_at`, no
  spike/execution context split, no `QUESTION.md` check. Step 4.1 confirmed
  necessary.
* CORRECTED 2026-07-10 (Spike A audit): `plugins/immutability.ts` already
  implements `readonly`, `prometheus_only`, AND `write_allowlist` with a
  three-stage agent-identity resolver (chat.params cache → session messages
  → parentID walk). The earlier finding that "no allowlist mechanism exists"
  was stale. Step 4.0 reduces to verifying test coverage, not writing new
  enforcement code.
* The deploy script's `--with-tools` reads `${REPO_ROOT}/tools/`, which does
  not exist; the runner is never installed by any flag. Step 12.1 confirmed
  necessary.
* `.opencode/strategies.json` registers only `karpathy`; Ralph Wiggum and
  Octopus exist only as prose/code references.
* `@builder` and `@data-scientist` exist and carry capabilities needing
  reassignment (Karpathy implementer, NotebookLM) — see Step 3.1.
* Spike A result: PASS (2026-07-10). Attribution is observable and enforced
  end to end. Evidence: (1) tests/plugins/immutability.test.mjs — 18/18 pass
  under Node v22.23.1, including child-session parent-inheritance and
  write_allowlist denial; (2) OpenCode's session store
  (~/.local/share/opencode/opencode.db) holds 169 real task-spawned child
  sessions with parent_id populated; (3) real user messages carry the agent
  field the hook's messages-fallback reads. The parentID walk the hook
  performs is backed by real runtime data. Proceed per the Execution Order.
* Environment constraint (2026-07-10): the default `node` on PATH is
  v20.18.1, which cannot import the `.ts` plugin sources
  (ERR_UNKNOWN_FILE_EXTENSION). `node --test tests/plugins/*.test.mjs`
  requires Node >= 22.6 (type stripping); v22.23.1 is available via nvm.
  The verification artifact for the node suite must be produced under
  Node >= 22.6, or the default node must be switched before the completion
  gate can pass. Flag at checkpoint (a) for the human to settle.

## Verification

The commands below are the completion checks for this cleanup. Each must
have a fresh runner artifact with `exit_code: 0` (Phase 6 semantics) before
completion is claimed.

- `python3 tests/verify_opencode.py --skip-llm`
- `node --test tests/plugins/*.test.mjs`

Two clarifications on how these are evaluated:

* Interpreter normalization: execution goes through the pyenv virtualenv
  interpreter (`scripts/ensure-venv.sh`), but the runner records the
  normalized `python3 ...` command string per the command-normalization rule
  in `docs/REQUIREMENTS.md`, so the declared strings above match exactly.
* Mid-cleanup enforcement: checkpoints (a) and (b) occur while the legacy
  gate/loop plugins are still the active enforcement. Those checkpoints are
  verified by a human running these commands directly. Phase 6 artifact
  semantics (fresh runner artifact, `exit_code: 0`) apply from checkpoint
  (c) onward, once the supervisor is active.

---

## Completion Criteria

The cleanup is complete only when all conditions below are true.

* The repository contains exactly the required six agents.
* Deleted agents and experimental strategies have no remaining references.
* Prometheus writes `SPEC.md` directly.
* Prometheus can write only `SPEC.md` and `.spike/**`.
* Spike commands require `QUESTION.md`.
* Spike evidence and execution evidence are physically segregated.
* The runner is the sole writer of trusted evidence artifacts.
* The runner is installed by the deploy script.
* The supervisor is the only completion gate.
* The supervisor uses disk state only.
* Completion requires exact, fresh, passing verification artifacts.
* Reviewer verdicts are advisory only.
* Corrective attempts are capped and persisted.
* Restart does not reset run state.
* Karpathy runs only with a valid harness.
* Mutation gating works only when explicitly enabled.
* No component auto-commits.
* Durable docs match implemented behavior.
* Tests verify every enforced invariant.
* No retained component lacks a direct connection to one of the four project failure modes.

---

## Explicit Non-Goals

Do not:

* create new agents
* create new strategies
* generalize the strategy system
* add a strategy registry
* add a strategy template
* add a new payload format
* add transcript evidence
* make reviewer approval mandatory
* preserve obsolete compatibility layers without a documented need
* redesign OpenCode
* optimize prompts beyond what is required for consistency
* auto-commit changes
* expand project scope

The desired outcome is a smaller, stricter, more understandable system.