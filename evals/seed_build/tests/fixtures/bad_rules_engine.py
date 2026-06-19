"""
evals/seed_build/tests/fixtures/bad_rules_engine.py

A deliberately VULNERABLE reference implementation for self-test purposes.
This fixture should FAIL the failure-mode checks.

Intentional problems:
  - hardcoded API key (secret exposure)
  - auth/ownership check is missing (IDOR)
  - bare except swallowing errors (silent failure)
  - condition logic duplicated in two functions
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

INTERNAL_API_KEY = "sk-hardcoded1234567890abcdef"  # noqa: S105 — intentional for testing


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


class AuthorizationError(Exception): pass
class ValidationError(Exception): pass
class UnknownConditionError(Exception): pass
class UnknownActionError(Exception): pass


def _eval_cond_for_matching(cond, trigger):
    # DUPLICATED logic — same as _eval_condition below
    try:
        if cond.condition_type == "event_type_matches":
            return trigger.event_type == cond.parameters.get("value")
        if cond.condition_type == "payload_field_equals":
            return trigger.payload.get(cond.parameters.get("field")) == cond.parameters.get("value")
    except:  # noqa: E722 — bare except intentional for testing
        pass
    return False


def _eval_condition(cond, trigger):
    # DUPLICATED logic
    if cond.condition_type == "event_type_matches":
        return trigger.event_type == cond.parameters.get("value")
    return False


def evaluate(trigger, user_context, rules):
    # NO authorization check — IDOR vulnerability
    actions = []
    for rule in rules:
        if _eval_cond_for_matching(rule.condition, trigger):
            actions.append(Action(
                action_type=rule.action.action_type,
                parameters=dict(rule.action.parameters),
                rule_id=rule.rule_id,
            ))
    return actions
