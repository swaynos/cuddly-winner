# Ralph To Direct Reconciliation Plan

Purpose: reconcile the observed workflow failures below. The current strategy is
single-session, agent-led implementation, not a fresh-pass, file-backed Ralph
Wiggum loop. Rename that strategy to `direct`; also provide a safe route when an
existing transient scaffold targets a different explicit user request. Delete
this temporary plan after its implementation verifies.

## Decisions

- **Schema v2 hard cut:** schema v2 accepts only `direct` and `karpathy`.
  Schema v1 and `ralph` are invalid. Existing generated scaffolds require a
  top-level Prometheus republish; there is no compatibility alias.
- **Explicit task supersession:** when a top-level Prometheus session receives an
  explicit materially different request, it automatically supersedes the active
  transient scaffold. It preserves ordinary pending implementation changes and
  states that the prior scaffold was superseded, not completed or validated.
- **No new orchestration runtime:** do not add a supervisor, runner, reset tool,
  task identifier, durable state machine, or Autonomous-to-Prometheus child
  delegation. A child would inherit Autonomous's restriction and could not
  rewrite the scaffold. A top-level agent switch is the supported route.

## Feedback Incorporated

The original local reports remain private and are not cited or copied here. The
following sanitized observations are the product requirements derived from them:

1. A specialist workflow created and rewrote planning artifacts, changed roles,
   and stopped after partial implementation. The extra workflow did more work
   for the operator than focused implementation would have done. The system must
   keep ownership of concrete in-scope work, run available verification, and
   surface only actual safety, permission, or technical boundaries. Scaffolding
   must not replace implementation or require repeated requests to continue.
2. A read-only report request encountered an existing published scaffold for an
   unrelated task. The workflow correctly preserved the scaffold, but treated
   the resulting edit guard as the end of useful work. When a published scaffold
   conflicts with the active request, the workflow must offer a supported
   top-level supersession path or route ordinary work to native Build. It must
   not silently run the stale task, bypass immutability, or falsely claim
   completion.

The prior Phase 1 fixes remain required evidence but do not close these failures:

- `3c685cc` limits the idle publication reminder to a session whose own identity
  is Prometheus, preventing a managed child from receiving the reminder.
- The `tests/fixtures/agent_value/` documentation path no longer conflicts with
  `tests/verify_opencode.py`'s retired-evaluation guard.

## Phase 0: Baseline

1. Before any Python command or edit, provision the required interpreter:

   ```bash
   PYTHON="$(bash scripts/ensure-venv.sh)"
   ```

2. Ensure Node dependencies exist with the repository lockfile, then run the
   existing deterministic baseline:

   ```bash
   bash scripts/ci.sh
   "$PYTHON" -m unittest discover -s evals/seed_build/tests -p 'test_*.py'
   ```

3. Record unrelated failures as baseline evidence. Do not change, reset, stage,
   commit, or otherwise disturb existing user-owned worktree changes.

## Phase 1: Schema v2 Direct Cutover

1. Start with failing tests in `tests/plugins/manifest.test.mjs` proving that:
   - schema-v2 `direct` and `karpathy` manifests pass;
   - schema-v1 manifests fail;
   - schema-v2 `ralph` manifests fail;
   - `direct` rejects an `optimization` block;
   - Karpathy's existing complete-optimization requirements remain unchanged.

2. Update `tools/validate_scaffold.ts`:
   - change the schema contract and `ValidationResult` union to schema v2;
   - accept only `direct` and `karpathy`;
   - update the direct no-optimization diagnostic;
   - retain fail-closed unknown-field, path, inventory, and Karpathy validation.

3. Replace and rename manifest fixtures under `tests/fixtures/manifests/`:
   - `valid-ralph.json` becomes `valid-direct.json` with `schema_version: 2`;
   - `invalid-ralph-*` becomes `invalid-direct-*` where its rule is independent
     of the old name;
   - add `invalid-legacy-ralph.json` and `invalid-legacy-schema-v1.json`;
   - update `valid-karpathy.json`, fixture documentation, and table-driven test
     names to schema v2.

4. Update every generated scaffold and test helper to produce schema-v2
   `direct` manifests:
   - root `opencode-autonomous.json` and its associated transient `SPEC.md`;
   - `tests/verify_opencode.py` and `tests/test_verify_opencode.py`, including
     renaming `_write_ralph_scaffold` to `_write_direct_scaffold`;
   - `evals/seed_build/CANONICAL_MANIFEST.json`, `_harness.py`, and
     `test_planning.py`;
   - `examples/ml-loop/opencode-autonomous.json` schema version;
   - every schema-version statement in fixture documentation and durable docs.

5. Reconcile evaluator vocabulary without treating it as runtime authority:
   - update the active seed-build evaluator and its tests to recognize the
     canonical `direct` directive;
   - remove retired `ralph-wiggum`, `octopus`, and `instrumentation` values from
     `evals/seed_build/oracle/planning_checks.py` unless a current evaluator test
     demonstrates a supported use;
   - keep `tests/audit_run.py` observational: it may describe direct execution,
     but it must not infer a manifest strategy from child delegation alone.

## Phase 2: Managed Scaffold Lifecycle

1. Update `agents/autonomous.md` before implementation work begins:
   - compare the active user request's requested outcome with the loaded
     scaffold before edits, commands, or validation;
   - for a matching scaffold, treat an explicit request to run or continue the
     loop as authorization to continue all in-scope implementation and final
     verification work;
   - for a material mismatch, do not edit ordinary files or scaffold files, run
     stale verification, or claim either task complete;
   - state the concise top-level route: explicit managed-loop work switches to
     top-level `@prometheus` for supersession; ordinary direct work switches to
     native Build and does not use or modify the stale scaffold;
   - preserve the current refusal to rewrite a scaffold and never suggest Bash
     deletion as a reset mechanism.

2. Update `agents/prometheus.md`:
   - inspect any existing scaffold before publication;
   - reuse a matching valid scaffold only when it still serves the explicit
     active request;
   - for an explicitly different request, write the complete replacement
     manifest and SPEC, reconcile obsolete `.prometheus/evaluator/**` assets,
     run `scaffold_gitignore` and `validate_scaffold`, and hand off normally;
   - state that superseding a scaffold neither validates nor discards prior
     ordinary implementation changes;
   - do not turn task switching into a confirmation loop when the new explicit
     request materially supersedes the old one.

3. Keep `plugins/immutability.ts` unchanged unless a new deterministic test
   exposes a real permission defect. The existing guard already permits a
   top-level Prometheus session to edit the scaffold and blocks Autonomous. Do
   not weaken it to permit Autonomous edits or child-delegated Prometheus edits.

4. Update durable behavior documentation in the same change:
   - `README.md`: explain direct execution and the concise stale-scaffold route;
   - `AGENTS.md`: set the optional Autonomous default to `direct`;
   - `docs/REQUIREMENTS.md`: describe schema v2, direct execution, transient
     scaffold supersession, and the no-durable-state boundary;
   - `docs/ARCHITECTURE.md`: update manifest schema, Prometheus flow, and
     Autonomous flow with the top-level-only switch rule;
   - `docs/USE-CASES.md`: rename the ordinary strategy use case and add a
     stale-scaffold/supersession use case;
   - `docs/TEST-PLAN.md` and `docs/TESTING-METHODOLOGY.md`: map the new
     executable cases and update the live-scenario count.

## Phase 3: Executable Regressions

1. Add named frozen behavioral fixtures under `tests/fixtures/agent_value/`.
   Each fixture must include an exact prompt or scenario, repository revision,
   scored observable rubric with threshold, and retained evidence as required by
   `docs/TEST-PLAN.md`:
   - `autonomous-continue-incomplete.md`: a matching direct scaffold with an
     incomplete in-scope deliverable and an explicit "run your loop" request;
   - `scaffold-task-switch.md`: a valid direct scaffold for task A followed by
     an explicit incompatible task B;
   - `prometheus-supersede-scaffold.md`: task A is present, task B explicitly
     supersedes it, and obsolete evaluator assets exist.

2. Extend deterministic tests:
   - `tests/plugins/immutability.test.mjs`: a root session whose current identity
     is Prometheus may replace existing scaffold files; Autonomous remains
     denied; a Prometheus child below Autonomous remains denied through inherited
     identity; Prometheus remains unable to edit ordinary implementation files;
   - `tests/test_verify_opencode.py`: cover new assertion helpers, stable fixture
     references, direct scaffolds, and no false success on mismatch;
   - `tests/verify_opencode.py`: make static contract checks fail if the direct
     strategy, continuation rule, or top-level-only supersession route vanishes.

3. Extend live behavioral scenarios in isolated temporary workspaces:
   - **Continuation:** Autonomous receives the matching incomplete scaffold and
     explicit loop request; it implements the missing deliverable, runs declared
     verification, and does not request fresh authorization merely because work
     remains;
   - **Mismatch:** Autonomous receives task A's valid scaffold and explicit task
     B; scaffold byte content and ordinary files remain unchanged, no stale
     verification runs, and the response names the top-level route without a
     validated or completed claim;
   - **Supersession:** top-level Prometheus receives explicit task B while task
     A's scaffold and evaluator assets exist; both root files describe B,
     obsolete evaluator assets are reconciled, static validation passes, and no
     ordinary implementation file changes;
   - **Replacement consumption:** Autonomous invoked after supersession consumes
     B rather than A.

4. Do not count a text-only fixture or source-string check as behavioral proof.
   A missing model, tool, or profile remains a blocked live case, not a pass.

## Phase 4: Verification And Feedback Closure

1. Run focused tests while implementing:

   ```bash
   node --test tests/plugins/manifest.test.mjs tests/plugins/immutability.test.mjs
   "$PYTHON" -m unittest discover -s tests -p 'test_verify_opencode.py'
   "$PYTHON" evals/seed_build/test_planning.py --dry-run
   "$PYTHON" evals/seed_build/test_build.py --dry-run
   "$PYTHON" -m unittest discover -s evals/seed_build/tests -p 'test_*.py'
   ```

2. Before declaring implementation complete, run the full deterministic suite:

   ```bash
   bash scripts/ci.sh
   git diff --check
   ```

3. Run the new targeted live scenarios with the active deployed profile when
   model access is available. Preserve their observed tool and filesystem
   evidence. A live failure or unavailable prerequisite must be reported
   honestly.

4. Keep any private feedback records local. Do not stage, commit, force-add,
   quote, or link them from this plan.

5. Delete this file only when all schema-v2/direct references are reconciled,
   the stale-scaffold and continuation regressions pass, and durable docs
   describe the implemented behavior. Leave all changes unstaged for human
   review; do not commit.
