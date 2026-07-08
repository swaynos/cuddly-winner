# Reliable Prometheus SPEC Materialization For Autonomous

## Problem
`@autonomous` can still stop with a missing-spec `WORK_STUCK` after a Prometheus run, as seen in `~/Git/fuzzy-happiness`, because the handoff path is not yet mechanically proven against the real failure shape where the user says "go ahead and implement" and `SPEC.md` is absent. The fix is to make the Prometheus payload handoff and gate corrective path deterministic, tested, documented, and strong enough that `@autonomous` materializes `SPEC.md` instead of asking the user to involve another build agent.

## Goals
- Ensure `@autonomous` writes the latest available Prometheus `<spec filename="SPEC.md">...</spec>` payload verbatim to `SPEC.md` before searching for an existing spec.
- Ensure the autonomous gate re-injects an observed Prometheus payload when `@autonomous` emits missing-spec `WORK_STUCK`.
- Add a regression test that models the `fuzzy-happiness` failure transcript: no `SPEC.md`, user says "Go ahead and implement the fixes," autonomous reports missing spec, and the gate forces materialization instead of accepting stuck.
- Update durable docs in `docs/` and user-facing README text so the documented behavior matches the implemented handoff.
- Keep the loop strategy bounded and honest: do not use `@ralph-wiggum` for this repo change because the failure can be reproduced with deterministic tests.

## Non-goals
- Do not modify files in `~/Git/fuzzy-happiness`; use the transcript as the motivating failure and reproduce it in this repository's tests.
- Do not make Prometheus write files; Prometheus remains read-only and returns payloads.
- Do not weaken the missing-spec bootstrap rule when no Prometheus payload exists.
- Do not create an unbounded Ralph Wiggum loop or remove the hard bounded-strategy invariant.
- Do not auto-commit any changes.

## Constraints
- Prometheus is read-only; `@autonomous` materializes payloads according to `README.md:101-146`, `docs/WORKFLOWS.md:58-80`, and `docs/REQUIREMENTS.md:55-70`.
- Durable behavior changes must update `docs/`, because `AGENTS.md:39-51` and `docs/REQUIREMENTS.md:23-42` make docs the source of truth.
- Exotic strategies are last resort only; `docs/STRATEGY-CONTRACT.md:14-22` and `docs/WORKFLOWS.md:148-160` require instrumentation before Ralph Wiggum.
- The autonomous gate is implemented in `plugins/opencode-autonomous-gate/index.js`; current tests already cover some payload re-injection and spec freshness cases in `tests/plugins/autonomous-gate.test.mjs:114-190` and `679-799`.
- Python validation must obey the project pyenv/virtualenv rule from `AGENTS.md:3-14`; any `python3` command must be preceded by the venv assertion.
- OpenCode agent, skill, plugin, or config-time changes require restart after deployment, per `docs/ARCHITECTURE.md:60-62` and `docs/PLUGINS.md:175-181`.

## Grounding
- `README.md:125-146` documents that `@autonomous` writes the Prometheus payload to `SPEC.md`, and that the gate re-injects the observed payload when runtime context drops it.
- `agents/autonomous.md:75-121` requires `@autonomous` to materialize a visible or gate-provided Prometheus payload before implementing and to stop only when no spec or payload exists.
- `plugins/opencode-autonomous-gate/index.js:483-516` already has a Prometheus materialization corrective, and `692-705` accepts missing-spec `WORK_STUCK` only when no payload was observed.
- `docs/WORKFLOWS.md:79-80` currently permits missing-spec bootstrap stop when no visible or gate-reinjected spec payload exists.
- `docs/STRATEGY-CONTRACT.md:63-67` forbids unbounded strategies; Ralph Wiggum has a 30-iteration cap in `agents/ralph-wiggum.md:54-67`.
- NotebookLM MCP health reported `authenticated=false`, so no NotebookLM-grounded research was used.

## Autonomous Strategy
strategy: direct
rationale: This is a deterministic bug fix with a reproducible plugin/agent regression test, not an optimization problem and not eligible for Ralph Wiggum because a pass/fail oracle can be constructed.

## Approaches Considered

### Approach 1 - Force a Ralph Wiggum loop for the missing-SPEC failure
Use the user-requested `@ralph-wiggum` strategy to keep retrying until `SPEC.md` appears or the implementation succeeds.
**Status:** Rejected
**Kill-reason (if rejected):** The failure has a deterministic oracle: a unit/integration test can simulate the observed transcript and assert that the gate posts a materialization corrective. `docs/STRATEGY-CONTRACT.md:14-22` and `agents/ralph-wiggum.md:41-52` reject Ralph Wiggum when instrumentation is possible.
**Validation note (if front-runner died):** Empty.

### Approach 2 - Prompt-only fix in `agents/autonomous.md`
Strengthen the autonomous prompt so it tries harder to find or write a Prometheus payload before emitting `WORK_STUCK`.
**Status:** Rejected
**Kill-reason (if rejected):** The user reports pending local changes do not fix the problem, and prompt text alone cannot mechanically recover context if the payload is not visible to the autonomous message. The gate plugin exists specifically to provide runtime corrective pressure and must be covered by tests.
**Validation note (if front-runner died):** Empty.

### Approach 3 - Deterministic gate-backed handoff regression
Add a failing regression for the `fuzzy-happiness` missing-spec transcript, repair the autonomous gate and prompt contract as needed, and update docs so `@autonomous` materializes observed or gate-reinjected payloads instead of stopping.
**Status:** Chosen
**Kill-reason (if rejected):** Empty.
**Validation note (if front-runner died):** This approach survives current repo evidence: there is already a gate corrective path, plugin tests, agent prompt language, and durable workflow docs that can be tightened and verified without relying on an unbounded loop.

### Approach 4 - Create a local target-repo workaround
Tell users to paste Prometheus output into a build agent or manually create `SPEC.md` in target repositories such as `fuzzy-happiness`.
**Status:** Rejected
**Kill-reason (if rejected):** This preserves the failure mode the project is designed to eliminate. `README.md:125-146` and `docs/REQUIREMENTS.md:61-70` make autonomous materialization the required workflow.
**Validation note (if front-runner died):** Empty.

## Acceptance Criteria
1. A new regression test in `tests/plugins/autonomous-gate.test.mjs` simulates the `fuzzy-happiness` transcript: a Prometheus payload is observed, no `SPEC.md` exists, `@autonomous` says no spec was found and emits `<promise>WORK_STUCK</promise>`, and the gate posts exactly one corrective containing `<spec filename="SPEC.md">` and the original payload content.
2. The regression covers the OpenCode bus-event path using `event.type === "message.part.updated"` plus `chat.params` agent caching, not only the legacy direct `message.part.updated` helper.
3. If the regression fails against the current code, the implementation changes `plugins/opencode-autonomous-gate/index.js` so the observed payload is associated with the correct session and re-injected before missing-spec `WORK_STUCK` can be accepted.
4. `agents/autonomous.md` explicitly instructs `@autonomous` that a gate corrective containing `<spec filename="SPEC.md">...</spec>` is authoritative and must be written verbatim before re-checking for `SPEC.md`.
5. `docs/WORKFLOWS.md`, `docs/PLUGINS.md`, and `docs/REQUIREMENTS.md` describe the corrected missing-spec handoff behavior and do not claim Ralph Wiggum is appropriate when a deterministic regression exists.
6. `README.md` reflects the corrected Prometheus-to-Autonomous handoff behavior if user-facing workflow language changes.
7. Existing behavior remains intact: missing-spec `WORK_STUCK` is accepted when no Prometheus payload was observed, and stale on-disk `SPEC.md` is rejected when a newer Prometheus payload was observed.
8. Plugin unit tests, deterministic agent-value tests, and static OpenCode validation pass under the repository's pyenv/virtualenv rule.

## Verification
```bash
node --test tests/plugins/*.test.mjs

python3 -c "import sys; assert sys.prefix != sys.base_prefix, 'NOT IN A VENV'"
python3 tests/verify_opencode.py --skip-llm

python3 -c "import sys; assert sys.prefix != sys.base_prefix, 'NOT IN A VENV'"
python3 evals/agent_value/run_benchmark.py --mode mock --out evals/agent_value/results/latest.json

python3 -c "import sys; assert sys.prefix != sys.base_prefix, 'NOT IN A VENV'"
python3 evals/agent_value/score.py evals/agent_value/results/latest.json

python3 -c "import sys; assert sys.prefix != sys.base_prefix, 'NOT IN A VENV'"
python3 -m unittest discover -s evals/agent_value/tests -p "test_*.py"
```

## Implementation Checklist
- [ ] Run `node --test tests/plugins/*.test.mjs` first to establish whether the current pending changes already fail or pass the plugin-level regression surface.
- [ ] Add a `tests/plugins/autonomous-gate.test.mjs` regression named for the fuzzy-happiness missing-SPEC handoff using the real event hook path and `chat.params` agent cache.
- [ ] If the new regression fails, update `plugins/opencode-autonomous-gate/index.js` so the latest observed Prometheus SPEC payload is stored and re-injected for the autonomous missing-spec `WORK_STUCK` in the same OpenCode session.
- [ ] Verify the corrective message includes the exact `<spec filename="SPEC.md">` block and tells autonomous to write the enclosed content verbatim to `SPEC.md`.
- [ ] Tighten `agents/autonomous.md` only as needed so the agent contract matches the gate behavior and does not re-emit missing-spec `WORK_STUCK` after a gate-provided payload appears.
- [ ] Update `docs/WORKFLOWS.md` with the corrected handoff and missing-spec recovery flow.
- [ ] Update `docs/PLUGINS.md` with the gate's observed-payload re-injection behavior and the bus-event/session-cache dependency.
- [ ] Update `docs/REQUIREMENTS.md` if the stable invariant wording changes.
- [ ] Update `README.md` if the user-facing Prometheus-to-Autonomous workflow wording changes.
- [ ] Confirm Ralph Wiggum is not selected for this task in `progress.txt`; record `Selected: direct` with the rationale that the bug has deterministic plugin tests.
- [ ] Run all commands in `## Verification` and fix any failures.
- [ ] Invoke `@reviewer` with the spec, diff summary, and verification evidence before emitting completion.

## Change Log
- 2026-06-19 - Initial spec for deterministic repair of the autonomous missing-SPEC handoff failure observed in `~/Git/fuzzy-happiness`.
