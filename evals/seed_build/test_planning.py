#!/usr/bin/env python3
"""
evals/seed_build/test_planning.py  —  Test 1: Loose idea → @prometheus → well-formed SPEC

Feeds the seed idea to a live @prometheus agent in a disposable workspace.
Captures the SPEC.md it produces and scores it against the frozen planning oracle.

Usage:
    python3 evals/seed_build/test_planning.py [--out path/to/report.json]

Exits:
    0 = PASS or SKIPPED
    1 = FAIL or PARTIAL
    2 = internal error
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _harness import (
    PASS, PARTIAL, FAIL, SKIPPED,
    TestReport, make_workspace, write_report, should_skip,
    run_opencode_agent, dry_run_prometheus,
)

ORACLE   = Path(__file__).resolve().parent / "oracle"
SEED     = Path(__file__).resolve().parent / "seed" / "idea.md"
REPORTS  = Path(tempfile.gettempdir()) / "opencode-seed-build-reports"


def run_test(workspace: Path, dry_run: bool = False) -> TestReport:
    report = TestReport(test_name="test_planning")

    # Copy seed into workspace
    seed_text = SEED.read_text(encoding="utf-8")
    (workspace / "idea.md").write_text(seed_text, encoding="utf-8")

    if dry_run:
        rc, stdout, stderr = dry_run_prometheus(workspace)
    else:
        # Run @prometheus with the loose idea as the prompt
        prompt = (
            "Read idea.md and use the @prometheus workflow to plan this project. "
            "Publish the complete canonical SPEC.md and opencode-autonomous.json directly in the workspace."
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
        "name": "OpenCode run completed",
        "passed": rc == 0,
        "note": "" if rc == 0 else f"OpenCode exited with status {rc}.",
    })

    spec_text: str | None = None
    if (workspace / "SPEC.md").exists():
        spec_text = (workspace / "SPEC.md").read_text(encoding="utf-8")
        report.evidence["spec_source"] = "SPEC.md_on_disk"
    else:
        report.checks.append({
            "name": "SPEC produced by @prometheus",
            "passed": False,
            "note": "No SPEC.md was written to the workspace.",
        })
        report.verdict = FAIL
        return report

    report.checks.append({
        "name": "SPEC produced by @prometheus",
        "passed": True,
        "evidence": f"source={report.evidence['spec_source']} length={len(spec_text)}",
    })

    manifest_path = workspace / "opencode-autonomous.json"
    if not manifest_path.exists():
        report.checks.append({
            "name": "Manifest produced by @prometheus",
            "passed": False,
            "note": "No opencode-autonomous.json was written to the workspace.",
        })
        report.verdict = FAIL
        return report
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        commands = re.findall(r"^- `([^`\n]+)`\s*$", spec_text, re.M)
        manifest_commands = manifest["verification"]["commands"]
        valid_manifest = (
            manifest.get("schema_version") == 2
            and manifest.get("strategy") in {"direct", "karpathy"}
            and commands == manifest_commands
        )
    except (json.JSONDecodeError, KeyError, TypeError):
        valid_manifest = False
    report.checks.append({
        "name": "Manifest produced by @prometheus",
        "passed": valid_manifest,
        "note": "Manifest must be schema-v2 and match SPEC verification commands.",
    })

    # Score with planning_checks
    import importlib.util
    spec_path = Path(__file__).resolve().parent / "planning_checks.py"
    mod_spec = importlib.util.spec_from_file_location("planning_checks", spec_path)
    planning = importlib.util.module_from_spec(mod_spec)
    sys.modules["planning_checks"] = planning  # register before exec for @dataclass compat
    mod_spec.loader.exec_module(planning)

    planning_report = planning.score_spec(spec_text)
    for c in planning_report.checks:
        report.checks.append({
            "name": c.name,
            "passed": c.passed,
            "note": c.note,
            "evidence": c.evidence,
        })

    # Write the SPEC to disk for inspection regardless
    (workspace / "prometheus_output.md").write_text(spec_text, encoding="utf-8")

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
        report = TestReport(test_name="test_planning", verdict=FAIL, error=str(e))
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
