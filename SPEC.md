# Release-Contract Implementation

## Grounding

The project’s documented application outcome includes optional specialist
workflows with release evidence for skills, mutation checks, session auditing,
and Prometheus-to-Autonomous publication. Current implementation evidence
identifies concrete gaps:

- `tests/test_skill_coverage.py` and `tests/test_skill_pressure.py` target the
  nonexistent legacy `.opencode/skills` path, and the coverage suite imports a
  missing validator. These checks are absent from `scripts/ci.sh`.
- `evals/mutation/run_mutation.py` does not run its unmutated baseline. A failing
  test command therefore marks every mutant as killed and can return a passing
  score. `opencode-mutation.json` is present but has no runtime effect.
- `tests/audit_run.py` marks every root-session Bash call as a Prometheus
  violation after any Prometheus switch, even when a later agent made the call.
  It has no fixture coverage for its verdicts or missing-data behavior.
- `evals/seed_build/test_planning.py` requires only `SPEC.md`; it does not prove
  automatic publication of `opencode-autonomous.json` or structural validation.
- `docs/TEST-PLAN.md` retains a duplicate deferred Scaffold Publication block.

The mandatory Prometheus publication prompt is installed, but text matching is
not behavioral evidence. The release must test the output artifacts produced in
a frozen planning workspace.

## Approaches Considered

### Selected: Implement deterministic release contracts

Repair the broken deterministic checks, make mutation policy operational,
eliminate audit misattribution, and extend the existing frozen planning harness
to verify both scaffold artifacts. This closes correctness gaps while keeping
live model-pressure checks optional rather than making credentials a CI
requirement.

### Rejected: Documentation-only release

Kill reason: documentation accurately records the gaps but cannot prevent a
false passing mutation score, validate shipped skill assets, or demonstrate
automatic scaffold publication.

## Acceptance Criteria

- Skill validation reads packaged `skills/`, validates every installed skill in
  a temporary deployment, rejects malformed frontmatter/content, and runs as a
  deterministic CI gate without model credentials.
- Managed-agent integration coverage proves a loaded skill cannot widen edit or
  command permissions; direct-model pressure checks remain optional evidence.
- The mutation runner first executes the unmutated test command. A failing
  baseline writes a machine-readable invalid/error result and exits nonzero
  without reporting a passing mutation score.
- `opencode-mutation.json` becomes a validated, documented operative policy
  input with explicit CLI override behavior, or is removed with all references
  updated so no dead configuration remains.
- Audit verdicts do not attribute a tool call to Prometheus without a matching
  active-agent interval. Fixture tests cover normal, malformed, and missing-data
  database cases and every documented verdict.
- The frozen planning harness requires both `SPEC.md` and
  `opencode-autonomous.json`, validates their structural agreement when the tool
  is available, and fails planning-ready runs that omit either artifact.
- `scripts/ci.sh` runs the deterministic skill, mutation, audit, and planning
  checks. Documentation and test-plan rows match the resulting behavior, with a
  single canonical Scaffold Publication section.

## Verification

- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" tests/verify_opencode.py --skip-llm`
- `node --test tests/plugins/*.test.mjs tests/integration/*.test.mjs`
- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" -m unittest discover -s evals/mutation/tests -p 'test_*.py'`
- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" tests/test_skill_coverage.py --skip-llm`
- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" -m unittest discover -s tests -p 'test_audit_run.py'`
- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" evals/seed_build/test_planning.py --dry-run`
- `bash scripts/ci.sh`
- `git diff --check`

## Implementation Checklist

- [ ] Replace legacy-path skill checks with packaged/deployed-skill validation and add deterministic managed-agent boundary coverage.
- [ ] Add mutation baseline gating, operative policy configuration or remove the dead configuration, and regression tests for both decisions.
- [ ] Make audit reporting timeline-aware or explicitly non-attributable, then add SQLite fixture coverage for all outcomes.
- [ ] Extend frozen Prometheus planning evaluation to require and structurally validate both published scaffold artifacts.
- [ ] Add deterministic release checks to CI and consolidate duplicate documentation test-plan coverage.
- [ ] Update durable documentation for the implemented release contracts and run every declared verification command.

Invoke @autonomous to execute SPEC.md.
