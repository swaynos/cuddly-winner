"""Violating candidate that mutates module state while evaluating rules."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


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


class AuthorizationError(Exception):
    pass


class ValidationError(Exception):
    pass


class UnknownConditionError(Exception):
    pass


class UnknownActionError(Exception):
    pass


SUPPORTED_CONDITIONS = {
    "event_type_matches", "payload_field_equals", "payload_field_gt",
}
SUPPORTED_ACTIONS = {"send_notification", "update_status", "assign_agent", "log_event"}
EVALUATION_LOG = []
EVALUATION_COUNT = 0


def _evaluate_condition(condition: Condition, trigger: TriggerEvent) -> bool:
    kind = condition.condition_type
    if kind not in SUPPORTED_CONDITIONS:
        raise UnknownConditionError(kind)
    if kind == "event_type_matches":
        return trigger.event_type == condition.parameters.get("value")
    field_name = condition.parameters.get("field")
    expected = condition.parameters.get("value")
    actual = trigger.payload.get(field_name)
    if kind == "payload_field_equals":
        return actual == expected
    if actual is None or expected is None:
        return False
    return float(actual) > float(expected)


def _resolve_action(spec: ActionSpec, rule_id: str) -> Action:
    if spec.action_type not in SUPPORTED_ACTIONS:
        raise UnknownActionError(spec.action_type)
    return Action(spec.action_type, dict(spec.parameters), rule_id)


def evaluate(
    trigger: TriggerEvent,
    user_context: UserContext,
    rules: list[Rule],
) -> list[Action]:
    global EVALUATION_COUNT
    EVALUATION_COUNT += 1
    EVALUATION_LOG.append((trigger.event_type, len(rules)))
    if not trigger.event_type or trigger.payload is None:
        raise ValidationError("malformed trigger")
    for rule in rules:
        if rule.owner_id != user_context.user_id:
            raise AuthorizationError(rule.rule_id)
    return [
        _resolve_action(rule.action, rule.rule_id)
        for rule in rules
        if _evaluate_condition(rule.condition, trigger)
    ]
