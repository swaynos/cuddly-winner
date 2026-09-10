#!/usr/bin/env python3
"""
evals/seed_build/test_planning.py - Test 1: idea to generated-agent package

Feeds the seed idea to a live Prometheus agent in a disposable workspace. It
scores the registered schema-v1 package and fresh-context handoff Prometheus
publishes before stopping.

Usage:
    python3 evals/seed_build/test_planning.py [--out path/to/report.json]

Exits:
    0 = PASS
    1 = FAIL, PARTIAL, or SKIPPED
"""
from __future__ import annotations

import argparse
import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _harness import (
    PASS, PARTIAL, FAIL, SKIPPED,
    TestReport, make_workspace, write_report, should_skip,
    run_opencode_agent, dry_run_prometheus, opencode_text,
)
from planning_checks import score_package

SEED     = Path(__file__).resolve().parent / "seed" / "idea.md"
REPORTS  = Path(tempfile.gettempdir()) / "opencode-seed-build-reports"


def run_test(workspace: Path, dry_run: bool = False) -> TestReport:
    report = TestReport(
        test_name="test_planning",
        execution_mode="dry-run" if dry_run else "live",
    )

    # Copy seed into workspace
    seed_text = SEED.read_text(encoding="utf-8")
    (workspace / "idea.md").write_text(seed_text, encoding="utf-8")

    if dry_run:
        rc, stdout, stderr = dry_run_prometheus(workspace)
    else:
        # Prometheus owns planning and publication, but not implementation.
        prompt = (
            "Read idea.md and plan this project. Publish one complete registered "
            "schema-v1 generated-agent package under .opencode, follow the documented "
            "handoff, and stop before implementation."
        )
        rc, stdout, stderr = run_opencode_agent(
            agent="prometheus",
            prompt=prompt,
            workspace=workspace,
            timeout_seconds=600,
        )

    report.evidence["opencode_exit_code"] = rc
    report.evidence["stdout_tail"] = stdout[-3000:] if stdout else ""
    report.evidence["stderr_tail"] = stderr[-1000:] if stderr else ""
    report.checks.append({
        "name": "Prometheus run completed",
        "passed": rc == 0,
        "note": "" if rc == 0 else f"OpenCode exited with status {rc}.",
    })

    handoff = opencode_text(stdout)
    planning_report = score_package(workspace, handoff)
    for c in planning_report.checks:
        report.checks.append({
            "name": c.name,
            "passed": c.passed,
            "note": c.note,
            "evidence": c.evidence,
        })

    registry = workspace / ".opencode" / "generated-agents.json"
    report.evidence["registry_path"] = str(registry) if registry.is_file() else ""

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
                test_name="test_planning",
                execution_mode="live",
                verdict=SKIPPED,
                error=reason,
            )
            print(report.render())
            out_path = write_report(report, Path(args.out).parent if args.out else REPORTS)
            print(f"Report: {out_path}")
            return 1

    workspace = make_workspace("planning")
    try:
        report = run_test(workspace, dry_run=args.dry_run)
    except Exception as e:
        report = TestReport(
            test_name="test_planning",
            execution_mode="dry-run" if args.dry_run else "live",
            verdict=FAIL,
            error=str(e),
        )
    finally:
        if not args.keep_workspace:
            import shutil as _shutil
            _shutil.rmtree(workspace, ignore_errors=True)

    print(report.render())
    out_path = write_report(
        report,
        Path(args.out).parent if args.out else REPORTS,
    )
    if args.out:
        import shutil as _shutil
        _shutil.copy(out_path, args.out)
    print(f"Report: {out_path}")

    return 0 if report.verdict == PASS else 1


if __name__ == "__main__":
    raise SystemExit(main())
