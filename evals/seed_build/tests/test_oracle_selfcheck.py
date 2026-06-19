"""
evals/seed_build/tests/test_oracle_selfcheck.py

Deterministic self-test proving the oracle is self-consistent.

Tests:
  1. Reference implementation passes all acceptance tests.
  2. Reference implementation passes all failure-mode checks.
  3. Canonical SPEC passes all planning checks.
  4. Bad-reference fixture is flagged by failure-mode checks.
  5. Weak-SPEC fixture fails planning checks.
  6. test_planning.py --dry-run runs end-to-end and returns PASS.
  7. test_build.py --dry-run runs end-to-end and returns PASS.

Run with:
    python3 -m unittest discover -s evals/seed_build/tests -p "test_*.py"
"""
from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import unittest
from pathlib import Path

ROOT    = Path(__file__).resolve().parents[3]
ORACLE  = Path(__file__).resolve().parents[1] / "oracle"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
SEED_BUILD = Path(__file__).resolve().parents[1]


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod  # register before exec so @dataclass can resolve annotations
    spec.loader.exec_module(mod)
    return mod


class TestAcceptanceSuiteOnReference(unittest.TestCase):
    """The reference implementation must pass all acceptance tests."""

    def test_reference_passes_acceptance_suite(self):
        reference_engine = ORACLE / "reference" / "rules_engine.py"
        acceptance_dir   = ORACLE / "acceptance"

        result = subprocess.run(
            [sys.executable, "-m", "unittest", "discover",
             "-s", str(acceptance_dir), "-p", "test_*.py", "-v"],
            env={**os.environ, "RULES_ENGINE_PATH": str(reference_engine)},
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            result.returncode, 0,
            f"Reference implementation failed acceptance tests:\n{result.stdout}\n{result.stderr}",
        )


class TestFailureModeChecks(unittest.TestCase):
    """failure_modes.py must flag the bad fixture and pass the reference."""

    def _check(self, engine_path: Path):
        fm = _load_module("failure_modes", ORACLE / "failure_modes.py")
        return fm.check_all(engine_path)

    def test_reference_passes_failure_mode_checks(self):
        report = self._check(ORACLE / "reference" / "rules_engine.py")
        self.assertTrue(
            report.passed,
            f"Reference implementation has failure modes:\n{report.render()}",
        )

    def test_bad_fixture_fails_failure_mode_checks(self):
        report = self._check(FIXTURES / "bad_rules_engine.py")
        self.assertFalse(
            report.passed,
            "Bad fixture should have been flagged by failure-mode checks but wasn't.",
        )
        # Must detect at least hardcoded secret and duplicated logic
        failures_text = "\n".join(report.failures).lower()
        self.assertTrue(
            "secret" in failures_text or "hardcod" in failures_text or "api" in failures_text,
            f"Expected secret detection; failures:\n{report.render()}",
        )
        self.assertTrue(
            "duplic" in failures_text or "multiple function" in failures_text
            or "centraliz" in failures_text,
            f"Expected duplication detection; failures:\n{report.render()}",
        )


class TestPlanningChecks(unittest.TestCase):
    """planning_checks.py must pass the canonical SPEC and fail the weak fixture."""

    def _score(self, spec_path: Path):
        planning = _load_module("planning_checks", ORACLE / "planning_checks.py")
        text = spec_path.read_text(encoding="utf-8")
        return planning.score_spec(text)

    def test_canonical_spec_passes_planning_checks(self):
        report = self._score(ORACLE / "CANONICAL_SPEC.md")
        self.assertTrue(
            report.passed,
            f"Canonical SPEC failed planning checks:\n{report.render()}",
        )

    def test_weak_spec_fails_planning_checks(self):
        report = self._score(FIXTURES / "weak_spec.md")
        self.assertFalse(
            report.passed,
            "Weak SPEC fixture should have failed planning checks but passed.",
        )
        # Should fail at least scope narrowing and objective criteria
        failed_names = [c.name for c in report.checks if not c.passed]
        self.assertTrue(
            len(failed_names) >= 2,
            f"Expected >=2 check failures on weak SPEC; got: {failed_names}\n{report.render()}",
        )


class TestDryRun(unittest.TestCase):
    """Both live tests must return PASS in dry-run mode."""

    def _run_test(self, script: str) -> tuple[int, str]:
        result = subprocess.run(
            [sys.executable, str(SEED_BUILD / script), "--dry-run"],
            capture_output=True,
            text=True,
            cwd=str(ROOT),
        )
        return result.returncode, result.stdout + result.stderr

    def test_planning_dry_run_passes(self):
        rc, output = self._run_test("test_planning.py")
        self.assertEqual(rc, 0, f"test_planning --dry-run failed:\n{output}")
        self.assertIn("PASS", output, f"Expected PASS verdict:\n{output}")

    def test_build_dry_run_passes(self):
        rc, output = self._run_test("test_build.py")
        self.assertEqual(rc, 0, f"test_build --dry-run failed:\n{output}")
        self.assertIn("PASS", output, f"Expected PASS verdict:\n{output}")


if __name__ == "__main__":
    unittest.main()
