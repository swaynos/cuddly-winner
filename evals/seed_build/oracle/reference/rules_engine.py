"""
evals/seed_build/oracle/reference/rules_engine.py

Reference implementation of the workflow rules engine.
This is the FROZEN CORRECT implementation against which the acceptance tests
and failure-mode checks are calibrated.

Design invariants:
  - Pure function: evaluate() has no side effects.
  - Authorization first: ownership is verified before any condition evaluation.
  - Single condition evaluator: _evaluate_condition() is the only place
    condition logic lives; it is not duplicated elsewhere.
  - No hardcoded secrets, tokens, or API keys.
  - Standard library only.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TriggerEvent:
    event_type: str
    payload: dict[str, Any]


@dataclass(frozen=True)
class UserContext:
    user_id: str


@dataclass(frozen=True)
class Condition:
    condition_type: str
    parameters: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ActionSpec:
    action_type: str
    parameters: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Rule:
    rule_id: str
    owner_id: str
    condition: Condition
    action: ActionSpec


@dataclass(frozen=True)
class Action:
    action_type: str
    parameters: dict[str, Any]
    rule_id: str


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class AuthorizationError(Exception):
    """Raised when a user attempts to evaluate a rule they do not own."""


class ValidationError(Exception):
    """Raised when a trigger event is missing required fields."""


class UnknownConditionError(Exception):
    """Raised when a rule specifies a condition_type the engine does not support."""


class UnknownActionError(Exception):
    """Raised when a rule specifies an action_type the engine does not support."""


# ---------------------------------------------------------------------------
# Supported condition and action types
# ---------------------------------------------------------------------------

_SUPPORTED_CONDITIONS = {"event_type_matches", "payload_field_equals", "payload_field_gt"}
_SUPPORTED_ACTIONS = {"send_notification", "update_status", "assign_agent", "log_event"}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _check_authorization(user_context: UserContext, rules: list[Rule]) -> None:
    """Raise AuthorizationError if any rule is not owned by user_context.user_id."""
    for rule in rules:
        if rule.owner_id != user_context.user_id:
            raise AuthorizationError(
                f"User '{user_context.user_id}' does not own rule '{rule.rule_id}' "
                f"(owned by '{rule.owner_id}')."
            )


def _validate_trigger(trigger: TriggerEvent) -> None:
    """Raise ValidationError if the trigger is missing required fields."""
    if not trigger.event_type:
        raise ValidationError("TriggerEvent.event_type must be a non-empty string.")
    if trigger.payload is None:
        raise ValidationError("TriggerEvent.payload must not be None.")


def _evaluate_condition(condition: Condition, trigger: TriggerEvent) -> bool:
    """
    Single centralized condition evaluator.
    Raises UnknownConditionError for unsupported condition types.
    """
    ct = condition.condition_type
    if ct not in _SUPPORTED_CONDITIONS:
        raise UnknownConditionError(
            f"Unknown condition_type '{ct}'. "
            f"Supported: {sorted(_SUPPORTED_CONDITIONS)}"
        )

    if ct == "event_type_matches":
        return trigger.event_type == condition.parameters.get("value")

    if ct == "payload_field_equals":
        field_name = condition.parameters.get("field")
        expected = condition.parameters.get("value")
        return trigger.payload.get(field_name) == expected

    if ct == "payload_field_gt":
        field_name = condition.parameters.get("field")
        threshold = condition.parameters.get("value")
        actual = trigger.payload.get(field_name)
        if actual is None or threshold is None:
            return False
        return float(actual) > float(threshold)

    return False  # unreachable given the guard above


def _resolve_action(action_spec: ActionSpec, rule_id: str) -> Action:
    """Validate action type and return an Action. Raises UnknownActionError."""
    if action_spec.action_type not in _SUPPORTED_ACTIONS:
        raise UnknownActionError(
            f"Unknown action_type '{action_spec.action_type}'. "
            f"Supported: {sorted(_SUPPORTED_ACTIONS)}"
        )
    return Action(
        action_type=action_spec.action_type,
        parameters=dict(action_spec.parameters),
        rule_id=rule_id,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def evaluate(
    trigger: TriggerEvent,
    user_context: UserContext,
    rules: list[Rule],
) -> list[Action]:
    """
    Evaluate trigger against rules for the given user.

    Steps:
      1. Validate trigger fields.
      2. Authorize: all rules must be owned by user_context.user_id.
      3. For each rule, evaluate its condition against the trigger.
      4. For each matching rule, resolve and collect its action.

    Returns the list of Action objects for rules whose condition matched.
    Raises AuthorizationError, ValidationError, UnknownConditionError,
    or UnknownActionError on contract violations.
    """
    _validate_trigger(trigger)
    _check_authorization(user_context, rules)

    actions: list[Action] = []
    for rule in rules:
        if _evaluate_condition(rule.condition, trigger):
            actions.append(_resolve_action(rule.action, rule.rule_id))
    return actions
