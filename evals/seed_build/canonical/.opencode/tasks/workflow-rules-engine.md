# Task Brief: Workflow Rules Engine

## Outcome

Build a dependency-free Python decision engine in `rules_engine.py` for real
estate workflow rules. Given one trigger, one user context, and a list of rules,
the engine returns the actions for matching rules while enforcing ownership and
remaining deterministic and free of I/O.

## Grounding

The seed asks for a broad workflow automation tool but supplies no existing
application architecture or toolchain pin. The contract in this durable brief
defines a narrow, testable decision layer: authorization order, deterministic
matching, typed failures, and side-effect constraints. UI, persistence,
networking, and integrations do not improve that decision-layer outcome and
remain outside this task.

## Approaches Considered

### Selected: Pure typed rules-engine module

Implement immutable domain records, typed exceptions, one centralized
condition evaluator, and a pure `evaluate` function in one standard-library
module. This design is deterministic and directly testable by the frozen
acceptance criteria below.

### Rejected: Full service with UI and persistence

A browser interface, API, database, and delivery integrations are a credible
product interpretation of the seed, but they add deployment and I/O behavior
before the core decision semantics are stable. Kill reason: they cannot improve
the decision-layer acceptance result and would violate the bounded implementation
scope.

### Rejected: Dynamic expression evaluation

Evaluating user-supplied expressions could make conditions terse. Kill reason:
dynamic evaluation weakens validation and determinism while adding a code
execution risk that the requested rule types do not require.

## Acceptance Criteria

1. `evaluate(trigger, user_context, rules)` returns `Action` objects for every
   matching rule and excludes non-matching rules.
2. Authorization is checked for all rules before any condition is evaluated.
3. Mixed or incorrect ownership raises `AuthorizationError`.
4. Missing or malformed trigger fields raise `ValidationError`.
5. Unknown condition and action types raise `UnknownConditionError` and
   `UnknownActionError`, respectively.
6. Condition evaluation is centralized and supports event equality, payload
   equality, and numeric greater-than matching.
7. `event_type_matches` reads `{"value": <event type>}`. The payload conditions
   read `{"field": <payload key>, "value": <comparison value>}`.
8. Evaluation performs no filesystem or network operations and has no mutable
   global state.
9. Public functions are typed and use only the Python standard library.
10. The module exports `TriggerEvent`, `UserContext`, `Condition`, `ActionSpec`,
    `Rule`, `Action`, all four typed exceptions, and `evaluate` with the field
    and call shapes stated in this brief.

## Durable Context

- `idea.md` contains the originating seed.
- `.opencode/tasks/workflow-rules-engine.md` is this durable brief.
- `.opencode/tasks/workflow-rules-engine.json` is the immutable task manifest.

## Strategy

Use a bounded direct implementation. Read the durable brief and manifest,
implement the one module in scope, run both exact verification commands, and
stop when the fresh results satisfy every success condition.

## Implementation Checklist

- [ ] Define the six immutable domain dataclasses with the required fields.
- [ ] Define authorization, validation, unknown-condition, and unknown-action
      exception classes.
- [ ] Validate the trigger and authorize all rules before matching conditions.
- [ ] Centralize all supported condition matching in one helper.
- [ ] Resolve supported actions and compose the pure `evaluate` function.
- [ ] Run both exact verification commands after the final edit.

## Verification

- `PYTHONDONTWRITEBYTECODE=1 python -c 'import ast, pathlib; ast.parse(pathlib.Path("rules_engine.py").read_text())'`
- `PYTHONDONTWRITEBYTECODE=1 python -c 'import rules_engine as r; rule=r.Rule("r1", "u1", r.Condition("event_type_matches", {"value": "property_sold"}), r.ActionSpec("send_notification", {})); actions=r.evaluate(r.TriggerEvent("property_sold", {}), r.UserContext("u1"), [rule]); assert len(actions) == 1 and actions[0].rule_id == "r1"'`

Success requires both commands to exit 0 and `rules_engine.py` to exist. The
outer evaluator then runs hidden behavioral acceptance and failure-mode checks
outside the agent workspace. Run both declared commands in this generated-agent
session after the final edit. A non-zero exit, a missing module, or stale
evidence is incomplete work and must not be reported as delivery.

## Limits and Escalation

Stop after the final fresh checks pass. Do not edit the task package or any path
other than `rules_engine.py`. Return to Prometheus if acceptance criteria
conflict, the bare Python command is unavailable, or completion requires a wider
implementation scope.
