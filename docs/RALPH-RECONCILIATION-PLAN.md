# Ralph → Direct Reconciliation Plan

Purpose: reconcile the standing feedback that this project labels
single-session, agent-led execution "Ralph" but does not implement a
file-backed, fresh-pass Ralph loop. This is a cross-machine handoff doc, not a
permanent architecture record — delete it once Phase 2 lands and the
referenced feedback report is archived.

## Current state (verified)

Phase 1 is committed at HEAD `3c685cc`; working tree was clean at last check.

- **Fix 1 (idle hook):** `plugins/immutability.ts` — `ownAgent()` resolves a
  session's own agent without walking `parentID` or reading the inheritance
  cache, so the idle publication reminder no longer fires on a managed
  descendant (e.g. a Grounder child of Prometheus) and cannot make a child
  rewrite the scaffold. Regression tests added in
  `tests/plugins/immutability.test.mjs` (child-idle → 0 prompts; cache-poison
  → 0 prompts). Docs synced: `docs/ARCHITECTURE.md:136`,
  `docs/REQUIREMENTS.md:231`.
- **Fix 2 (test-plan deadlock):** `docs/TEST-PLAN.md` fixture path moved from
  `evals/agent_value/tests/fixtures/` to `tests/fixtures/agent_value/`
  (`tests/verify_opencode.py:994` forbids any file under
  `evals/agent_value/`). Doc-only change.

The full README validation suite passed after these fixes (requires
`npm install` first — see prerequisites below).

## Resume prerequisites (feedback machine)

1. `git pull` this branch; confirm HEAD contains `ownAgent` in
   `plugins/immutability.ts`.
2. `npm install` — `node_modules/` is git-ignored and `@opencode-ai/plugin` is
   required for `node --test` and the validator.
3. `PYTHON="$(bash scripts/ensure-venv.sh)"` before running any Python (per
   `AGENTS.md`).
4. The feedback report itself lives in this machine's `feedback/inbox/`
   (absent on the authoring machine). Archival is Step 6 below.

## Open decision — pick the fork

Why a rename at all: the prose is already honest — `README.md:130-131` denies
any host coordinator or durable workflow state machine. The mismatch is the
*name*, not a false claim. The planning oracle
`evals/seed_build/oracle/planning_checks.py:265` already accepts `direct` and
`ralph-wiggum` as strategy values but not bare `ralph` — the vocabulary is
already internally inconsistent.

- **N-full (recommended): rename the strategy enum `ralph` → `direct`.**
  Honest on its face, aligns the schema with the oracle, and reserves
  `ralph`/`ralph-wiggum` for a real loop later — so option R stays additive
  rather than a reversal of commit `61cf6c5` (which removed the prior
  supervisor and runner).
- **N-lite:** keep the enum, add one doc paragraph defining "ralph = direct
  single-session execution, no loop/coordinator/resume." Touches ~8 doc files,
  zero schema risk, but keeps the loaded token in place.
- **R:** build the real loop (host coordinator, durable progress file, fresh
  pass per invocation, runtime-enforced bounds). 2–4 engineering days;
  re-adds the supervisor removed in `61cf6c5` and contradicts
  `README.md:24-29` and `docs/REQUIREMENTS.md:249-254`. Choose only if product
  intent is genuinely to match the name by implementation.

## Phase 2 execution — N-full (if chosen)

Sub-decision first: fail-closed policy. Hard cut to `direct` only
(recommended — matches the validator's stated "fails closed" philosophy) vs.
accept `ralph` as a deprecated alias.

1. **Schema:** `tools/validate_scaffold.ts:12,124-125,189-190` — the type
   union, the enum check and its error message, and the
   `strategy === "ralph"` no-optimization-block branch → `direct`.
2. **Manifests and fixtures:** flip `"strategy": "ralph"` → `"direct"` in
   `evals/seed_build/CANONICAL_MANIFEST.json`,
   `evals/seed_build/_harness.py:230`, and the six
   `tests/fixtures/manifests/*.json` files; rename `valid-ralph.json` →
   `valid-direct.json` and `invalid-ralph-*` → `invalid-direct-*`; update
   `tests/fixtures/manifests/README.md`.
3. **Tests:** `tests/plugins/manifest.test.mjs` (fixture map and strategy
   assertions), `evals/seed_build/test_planning.py:105`,
   `tests/verify_opencode.py:353` (value; optionally rename
   `_write_ralph_scaffold` and its ~9 call sites), and
   `tests/test_verify_opencode.py:113,130,133`. Confirm no assertion in
   `verify_opencode.py` matches the literal string "Ralph" before finishing.
4. **Docs** (same change, per `AGENTS.md`): `README.md:127`,
   `AGENTS.md:71-72`, `docs/ARCHITECTURE.md:74,78,85,124,148`,
   `docs/REQUIREMENTS.md:57,240,334`, `docs/USE-CASES.md:164-168`,
   `docs/TEST-PLAN.md:68,74,95,243`, and
   `agents/{autonomous,prometheus,karpathy}.md`. Add one paragraph stating
   that `direct` is ordinary single-session execution and `ralph-wiggum` is
   reserved for a possible future real loop.
5. **Regression fixture** (guards the original symptom): author the B-class
   fixture at `tests/fixtures/agent_value/` — a scenario where "Run your
   loop" is given against an incomplete implementation, and the agent must
   *continue implementing* rather than stop (per
   `agents/autonomous.md:24-33`). Needs a scored rubric per
   `docs/TEST-PLAN.md:196-203`.

## Verification (run before declaring done)

```bash
PYTHON="$(bash scripts/ensure-venv.sh)"
"$PYTHON" tests/verify_opencode.py --skip-llm
node --test tests/plugins/*.test.mjs tests/integration/*.test.mjs
"$PYTHON" -m unittest discover -s evals/mutation/tests -p 'test_*.py'
"$PYTHON" tests/test_skill_coverage.py --skip-llm
"$PYTHON" -m unittest discover -s tests -p 'test_audit_run.py'
"$PYTHON" evals/seed_build/test_planning.py --dry-run
"$PYTHON" evals/seed_build/test_build.py --dry-run
```

## Step 6 — feedback archival (blocked until Phase 2 verifies green)

Per `skills/cuddly-winner-feedback/SKILL.md:37-39`: only after fresh
verification, append a brief local action note to the report and move its
basename from `feedback/inbox/` to `feedback/archive/`. Never `git add -f` for
feedback. Keep the report pending until Phase 2 — not just Phase 1 — is
verified, since Phase 1 fixed only the two sub-bugs (idle-hook scope,
TEST-PLAN/validator deadlock), not the core "labelled Ralph but isn't one"
claim.

## Done when

The strategy enum is `direct` everywhere (schema, manifests, fixtures, tests,
docs), the full verification suite above is green, the regression fixture
exists and passes its rubric, no remaining doc describes the current strategy
as "Ralph," and the feedback report is archived with an action note. No agent
stages or commits this work — a human commits after review, per `AGENTS.md`.
