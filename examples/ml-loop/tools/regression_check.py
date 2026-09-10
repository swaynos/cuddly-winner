"""Run the complete ml-loop integrity regression suite in this process."""

from __future__ import annotations

import sys

if not sys.flags.isolated or not sys.flags.dont_write_bytecode:
    raise SystemExit("regression_check.py requires isolated Python mode (-I -B)")

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_TEST_COUNT = 16


def main() -> None:
    suite = unittest.defaultTestLoader.discover(
        str(ROOT / "tests"),
        pattern="test_*.py",
    )
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if result.testsRun != EXPECTED_TEST_COUNT:
        raise SystemExit(
            "regression test count mismatch: "
            f"expected {EXPECTED_TEST_COUNT} tests, ran {result.testsRun}"
        )
    if not result.wasSuccessful():
        raise SystemExit("regression suite failed")
    print(
        f"regression-ok: {result.testsRun} tests; "
        "trainer boundary, output, cache, tamper, and shadow checks passed"
    )


if __name__ == "__main__":
    main()
