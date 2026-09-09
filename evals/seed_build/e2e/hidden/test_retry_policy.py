"""
evals/seed_build/e2e/hidden/test_retry_policy.py

Hidden acceptance suite for the end-to-end fixture.

This file is never copied into the agent workspace and is never named in the
request the agent receives. The harness runs it from outside the workspace
against the module the agent actually produced, so a pass means the delivered
code satisfies criteria the agent could not read.

Usage:
    RETRY_POLICY_PATH=/path/to/retry_policy.py python3 -m unittest discover \
        -s evals/seed_build/e2e/hidden -p 'test_*.py'
"""
from __future__ import annotations

import ast
import dataclasses
import importlib.util
import os
import sys
import unittest
from pathlib import Path

_PATH = Path(os.environ["RETRY_POLICY_PATH"]).resolve()


def _load():
    spec = importlib.util.spec_from_file_location("retry_policy_under_test", _PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["retry_policy_under_test"] = module
    spec.loader.exec_module(module)
    return module


engine = _load()


class TestSchedule(unittest.TestCase):
    def test_returns_one_attempt_per_retry_in_ascending_order(self):
        result = engine.schedule(4, 100, cap_ms=100_000)
        self.assertEqual([item.index for item in result], [0, 1, 2, 3])

    def test_exponential_backoff_values(self):
        result = engine.schedule(4, 100, cap_ms=100_000)
        self.assertEqual([item.delay_ms for item in result], [100, 200, 400, 800])

    def test_cap_is_applied(self):
        result = engine.schedule(5, 100, cap_ms=300)
        self.assertEqual([item.delay_ms for item in result], [100, 200, 300, 300, 300])

    def test_cap_equal_to_base_flattens_schedule(self):
        result = engine.schedule(3, 250, cap_ms=250)
        self.assertEqual([item.delay_ms for item in result], [250, 250, 250])

    def test_zero_retries_returns_empty_list(self):
        self.assertEqual(engine.schedule(0, 100, cap_ms=1000), [])

    def test_single_retry_uses_base_delay(self):
        result = engine.schedule(1, 75, cap_ms=1000)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].index, 0)
        self.assertEqual(result[0].delay_ms, 75)

    def test_deterministic_across_calls(self):
        self.assertEqual(engine.schedule(6, 10, cap_ms=200), engine.schedule(6, 10, cap_ms=200))

    def test_cap_ms_is_keyword_only(self):
        with self.assertRaises(TypeError):
            engine.schedule(1, 100, 1000)


class TestErrors(unittest.TestCase):
    def test_policy_error_derives_from_value_error(self):
        self.assertTrue(issubclass(engine.PolicyError, ValueError))

    def test_negative_retries_rejected(self):
        with self.assertRaises(engine.PolicyError):
            engine.schedule(-1, 100, cap_ms=1000)

    def test_zero_base_rejected(self):
        with self.assertRaises(engine.PolicyError):
            engine.schedule(2, 0, cap_ms=1000)

    def test_negative_base_rejected(self):
        with self.assertRaises(engine.PolicyError):
            engine.schedule(2, -5, cap_ms=1000)

    def test_cap_below_base_rejected(self):
        with self.assertRaises(engine.PolicyError):
            engine.schedule(2, 100, cap_ms=99)


class TestAttemptShape(unittest.TestCase):
    def test_attempt_is_a_frozen_dataclass(self):
        self.assertTrue(dataclasses.is_dataclass(engine.Attempt))
        self.assertTrue(engine.Attempt.__dataclass_params__.frozen)

    def test_attempt_field_names_and_order(self):
        fields = [field.name for field in dataclasses.fields(engine.Attempt)]
        self.assertEqual(fields, ["index", "delay_ms"])

    def test_attempt_instances_are_immutable(self):
        attempt = engine.schedule(1, 100, cap_ms=1000)[0]
        with self.assertRaises(dataclasses.FrozenInstanceError):
            attempt.delay_ms = 1


class TestPurity(unittest.TestCase):
    """Static purity checks the request demands but no workspace test enforces."""

    FORBIDDEN_MODULES = {
        "socket", "urllib", "http", "httpx", "requests", "aiohttp", "smtplib",
        "ftplib", "random", "secrets", "shutil", "subprocess", "pathlib", "os",
    }

    def setUp(self):
        self.tree = ast.parse(_PATH.read_text(encoding="utf-8"), filename=str(_PATH))

    def test_imports_only_permitted_stdlib_modules(self):
        imported = set()
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
        self.assertEqual(imported & self.FORBIDDEN_MODULES, set())

    def test_no_file_or_process_calls(self):
        forbidden_calls = {"open", "system", "popen", "run", "urlopen", "connect"}
        found = set()
        for node in ast.walk(self.tree):
            if not isinstance(node, ast.Call):
                continue
            if isinstance(node.func, ast.Name):
                found.add(node.func.id)
            elif isinstance(node.func, ast.Attribute):
                found.add(node.func.attr)
        self.assertEqual(found & forbidden_calls, set())

    def test_schedule_does_not_use_network_sockets(self):
        import socket

        original = socket.socket

        class Blocked:
            def __init__(self, *_args, **_kwargs):
                raise AssertionError("schedule() must not open a socket")

        socket.socket = Blocked  # type: ignore[assignment]
        try:
            engine.schedule(3, 100, cap_ms=1000)
        finally:
            socket.socket = original


if __name__ == "__main__":
    unittest.main()
