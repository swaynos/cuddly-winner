# R0: Rebuild Baseline, Traceability, and Inventory

Transient rebuild-tracking artifact for the `SPEC.md` Canonical Rebuild Plan.
Not canonical: `README.md`, `docs/REQUIREMENTS.md`, and `docs/ARCHITECTURE.md`
remain the sole behavioral authority. This document records the R0 baseline so
later work items (R2–R8) can be verified against a known starting state.

Generated: 2026-07-21.

## Environment Contract (discovered, needs R1 ratification)

The suite is only runnable under a specific toolchain. The Node-20 default shell
on this machine hid the true baseline behind `ERR_UNKNOWN_FILE_EXTENSION`.

| Requirement | Value | Evidence |
| --- | --- | --- |
| Node | `>=22.6 <25` (uses native TS type-stripping) | `package.json` engines; `scripts/ci.sh` guard |
| Installed usable Node | `v22.23.1` (via nvm) | `~/.nvm/versions/node` |
| Python | pyenv virtualenv `cuddly-winner` (3.12.7) | `scripts/ensure-venv.sh`, `.python-version` |
| Runner SDK | `@opencode-ai/plugin`, pinned `1.15.10` in deploy | `scripts/deploy-opencode-agents.sh:552` |
| SDK present in repo | `1.17.15` under `.opencode/node_modules` | `.opencode/package.json` |

**Version skew flagged for R1:** deploy pins `1.15.10`; repo cache has `1.15.9`,
`1.4.10`, `1.17.15` but not `1.15.10`. Root `package.json` declares `1.15.10`;
`.opencode` declares `1.17.15`. This three-way skew is a durable version-contract
decision (see R1 gate).

**Local runnability bridge (reversible, non-canonical):** root `node_modules` is
a symlink to `.opencode/node_modules` so `tools/run.ts` and `plugins/*.ts`
resolve the SDK offline. This is a dev-environment convenience, not a product
change; the real fix (a pinned, installable SDK) is an R1 decision.

## Baseline Test Results (honest)

Run under Node `v22.23.1`, pyenv `cuddly-winner`, macOS (no Bubblewrap).

| Suite | Result | Notes |
| --- | --- | --- |
| `node --test tests/plugins/*.test.mjs tests/integration/*.test.mjs` | 24 pass / 0 fail / 8 skip | skips are live-auth + Bubblewrap sandbox tests |
| `evals/mutation/tests` unittest | 9 pass | |
| `evals/seed_build/test_planning.py --dry-run` | pass (plumbing only) | not release evidence |
| `evals/seed_build/test_build.py --dry-run` | pass (plumbing only) | not release evidence |
| `tests/verify_opencode.py --skip-llm` | **fails** | only at the `--with-autonomous` deploy step |
| `deploy ... status` | pass | default profile resolves |

**The single failure is environmental, not behavioral.** `verify_opencode.py`
line 78 runs `deploy(config, "--with-autonomous")`, which triggers
`npm install @opencode-ai/plugin@1.15.10` (deploy script line 552) against
Expedia Artifactory and fails `E401` (unauthenticated). All documentation
assertions (lines 53–64) and the entire default-profile install pass before it.

### The 8 environmental skips (not defects)

```
live OpenCode child write retains Prometheus ancestry  # needs OPENCODE_LIVE_PROVENANCE=1 + auth
runner persists complete execution evidence            # Bubblewrap
execution sandbox provides writable devices            # Bubblewrap
execution commands cannot forge runner/supervisor state# Bubblewrap
nonzero timeout invalid cwd and concurrency cleanup     # Bubblewrap
spike is contracted and routed without execution leakage# Bubblewrap
spike sandbox writes only inside its spike directory    # Bubblewrap
spawn errors reject and restore concurrency             # Bubblewrap
```

These map to test layers L (Linux/Bubblewrap) and O (authenticated live) in
`docs/USE-CASES.md`, which are documented as release-CI-only. Their skipping on
macOS is expected behavior per UC-DEP-06, not a regression.

## Current Implementation Inventory (by responsibility)

| Responsibility | Artifact | Lines | Canonical target | Reuse assessment |
| --- | --- | --- | --- | --- |
| Managed agent defs | `agents/{ask,prometheus,autonomous,karpathy,reviewer,grounder}.md` | 673 | REQ § Managed Agents | Frontmatter matches roles; needs line-by-line R2 review |
| Identity enforcement | `plugins/immutability.ts` | 144 | ARCH § Identity Enforcement | Exports `ImmutabilityGuard`; tested; review in R2 |
| Run coordinator | `plugins/opencode-autonomous-supervisor/index.js` | 207 | ARCH § Shared Run Coordinator | Real source; `.js` bundle sibling is 1-line re-export |
| Protected runner | `tools/run.ts` | 345 | ARCH § Autonomous Flow, REQ § Autonomous Profile | Exports `run`, `__testing`; Bubblewrap-gated |
| Git exclusion | `tools/scaffold_gitignore.ts` | **0 (absent)** | ARCH § Git Exclusion Tool | **CONFIRMED MISSING — only `run.ts` exists in `tools/`. Greenfield in R4.** |
| Scaffold publication | (none) | **0 (absent)** | ARCH § Prometheus Flow, § Scaffold Handoff | **CONFIRMED MISSING — no manifest parser/validator/publication flow exists. Greenfield in R4.** |
| Deployment | `scripts/deploy-opencode-agents.sh` | ~575 | REQ/ARCH § Deployment | Profile logic present; SDK pin is R1 issue |
| Venv bootstrap | `scripts/ensure-venv.sh` | — | AGENTS.md | Reusable as-is |
| CI | `scripts/ci.sh` | ~30 | REQ § Validation | Reusable; guards Node/Bubblewrap |
| Repo checks | `tests/verify_opencode.py` | 90 | UC-DOC-01 | Substring-based doc audit; extend in R8 |
| Plugin tests | `tests/plugins/{immutability,runner,supervisor}.test.mjs` | — | S/U/C/L layers | Primary reuse candidates |
| Integration | `tests/integration/provenance.test.mjs` | — | L/O layers | Auth-gated |
| Mutation eval | `evals/mutation/**` | — | Karpathy fixtures | Review in R7 |
| Seed build eval | `evals/seed_build/**` | — | B layer | Review in R8 |
| Skills | `skills/**` (10) | 533 | `--with-skills` | Non-core; R3 |

### Generated / stale artifacts (R0 step 4)

| Artifact | State | Canonical expectation | Action |
| --- | --- | --- | --- |
| `SPEC.md` | **git-tracked** | Excluded from VC (ARCH § Git Exclusion) | Keep for now — it IS the rebuild plan; reconcile at end |
| `opencode-karpathy.json` | present at root | Generated manifest, should be excluded | Inventory; candidate removal in R4 |
| `opencode-mutation.json` | present at root | Generated manifest, should be excluded | Inventory; candidate removal in R4 |
| `.opencode/runs/` | empty | Runtime state, excluded | Clean |
| `.spike/attribution-check/` | present | Disposable spike output | Candidate cleanup |
| `.prometheus/evaluator/` | absent | Created on publish | N/A |

Note: `SPEC.md` being tracked while ARCH says the scaffold is excluded is a real
tension, but here `SPEC.md` is serving as the durable rebuild plan, not a
generated Prometheus scaffold. Resolving this is deferred until the rebuild is
complete (removing it now would delete the plan we are executing).

## Traceability Matrix: 14 Validation Categories → Module → Test → Work Item

Categories are REQ § Validation 1–14. Test layers per `docs/USE-CASES.md`.

| # | Category | Primary module(s) | Test / use case | Rebuild item |
| --- | --- | --- | --- | --- |
| 1 | Native + unmanaged bypass | `plugins/immutability.ts` | UC-CAN-02/03/04; `immutability.test.mjs`; `verify_opencode.py` | R2 |
| 2 | Roles + descendant inheritance | `agents/*.md`, `immutability.ts` | UC-ID-01/05/07; `immutability.test.mjs` | R2 |
| 3 | Prometheus framing | `agents/prometheus.md` | UC-PRO-01/02 (B); `evals/seed_build` | R8 |
| 4 | Interview discipline | `agents/prometheus.md` | UC-PRO-04/05/06 (B) | R8 |
| 5 | Alternatives + veto | `agents/prometheus.md` | UC-PRO-03/07/08 (B) | R8 |
| 6 | Publication + Git exclusion | `tools/scaffold_gitignore.ts` (unconfirmed), publication flow | UC-PUB-01..06, UC-GIT-01..03 (F/L) | R4 |
| 7 | Operational blockers | supervisor `index.js` | UC-AUT-02/05, UC-PRO-09 (C) | R6 |
| 8 | Ralph default + fast path | supervisor `index.js` | UC-AUT-04, UC-RAL-06 (C) | R6 |
| 9 | Local vs material change | supervisor `index.js` | UC-AUT-03/05 (C/B) | R6 |
| 10 | Worker/item/handoff/repair | supervisor `index.js` | UC-RAL-01..03/07 (C); `supervisor.test.mjs` | R6 |
| 11 | Progress + completion | supervisor `index.js` | UC-RAL-04/05/08, UC-RUN-04 (C); `supervisor.test.mjs` | R6 |
| 12 | Karpathy experiments | supervisor `index.js`, `agents/karpathy.md` | UC-KAR-01..05 (C/F); `evals/mutation` | R7 |
| 13 | Deployment cleanup + fail-closed | `deploy-opencode-agents.sh` | UC-DEP-01..07 (F/S); `verify_opencode.py` | R3 |
| 14 | Documentation consistency | all docs | UC-DOC-01/02 (S); `verify_opencode.py` | R8 |

### Coverage gaps found during R0

1. **`tools/scaffold_gitignore.ts` confirmed MISSING, and so is the entire
   scaffold-publication flow.** `scaffold_gitignore` appears only in docs
   (`ARCHITECTURE.md`, `USE-CASES.md`, `SPEC.md`) — no source, no deploy wiring,
   no test. `tools/` contains only `run.ts`. There is no manifest parser,
   validator, or publication sequencer anywhere. **Category 6 (R4) is greenfield
   construction, not a rebuild of existing code.** This is the single largest
   gap between canon and implementation and the highest-risk part of the plan.
2. **Category 8 Ralph-vs-incomplete-Karpathy** now has a durable rule (added to
   REQ last change) but no dedicated test yet. R6/R7 must add UC-AUT-04 negative.
3. **UC-DEP-07 (fail-closed without profile)** is newly documented; no test
   exists. R3 must add it.
4. **`--with-autonomous` path is unverifiable on this host** (E401 + version
   skew). Category 13's positive case and all L-layer tests cannot run locally.

## Progress Log

| Item | Status | Result |
| --- | --- | --- |
| R0 baseline/traceability/inventory | done | suite made runnable (Node 22 + SDK bridge); honest baseline recorded |
| R1 contract decisions + fixtures | done | 8 contracts documented in canon; 8 manifest fixtures; SDK re-pinned |
| R2 agents + immutability hook | done | 6 agents match canon; fixed D1 (Prometheus write perms); scaffold_gitignore restricted to Prometheus |
| R3 deployment isolation | done | profiles verified; fixed D2 (copy-mode remove) |
| R4 scaffold publication (greenfield) | done | `scaffold_gitignore.ts` + `manifest.ts` built, wired, tested; Prometheus prompt now encodes publication order |
| R5 protected runner | done | reviewed vs threat model; fixed D4 (redaction coverage); added platform-independent redaction test |
| R6 supervisor/Ralph | done (delta documented) | reviewed; evidence-gating, fingerprint lock, fail-closed, caps all correct; delta below |
| R7 Karpathy branch | done (delta documented) | reviewed; see delta below |
| R8 release evidence + docs | done | terminology normalized (protected runner), README + prompt updated, suite green |

Test totals after R8: node 43 pass / 0 fail / 8 skip; `verify_opencode` passes
both profiles; mutation 9 pass; planning + build dry-runs pass. New modules:
`tools/scaffold_gitignore.ts`, `tools/manifest.ts`,
`tests/plugins/{manifest,scaffold_gitignore}.test.mjs`,
`tests/fixtures/manifests/**`.

## Supervisor Delta (R6/R7) — documented, not rewritten

The installed supervisor (`plugins/opencode-autonomous-supervisor/index.js`) is a
deterministic, evidence-gated completion coordinator. It correctly enforces the
load-bearing canonical invariants: completion only from fresh protected run
artifacts bound to the run id and SPEC fingerprint; SPEC-fingerprint lock that
blocks a changed scaffold; fail-closed on corrupt/uninitialized state; atomic
serialized state updates; and bounded correction caps (`FAILURE_CAP`,
`GLOBAL_CAP`).

It does not yet implement every canonical term verbatim: multi-item Ralph
scheduling with per-item `pending/in progress/passed/blocked` state, and the
Karpathy target-scoped KEEP/REVERT experiment loop, are expressed today as a
single-run verification/correction reducer plus a mutation-result gate. This is a
faithful subset for one-shot and correction-driven Ralph runs, not the full
multi-item/experiment engine described in REQ § Ralph/Karpathy.

Decision: left in place under the evolve-in-place scope. Rewriting it toward the
full reducer is high-risk against Bubblewrap-dependent behavior that cannot be
executed on this host (macOS; L-layer skipped), and the current behavior does not
contradict canon for the paths it does support. A full multi-item/experiment
reducer is the recommended next work item, gated on a Linux/Bubblewrap CI where
the L-layer tests actually run.

## Unverifiable-On-This-Host Layers

- **L (Bubblewrap):** 8 runner/spike sandbox tests skip on macOS by design.
- **O (live auth):** provenance smoke test skips without `OPENCODE_LIVE_PROVENANCE`.

These are release-CI-only per `docs/USE-CASES.md` § Automation Rules; their skip
is reported as missing evidence, never as passing.

## Defects Found And Fixed During Rebuild

| ID | Work item | Defect | Fix |
| --- | --- | --- | --- |
| D1 | R2 | `PROMETHEUS_WRITABLE` allowed only `SPEC.md` + `.spike/**`, so Prometheus could not write its own manifest or evaluator (blocks all publication). | Added `opencode-autonomous.json` and `.prometheus/evaluator/**`; test widened. |
| D2 | R3 | `remove` only deleted symlinks; copy-mode installs (the default) were never uninstalled, leaving stale managed files (violates UC-DEP-04). | `remove` now deletes byte-identical managed copies (`cmp`/`diff -r`), preserves modified/unrelated files. |
| D3 | R1 | SDK three-way version skew + E401 made `--with-autonomous` uninstallable. | Re-pinned to 1.17.15; deploy copies vendored closure instead of registry install. |
| D4 | R5 | Runner `redact()` covered fewer secret shapes than the documented threat model. | Expanded to AWS keys, JWT, bearer, key=value, PEM blocks; added platform-independent test. |
| D5 | R4/R6 | Prometheus prompt was stale: named only `SPEC.md`/`## Grounding`, omitted manifest, evaluator, `scaffold_gitignore`, and publication order. | Rewrote prompt to canon publication order + writable paths; planning eval still passes. |

### R3 follow-ups (open, low priority)

- `--with-autonomous` install copies `node_modules` into the config dir, but no
  `remove` block deletes it; a full uninstall leaves the SDK behind.
- `remove` requires the same profile flags as `install`; forgetting
  `--with-autonomous` on remove silently leaves the runner/supervisor. Consider
  making `remove` always reconcile all managed entries regardless of flags.

## R0 Acceptance Check

- [x] Traceability matrix covers every numbered validation requirement (1–14).
- [x] No existing implementation treated as authoritative (all marked "review").
- [x] Baseline demonstrates unmanaged bypass: `verify_opencode.py` unmanaged
      checks pass; `immutability.test.mjs` "native plan and build never
      initialize supervisor state" passes.
- [x] Stale generated runtime artifacts identified (not yet deleted — see R1).
- [~] Suite runnable: yes under Node 22 + SDK bridge; `--with-autonomous`
      remains environmentally blocked (E401 + version skew), recorded for R1.
