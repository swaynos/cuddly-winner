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

The project virtual-environment preflight passed before verification. Session
spike evidence is disposable and is not retained in this scaffold.

The follow-on implementation backlog is recorded here but is outside this
scaffold's implementation scope:

1. Rebuild skill validation to target packaged `skills/`, validate deployed
   skills, and exercise managed-agent permission and identity boundaries.
2. Rebuild the session auditor if it must certify recursive ancestry, complete
   tool history, scaffold validity, and fresh final-verification execution.
3. Either make `opencode-mutation.json` an input to the mutation runner or
   replace it with a supported CLI-only policy mechanism.
4. Add recorded SQLite fixtures for every documented audit verdict, including
   `NOT_SELECTED` and missing-data errors.

Prometheus publication investigation: the installed runtime copy of
`agents/prometheus.md` matches this repository and already describes a
publication sequence. It does not, however, explicitly make publication a
precondition of every successful planning response. This ambiguity permits a
planning response to end after analysis without writing the scaffold. The
correction is a mandatory publication gate, documented and statically checked.

## Approaches Considered

### Selected: Documentation-only evidence correction

Revise the durable docs and README to state the implemented limits of the audit,
mutation, and skill-validation tooling; remove the duplicated test-plan section;
keep the validation list limited to executable, meaningful commands; and make
automatic scaffold publication a mandatory Prometheus completion gate. This
preserves the project’s optional-agent boundary while preventing a completed
Prometheus planning response from ending without `SPEC.md` and
`opencode-autonomous.json`.

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
- The Prometheus prompt requires a planning-ready run to publish and statically
  validate the scaffold before its final response, without asking the user for a
  separate publication request.
- Durable requirements, architecture, use cases, and the static verification
  test describe and retain that publication gate.
- No runtime product source, deployment scripts, or configuration files are
  modified for this task.

## Verification

- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" tests/verify_opencode.py --skip-llm`
- `node --test tests/plugins/*.test.mjs tests/integration/*.test.mjs`
- `git diff --check`

## Implementation Checklist

- [ ] Update `README.md` documentation navigation and validation guidance to avoid unsupported skill-validation claims.
- [ ] Correct audit, mutation, and skills descriptions in architecture, requirements, use cases, and testing methodology.
- [ ] Reconcile test-plan expectations with actual evidence limits and remove duplicate Scaffold Publication coverage.
- [ ] Add and document the mandatory Prometheus publication gate, plus a static regression check for the prompt contract.
- [ ] Review the documentation diff for clarity, cross-document consistency, and preservation of the documentation-only scope.
- [ ] Run every declared verification command and report exact outcomes.

Invoke @autonomous to execute SPEC.md.
