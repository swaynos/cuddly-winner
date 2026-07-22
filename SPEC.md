# Lightweight Specialist Workflow Rollout

## Grounding

The project should preserve Prometheus as the planning owner and Autonomous as
the implementation owner without building a second command sandbox or
orchestration platform on top of OpenCode. User approval and OpenCode auto mode
must govern native command execution.

## Approaches Considered

### Selected: Native OpenCode permissions with a contracted spike helper

Prometheus receives an approval-gated, bounded, explicitly unsandboxed spike
tool while direct Bash remains denied. Autonomous receives approval-gated native
Bash. Fixed edit-tool immutability remains.

### Rejected: Cross-platform protected runner

Kill reason: Bubblewrap, Lima, provenance storage, and a custom supervisor add a
second runtime and security model that exceeds the intended extension boundary.

### Rejected: Direct Prometheus Bash

Kill reason: unrestricted shell access obscures the distinction between focused
measured investigation and general implementation.

## Acceptance Criteria

1. No Bubblewrap, Lima, protected runner, or supervisor remains in runtime, setup, CI, or durable documentation.
2. Prometheus can run contracted native spikes with `ask` permission and cannot use Bash directly.
3. Autonomous uses native Bash with `ask`; OpenCode `--auto` may approve asks while explicit denies remain.
4. Static scaffold and Git exclusion helpers remain available under `--with-workflow-tools`.
5. Native Plan/Build and unmanaged agents remain unchanged.
6. Ralph remains the ordinary default; Karpathy remains read-only strategy advice for explicit scalar optimization.
7. Deployment is additive from one config root and safely removes only current matching entries.

## Verification

- `node --test tests/plugins/*.test.mjs tests/integration/*.test.mjs`
- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" tests/verify_opencode.py --skip-llm`
- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" -m unittest discover -s evals/mutation/tests -p 'test_*.py'`
- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" evals/seed_build/test_planning.py --dry-run`
- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" evals/seed_build/test_build.py --dry-run`

## Implementation Checklist

- [ ] Replace the protected runner with the native contracted spike tool.
- [ ] Remove supervisor and protected-evidence behavior.
- [ ] Update managed-agent permissions and prompts.
- [ ] Keep `--with-workflow-tools` additive and simplify installer configuration to one root.
- [ ] Update durable docs, examples, evaluations, and tests.
- [ ] Run all verification commands and inspect the final diff.

Invoke @autonomous to execute SPEC.md.
