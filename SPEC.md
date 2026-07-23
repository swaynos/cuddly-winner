# SPEC: Close Documentation Gaps in USE-CASES.md and TEST-PLAN.md

## Grounding

Analysis of `docs/USE-CASES.md`, `docs/TEST-PLAN.md`, `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, the agent source files in `agents/`, and the repository test infrastructure reveals the following gaps in the current doc state.

**Current doc state (post commit 0cda078)**

The most recent commit reframed Prometheus as a self-resolving analyst with `bash: ask` permission. It added UC-PRO-05 (self-resolution through deliberation), UC-PRO-06 (creative liberty with thin context), and UC-PRO-07 (Prometheus recommends Karpathy for measurable outcomes) to USE-CASES.md, and the corresponding TP-PRO-05/06/07 to TEST-PLAN.md. It also restructured the Deployment, Measured Spikes, and Scaffold Publication Tools sections by moving them to a `## Deferred Infrastructure` section at the end of both files. UC-ID-02 was renamed from "Prometheus is scaffold-only" to "Prometheus is scaffold-scoped" to reflect the new `bash: ask` permission.

**Missing use cases (USE-CASES.md)**

Ask and Grounder are described in `docs/REQUIREMENTS.md` with non-trivial behavioral contracts. The agent source files (`agents/ask.md`, `agents/grounder.md`) confirm richer detail: Ask has `bash: deny`, can only delegate to `@grounder` (no other agents), must never generate manual workaround instructions or blame the environment for role-based limits, and uses a strict escalation ladder from session context to minimal direct evidence to Grounder delegation. Grounder has `bash: deny`, is terminal with `task: "*": deny` (cannot sub-delegate), must cite every claim with a file/line or URL, and must not send private repository contents or secrets to third-party services including NotebookLM queries.

Neither agent has a UC-ASK or UC-GROUNDER section in USE-CASES.md. Both appear only inside UC-ID-04 (read-only role check). Their actual purpose-driven behaviors — what they do, what they must never do, and how they are constrained — are untested by any documented use case.

No end-to-end scenario use cases exist. The Prometheus→Autonomous handoff is the most critical integration seam in the system: UC-PUB-03 checks only that Prometheus emits the handoff message, and TP-AUT-03 checks only that Autonomous executes a supplied scaffold. No use case combines both to verify that a scaffold Prometheus produces can be consumed and executed by Autonomous. The full Karpathy loop (contract → proposal → measurement → KEEP/REVERT) is split across TP-KAR-01 and TP-KAR-02 but never exercised as a complete cycle.

**Missing test infrastructure definition (TEST-PLAN.md)**

The test plan references "frozen fixtures," "frozen prompts," and "frozen rubrics" over twenty times for every B-class case without defining what they are, where they live, their required format, or who is responsible for creating them. Every B-class test case is a phantom reference until this contract is defined.

`evals/seed_build/test_planning.py` and `evals/seed_build/test_build.py` are real, runnable end-to-end agent evaluations confirmed by inspection. The README treats them as first-class validation. The test plan does not reference them by path. TP-AUT-03 cites "seed build evaluation" in its Evidence column without pointing to the file. `evals/mutation/tests/` is also unconnected. `evals/agent_value/tests/` is empty and is the intended location for Ask and Grounder behavioral tests.

No platform matrix is stated. TP-SPIKE-02 references "macOS and Linux" but the rest of the test plan is silent on platform scope. TP-NATIVE-02's setup column has no defined prompt input, making the test unreproducible.

**Existing infrastructure confirmed correct — must not change**

`tests/fixtures/manifests/` contains nine valid and invalid Ralph/Karpathy manifest fixtures. `evals/seed_build/planning_checks.py` is a functional mechanical SPEC scorer. `evals/seed_build/oracle/reference/rules_engine.py` is a frozen reference implementation. All existing test cases in the primary sections of TEST-PLAN.md (TP-NATIVE-01/02, TP-ID-01 through TP-ID-05, TP-PRO-01 through TP-PRO-07, TP-PUB-03, TP-AUT-01 through TP-AUT-05, TP-KAR-01/02, TP-REV-01, TP-DOC-01) and all use cases in the primary sections of USE-CASES.md are correctly structured and must not be changed by this work.

## Approaches Considered

### Selected: Documentation-only update to USE-CASES.md and TEST-PLAN.md

Add UC-ASK, UC-GROUNDER, and UC-E2E sections to the primary portion of USE-CASES.md (before `## Documentation Consistency`, not after `## Deferred Infrastructure`). Add a Behavioral Fixture Registry section, Platform Matrix section, TP-ASK, TP-GROUNDER, and TP-E2E test cases, and explicit evals path references to the primary portion of TEST-PLAN.md (before `## Deferred Infrastructure`). Update TP-AUT-03 and TP-NATIVE-02 to reference concrete artifacts. Zero code changes, zero risk to passing tests.

### Rejected: Create frozen B-class fixture content alongside the documentation update

Kill reason: Authoring frozen prompts, scenario fixtures, and scoring rubrics for the full B-class suite is ten to fifteen separate content decisions per test case that require LLM scenario design expertise and independent review. The prerequisite is defining the fixture registration contract first; bundling content authoring with structure definition in one change makes both harder to review and blocks neither on the other.

## Acceptance Criteria

1. USE-CASES.md contains an "## Ask" section with UC-ASK-01 (answering focused questions from session context using the documented escalation ladder: session context first, minimal direct evidence second, Grounder delegation third) and UC-ASK-02 (Grounder delegation: Ask may only delegate to `@grounder`, not to any other agent). Each use case follows the existing Given/When/Then/Never/Evidence structure.
2. USE-CASES.md contains a "## Grounder" section with UC-GROUNDER-01 (citation honesty: every substantive claim must be cited with a file/line or URL; inferences are labelled as such) and UC-GROUNDER-02 (private-data non-disclosure: private repository contents, credentials, and secrets must not be sent to third-party services including web and NotebookLM queries; Grounder cannot sub-delegate). Each use case follows the existing structure.
3. USE-CASES.md contains an "## End-to-End Scenarios" section with UC-E2E-01 (Prometheus produces a scaffold that Autonomous successfully consumes and executes) and UC-E2E-02 (full Karpathy optimization loop from contract to KEEP/REVERT decision).
4. All three new sections (Ask, Grounder, End-to-End Scenarios) are inserted in the primary portion of the file, after the `## Karpathy And Review` section and before `## Documentation Consistency`. They do not appear under or after `## Deferred Infrastructure`.
5. TEST-PLAN.md contains a "## Behavioral Fixture Registry" section defining: what a frozen fixture must contain (prompt or scenario description, repository fixture revision, expected behavior rubric with pass threshold, and evidence to retain); the directory convention (`evals/agent_value/tests/fixtures/` for agent behavioral tests, `evals/seed_build/` for planning and build evals); and the rule that every B-class test case must reference a named fixture file.
6. TEST-PLAN.md contains a "## Platform Matrix" section that explicitly states macOS and Linux are required platforms and Windows is out of scope for this release.
7. TEST-PLAN.md contains an "## Ask" test section with TP-ASK-01 and a "## Grounder" test section with TP-GROUNDER-01, each referencing the `evals/agent_value/tests/fixtures/` convention.
8. TEST-PLAN.md contains an "## End-to-End Scenarios" test section with TP-E2E-01 and TP-E2E-02.
9. All new TEST-PLAN.md sections are inserted in the primary portion of the file, before `## Deferred Infrastructure`.
10. TP-AUT-03's Evidence column explicitly references `evals/seed_build/test_build.py --dry-run`.
11. TP-NATIVE-02's Setup and Action column specifies that the "ordinary planning request" input must be a named frozen prompt fixture under `evals/agent_value/tests/fixtures/`.
12. No existing use case, test case, or invariant in the primary sections of either file is modified in meaning, structure, or pass condition.

## Verification

- `grep -c '## Grounder' docs/USE-CASES.md`
- `grep -c '## Ask' docs/USE-CASES.md`
- `grep -c 'UC-E2E' docs/USE-CASES.md`
- `grep -c 'TP-GROUNDER' docs/TEST-PLAN.md`
- `grep -c 'TP-ASK' docs/TEST-PLAN.md`
- `grep -c 'Behavioral Fixture' docs/TEST-PLAN.md`
- `grep -c 'Platform Matrix' docs/TEST-PLAN.md`
- `grep -c 'evals/seed_build' docs/TEST-PLAN.md`

## Implementation Checklist

- [ ] Add "## Ask" section to `docs/USE-CASES.md` with UC-ASK-01 (session-context-first escalation ladder) and UC-ASK-02 (Grounder-only delegation; no other agent delegation permitted), placed after `## Karpathy And Review` and before `## Documentation Consistency`
- [ ] Add "## Grounder" section to `docs/USE-CASES.md` with UC-GROUNDER-01 (citation honesty) and UC-GROUNDER-02 (private-data non-disclosure and no sub-delegation), placed after the new `## Ask` section and before `## Documentation Consistency`
- [ ] Add "## End-to-End Scenarios" section to `docs/USE-CASES.md` with UC-E2E-01 (Prometheus→Autonomous handoff) and UC-E2E-02 (full Karpathy loop), placed after the new `## Grounder` section and before `## Documentation Consistency`
- [ ] Add "## Behavioral Fixture Registry" section to `docs/TEST-PLAN.md` defining fixture format, directory convention, and B-class test case reference rule, placed before `## Deferred Infrastructure`
- [ ] Add "## Platform Matrix" section to `docs/TEST-PLAN.md` with explicit macOS/Linux required, Windows out of scope, placed after `## Behavioral Fixture Registry` and before `## Deferred Infrastructure`
- [ ] Add "## Ask" test section to `docs/TEST-PLAN.md` with TP-ASK-01, placed before `## Deferred Infrastructure`
- [ ] Add "## Grounder" test section to `docs/TEST-PLAN.md` with TP-GROUNDER-01, placed before `## Deferred Infrastructure`
- [ ] Add "## End-to-End Scenarios" test section to `docs/TEST-PLAN.md` with TP-E2E-01 and TP-E2E-02, placed before `## Deferred Infrastructure`
- [ ] Update TP-AUT-03 Evidence column to explicitly reference `evals/seed_build/test_build.py --dry-run`
- [ ] Update TP-NATIVE-02 Setup and Action column to reference the frozen prompt fixture convention under `evals/agent_value/tests/fixtures/`

Invoke @autonomous to execute SPEC.md.
