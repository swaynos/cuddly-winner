# Preserve Native Plan/Build and Make Specialist Agents Optional

## Grounding

The project began as an optional Karpathy-style optimization extension and later
added planning, autonomous execution, review, and research agents. Its global
deployment and immutability hooks accidentally turned those additions into a
replacement workflow: repository-specific rules rerouted ordinary work, and the
global plugin restricted built-in Build even when no optional workflow had been
selected.

The durable product goal is augmentation. OpenCode's built-in Plan and Build are
the default workflow and must continue working exactly as shipped. The agents
introduced by this project are optional specialists with their own bounded role
defaults. Autonomous runner and supervisor behavior is a separately installed
profile.

## Approaches Considered

### Selected: Identity-Scoped Optional Profiles

Apply fixed immutability defaults only after resolving one of the six identities
introduced by this project. Bypass native Plan, native Build, unknown identities,
and third-party agents before inspecting tools or paths. Keep the Autonomous
supervisor and runner behind an explicit deployment option.

This preserves useful specialist behavior without coupling normal OpenCode work
to a SPEC, sandbox, supervisor, or custom completion protocol.

### Rejected: Project Marker Activates Global Enforcement

Using `opencode-immutable.json` as the initial activation boundary would still
allow project configuration to alter native Plan/Build behavior and would mix
two decisions: selecting a specialist agent and defining project-specific path
rules. Project overrides are deferred until their semantics are deliberately
designed.

### Rejected: Replace Plan and Build With Prometheus and Autonomous

Prometheus and Autonomous provide a high-rigor optional profile, not aliases for
OpenCode's built-in modes. Universal routing adds friction to ordinary work and
causes unsupported platforms or missing custom tools to break unrelated tasks.

## Acceptance Criteria

1. Built-in `plan` and `build` retain native prompts, Bash access, mutation
   tools, and completion behavior after default installation.
2. Repository `AGENTS.md` is not installed globally and contains no instruction
   to redirect ordinary planning or implementation.
3. Immutability applies only to `ask`, `prometheus`, `autonomous`, `karpathy`,
   `reviewer`, `grounder`, and descendants of those managed identities.
4. Unresolved, built-in, future built-in, and third-party identities bypass the
   immutability hook before command or path inspection.
5. Prometheus may mutate only root `SPEC.md` and `.spike/**`; Autonomous may edit
   normal project files but not trusted control-plane state; Ask, Karpathy,
   Reviewer, and Grounder are read-only.
6. `opencode-immutable.json` remains a clearly labelled unused placeholder. The
   current runtime never reads it, and documentation warns that it provides no
   protection today.
7. The supervisor initializes only for top-level Autonomous sessions. Native
   Plan and Build never create supervisor state or require runner evidence.
8. Checklist boxes are planning aids rather than completion state. Autonomous
   does not rewrite the SPEC or write protected progress files.
9. Free-form message text and synthetic events without a production emitter do
   not drive supervisor state.
10. Karpathy is consistently a read-only strategist; Autonomous owns edits.
11. Default deployment uses copy mode, installs optional agents and their
    identity-scoped immutability defaults, and omits global rules, supervisor,
    runner, and non-core skills.
12. `--with-autonomous` installs the supervisor, runner, and pinned runtime
    dependency. `--with-skills` installs non-core skills.
13. Deployment removes obsolete managed links for deleted agents, split
    supervisor plugins, old global rules, and deselected optional components.
14. README, durable requirements, architecture, examples, deployment help, and
    tests lead with the augmentation goal and native Plan/Build compatibility.
15. Validation separates native compatibility, managed-agent defaults,
    Autonomous profile behavior, and optional evaluators.

## Verification

- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" tests/verify_opencode.py --skip-llm`
- `node --test tests/plugins/*.test.mjs tests/integration/*.test.mjs`
- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" -m unittest discover -s evals/mutation/tests -p 'test_*.py'`
- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" evals/seed_build/test_planning.py --dry-run`
- `PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" evals/seed_build/test_build.py --dry-run`
- `bash scripts/ci.sh`

## Implementation Checklist

- [x] Define native Plan/Build compatibility as the primary product invariant.
- [x] Remove global routing from repository rules and default deployment.
- [x] Scope immutability to explicit managed identities and inherited descendants.
- [x] Add native, unknown, third-party, managed-role, descendant, and alias tests.
- [x] Remove runtime handling of `opencode-immutable.json` and label it as a placeholder.
- [x] Keep supervisor lifecycle exclusive to explicitly invoked Autonomous runs.
- [x] Remove checklist/progress deadlocks and unreachable synthetic control events.
- [x] Make Karpathy consistently read-only and Autonomous the sole profile editor.
- [x] Split default, Autonomous, and skills deployment profiles.
- [x] Rewrite README, durable docs, examples, deployment guidance, and validation.
- [x] Run every verification command and resolve deterministic failures.
- [x] Install the corrected default profile and confirm stale global routing is removed.

## Review Feedback

No final advisory review has been performed. Native compatibility tests and the
documented profile boundaries are the deterministic authority for this change.
