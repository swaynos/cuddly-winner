#!/usr/bin/env python3
"""
evals/seed_build/test_build.py  —  Test 2: Canonical SPEC → @autonomous → great build

Feeds the frozen canonical SPEC to a live @autonomous agent in a disposable
workspace. Validates the produced build against the frozen acceptance suite,
failure-mode checks, and workflow-contract compliance.

Usage:
    python3 evals/seed_build/test_build.py [--out path/to/report.json]

Exits:
    0 = PASS or SKIPPED
    1 = FAIL or PARTIAL
    2 = internal error
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _harness import (
    PASS, PARTIAL, FAIL, SKIPPED,
    TestReport, make_workspace, write_report, should_skip,
    run_opencode_agent, dry_run_autonomous,
)

ORACLE    = Path(__file__).resolve().parent / "oracle"
CANONICAL = Path(__file__).resolve().parent / "CANONICAL_SPEC.md"
ACCEPTANCE = ORACLE / "acceptance"
REPORTS   = Path(tempfile.gettempdir()) / "opencode-seed-build-reports"
ROOT      = Path(__file__).resolve().parents[2]


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod  # register before exec so @dataclass resolves annotations
    spec.loader.exec_module(mod)
    return mod


def _find_rules_engine(workspace: Path) -> Path | None:
    """Locate the built rules_engine.py in the workspace, excluding the oracle copy."""
    oracle_readonly = workspace / ".oracle_readonly"
    candidates = [
        p for p in workspace.rglob("rules_engine.py")
        if not str(p).startswith(str(oracle_readonly))
    ]
    return candidates[0] if candidates else None


def _run_acceptance_suite(engine_path: Path) -> tuple[bool, str]:
    """Run the frozen acceptance tests against the built engine using unittest."""
    result = subprocess.run(
        [sys.executable, "-m", "unittest", "discover",
         "-s", str(ACCEPTANCE), "-p", "test_*.py", "-v"],
        env={**os.environ, "RULES_ENGINE_PATH": str(engine_path)},
        capture_output=True,
        text=True,
    )
    return result.returncode == 0, result.stdout + result.stderr


def _check_contract_compliance(workspace: Path) -> list[dict]:
    """
    Lightweight contract compliance checks against workspace artifacts.
    Mirrors the evidence model from tests/audit_run.py (no live DB needed here;
    we check what was committed to the workspace).
    """
    checks = []

    # 1. progress.txt updated
    progress = (workspace / "progress.txt").exists() or \
               (workspace / "PROGRESS.txt").exists()
    checks.append({
        "name": "progress.txt updated",
        "passed": progress,
        "note": "" if progress else "No progress.txt found in workspace.",
    })

    # 2. Strategy recorded
    strategy_recorded = False
    for fname in ("progress.txt", "PROGRESS.txt"):
        p = workspace / fname
        if p.exists():
            content = p.read_text(encoding="utf-8", errors="replace")
            if "Selected:" in content:
                strategy_recorded = True
                break
    checks.append({
        "name": "Strategy recorded in progress.txt",
        "passed": strategy_recorded,
        "note": "" if strategy_recorded else "No 'Selected:' line found in progress.txt.",
    })

    # 3. Trusted runner evidence present on disk.
    evidence_found = any((workspace / ".opencode" / "runs").glob("*.json"))
    checks.append({
        "name": "Trusted runner evidence present",
        "passed": evidence_found,
        "note": "" if evidence_found else "No .opencode/runs JSON artifact found.",
    })

    return checks


def run_test(workspace: Path, dry_run: bool = False) -> TestReport:
    report = TestReport(test_name="test_build")

    # Copy the canonical SPEC into the workspace
    canonical_text = CANONICAL.read_text(encoding="utf-8")
    (workspace / "SPEC.md").write_text(canonical_text, encoding="utf-8")
    (workspace / ".python-version").write_text(
        (ROOT / ".python-version").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    (workspace / "scripts").mkdir()
    shutil.copy2(ROOT / "scripts" / "ensure-venv.sh", workspace / "scripts" / "ensure-venv.sh")

    # Copy oracle acceptance dir as read-only reference (for context, not editing)
    oracle_dest = workspace / ".oracle_readonly"
    shutil.copytree(ORACLE, oracle_dest)

    if dry_run:
        rc, stdout, stderr = dry_run_autonomous(workspace)
    else:
        # Run @autonomous against the canonical SPEC
        prompt = (
            "Read the canonical SPEC.md in this workspace and execute it. "
            "Implement the workflow rules engine as specified. "
            "Write tests, verify, review, and emit COMPLETE when done."
        )
        rc, stdout, stderr = run_opencode_agent(
            agent="autonomous",
            prompt=prompt,
            workspace=workspace,
            timeout_seconds=int(os.environ.get("OPENCODE_BUILD_TIMEOUT", "900")),
        )

    report.evidence["opencode_exit_code"] = rc
    report.evidence["stdout_tail"] = stdout[-3000:] if stdout else ""
    report.evidence["stderr_tail"] = stderr[-1000:] if stderr else ""
    report.checks.append({
        "name": "OpenCode run completed",
        "passed": rc == 0,
        "note": "" if rc == 0 else f"OpenCode exited with status {rc}.",
    })

    # Find the built rules engine
    engine_path = _find_rules_engine(workspace)
    if not engine_path:
        report.checks.append({
            "name": "rules_engine.py produced",
            "passed": False,
            "note": "No rules_engine.py found in workspace after @autonomous run.",
        })
        report.verdict = FAIL
        return report

    report.checks.append({
        "name": "rules_engine.py produced",
        "passed": True,
        "evidence": str(engine_path.relative_to(workspace)),
    })
    report.evidence["engine_path"] = str(engine_path)

    # Run frozen acceptance suite
    acceptance_ok, acceptance_output = _run_acceptance_suite(engine_path)
    report.evidence["acceptance_output"] = acceptance_output[-3000:]
    report.checks.append({
        "name": "Frozen acceptance suite passes",
        "passed": acceptance_ok,
        "note": "" if acceptance_ok else f"One or more acceptance tests failed:\n{acceptance_output[-1500:]}",
    })

    # Run failure-mode checks
    failure_modes = _load_module("failure_modes", ORACLE / "failure_modes.py")
    fm_report = failure_modes.check_all(engine_path)
    report.evidence["failure_modes"] = fm_report.render()
    report.checks.append({
        "name": "No failure modes detected",
        "passed": fm_report.passed,
        "note": "" if fm_report.passed
                else f"Failure modes: {'; '.join(fm_report.failures[:3])}",
    })

    # Contract compliance checks
    contract_checks = _check_contract_compliance(workspace)
    report.checks.extend(contract_checks)

    # Overall verdict
    passed_count = sum(1 for c in report.checks if c.get("passed"))
    total = len(report.checks)
    if passed_count == total:
        report.verdict = PASS
    elif passed_count >= total * 0.5:
        report.verdict = PARTIAL
    else:
        report.verdict = FAIL

    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=None, help="Path to write JSON report")
    parser.add_argument("--keep-workspace", action="store_true",
                        help="Do not delete the workspace after the run")
    parser.add_argument("--dry-run", action="store_true",
                        help="Use stub agent responses to exercise all scoring logic without live agents")
    args = parser.parse_args(argv)

    if not args.dry_run:
        skip, reason = should_skip()
        if skip:
            report = TestReport(
                test_name="test_build",
                verdict=SKIPPED,
                error=reason,
            )
            print(report.render())
            out_path = write_report(report, Path(args.out).parent if args.out else REPORTS)
            print(f"Report: {out_path}")
            return 1

    workspace = make_workspace("build")
    try:
        report = run_test(workspace, dry_run=args.dry_run)
    except Exception as e:
        report = TestReport(test_name="test_build", verdict=FAIL, error=str(e))
    finally:
        if not args.keep_workspace:
            shutil.rmtree(workspace, ignore_errors=True)

    print(report.render())
    out_path = write_report(
        report,
        Path(args.out).parent if args.out else REPORTS,
    )
    if args.out:
        shutil.copy(out_path, args.out)
    print(f"Report: {out_path}")

    return 0 if report.verdict == PASS else 1


if __name__ == "__main__":
    raise SystemExit(main())
