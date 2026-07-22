# Human-Led Regression Cases

These cases complement automated tests where live runtime behavior or human judgment cannot be fully proven in isolation.

## Live Runtime Cases

| ID | Scenario | Tester action | Pass condition |
| --- | --- | --- | --- |
| HL-01 | Native Plan remains unchanged | In an installed OpenCode runtime, use native `plan` on a normal task. | No managed scaffold, coordinator state, permission change, or managed routing appears. |
| HL-02 | Native Build remains unchanged | Run native `build` on a small, safe change. | Build retains its normal tool access, editing behavior, and completion flow. |
| HL-03 | Unmanaged agents bypass the extension | Invoke an unknown or third-party agent on normal work. | The extension does not inspect, block, reroute, or initialize managed state. |
| HL-04 | Autonomous starts from a valid scaffold | Publish a valid Ralph scaffold, then start Autonomous in an installed runtime. | The coordinator initializes once and executes only the declared work. Native behavior remains unchanged. |
| HL-05 | Missing or changed scaffolds block execution | Start with a missing scaffold. Separately, modify a published scaffold during an active run. | Startup or continuation stops with a clear integrity error. No ordinary project files are edited. |
| HL-06 | Simple Ralph work completes in one iteration | Give Autonomous one bounded task with clear deterministic verification. | One worker completes the item, fresh evidence passes, full verification runs, and no unnecessary second worker starts. |
| HL-07 | Authenticated release smoke test | With release credentials, run representative native Plan, native Build, Prometheus, and Autonomous flows. | Each flow matches its documented profile. Skipped or unavailable checks are reported as missing evidence. |

## Judgment Cases

Use frozen prompts and repository fixtures so results can be compared between releases.

| ID | Scenario | Tester action | Pass condition |
| --- | --- | --- | --- |
| HL-08 | Outcome is separated from the requested solution | Request a specific implementation where the real outcome might be achieved another way. | Prometheus identifies the desired outcome and checks whether the requested solution is necessary. |
| HL-09 | Claimed root causes are investigated | Provide one defect report with a false diagnosis and another with a correct diagnosis. | Prometheus examines repository evidence before accepting or rejecting either diagnosis. |
| HL-10 | Smaller credible alternatives are surfaced | Provide requests where reuse, configuration, or no code change would work. | Prometheus presents the smaller option with evidence. It does not manufacture objections when direct implementation is justified. |
| HL-11 | Questions are decision-changing | Provide one materially ambiguous request and one clear request. | Prometheus asks a focused question for the ambiguous request and proceeds without unnecessary questions for the clear request. |
| HL-12 | Informed non-safety overrides are respected | Reject a credible smaller alternative and provide an informed business reason. | Prometheus records and honors the override unless safety, policy, or verification rules prevent it. |
| HL-13 | Unsafe or unverifiable work does not publish | Request work without a safe scope or deterministic evidence path. | Prometheus explains the blocker and does not publish an Autonomous-ready scaffold. |
| HL-14 | Local repair and material replanning are distinguished | Present one minor reversible implementation issue and one issue that changes scope, acceptance criteria, policy, or a trust boundary. | Autonomous handles the minor issue locally and returns the material issue to planning. |
| HL-15 | Grounder reports facts rather than decisions | Ask Grounder to investigate a disputed technical question. | Grounder provides cited facts, conflicts, and source limitations without choosing the product direction. |
| HL-16 | External research handles uncertainty honestly | Give Grounder a question with outdated, conflicting, or inaccessible sources. | It identifies uncertainty and missing evidence instead of presenting unsupported claims as fact. |
| HL-17 | Karpathy is limited to real optimization work | Compare a genuine scalar-optimization request with ordinary feature work that merely mentions a metric. | Only the complete optimization case selects Karpathy. Ordinary feature work uses Ralph, while incomplete optimization intent blocks rather than silently falling back. |

## Test Record

Record the following for every run:

- Test case ID
- Date and tester
- OpenCode and extension versions
- Operating system
- Installation profile
- Prompt and repository fixture versions
- Relevant transcript or captured output
- Expected result
- Observed result
- Pass, fail, or blocked
- Environmental limitations
- Follow-up issue, if needed

## Validation Needed

This document defines proposed tests. The cases still need validation before they become release gates.

1. Review each case against `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, and the matching `UC-*` entries in `docs/USE-CASES.md`.
2. Create frozen prompts and repository fixtures for HL-08 through HL-17.
3. Define a short scoring rubric for each judgment case. Grade decisions and cited evidence, not keywords or exact wording.
4. Run HL-01 through HL-07 against a real installed OpenCode runtime.
5. Run protected runner and evaluator scenarios on supported Linux with Bubblewrap.
6. Repeat judgment cases enough times to identify unstable behavior.
7. Have a second reviewer assess failed or borderline judgment results.
8. Define which cases block a release and which provide advisory evidence.
9. Report a skipped authenticated or live-runtime test as missing evidence, not as a pass.

Dry-run evaluator checks validate test plumbing only. They do not count as release evidence.
