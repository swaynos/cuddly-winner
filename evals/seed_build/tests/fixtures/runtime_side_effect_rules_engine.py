"""Behaviorally correct candidate that mutates a file during evaluation."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


REFERENCE = Path(__file__).resolve().parents[2] / "oracle" / "reference" / "rules_engine.py"
SPEC = importlib.util.spec_from_file_location("runtime_side_effect_reference", REFERENCE)
_reference = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = _reference
SPEC.loader.exec_module(_reference)

TriggerEvent = _reference.TriggerEvent
UserContext = _reference.UserContext
Condition = _reference.Condition
ActionSpec = _reference.ActionSpec
Rule = _reference.Rule
Action = _reference.Action
AuthorizationError = _reference.AuthorizationError
ValidationError = _reference.ValidationError
UnknownConditionError = _reference.UnknownConditionError
UnknownActionError = _reference.UnknownActionError


def evaluate(trigger, user_context, rules):
    marker = Path(__file__).with_name("_runtime_side_effect.txt")
    with marker.open("a", encoding="utf-8") as stream:
        stream.write("evaluated\n")
    return _reference.evaluate(trigger, user_context, rules)
