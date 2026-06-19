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
    TestReport, make_workspace, write_report, should_skip, run_opencode_agent,
)

ORACLE    = Path(__file__).resolve().parent / "oracle"
CANONICAL = ORACLE / "CANONICAL_SPEC.md"
ACCEPTANCE = ORACLE / "acceptance"
REPORTS   = Path(__file__).resolve().parent / "reports"
ROOT      = Path(__file__).resolve().parents[2]


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _find_rules_engine(workspace: Path) -> Path | None:
    """Locate the built rules_engine.py in the workspace."""
    candidates = list(workspace.rglob("rules_engine.py"))
    if candidates:
        return candidates[0]
    return None


def _run_acceptance_suite(engine_path: Path) -> tuple[bool, str]:
    """Run the frozen acceptance tests against the built engine."""
    result = subprocess.run(
        [sys.executable, "-m", "pytest", str(ACCEPTANCE), "-q", "--tb=short"],
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

    # 3. Evidence block present (look in any txt/md file in workspace)
    evidence_found = False
    for p in workspace.rglob("*.txt"):
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
            if '"exit_code"' in text and '"command"' in text:
                evidence_found = True
                break
        except Exception:
            pass
    if not evidence_found:
        for p in workspace.rglob("*.md"):
            try:
                text = p.read_text(encoding="utf-8", errors="replace")
                if '"exit_code"' in text and '"command"' in text:
                    evidence_found = True
                    break
            except Exception:
                pass
    checks.append({
        "name": "Evidence block present",
        "passed": evidence_found,
        "note": "" if evidence_found else "No evidence block (exit_code + command) found.",
    })

    return checks


def run_test(workspace: Path) -> TestReport:
    report = TestReport(test_name="test_build")

    # Copy the canonical SPEC into the workspace
    canonical_text = CANONICAL.read_text(encoding="utf-8")
    (workspace / "SPEC.md").write_text(canonical_text, encoding="utf-8")

    # Copy oracle acceptance dir as read-only reference (for context, not editing)
    oracle_dest = workspace / ".oracle_readonly"
    shutil.copytree(ORACLE, oracle_dest)

    # Run @autonomous against the canonical SPEC
    prompt = (
        "Materialize the SPEC.md in this workspace verbatim and execute it. "
        "Implement the workflow rules engine as specified. "
        "Write tests, verify, review, and emit COMPLETE when done."
    )
    rc, stdout, stderr = run_opencode_agent(
        agent="autonomous",
        prompt=prompt,
        workspace=workspace,
        timeout_seconds=900,
    )

    report.evidence["opencode_exit_code"] = rc
    report.evidence["stdout_tail"] = stdout[-3000:] if stdout else ""
    report.evidence["stderr_tail"] = stderr[-1000:] if stderr else ""

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
        "note": "" if acceptance_ok else "One or more acceptance tests failed.",
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
    args = parser.parse_args(argv)

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
        return 0

    workspace = make_workspace("build")
    try:
        report = run_test(workspace)
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

    return 0 if report.verdict in (PASS, SKIPPED) else 1


if __name__ == "__main__":
    raise SystemExit(main())
