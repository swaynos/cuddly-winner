"""
Unit tests for evals/mutation/run_mutation.py

Run with:
    python3 -m unittest discover -s evals/mutation/tests -p "test_*.py"

All tests use in-process fixtures — no network, no external dependencies.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

# Add the parent directory so we can import run_mutation directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import run_mutation as rm


# ---------------------------------------------------------------------------
# Tiny inline fixture helpers
# ---------------------------------------------------------------------------

def _write_source(directory: Path, name: str, src: str) -> Path:
    p = directory / name
    p.write_text(textwrap.dedent(src), encoding="utf-8")
    return p


def _write_test(directory: Path, name: str, test_src: str, target_module: str) -> Path:
    """Write a test file that imports target_module from the same directory."""
    p = directory / name
    header = f"import sys, os; sys.path.insert(0, '{directory}')\n"
    p.write_text(header + textwrap.dedent(test_src), encoding="utf-8")
    return p


# ---------------------------------------------------------------------------
# Mutant generation tests
# ---------------------------------------------------------------------------

class TestMutantGeneration(unittest.TestCase):
    def test_comparison_op_produces_mutants(self) -> None:
        src = "def ok(a, b):\n    return a == b\n"
        mutants = rm.generate_mutants(src, "test.py")
        mutated_sources = [m[2] for m in mutants]
        self.assertTrue(
            any("!=" in s for s in mutated_sources),
            "expected at least one mutant replacing == with !=",
        )

    def test_return_none_mutant(self) -> None:
        src = "def value():\n    return 42\n"
        mutants = rm.generate_mutants(src, "test.py")
        mutated_sources = [m[2] for m in mutants]
        self.assertTrue(
            any("return None" in s for s in mutated_sources),
            "expected a return-None mutant",
        )

    def test_int_literal_mutant(self) -> None:
        src = "x = 5\n"
        mutants = rm.generate_mutants(src, "test.py")
        mutated_sources = [m[2] for m in mutants]
        self.assertTrue(
            any("6" in s for s in mutated_sources),
            "expected integer literal incremented",
        )

    def test_blank_and_comment_lines_skipped(self) -> None:
        src = "\n# this is a comment\n"
        mutants = rm.generate_mutants(src, "test.py")
        self.assertEqual(mutants, [], "blank/comment lines should not produce mutants")


# ---------------------------------------------------------------------------
# End-to-end: weak (tautological) vs rigorous test suite
# ---------------------------------------------------------------------------

class TestWeakVsRigorousTestSuite(unittest.TestCase):
    """
    Weak suite: test always passes regardless of the function's logic.
    Rigorous suite: test actually asserts the return value.

    Both test the same target module.
    """

    TARGET_SRC = """
def add(a, b):
    return a + b
"""

    WEAK_TEST = """
import unittest
from target import add

class WeakTest(unittest.TestCase):
    def test_add_always_passes(self):
        add(1, 2)   # never asserts; always passes

if __name__ == '__main__':
    unittest.main()
"""

    RIGOROUS_TEST = """
import unittest
from target import add

class RigorousTest(unittest.TestCase):
    def test_add_correct(self):
        self.assertEqual(add(1, 2), 3)
        self.assertEqual(add(0, 0), 0)
        self.assertEqual(add(-1, 1), 0)

if __name__ == '__main__':
    unittest.main()
"""

    def _run_with_suite(self, test_src: str) -> rm.MutationResult:
        with tempfile.TemporaryDirectory(prefix="mutation-test-") as td:
            d = Path(td)
            src = _write_source(d, "target.py", self.TARGET_SRC)
            test_file = _write_test(d, "test_suite.py", test_src, "target")
            test_cmd = f"python3 -m unittest discover -s {td} -p 'test_suite.py' -q"
            return rm.run_mutation(
                source_files=[src],
                test_cmd=test_cmd,
                threshold=0.70,
                mutant_cap=50,
                wall_clock_seconds=60,
            )

    def test_weak_suite_scores_below_rigorous(self) -> None:
        weak = self._run_with_suite(self.WEAK_TEST)
        rigorous = self._run_with_suite(self.RIGOROUS_TEST)
        self.assertLess(
            weak.score, rigorous.score,
            f"weak score {weak.score:.3f} should be less than rigorous {rigorous.score:.3f}",
        )

    def test_weak_suite_does_not_pass_threshold(self) -> None:
        weak = self._run_with_suite(self.WEAK_TEST)
        self.assertFalse(weak.passed, "weak suite should not pass the 0.70 threshold")

    def test_rigorous_suite_passes_threshold(self) -> None:
        rigorous = self._run_with_suite(self.RIGOROUS_TEST)
        self.assertTrue(rigorous.passed, "rigorous suite should pass the 0.70 threshold")


# ---------------------------------------------------------------------------
# Result artifact writing
# ---------------------------------------------------------------------------

class TestResultArtifact(unittest.TestCase):
    def test_result_json_has_required_fields(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            src = _write_source(d, "mod.py", "def f(x):\n    return x + 1\n")
            test_file = _write_test(
                d, "test_mod.py",
                "import unittest\nfrom mod import f\nclass T(unittest.TestCase):\n    def test_f(self):\n        self.assertEqual(f(1), 2)\n",
                "mod",
            )
            result_path = d / "result.json"
            result = rm.run_mutation(
                source_files=[src],
                test_cmd=f"python3 -m unittest discover -s {td} -p 'test_mod.py' -q",
                threshold=0.70,
                mutant_cap=20,
                wall_clock_seconds=60,
            )
            result_path.write_text(
                json.dumps(result.to_dict(), indent=2), encoding="utf-8"
            )
            data = json.loads(result_path.read_text())
            for key in ["score", "killed", "survived", "total", "files",
                        "generated_at", "threshold", "passed"]:
                self.assertIn(key, data, f"result JSON missing key: {key}")
            self.assertIsInstance(data["score"], float)
            self.assertIsInstance(data["passed"], bool)


# ---------------------------------------------------------------------------
# Bounded cost
# ---------------------------------------------------------------------------

class TestBoundedCost(unittest.TestCase):
    def test_mutant_cap_limits_total(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            # Large-ish source with many mutation sites
            lines = ["def f(x):\n"] + [f"    x = x + {i}\n" for i in range(50)]
            src = _write_source(d, "big.py", "".join(lines))
            test_cmd = "python3 -c 'pass'"  # tests always pass
            result = rm.run_mutation(
                source_files=[src],
                test_cmd=test_cmd,
                threshold=0.70,
                mutant_cap=5,  # tight cap
                wall_clock_seconds=60,
            )
            self.assertLessEqual(result.total, 5, "total mutants should respect cap")


if __name__ == "__main__":
    unittest.main()
