#!/usr/bin/env python3
"""
evals/seed_build/test_build.py - Test 2: generated-agent package to great build

Starts the canonical project-local generated agent in a disposable workspace.
Validates its output, fresh verification, and task-package immutability against
the frozen rules-engine oracle.

Usage:
    python3 evals/seed_build/test_build.py [--out path/to/report.json]

Exits:
    0 = PASS
    1 = FAIL, PARTIAL, or SKIPPED
"""
from __future__ import annotations

import argparse
import importlib.util
import json
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
    run_opencode_agent, dry_run_generated_agent, copy_canonical_package,
    parse_opencode_events, verification_event_results, GENERATED_AGENT_NAME,
)

ORACLE    = Path(__file__).resolve().parent / "oracle"
ACCEPTANCE = ORACLE / "acceptance"
REPORTS   = Path(tempfile.gettempdir()) / "opencode-seed-build-reports"
TASK_MANIFEST = f".opencode/tasks/{GENERATED_AGENT_NAME}.json"
PACKAGE_FILES = (
    ".opencode/generated-agents.json",
    f".opencode/agents/{GENERATED_AGENT_NAME}.md",
    f".opencode/tasks/{GENERATED_AGENT_NAME}.md",
    TASK_MANIFEST,
)


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod  # register before exec so @dataclass resolves annotations
    spec.loader.exec_module(mod)
    return mod


def _find_rules_engine(workspace: Path) -> Path | None:
    """Locate the built rules_engine.py in the generated-agent workspace."""
    candidates = list(workspace.rglob("rules_engine.py"))
    return candidates[0] if candidates else None


def _workspace_input_leaks(workspace: Path) -> list[str]:
    """Find hidden acceptance inputs or a byte-for-byte golden implementation."""
    leaks = []
    for relative in (".oracle_readonly", "oracle"):
        if (workspace / relative).exists():
            leaks.append(relative)

    reference = (ORACLE / "reference" / "rules_engine.py").read_bytes()
    for path in workspace.rglob("*"):
        relative = path.relative_to(workspace)
        if ".git" in relative.parts or ".opencode-runtime" in relative.parts:
            continue
        if path.is_symlink() or not path.is_file():
            continue
        try:
            if path.read_bytes() == reference:
                leaks.append(str(relative))
        except OSError:
            leaks.append(f"unreadable:{relative}")
    return sorted(set(leaks))


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


def _read_regular_file(path: Path) -> bytes | None:
    if path.is_symlink() or not path.is_file():
        return None
    return path.read_bytes()


def _package_bytes(workspace: Path) -> dict[str, bytes | None]:
    return {relative: _read_regular_file(workspace / relative) for relative in PACKAGE_FILES}


def _check_contract_compliance(
    before: dict[str, bytes | None],
    workspace: Path,
) -> list[dict]:
    after = _package_bytes(workspace)
    changed = [
        relative for relative in PACKAGE_FILES
        if before.get(relative) is None or before.get(relative) != after.get(relative)
    ]
    retired = [
        name for name in ("SPEC.md", "opencode-autonomous.json")
        if (workspace / name).exists()
    ]
    return [
        {
            "name": "Published generated-agent package remains unchanged",
            "passed": not changed,
            "note": "" if not changed else f"Changed or missing package files: {changed}",
        },
        {
            "name": "Retired build handoff artifacts remain absent",
            "passed": not retired,
            "note": "" if not retired else f"Retired artifacts found: {retired}",
        },
    ]


def _declared_verification_commands(workspace: Path) -> list[str]:
    manifest = json.loads((workspace / TASK_MANIFEST).read_text(encoding="utf-8"))
    commands = manifest["verification"]["commands"]
    if not isinstance(commands, list) or not commands or not all(
        isinstance(command, str) and command for command in commands
    ):
        raise TypeError("verification.commands must be a non-empty string list")
    return commands


def _session_verification_results(stdout: str, commands: list[str]) -> list[dict]:
    """Score exact completed Bash events against the session's final mutation."""
    return verification_event_results(parse_opencode_events(stdout), commands)


def _run_declared_verification(
    workspace: Path,
    commands: list[str] | None = None,
) -> list[dict]:
    try:
        commands = commands or _declared_verification_commands(workspace)
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        return [{"command": "", "returncode": 1, "output": f"Cannot load commands: {error}"}]

    results = []
    for command in commands:
        try:
            completed = subprocess.run(
                command,
                shell=True,
                cwd=str(workspace),
                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
                capture_output=True,
                text=True,
                timeout=300,
            )
            results.append({
                "command": command,
                "returncode": completed.returncode,
                "output": completed.stdout + completed.stderr,
            })
        except subprocess.TimeoutExpired:
            results.append({"command": command, "returncode": 124, "output": "Timed out after 300s"})
    return results


def run_test(workspace: Path, dry_run: bool = False) -> TestReport:
    report = TestReport(
        test_name="test_build",
        execution_mode="dry-run" if dry_run else "live",
    )

    # Install the same package a new generated-agent session would load.
    copy_canonical_package(workspace)
    package_before = _package_bytes(workspace)
    package_ready = all(value is not None for value in package_before.values())
    report.checks.append({
        "name": "Canonical registered generated-agent package loaded",
        "passed": package_ready,
        "note": "" if package_ready else "One or more canonical package files are missing.",
    })
    shutil.copy2(Path(__file__).resolve().parent / "seed" / "idea.md", workspace / "idea.md")

    input_leaks = _workspace_input_leaks(workspace)
    report.checks.append({
        "name": "Golden implementation and hidden acceptance stay outside generated-agent input",
        "passed": not input_leaks,
        "note": "" if not input_leaks else f"Leaked input paths: {input_leaks}",
    })

    if input_leaks:
        rc, stdout, stderr = 1, "", "Refusing to run with hidden evaluator inputs in the workspace."
    elif dry_run:
        rc, stdout, stderr = dry_run_generated_agent(workspace)
    else:
        prompt = (
            "Read your published task brief and manifest, implement the workflow "
            "rules engine, and run every declared verification command."
        )
        rc, stdout, stderr = run_opencode_agent(
            agent=GENERATED_AGENT_NAME,
            prompt=prompt,
            workspace=workspace,
            timeout_seconds=int(os.environ.get("OPENCODE_BUILD_TIMEOUT", "900")),
            auto=True,
        )

    report.evidence["opencode_exit_code"] = rc
    report.evidence["stdout_tail"] = stdout[-3000:] if stdout else ""
    report.evidence["stderr_tail"] = stderr[-1000:] if stderr else ""
    report.checks.append({
        "name": "Generated-agent run completed",
        "passed": rc == 0,
        "note": "" if rc == 0 else f"OpenCode exited with status {rc}.",
    })

    # Find the built rules engine
    engine_path = _find_rules_engine(workspace)
    if not engine_path:
        report.checks.append({
            "name": "rules_engine.py produced",
            "passed": False,
            "note": f"No rules_engine.py found after the {GENERATED_AGENT_NAME} run.",
        })
        report.checks.extend([
            {
                "name": "Frozen acceptance suite passes",
                "passed": False,
                "note": "No generated rules engine was available to test.",
            },
            {
                "name": "No checked failure patterns found",
                "passed": False,
                "note": "No generated rules engine was available to scan.",
            },
        ])
    else:
        report.checks.append({
            "name": "rules_engine.py produced",
            "passed": True,
            "evidence": str(engine_path.relative_to(workspace)),
        })
        report.evidence["engine_path"] = str(engine_path)

        acceptance_ok, acceptance_output = _run_acceptance_suite(engine_path)
        report.evidence["acceptance_output"] = acceptance_output[-3000:]
        report.checks.append({
            "name": "Frozen acceptance suite passes",
            "passed": acceptance_ok,
            "note": "" if acceptance_ok else (
                f"One or more acceptance tests failed:\n{acceptance_output[-1500:]}"
            ),
        })

        failure_modes = _load_module("failure_modes", ORACLE / "failure_modes.py")
        fm_report = failure_modes.check_all(engine_path)
        report.evidence["failure_modes"] = fm_report.render()
        report.checks.append({
            "name": "No checked failure patterns found",
            "passed": fm_report.passed,
            "note": "" if fm_report.passed
                    else f"Failure modes: {'; '.join(fm_report.failures[:3])}",
        })

    report.checks.extend(_check_contract_compliance(package_before, workspace))

    try:
        commands = _declared_verification_commands(workspace)
        command_error = ""
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        commands = []
        command_error = str(error)
    report.checks.append({
        "name": "Declared verification commands load from the manifest",
        "passed": not command_error,
        "note": command_error,
    })

    session_results = _session_verification_results(stdout, commands)
    report.evidence["generated_session_verification"] = session_results
    for index, result in enumerate(session_results, start=1):
        report.checks.append({
            "name": f"Generated-session declared verification command {index} completed",
            "passed": result["passed"],
            "note": "" if result["passed"] else (
                f"Exact command had statuses {result['statuses']} and post-mutation statuses "
                f"{result['fresh_statuses']}; final mutation event: "
                f"{result['last_mutation_event']}; observed commands: {result['observed_commands']}"
            ),
            "evidence": result["command"],
        })

    session_verified = bool(commands) and all(result["passed"] for result in session_results)
    if session_verified:
        verification_results = _run_declared_verification(workspace, commands)
        report.evidence["declared_verification"] = [
            {
                "command": result["command"],
                "returncode": result["returncode"],
                "output_tail": result["output"][-1000:],
            }
            for result in verification_results
        ]
        for index, result in enumerate(verification_results, start=1):
            report.checks.append({
                "name": f"Fresh declared verification command {index} exits 0",
                "passed": result["returncode"] == 0,
                "note": "" if result["returncode"] == 0 else (
                    f"Exit {result['returncode']}: {result['output'][-800:]}"
                ),
                "evidence": result["command"],
            })
    else:
        report.evidence["declared_verification"] = []
        report.checks.append({
            "name": "Independent replay waits for generated-session verification evidence",
            "passed": False,
            "note": "Independent replay was not run because exact completed tool events were missing.",
        })

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
                execution_mode="live",
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
        report = TestReport(
            test_name="test_build",
            execution_mode="dry-run" if args.dry_run else "live",
            verdict=FAIL,
            error=str(e),
        )
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
