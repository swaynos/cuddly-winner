"""
evals/seed_build/oracle/acceptance/test_rules_engine.py

FROZEN behavioral acceptance tests for the workflow rules engine.

These tests define "what success looks like." They are run against:
  - the reference implementation (oracle/reference/rules_engine.py) to confirm
    they are satisfiable.
  - any implementation produced by @autonomous in Test 2, to judge its quality.

The tests are loaded dynamically: they import `rules_engine` from the path
injected via RULES_ENGINE_PATH env var, or default to the oracle reference.

Run against reference:
    python3 -m pytest evals/seed_build/oracle/acceptance/ -q

Run against a built implementation:
    RULES_ENGINE_PATH=/path/to/build python3 -m pytest evals/seed_build/oracle/acceptance/ -q
"""

from __future__ import annotations

import importlib.util
import os
import sys
import unittest
from pathlib import Path

# ---------------------------------------------------------------------------
# Dynamic engine loader
# ---------------------------------------------------------------------------

def _load_engine():
    """
    Load the rules_engine module from RULES_ENGINE_PATH env var,
    or fall back to the oracle reference implementation.
    """
    engine_path = os.environ.get("RULES_ENGINE_PATH")
    if engine_path:
        p = Path(engine_path)
    else:
        p = Path(__file__).resolve().parents[2] / "oracle" / "reference" / "rules_engine.py"

    spec = importlib.util.spec_from_file_location("rules_engine", p)
    module = importlib.util.module_from_spec(spec)
    import sys as _sys
    _sys.modules["rules_engine"] = module  # register before exec for @dataclass compat
    spec.loader.exec_module(module)
    return module


engine = _load_engine()

TriggerEvent     = engine.TriggerEvent
UserContext      = engine.UserContext
Condition        = engine.Condition
ActionSpec       = engine.ActionSpec
Rule             = engine.Rule
Action           = engine.Action
AuthorizationError   = engine.AuthorizationError
ValidationError      = engine.ValidationError
UnknownConditionError = engine.UnknownConditionError
UnknownActionError   = engine.UnknownActionError
evaluate             = engine.evaluate


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_rule(rule_id, owner_id, condition_type, condition_params,
               action_type="send_notification", action_params=None):
    return Rule(
        rule_id=rule_id,
        owner_id=owner_id,
        condition=Condition(condition_type=condition_type, parameters=condition_params),
        action=ActionSpec(action_type=action_type, parameters=action_params or {}),
    )


ALICE = "user-alice"
BOB   = "user-bob"

PROPERTY_SOLD = TriggerEvent(
    event_type="property_sold",
    payload={"price": 500000, "agent_id": "agent-42"},
)

LEAD_UPDATED = TriggerEvent(
    event_type="lead_updated",
    payload={"stage": "qualified", "score": 80},
)


# ---------------------------------------------------------------------------
# AC1 & AC2: Deterministic output — matching and non-matching rules
# ---------------------------------------------------------------------------

class TestDeterministicOutput(unittest.TestCase):

    def test_matching_rule_returns_action(self):
        rule = _make_rule("r1", ALICE, "event_type_matches", {"value": "property_sold"})
        result = evaluate(PROPERTY_SOLD, UserContext(ALICE), [rule])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].action_type, "send_notification")
        self.assertEqual(result[0].rule_id, "r1")

    def test_non_matching_rule_excluded(self):
        rule = _make_rule("r2", ALICE, "event_type_matches", {"value": "lead_updated"})
        result = evaluate(PROPERTY_SOLD, UserContext(ALICE), [rule])
        self.assertEqual(result, [])

    def test_multiple_rules_partial_match(self):
        r_match = _make_rule("r1", ALICE, "event_type_matches", {"value": "property_sold"})
        r_no    = _make_rule("r2", ALICE, "event_type_matches", {"value": "lead_updated"})
        result = evaluate(PROPERTY_SOLD, UserContext(ALICE), [r_match, r_no])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].rule_id, "r1")

    def test_same_trigger_always_same_result(self):
        rule = _make_rule("r1", ALICE, "event_type_matches", {"value": "property_sold"})
        r1 = evaluate(PROPERTY_SOLD, UserContext(ALICE), [rule])
        r2 = evaluate(PROPERTY_SOLD, UserContext(ALICE), [rule])
        self.assertEqual(r1, r2)

    def test_payload_field_equals_condition(self):
        rule = _make_rule("r3", ALICE, "payload_field_equals",
                          {"field": "stage", "value": "qualified"})
        result = evaluate(LEAD_UPDATED, UserContext(ALICE), [rule])
        self.assertEqual(len(result), 1)

    def test_payload_field_gt_condition(self):
        rule = _make_rule("r4", ALICE, "payload_field_gt",
                          {"field": "score", "value": 70},
                          action_type="assign_agent")
        result = evaluate(LEAD_UPDATED, UserContext(ALICE), [rule])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].action_type, "assign_agent")

    def test_payload_field_gt_not_met(self):
        rule = _make_rule("r5", ALICE, "payload_field_gt",
                          {"field": "score", "value": 90})
        result = evaluate(LEAD_UPDATED, UserContext(ALICE), [rule])
        self.assertEqual(result, [])

    def test_empty_rules_returns_empty(self):
        result = evaluate(PROPERTY_SOLD, UserContext(ALICE), [])
        self.assertEqual(result, [])


# ---------------------------------------------------------------------------
# AC3: Authorization enforced
# ---------------------------------------------------------------------------

class TestAuthorization(unittest.TestCase):

    def test_user_cannot_evaluate_rule_they_do_not_own(self):
        rule = _make_rule("r1", BOB, "event_type_matches", {"value": "property_sold"})
        with self.assertRaises(AuthorizationError):
            evaluate(PROPERTY_SOLD, UserContext(ALICE), [rule])

    def test_mixed_owners_raises_authorization_error(self):
        r_alice = _make_rule("r1", ALICE, "event_type_matches", {"value": "property_sold"})
        r_bob   = _make_rule("r2", BOB,   "event_type_matches", {"value": "property_sold"})
        with self.assertRaises(AuthorizationError):
            evaluate(PROPERTY_SOLD, UserContext(ALICE), [r_alice, r_bob])

    def test_authorization_checked_before_conditions(self):
        """Even if no conditions would match, auth is checked first."""
        rule = _make_rule("r1", BOB, "event_type_matches", {"value": "lead_updated"})
        with self.assertRaises(AuthorizationError):
            evaluate(PROPERTY_SOLD, UserContext(ALICE), [rule])

    def test_correct_owner_allowed(self):
        rule = _make_rule("r1", ALICE, "event_type_matches", {"value": "property_sold"})
        result = evaluate(PROPERTY_SOLD, UserContext(ALICE), [rule])
        self.assertIsInstance(result, list)


# ---------------------------------------------------------------------------
# AC4: ValidationError on malformed trigger
# ---------------------------------------------------------------------------

class TestTriggerValidation(unittest.TestCase):

    def test_empty_event_type_raises_validation_error(self):
        bad = TriggerEvent(event_type="", payload={"x": 1})
        rule = _make_rule("r1", ALICE, "event_type_matches", {"value": "anything"})
        with self.assertRaises(ValidationError):
            evaluate(bad, UserContext(ALICE), [rule])

    def test_none_payload_raises_validation_error(self):
        bad = TriggerEvent(event_type="property_sold", payload=None)  # type: ignore
        rule = _make_rule("r1", ALICE, "event_type_matches", {"value": "property_sold"})
        with self.assertRaises(ValidationError):
            evaluate(bad, UserContext(ALICE), [rule])


# ---------------------------------------------------------------------------
# AC5 & AC6: Unknown condition and action types
# ---------------------------------------------------------------------------

class TestUnknownTypes(unittest.TestCase):

    def test_unknown_condition_type_raises(self):
        rule = _make_rule("r1", ALICE, "magic_condition", {})
        with self.assertRaises(UnknownConditionError):
            evaluate(PROPERTY_SOLD, UserContext(ALICE), [rule])

    def test_unknown_action_type_raises(self):
        rule = _make_rule("r1", ALICE, "event_type_matches",
                          {"value": "property_sold"},
                          action_type="launch_missiles")
        with self.assertRaises(UnknownActionError):
            evaluate(PROPERTY_SOLD, UserContext(ALICE), [rule])

    def test_known_types_do_not_raise(self):
        rule = _make_rule("r1", ALICE, "event_type_matches",
                          {"value": "property_sold"},
                          action_type="update_status")
        result = evaluate(PROPERTY_SOLD, UserContext(ALICE), [rule])
        self.assertEqual(len(result), 1)


# ---------------------------------------------------------------------------
# AC7: No network/DB side effects in core path
# ---------------------------------------------------------------------------

class TestNoSideEffects(unittest.TestCase):

    def test_evaluate_makes_no_network_calls(self):
        """
        Patch socket.socket to raise on any connection attempt, then run
        evaluate. If any network call is attempted the test fails.
        """
        import socket
        original_socket = socket.socket

        class NoNetworkSocket:
            def __init__(self, *a, **kw):
                raise AssertionError(
                    "evaluate() must not make network calls; socket.socket was called"
                )

        socket.socket = NoNetworkSocket  # type: ignore
        try:
            rule = _make_rule("r1", ALICE, "event_type_matches", {"value": "property_sold"})
            evaluate(PROPERTY_SOLD, UserContext(ALICE), [rule])
        finally:
            socket.socket = original_socket


if __name__ == "__main__":
    unittest.main()
