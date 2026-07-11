# Workflow Rules Engine

## Grounding

Build a dependency-free Python decision engine in `rules_engine.py`. The frozen
acceptance suite is available under `.oracle_readonly/acceptance/` and defines
authorization ordering, deterministic matching, validation, and side-effect
constraints. UI, persistence, networking, and integrations are out of scope.

## Approaches Considered

### Selected: Pure typed rules-engine module

Implement dataclasses, typed exceptions, centralized condition evaluation, and a
pure `evaluate` function in one module. This is deterministic and directly
testable against the frozen acceptance suite.

### Rejected: Full service with API and persistence

This adds unrelated deployment, network, and storage behavior. Kill reason: it
cannot improve the frozen decision-layer acceptance score and creates prohibited
side effects.

### Rejected: Dynamic expression evaluation

Using `eval` or arbitrary callbacks would reduce implementation size. Kill
reason: it weakens validation, determinism, and security boundaries.

## Acceptance Criteria

1. `evaluate(trigger, user_context, rules)` returns `Action` objects for every
   matching rule and excludes non-matching rules.
2. Authorization is checked for all rules before any condition is evaluated.
3. Mixed or incorrect ownership raises `AuthorizationError`.
4. Missing or malformed trigger fields raise `ValidationError`.
5. Unknown condition and action types raise their dedicated typed exceptions.
6. Condition evaluation is centralized and supports event equality, payload
   equality, and numeric greater-than matching. Condition data uses
   `{"value": <event_type>}` for `event_type_matches` and
   `{"field": <payload key>, "value": <comparison value>}` for both
   `payload_field_equals` and `payload_field_gt`; greater-than compares
   `trigger.payload[field] > condition_data["value"]`.
7. Evaluation performs no filesystem or network side effects.
8. Public functions are typed and use only the Python standard library.
9. Export these dataclasses with these constructor fields:
   `TriggerEvent(event_type: str, payload: dict)`, `UserContext(user_id: str)`,
   `Condition(condition_type: str, parameters: dict)`,
   `ActionSpec(action_type: str, parameters: dict)`,
   `Rule(rule_id: str, owner_id: str, condition: Condition, action: ActionSpec)`,
   and `Action(action_type: str, parameters: dict, rule_id: str)`.
10. Export `AuthorizationError`, `ValidationError`, `UnknownConditionError`,
    and `UnknownActionError`, plus
    `evaluate(trigger: TriggerEvent, user_context: UserContext, rules: list[Rule]) -> list[Action]`.

## Verification

- `python3 -c 'import ast, pathlib; ast.parse(pathlib.Path("rules_engine.py").read_text())'`
- `PYTHONDONTWRITEBYTECODE=1 RULES_ENGINE_PATH=rules_engine.py python3 -m unittest discover -s .oracle_readonly/acceptance -p 'test_*.py' -v`

## Implementation Checklist

- [ ] Define all six typed dataclasses with the exact constructor fields above.
- [ ] Define authorization, validation, unknown-condition, and unknown-action exceptions.
- [ ] Implement authorization checks before condition evaluation.
- [ ] Implement trigger validation.
- [ ] Centralize supported condition evaluation in one helper.
- [ ] Validate and resolve action specifications.
- [ ] Implement the pure `evaluate` composition.
- [ ] Run every exact verification command through the trusted runner.
- [ ] Report the selected direct strategy and results; durable state belongs to the supervisor.

Invoke @autonomous to execute SPEC.md.
