#!/usr/bin/env python3
"""
evals/seed_build/oracle/reference/selfcheck.py

Proves the reference implementation is self-consistent:
  - passes all acceptance tests
  - passes all failure-mode checks
  - canonical generated-agent package and handoff pass planning checks

Run from anywhere:
    python3 evals/seed_build/oracle/reference/selfcheck.py

Exits 0 on success, 1 on failure.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE    = Path(__file__).resolve().parent          # oracle/reference/
ORACLE  = HERE.parent                               # oracle/
SEED_BUILD = ORACLE.parent
ACCEPTANCE = ORACLE / "acceptance"
FAILURE_MODES = ORACLE / "failure_modes.py"
PLANNING_CHECKS = SEED_BUILD / "planning_checks.py"
CANONICAL_PACKAGE = SEED_BUILD / "canonical"
CANONICAL_HANDOFF = CANONICAL_PACKAGE / "PROMETHEUS_HANDOFF.txt"
REFERENCE_ENGINE = HERE / "rules_engine.py"


def run(cmd: list[str], env_extra: dict | None = None) -> int:
    import os
    env = {**os.environ, **(env_extra or {})}
    r = subprocess.run(cmd, env=env)
    return r.returncode


def main() -> int:
    ok = True

    print("=== Selfcheck: reference implementation ===\n")

    # 1. Acceptance tests via unittest discover
    print("1. Running acceptance tests against reference...")
    rc = run(
        [sys.executable, "-m", "unittest", "discover",
         "-s", str(ACCEPTANCE), "-p", "test_*.py"],
        env_extra={"RULES_ENGINE_PATH": str(REFERENCE_ENGINE)},
    )
    if rc == 0:
        print("   PASS\n")
    else:
        print("   FAIL — acceptance tests failed against reference implementation\n")
        ok = False

    # 2. Failure-mode checks against reference (should pass = no failures detected)
    print("2. Running failure-mode checks against reference...")
    rc = run([sys.executable, str(FAILURE_MODES), str(REFERENCE_ENGINE)])
    if rc == 0:
        print("   PASS\n")
    else:
        print("   FAIL — failure modes detected in reference implementation\n")
        ok = False

    # 3. Planning checks against the canonical generated-agent package.
    print("3. Running planning checks against the canonical task package...")
    rc = run([
        sys.executable,
        str(PLANNING_CHECKS),
        str(CANONICAL_PACKAGE),
        "--handoff-file",
        str(CANONICAL_HANDOFF),
    ])
    if rc == 0:
        print("   PASS\n")
    else:
        print("   FAIL - canonical package failed planning checks\n")
        ok = False

    if ok:
        print("=== Selfcheck PASS ===")
    else:
        print("=== Selfcheck FAIL ===")

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
