# Complete the Control-Plane Migration

## Grounding

`docs/REQUIREMENTS.md` is the durable authority for this implementation. The
repository is currently in a halfway migration: the requirements describe a
runner, immutability hook, and supervisor as the trusted computing base, while
the executable system still relies on payload materialization, transcript
evidence, reviewer gating, promise-token state transitions, and separate gate
and loop plugins.

Two source reviews identified the following critical defects:

1. `.opencode/tool/run.ts` resolves before its evidence files are durable,
   swallows persistence errors, has no child-process `error` handler, lacks the
   required `started_at` and context fields, and cannot segregate spike runs.
2. `plugins/opencode-autonomous-gate/index.js` accepts the newest successful
   artifact without proving that every command in this SPEC ran exactly and
   after the latest relevant source change.
3. No `plugins/opencode-autonomous-supervisor/` implementation exists. The old
   gate and loop disagree about completion, keep important verdicts in memory,
   have race-prone state updates, and do not enforce bounded correction.
4. `plugins/immutability.ts` can be bypassed by shell-based writes and derives
   configuration only from the first path of a multi-path patch. Relative-path
   resolution and cross-project patches are not covered by regression tests.
5. Prometheus is read-only and returns a payload, Autonomous materializes it,
   and `.opencode/immutable.json` does not activate the required Prometheus
   confinement to `SPEC.md` and `.spike/**`.
6. `scripts/deploy-opencode-agents.sh` treats the runner as optional and reads
   from a nonexistent `tools/` directory rather than the canonical runner
   source. Its skills source also conflicts with the required root `skills/`
   layout.
7. Existing tests, README content, agent prompts, plugin docs, and most files
   under `docs/` preserve removed agents and obsolete control-plane behavior.
   A green suite currently validates much of the architecture being deleted.
8. The cleanup brief itself was not parseable as the canonical SPEC contract:
   it lacked the complete required section structure and deterministic
   implementation checklist expected by the target supervisor.

Completed work that must be preserved:

- The checked-in agent roster is the intended six agents: Ask, Prometheus,
  Autonomous, Karpathy, Reviewer, and Grounder.
- Builder and Data Scientist have been removed; Karpathy now performs its own
  scoped edits and Grounder has inherited read-only NotebookLM research.
- The immutability hook already contains useful agent attribution,
  parent-session inheritance, readonly patterns, Prometheus-only patterns, and
  per-agent allowlist primitives. Harden these rather than replacing them.
- `evals/mutation/` and `evals/seed_build/` remain required. The obsolete
  `evals/agent_value/` and `evals/plan_outcome/` suites do not.

Before implementation, run the load-bearing attribution spike described below.
Record its measured result here, including the spike ID and whether its kill
criterion passed. Do not claim this grounding item complete from existing unit
tests alone.

- **Spike ID:** `attribution-check`
- **Question:** Can the immutability hook attribute and deny a child-session
  write initiated by Prometheus when the target is outside `SPEC.md` and
  `.spike/**`?
- **Kill criterion:** The hook logs or otherwise exposes the originating
  Prometheus identity and denies the write. A denial without reliable identity
  attribution does not pass.
- **Measured result:** Pending.

If the spike fails, stop before granting Prometheus write or command execution
permissions. Update `docs/REQUIREMENTS.md`, this SPEC, and the confinement design
before proceeding.

## Approaches Considered

### Selected: Strangler Migration With an Atomic Handoff Flip

Build and test the hardened runner and new supervisor beside the old plugins.
Only after the replacement control plane passes isolated tests should one
coordinated change switch agent permissions and prompts, activate Prometheus
confinement, and remove the old gate and loop.

This approach keeps completion enforcement present throughout the migration and
allows deterministic comparison between old and replacement behavior. It also
isolates the highest-risk trusted-computing-base work from broad deletion.

### Rejected: Delete the Old Architecture First

Removing the old gate, loop, transcript utility, and tests before the
replacement is proven would create an interval with no completion enforcement
and no restart recovery. That directly worsens completion lying and restart
fragility, so this approach is rejected.

### Rejected: Incrementally Mutate the Existing Gate and Loop

The current plugins have overlapping state ownership and incompatible event
models. Gradually modifying both would preserve split-brain completion and make
it difficult to establish pure disk-state semantics. Reusing small pure helpers
is acceptable, but the final runtime owner must be one supervisor plugin.

### Rejected: Treat Prompt Rewrites as Enforcement

Changing Prometheus and Autonomous prompts without first hardening the runner,
immutability hook, and supervisor would provide guidance but no trustworthy
enforcement. Prompt-only migration cannot satisfy the four project failure
modes.

## Acceptance Criteria

### Contract Decisions

1. `docs/REQUIREMENTS.md` and `docs/ARCHITECTURE.md` are the only durable design
   documents. This SPEC is the volatile implementation contract.
2. Prometheus is the only workflow agent permitted to create or modify
   project-root `SPEC.md`. Autonomous reads it and must not rewrite it.
3. A promise token may request supervisor evaluation or communicate a terminal
   state to the user. It is never completion evidence and never directly marks
   durable state complete.
4. Completion is a pure disk-state decision. Every command listed as a command
   item in `## Verification` must have a fresh artifact with an exact normalized
   command match and `exit_code: 0` in `.opencode/runs/`.
5. Freshness is measured against the newest modification time among source
   code, tests, agent definitions, plugin implementations, runner code, and
   deployment scripts. Exclude docs, README files, `.gitignore`, `SPEC.md`,
   `progress.txt`, `.spike/**`, `.opencode/runs/**`, and supervisor state.
6. Command normalization may replace the resolved pyenv interpreter with the
   canonical `python3` spelling. No other semantic rewriting, whitespace
   folding, shell reordering, or argument normalization is allowed.
7. Mutation result files are trusted disk artifacts at the configured
   repository path. Agents may create or refresh them but never commit them.
   The supervisor validates their schema, score, file list, and freshness from
   disk. Update durable requirements to remove any wording that implies agents
   auto-commit mutation results.
8. Corrective injection is bounded by both a per-failure-class cap of 3 and a
   global per-run cap of 12. Either cap transitions the run to `blocked`,
   persists the reason, and stops automatic messages until user intervention.
9. Reviewer output is advisory. `REQUEST_CHANGES` may cause one bounded
   corrective attempt in its failure class, but neither `APPROVE` nor
   `REQUEST_CHANGES` changes deterministic completion eligibility.
10. The old gate and loop remain installed until the replacement supervisor's
    isolated tests pass. The final cutover removes them atomically with their
    wrappers and transcript-evidence helpers.
11. No implementation step creates a Git commit. Commits require explicit user
    instruction.

### Runner

- The runner records `run_id`, `started_at`, `finished_at`, `duration_ms`, exact
  normalized `command`, `exit_code`, `stdout_tail`, `stderr_tail`, `timed_out`,
  `context`, and `spike_id` when applicable.
- Execution context writes atomically to `.opencode/runs/<run-id>.json` and its
  log. Spike context writes atomically to
  `.spike/<spike-id>/runs/<run-id>.json` and its log.
- The runner awaits both artifact writes before resolving. Directory creation,
  log writes, JSON writes, rename failures, and serialization failures surface
  as tool failures rather than being swallowed.
- Child-process spawn errors, timeouts, signals, and normal exits settle exactly
  once. The concurrency counter is restored in `finally` for every path.
- Spike execution is rejected unless
  `.spike/<spike-id>/QUESTION.md` exists and contains a question and kill
  criterion.
- The runner never writes spike evidence into `.opencode/runs/`.
- Unit tests cover success, non-zero exit, timeout, spawn failure, invalid cwd,
  evidence-write failure, atomic persistence, context routing, missing
  `QUESTION.md`, and concurrency cleanup.

### Immutability

- `.opencode/immutable.json` confines Prometheus to project-root `SPEC.md` and
  `.spike/**`; all other project writes from Prometheus or its attributed child
  sessions are denied.
- Every path in a multi-file mutation is resolved independently, discovers its
  own project root, and is checked against that root's configuration.
- Relative mutation paths resolve against the tool's project/cwd argument, not
  the plugin process's incidental working directory.
- Protected paths cannot be modified through `apply_patch`, edit/write tools,
  or allowed shell commands. Implement a deterministic shell-write guard or
  remove shell command forms that can mutate protected targets from affected
  agents. Do not claim immutability while an unrestricted interpreter can write
  those files.
- Missing agent identity fails closed whenever a target matches any protected
  or agent-scoped rule.
- Tests cover shell/Python overwrite attempts, relative paths, mixed protected
  and unprotected paths, cross-project patches, child sessions, case variants,
  and unknown identity.
- Remove readonly entries for deleted `evals/agent_value/` files while retaining
  protections required by the surviving mutation and seed-build evaluators.

### Supervisor

- `plugins/opencode-autonomous-supervisor/` is the single owner of completion
  evaluation, correction limits, and durable autonomous state.
- Verification parsing is strict and deterministic. An absent, duplicate,
  malformed, or empty `## Verification` section makes the SPEC invalid.
- The gate requires one fresh passing execution artifact for every declared
  command. Unrelated passing commands, spike artifacts, transcript blocks,
  reviewer text, and promise tokens cannot satisfy it.
- Artifact validation fails closed on missing or invalid timestamps, malformed
  JSON, duplicate run IDs, missing fields, non-finite numbers, missing files, or
  unknown execution context.
- Mutation validation fails closed on missing or invalid `generated_at`, empty
  file lists, deleted listed files, non-finite scores, stale results, or scores
  below threshold.
- State updates use atomic replacement and serialization per run so concurrent
  events cannot lose counters or history. Restarting the plugin restores run
  ID, SPEC fingerprint, satisfied commands, corrective counts, global count,
  status, and blocker reason.
- A SPEC fingerprint is captured at execution start. If `SPEC.md` changes,
  execution pauses and the supervisor requires a new run rather than silently
  applying the old run's evidence to a changed contract.
- Child/subagent messages are attributed only to their actual parent run.
  Concurrent Autonomous sessions cannot inherit one another's Reviewer or
  Karpathy activity.
- Corrective delivery is deduplicated across streaming and legacy event hooks.
- Pure-function tests cover parsing, exact matching, freshness, failure
  classification, cap transitions, restart restoration, malformed artifacts,
  concurrent updates, event deduplication, and gate/loop verdict disagreement.

### Agent Handoff

- Prometheus can execute only through the trusted runner and can write only
  `SPEC.md` and `.spike/**`. Its prompt requires measured spikes for unresolved
  load-bearing assumptions and direct creation of this canonical SPEC format.
- Prometheus ends every completed SPEC with exactly the handoff sentence used at
  the end of this file. It does not emit a payload grammar.
- Autonomous reads `SPEC.md` from disk, validates the canonical sections,
  fingerprints it, executes `## Implementation Checklist`, and runs every
  `## Verification` command through the runner.
- Autonomous contains no payload materialization, alternate filename casing,
  fenced transcript evidence, reviewer-gate, or committed-artifact protocol.
- Karpathy sends every measurement through the runner and requires the complete
  harness: `program.md`, `.opencode/karpathy.json`, and a frozen evaluator.
- Grounder remains read-only and no longer claims it can update
  `.opencode/memory/`.

### Deployment, Validation, and Documentation

- The deploy script installs the canonical runner by default from
  `.opencode/tool/run.ts` into the global OpenCode tool directory. There is no
  required `--with-tools` opt-in for the runner.
- The supervisor and immutability hook are installed consistently with the
  documented default deployment. A clean-project sandbox proves global runner
  discovery and per-project evidence placement.
- Root `skills/` is the canonical deploy source. Move retained skills there and
  update validation and deployment together.
- Delete the old gate, loop, wrappers, package directories, READMEs, and shared
  transcript evidence utility only after supervisor tests pass.
- Delete `evals/agent_value/` and `evals/plan_outcome/`; retain and repair
  `evals/mutation/` and `evals/seed_build/`.
- Rewrite `tests/verify_opencode.py` and plugin tests so they reject payload
  materialization, transcript evidence, reviewer gating, split gate/loop
  plugins, read-only Prometheus, optional runner deployment, and removed agents.
- Reduce durable docs to `docs/REQUIREMENTS.md` and `docs/ARCHITECTURE.md`, and
  rewrite both to describe the resulting implementation. Delete stale durable
  docs only after their still-valid content is incorporated into those files.
- Rewrite the root README as a user-facing description of the final workflow,
  installation, runtime artifacts, and pyenv-safe validation commands.
- A repository-wide search finds no live references to Builder, Data Scientist,
  strategy registries, payload materialization, transcript evidence, reviewer
  gating, old plugin names, or obsolete eval suites outside explicit migration
  history.

## Verification

Run these exact commands through the trusted runner after all implementation and
documentation changes are complete. Provisioning the project interpreter is a
shell prerequisite; the supervisor command matcher records the normalized
`python3` spelling for the three Python commands. Each list item below is one
required command; prose and code examples elsewhere in this SPEC are not
verification commands.

- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" tests/verify_opencode.py --skip-llm`
- `node --test tests/plugins/*.test.mjs`
- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" -m unittest discover -s evals/mutation/tests -p 'test_*.py'`
- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" evals/seed_build/test_planning.py`
- `bash scripts/deploy-opencode-agents.sh status`

The implementation must also add deterministic tests for failure injection that
the commands above execute: runner persistence failure, spawn failure,
cross-project immutability, shell-write bypass, stale and malformed evidence,
concurrent supervisor updates, restart restoration, corrective caps, and clean
sandbox deployment.

## Implementation Checklist

Execute in order. Keep exactly one control plane active during cutover, update
tests with each behavior change, and stop at each checkpoint for review. Do not
perform broad deletion before its replacement passes.

### Checkpoint 1: Prove Preconditions and Freeze Contracts

- [ ] Run `.spike/attribution-check/` with `QUESTION.md` and record the measured
      result in `## Grounding`.
- [ ] If attribution fails, stop and redesign confinement in requirements and
      this SPEC; do not broaden Prometheus permissions.
- [ ] Capture the current validation baseline using the mandatory pyenv
      interpreter and existing Node tests.
- [ ] Add tests that encode the contract decisions in this SPEC, initially
      failing where the implementation is absent.
- [ ] Update `docs/REQUIREMENTS.md` to specify the global corrective cap,
      mutation artifact/no-auto-commit semantics, SPEC ownership, promise-token
      evaluation semantics, and exact runner schema.

### Checkpoint 2: Harden the Trusted Runner

- [ ] Add timestamps, normalized command, execution context, and spike identity
      to the runner result schema.
- [ ] Implement atomic, awaited log and JSON persistence and surface every
      persistence error.
- [ ] Handle spawn errors, invalid cwd, timeout, signal, and close exactly once;
      restore concurrency state in `finally`.
- [ ] Implement execution and spike destinations, require spike
      `QUESTION.md`, and prevent cross-context evidence leakage.
- [ ] Add focused runner tests for every Runner acceptance criterion.
- [ ] Confirm no agent can author runner artifacts except through the tool.

### Checkpoint 3: Close Immutability Bypasses

- [ ] Resolve each mutation path against its own cwd and project configuration.
- [ ] Enforce every path in mixed-root and multi-file mutations independently.
- [ ] Close shell/interpreter write bypasses for protected paths with
      deterministic enforcement and tests.
- [ ] Fail closed for unknown identities on protected or scoped paths.
- [ ] Activate Prometheus's `SPEC.md` and `.spike/**` allowlist only after the
      attribution spike passes; land permissions and policy atomically.
- [ ] Remove obsolete evaluator protections and retain required frozen files.

### Checkpoint 4: Build the Supervisor Beside the Old Plugins

- [ ] Create `plugins/opencode-autonomous-supervisor/` and a loadable root
      wrapper without yet removing the old plugins.
- [ ] Implement pure strict parsing of this SPEC's `## Verification` commands.
- [ ] Implement exact normalized command matching, freshness calculation,
      execution-context filtering, and fail-closed artifact validation.
- [ ] Implement strict opt-in mutation result validation.
- [ ] Implement the documented failure classes, per-class cap of 3, global cap
      of 12, blocked transitions, and corrective deduplication.
- [ ] Implement serialized atomic state updates, SPEC fingerprinting, restart
      restoration, and correct parent/child run attribution.
- [ ] Prove the supervisor with isolated unit and integration tests, including
      concurrent sessions and duplicate event delivery.

### Checkpoint 5: Flip the Handoff Atomically

- [ ] Rewrite Prometheus as a spiking SDE that writes canonical `SPEC.md`
      directly and uses only the runner for commands.
- [ ] Rewrite Autonomous to read and fingerprint `SPEC.md`, execute its
      checklist, and request disk-state completion evaluation.
- [ ] Remove payload grammar, gate-side SPEC writes, materialization, alternate
      SPEC casing, transcript evidence, and reviewer-gate instructions from
      agent prompts and tests.
- [ ] Make Reviewer advisory with one bounded request-changes correction.
- [ ] Require Karpathy's complete harness and runner-backed measurements.
- [ ] Remove Grounder's impossible memory-write instruction.
- [ ] Switch runtime ownership to the supervisor and prove completion cannot be
      marked from token text, reviewer text, or unrelated passing commands.

### Checkpoint 6: Remove the Replaced System

- [ ] Delete the old gate and loop implementations, wrappers, package metadata,
      plugin README, and shared transcript-evidence utility.
- [ ] Delete obsolete payload and transcript tests rather than adapting them to
      preserve old behavior.
- [ ] Delete `evals/agent_value/` and `evals/plan_outcome/` and all associated
      configuration, test, and documentation references.
- [ ] Confirm only the supervisor owns completion, correction, and run state.

### Checkpoint 7: Repair Deployment and Validation

- [ ] Install `.opencode/tool/run.ts` globally by default from its actual source
      path and remove optional-runner behavior.
- [ ] Move retained skill sources to root `skills/` and update deployment paths.
- [ ] Rewrite static validation for the six-agent roster, supervisor, runner,
      Prometheus confinement, advisory Reviewer, and read-only Grounder.
- [ ] Add a disposable clean-project deployment test proving global tool
      discovery and project-local artifact output.
- [ ] Repair seed-build and mutation evaluations without reviving removed
      agents or strategy infrastructure.

### Checkpoint 8: Make Documentation True

- [ ] Rewrite `docs/ARCHITECTURE.md` around the runner, immutability hook, and
      supervisor trust boundaries and final control flows.
- [ ] Reconcile `docs/REQUIREMENTS.md` status and delete its in-flight table once
      every invariant is implemented.
- [ ] Incorporate still-valid content from other docs, then delete all durable
      docs except `REQUIREMENTS.md` and `ARCHITECTURE.md`.
- [ ] Rewrite README installation and workflow guidance, including mandatory
      pyenv provisioning before Python validation.
- [ ] Remove stale examples, comments, plugin docs, and references identified in
      both reviews.

### Checkpoint 9: Final Audit

- [ ] Run every exact command in `## Verification` through the hardened runner.
- [ ] Confirm every artifact is fresh, passing, execution-context evidence for
      its exact declared command.
- [ ] Search the repository for every removed agent, plugin, payload, transcript
      evidence, strategy registry, and obsolete evaluation concept.
- [ ] Verify the worktree contains no unintended changes and no automatic
      commits were created.
- [ ] Confirm `docs/` describes the resulting executable system without future
      tense or stale implementation-status claims.
- [ ] Request advisory Reviewer inspection and address at most one bounded
      correction cycle; deterministic artifacts remain the completion gate.

## Review Feedback

Based on a review of the current codebase and project requirements, please consider the following feedback during implementation:

1. **Mandatory Preflight Validation**: Per `AGENTS.md`, `ensure-venv.sh` MUST be executed before any edits are made. While Checkpoint 1 mentions capturing the baseline, it should explicitly require running `scripts/ensure-venv.sh` and ensuring a working Python environment *first* to avoid the "unverified completion claim" failure mode.
2. **Shell-Write Bypass Architecture (Checkpoint 3)**: `plugins/immutability.ts` currently only intercepts `["write", "edit", "patch", "apply_patch"]`. Since `run.ts` spawns an unrestricted bash shell, closing shell bypasses deterministically is non-trivial (e.g., using `LD_PRELOAD`, `strace`, dropping bash access for Prometheus, or using OS-level read-only flags). The SPEC should clarify the accepted technical approach for this guard.
3. **`run.ts` Error Handling (Checkpoint 2)**: The current implementation of `run.ts` uses empty catch blocks for file writing (`fs.writeFile(...).catch(() => {})`). To fulfill the requirement of "surfacing every persistence error", these must be changed to proper awaited calls or explicitly bubble errors back to the runner execution result.
4. **Deployment Path Inconsistencies (Checkpoint 7)**: The `scripts/deploy-opencode-agents.sh` script currently hardcodes `${REPO_ROOT}/.opencode/skills` for skill deployment. The migration step must update this line directly in the script to use the canonical `${REPO_ROOT}/skills` source as mandated by `REQUIREMENTS.md`.

Invoke @autonomous to execute SPEC.md.
