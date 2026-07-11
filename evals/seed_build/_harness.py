"""
evals/seed_build/_harness.py

Shared utilities for the live seed-to-build tests.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ORACLE = Path(__file__).resolve().parent / "oracle"

# Verdict constants matching docs/testing-methodology.md
PASS    = "PASS"
PARTIAL = "PARTIAL"
FAIL    = "FAIL"
SKIPPED = "SKIPPED"


@dataclass
class TestReport:
    test_name: str
    verdict: str = ""
    checks: list[dict] = field(default_factory=list)
    evidence: dict = field(default_factory=dict)
    error: str = ""

    def to_dict(self) -> dict:
        return {
            "test_name": self.test_name,
            "verdict": self.verdict,
            "checks": self.checks,
            "evidence": self.evidence,
            "error": self.error,
        }

    def render(self) -> str:
        lines = [f"\n{'='*60}", f"Test: {self.test_name}", f"Verdict: {self.verdict}"]
        if self.error:
            lines.append(f"Error: {self.error}")
        for c in self.checks:
            mark = "✓" if c.get("passed") else "✗"
            lines.append(f"  {mark} {c.get('name','?')}")
            if not c.get("passed") and c.get("note"):
                lines.append(f"      {c['note']}")
        lines.append("="*60)
        return "\n".join(lines)


def opencode_available() -> bool:
    """Return True if the opencode binary is on PATH."""
    return shutil.which("opencode") is not None


def credentials_available() -> bool:
    """Heuristic: a real model API key (not just a profile name) is set."""
    real_key_vars = [
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "GOOGLE_API_KEY",
        "GEMINI_API_KEY",
        "AWS_ACCESS_KEY_ID",   # real key, not just a profile name
    ]
    return any(os.environ.get(k) for k in real_key_vars)


def should_skip() -> tuple[bool, str]:
    """Return (skip, reason) if the live tests should be skipped."""
    if not opencode_available():
        return True, "opencode binary not found on PATH"
    if not credentials_available():
        return True, "no model provider credentials found in environment"
    return False, ""


def make_workspace(base_name: str) -> Path:
    """Create a disposable temp workspace and return its path."""
    d = Path(tempfile.mkdtemp(prefix=f"seed-build-{base_name}-"))
    return d


def write_report(report: TestReport, reports_dir: Path) -> Path:
    reports_dir.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%dT%H%M%S")
    out = reports_dir / f"{report.test_name.replace(' ', '_')}_{ts}.json"
    out.write_text(json.dumps(report.to_dict(), indent=2) + "\n", encoding="utf-8")
    return out


def run_opencode_agent(
    agent: str,
    prompt: str,
    workspace: Path,
    timeout_seconds: int = 600,
) -> tuple[int, str, str]:
    """
    Run `opencode run --agent <agent> <prompt>` in workspace.
    Returns (exit_code, stdout, stderr).
    """
    cmd = [
        "opencode", "run",
        "--agent", agent,
        prompt,
    ]
    try:
        result = subprocess.run(
            cmd,
            cwd=str(workspace),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return 1, "", f"Timed out after {timeout_seconds}s"
    except FileNotFoundError:
        return 1, "", "opencode binary not found"


# ---------------------------------------------------------------------------
# Dry-run stubs — exercise all scoring/validation logic without live agents
# ---------------------------------------------------------------------------

def dry_run_prometheus(workspace: Path) -> tuple[int, str, str]:
    """
    Stub for dry-run mode: simulate a @prometheus response by copying the
    canonical SPEC into the workspace as SPEC.md.
    Returns (exit_code, stdout, stderr) matching run_opencode_agent signature.
    """
    canonical = ORACLE / "CANONICAL_SPEC.md"
    (workspace / "SPEC.md").write_text(
        canonical.read_text(encoding="utf-8"), encoding="utf-8"
    )
    stub_stdout = (
        "Stub @prometheus response for dry-run.\n"
        "Wrote canonical SPEC.md directly. Invoke @autonomous to execute SPEC.md."
    )
    return 0, stub_stdout, ""


def dry_run_autonomous(workspace: Path) -> tuple[int, str, str]:
    """
    Stub for dry-run mode: simulate a @autonomous response by copying the
    reference implementation into the workspace.
    Returns (exit_code, stdout, stderr) matching run_opencode_agent signature.
    """
    ref_engine = ORACLE / "reference" / "rules_engine.py"
    (workspace / "rules_engine.py").write_text(
        ref_engine.read_text(encoding="utf-8"), encoding="utf-8"
    )
    # Write minimal progress and produce evidence through the trusted runner.
    (workspace / "progress.txt").write_text(
        "## Strategy\nSelected: direct\nReason: Dry-run stub.\n\n"
        "## Verification\n- trusted runner dry-run completed\n",
        encoding="utf-8",
    )
    script = (
        f'import {{run}} from {str(ROOT / ".opencode/tool/run.ts")!r};'
        f'const r=await run({{command:"true",cwd:{str(workspace)!r}}});if(r.exit_code!==0)process.exit(1)'
    )
    subprocess.run(["node", "--input-type=module", "-e", script], check=True, capture_output=True, text=True)
    stub_stdout = "Stub @autonomous response for dry-run; trusted runner evidence is on disk.\n"
    return 0, stub_stdout, ""
