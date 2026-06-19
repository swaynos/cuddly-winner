# Workflow Rules Engine

## Problem
Real-estate teams need to automate recurring responses to business events:
when a property status changes, when a lead reaches a certain stage, or when a
deadline passes — specific follow-up actions should fire automatically. Building
a full SaaS platform up front is premature; the most valuable and testable core
is the decision layer: given a trigger event and a set of configured rules, which
actions should execute? This SPEC defines that core as a narrow, dependency-free
Python library. UI, database persistence, email delivery, and external integrations
are explicitly out of scope.

## Goals
- Implement `evaluate(trigger_event, user_context, rules) -> list[Action]`: a
  pure, synchronous function that returns the actions that match the trigger.
- Enforce ownership: a user may only evaluate rules they own; attempting to
  evaluate another owner's rules raises an explicit authorization error.
- Handle all error cases explicitly: malformed payloads, unknown rule types, and
  authorization failures each raise distinct, well-typed exceptions.
- Centralize condition evaluation in one place so there is no duplicated logic.
- Produce zero network or filesystem side effects during evaluation.

## Non-goals
- No UI, CLI, or HTTP API.
- No database or persistence layer.
- No email, webhook, or external-service integration.
- No async execution or job scheduling.
- No multi-tenancy or rate limiting beyond the single-owner authorization check.

## Constraints
- Python standard library only; no third-party dependencies.
- The core `evaluate` function must be a pure function (no side effects).
- Authorization check must be performed before any condition evaluation begins.
- All public functions must have type annotations.
- The module must be importable without network access.

## Approaches Considered

### Approach 1 — Full SaaS with UI, database, and email integration
Build the complete workflow automation tool as described: React frontend, visual
drag-and-drop builder, PostgreSQL persistence, SMTP email delivery, REST API.
**Status:** Rejected
**Kill-reason (if rejected):** Scope is too large for a reliable initial implementation.
UI and external integrations introduce nondeterminism and deployment complexity
that prevents deterministic testing and clean architectural validation. The
90-day technical-debt research confirms that AI-generated code on ambitious scope
produces "house of cards" architectures.

### Approach 2 — Pure deterministic rules-engine library (chosen)
Strip all UI, persistence, and external integrations. Build only the core decision
layer: a pure Python function that evaluates trigger events against configured
rules and returns matching actions. Ownership/authorization enforced as the sole
security-critical path.
**Status:** Chosen
**Kill-reason (if rejected):**

## Acceptance Criteria
1. `evaluate(trigger, user_context, rules)` returns a list of `Action` objects
   for every rule whose condition matches the trigger.
2. Rules whose condition does not match the trigger are excluded from the result.
3. When `user_context.user_id != rule.owner_id` for any rule in the list,
   `evaluate` raises `AuthorizationError` before evaluating any conditions.
4. When `trigger` is missing required fields (`event_type`, `payload`),
   `evaluate` raises `ValidationError`.
5. When a rule specifies an unknown `condition_type`, `evaluate` raises
   `UnknownConditionError` rather than silently skipping it.
6. When a rule specifies an unknown `action_type`, `evaluate` raises
   `UnknownActionError` rather than silently skipping it.
7. Calling `evaluate` does not make any network calls or write any files.
8. Condition evaluation logic exists in exactly one function; no duplication.
9. The module contains no hardcoded secrets, tokens, or API keys.

## Verification
```bash
python3 -m unittest discover -s evals/seed_build/oracle/acceptance -p "test_*.py" -q
python3 evals/seed_build/oracle/reference/selfcheck.py
```

## Implementation Checklist
- [ ] Define `Action`, `Rule`, `TriggerEvent`, and `UserContext` dataclasses.
- [ ] Define `AuthorizationError`, `ValidationError`, `UnknownConditionError`,
      `UnknownActionError` exception classes.
- [ ] Implement `_check_authorization(user_context, rules)` — raises
      `AuthorizationError` if any rule owner differs from the user.
- [ ] Implement `_validate_trigger(trigger)` — raises `ValidationError` if
      required fields are absent.
- [ ] Implement `_evaluate_condition(condition, trigger)` — the single,
      centralized condition evaluator; supports at minimum:
      `event_type_matches`, `payload_field_equals`, `payload_field_gt`.
- [ ] Implement `_resolve_action(action_spec)` — validates action type and
      returns an `Action`; raises `UnknownActionError` for unknown types.
- [ ] Implement `evaluate(trigger, user_context, rules)` composing the above.
- [ ] Verify with `python3 -m unittest discover`.

## Autonomous Strategy
strategy: direct
rationale: This is a narrow, one-shot implementation task with deterministic acceptance criteria. No scalar metric to optimize; Karpathy does not apply.
