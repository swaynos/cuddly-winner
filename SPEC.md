# Documentation Evidence-Accuracy Correction

## Grounding

The pending documentation adds a docs index and records skills, mutation
testing, and session auditing as durable project behavior. Repository evidence
shows several claims need narrowing before those docs can be trusted:

- `tests/audit_run.py` reports signals for a selected root session and direct
  children; it does not validate scaffolds, recurse through descendants, or
  prove fresh verification-command execution.
- `evals/mutation/run_mutation.py` requires CLI inputs and does not read
  `opencode-mutation.json`; `evals/mutation/tests/` tests the runner itself.
- `tests/test_skill_coverage.py` and `tests/test_skill_pressure.py` currently
  target `.opencode/skills`, while packaged skills are under `skills/`; direct
  model prompting does not prove managed-agent permission enforcement.
- `docs/TEST-PLAN.md` currently duplicates the Scaffold Publication section and
  `TP-PUB-03`.

Measured planning prerequisite: spike `docs-verification-env` ran
`PYTHON="$(bash ../../scripts/ensure-venv.sh)" && test -x "$PYTHON" && printf '%s\n' "$PYTHON"`
from `.spike/docs-verification-env`. It exited 0 and printed
`/Users/jpswaynos/.pyenv/versions/cuddly-winner/bin/python3`; its kill criterion
did not fail. The spike was native (`sandboxed: false`).

`scaffold_gitignore` reported that `SPEC.md` is already tracked; exclusion does
not untrack it.

## Approaches Considered

### Selected: Documentation-only evidence correction

Revise the durable docs and README to state the implemented limits of the audit,
mutation, and skill-validation tooling; remove the duplicated test-plan section;
and keep the validation list limited to executable, meaningful commands. This
meets the requested documentation focus without changing the codebase’s behavior
or disguising missing evidence as validation.

## Acceptance Criteria

- README provides a useful docs index and does not present the legacy-path skill
  scripts as release-validation commands.
- Architecture, requirements, use cases, and testing methodology describe the
  session auditor as an investigative, limited-signal report rather than proof
  of policy enforcement, scaffold validity, or fresh verification execution.
- Mutation documentation states that the runner takes explicit CLI arguments and
  does not consume `opencode-mutation.json`.
- Skills documentation distinguishes the packaged `skills/` source from the
  legacy `.opencode/skills` test target and does not claim direct-model tests
  prove managed-agent boundaries.
- `docs/TEST-PLAN.md` has one Scaffold Publication section and one `TP-PUB-03`.
- No production code, tests, agent prompts, deployment scripts, or configuration
  files are modified for this task.

## Verification

- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" tests/verify_opencode.py --skip-llm`
- `node --test tests/plugins/*.test.mjs tests/integration/*.test.mjs`
- `git diff --check`

## Implementation Checklist

- [ ] Update `README.md` documentation navigation and validation guidance to avoid unsupported skill-validation claims.
- [ ] Correct audit, mutation, and skills descriptions in architecture, requirements, use cases, and testing methodology.
- [ ] Reconcile test-plan expectations with actual evidence limits and remove duplicate Scaffold Publication coverage.
- [ ] Review the documentation diff for clarity, cross-document consistency, and preservation of the documentation-only scope.
- [ ] Run every declared verification command and report exact outcomes.

Invoke @autonomous to execute SPEC.md.
