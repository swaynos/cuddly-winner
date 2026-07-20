# Canonical Rebuild Plan

## Purpose

Rebuild this repository as an optional OpenCode extension whose behavior matches
`README.md`, `docs/REQUIREMENTS.md`, and `docs/ARCHITECTURE.md`. Those files are
the sole behavioral authority for this work. Existing source, tests, examples,
configuration, and generated artifacts are stale implementation inputs only;
they must not preserve behavior that conflicts with the canonical documents.

The rebuilt product provides six explicitly selected specialist agents and an
optional, bounded Autonomous execution profile. It extends OpenCode without
modifying native Plan or Build.

## Success Criteria

1. Native `plan`, `build`, unknown identities, future built-ins, and third-party
   agents bypass managed enforcement before command or path inspection. Their
   prompts, routing, tools, permissions, Bash access, mutation behavior, and
   completion behavior remain unchanged.
2. Exactly these managed identities are installed and enforced: `ask`,
   `prometheus`, `autonomous`, `karpathy`, `reviewer`, and `grounder`.
3. Agent definitions provide the canonical role-specific tool and delegation
   boundaries. The identity hook resolves the topmost managed ancestor and
   applies fixed restrictions to descendants.
4. Prometheus can only create the fixed transient scaffold artifacts and invoke
   the constrained `scaffold_gitignore` operation. It cannot edit production
   files or `.gitignore` directly.
5. Autonomous is the only managed identity allowed to edit ordinary project
   files. It cannot edit a published scaffold, trusted coordinator code, or
   protected runtime state/evidence. The other four read-only roles cannot
   mutate or execute commands.
6. The default installation installs agent definitions and the identity hook
   only. `--with-autonomous` additionally installs the supervisor, protected
   runner, and scaffold Git-exclusion tool. `--with-skills` additionally
   installs optional skills. No profile installs this repository's `AGENTS.md`
   globally.
7. Prometheus publication creates and validates a frozen `SPEC.md`, a versioned
   `opencode-autonomous.json`, optional evaluator assets, and optional spike
   assets in the canonical publication order. It publishes `SPEC.md` last.
8. The Git-exclusion tool manages only the canonical root `.gitignore` block,
   is atomic and byte-idempotent, preserves unrelated content and permissions,
   rejects unsafe targets/markers, and reports tracked generated artifacts
   without modifying the Git index.
9. The optional supervisor implements one deterministic shared coordinator for
   Ralph and Karpathy: one worktree, durable run-state document, coordinator,
   active worker, and active item per run. It is not a distributed workflow or
   checkpoint platform.
10. Every state-changing command result comes through a protected runner that
    confines execution to the worktree, records scaffold provenance, limits
    resources and captured output, redacts likely credentials, and atomically
    persists evidence.
11. Ralph is the default strategy for ordinary deterministic work and supports
    a verified one-iteration completion. It uses fresh workers, one prioritized
    item per iteration, protected item state/handoffs, scoped diffs, focused
    evidence, final full verification, bounded repairs, and bounded stopping.
12. Karpathy starts only for explicit scalar-optimization intent with a complete
    validated frozen Karpathy scaffold. It applies one bounded change per
    experiment and performs target-scoped KEEP/REVERT decisions from protected
    measurements.
13. Documentation remains consistent with the resulting system. Durable changes
    to behavior must update the relevant document in `docs/` in the same change.

## Fixed Decisions

- Treat the project as a clean rebuild. Do not retain stale interfaces merely
  because current files, deployment targets, or tests reference them.
- Preserve only user-owned uncommitted work and repository history. Replace,
  remove, or migrate stale implementation artifacts only after recording their
  replacement in the rebuild inventory.
- Keep the implementation thin and deterministic. Do not introduce dynamic
  policy configuration, a task DAG, parallel mutation, worker messaging,
  distributed execution, event sourcing, general checkpoints, or cross-machine
  recovery.
- Keep native Plan and Build outside all autonomous initialization, evidence,
  and enforcement machinery.
- Do not commit changes unless explicitly requested.

## Required Clarifications Before Runtime Implementation

The canonical documents intentionally leave several contract details open. The
first implementation phase must turn these into durable documented decisions
before code relies on them:

1. Define the manifest schema version, exact required fields, enum values,
   validation errors, and compatibility/migration policy.
2. Resolve the wording around Ralph support versus an exclusively Karpathy
   scaffold, and distinguish an intentional Ralph scaffold from an incomplete
   intended Karpathy scaffold.
3. Define all limit defaults, units, override ownership, and validation rules:
   iteration, repair, no-progress, repeated-error, wall-clock, command,
   resource, output, experiment, and Karpathy failure thresholds.
4. Document the worker threat model, protected coordinator source/state paths,
   redaction policy, and evidence integrity guarantees.
5. Define supported Linux/Bubblewrap prerequisites and exact unavailable-profile
   behavior on unsupported platforms.
6. Define local same-machine restart/recovery and stale-run handling without
   adding cross-machine recovery.
7. Define release test fixtures, supported platforms, and pass criteria for all
   fourteen validation categories.
8. Define Grounder external-source privacy, citation, credential, and offline
   behavior.

These are readiness decisions, not implementation discretion. If a decision
cannot be made from existing canonical intent, record it in `docs/` after a
focused product decision before implementing the dependent capability.

## Work Items

### R0: Establish The Rebuild Baseline

1. Inventory every noncanonical artifact by responsibility: agent definitions,
   plugins, deployment, runner, tools, tests, examples, package metadata, CI,
   and generated state.
2. Build a traceability matrix from every canonical requirement to its intended
   replacement module and acceptance test. Mark existing artifacts as reusable
   only after a line-by-line compatibility review.
3. Capture a clean baseline for native Plan/Build behavior and installation
   destinations. Add regression fixtures that exercise unmanaged identities
   before any managed enforcement is enabled.
4. Remove stale generated runtime artifacts and ensure they cannot become part
   of the rebuilt product or release evidence.

Acceptance:

- The traceability matrix covers every numbered validation requirement in
  `docs/REQUIREMENTS.md`.
- No existing implementation is treated as authoritative.
- Baseline tests demonstrate that unmanaged identities bypass the extension.

### R1: Decide And Document Missing Contracts

1. Resolve the eight clarification areas above using focused decisions and
   repository/platform evidence.
2. Amend `docs/REQUIREMENTS.md` and/or `docs/ARCHITECTURE.md` with the durable
   contract choices, not with transient source-path detail unless it is a
   durable architectural commitment.
3. Define machine-readable fixtures for valid and invalid Ralph/Karpathy
   manifests and publication inputs.

Acceptance:

- No implementation-critical behavior depends on undocumented defaults.
- The schema and runtime failure modes have canonical, testable definitions.

### R2: Rebuild Managed Identities And Enforcement

1. Recreate all six agent definitions with minimal prompts that express their
   canonical roles, tool permissions, and delegation allowlists.
2. Rebuild the immutability hook as an identity-scoped fixed-default boundary.
   It must resolve ancestry, bypass unmanaged identities immediately, and avoid
   project markers or dynamically parsed policy files.
3. Enforce Prometheus scaffold-only writes; Autonomous ordinary-file-only
   writes; and read-only behavior for Ask, Karpathy, Reviewer, and Grounder.
4. Test direct and delegated sessions, including inherited Autonomous execution
   for Karpathy measurements while Karpathy itself remains non-mutating.

Acceptance:

- Native and unmanaged bypass is proven before command/path inspection.
- Every canonical role and descendant restriction is covered by integration
  tests.

### R3: Rebuild Deployment And Profile Isolation

1. Rebuild the installer around copy-mode managed entries with deterministic
   target reporting and obsolete-managed-entry cleanup.
2. Implement default, `--with-autonomous`, and `--with-skills` profiles exactly
   as documented. Ensure install/uninstall/status paths preserve unrelated
   global configuration and never deploy repository `AGENTS.md`.
3. Gate the Autonomous profile on documented platform capabilities while leaving
   native and non-runner specialist operation intact everywhere.

Acceptance:

- Each profile's installed and omitted artifacts match the canonical contract.
- Repeated installation is safe; stale managed entries are removed; unrelated
  global configuration remains intact.

### R4: Implement Scaffold Publication

1. Implement the versioned manifest parser and validator, including canonical
   worktree-relative path validation, evaluator inventory validation, symlink
   escape rejection, strategy-specific fields, and consistency with `SPEC.md`.
2. Implement the `scaffold_gitignore` custom tool with the exact canonical
   block, atomic/idempotent replacement, permission preservation, marker and
   target safety checks, and read-only tracked-artifact warnings.
3. Implement Prometheus publication in the required order: resolve/select,
   validate verification baseline, validate custom evaluator cases when present,
   invoke Git exclusion, write/validate manifest, then write `SPEC.md` last.
4. Ensure incomplete, malformed, unlisted, missing, escaping, or unvalidated
   scaffolds fail publication. Permit an empty Ralph evaluator inventory only
   when existing deterministic verification is recorded.

Acceptance:

- Positive, negative, malformed, and partial-publication fixtures prove every
  rejection rule.
- A valid published scaffold is the only input that can make an Autonomous run
  ready.

### R5: Implement Protected Execution And Evidence

1. Implement the protected runner as a separate execution boundary, not a
   scheduler. Bind each command artifact to the active worktree, run identifier,
   and combined scaffold fingerprint.
2. Apply the documented Bubblewrap sandbox on supported Linux, finite timeout/
   resource/output limits, likely-credential redaction, and atomic evidence
   persistence.
3. Ensure runner output is structured and bounded so only exact artifacts, not
   worker prose or checklist changes, can influence coordinator transitions.
4. Add adversarial tests for escaping paths, forged/mismatched provenance,
   output overflow, command limits, redaction, interrupted writes, and
   unsupported platforms.

Acceptance:

- State-changing evidence is protected, provenance-bound, bounded, and
  atomically persisted under the documented threat model.

### R6: Implement The Shared Supervisor And Ralph

1. Implement one top-level-Autonomous-only supervisor with one durable run-state
   document and a deterministic reducer shared by both strategies.
2. At startup validate the publication, inventory, and combined fingerprint;
   revalidate before each state-changing transition and before completion.
   Fingerprint mismatch blocks the run and requires a new validated run.
3. Implement Ralph item selection and protected states (`pending`, `in progress`,
   `passed`, `blocked`), fresh worker initialization, structured handoff
   validation, diff scope validation, focused checks, full final verification,
   bounded repair, progress/no-progress accounting, and stop conditions.
4. Implement the one-iteration fast path so successful final evidence terminates
   without starting another worker. Do not create Git commits unless requested.
5. Ensure material outcome, acceptance, evaluator, immutable-target, scope,
   trust-boundary, product/policy, and irreversible-tradeoff changes become
   planning blockers; permit ordinary local repair within the discretion
   envelope.

Acceptance:

- Tests prove fresh worker isolation, one item/worker, durable worktree
  continuity, protected state, exact-evidence completion, repair bounds, and
  no-progress stopping.

### R7: Implement Karpathy As A Supervisor Branch

1. Implement strategy selection only when scalar-optimization intent and the
   complete validated Karpathy scaffold are both present; otherwise use Ralph or
   produce the documented blocker.
2. Validate objective, direction, baseline, score extraction, noise probe,
   mutable/immutable targets, evaluator, budgets, and stop criteria before the
   first mutation.
3. Delegate exactly one bounded proposal to the read-only Karpathy strategist,
   preserve only declared mutable targets, use an Autonomous worker for the
   edit, remeasure through the runner, and execute deterministic KEEP or REVERT.
4. Persist experiment records and implement noise-threshold comparison, pivot,
   objective, and bounded-exhaustion behavior without a general checkpoint
   system.

Acceptance:

- Tests prove selection gating, one-change enforcement, target-scoped restore,
  KEEP/REVERT, evaluator integrity, pivot, and bounded stopping.

### R8: Rebuild Release Evidence And Documentation

1. Replace stale tests and examples with fixture-driven unit, integration, and
   end-to-end coverage for all fourteen canonical validation categories.
2. Keep validation layered: Python repository checks through the managed pyenv
   virtualenv, Node plugin/integration tests, mutation tests, dry-run plumbing,
   and CI. Do not present dry-run evaluator checks as release evidence.
3. Audit README, durable docs, installer help, agent prompts, examples, and CI
   against the rebuilt behavior. Update durable documents whenever a justified
   architecture decision changed their contract.
4. Run the complete documented validation suite on supported platforms and
   record the resulting evidence, including explicit unsupported-platform
   behavior.

Acceptance:

- All documented validation commands pass using `scripts/ensure-venv.sh` for
  Python execution.
- A release audit finds no claim that ordinary planning/build requires a custom
  agent, `SPEC.md`, runner, supervisor, or repository-specific global
  instruction.

## Implementation Scope

This rebuild may replace any stale implementation artifact needed to satisfy the
canonical documents, including `agents/`, `plugins/`, `tools/`, `scripts/`,
`tests/`, `evals/`, `examples/`, package metadata, CI configuration, and
noncanonical configuration. Preserve `README.md` and `docs/` unless a required
clarification or a behavior change makes a durable documentation update
necessary.

Do not expand the product beyond the complexity boundary. In particular, do not
add a generic orchestration framework or alter native OpenCode workflows.

## Verification Contract

Before declaring the rebuild complete, run the documented suite with the project
virtualenv:

```bash
PYTHON="$(bash scripts/ensure-venv.sh)"
"$PYTHON" tests/verify_opencode.py --skip-llm
node --test tests/plugins/*.test.mjs tests/integration/*.test.mjs
"$PYTHON" -m unittest discover -s evals/mutation/tests -p 'test_*.py'
"$PYTHON" evals/seed_build/test_planning.py --dry-run
"$PYTHON" evals/seed_build/test_build.py --dry-run
bash scripts/ci.sh
```

The rebuilt test suite must also provide release-grade evidence for each of the
fourteen validation categories in `docs/REQUIREMENTS.md`; dry-run evaluator
checks demonstrate plumbing only.

## Handoff

Begin implementation at R0 and complete each work item in order. Do not begin a
runtime-dependent item until its contract decisions are durable and tested.
Report blockers with the affected canonical requirement, evidence, the smallest
safe resolution, and whether it requires a product decision or a local repair.
