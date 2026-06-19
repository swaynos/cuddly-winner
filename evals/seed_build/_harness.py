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

# Verdict constants matching docs/testing-methodology.md
PASS    = "PASS"
PARTIAL = "PARTIAL"
FAIL    = "FAIL"
SKIPPED = "SKIPPED"


@dataclass
class TestReport:
    test_name: str
    verdict: str
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
    """Heuristic: at least one model provider env var is set."""
    provider_keys = [
        "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
        "AWS_PROFILE", "AWS_ACCESS_KEY_ID",
        "GOOGLE_API_KEY", "GEMINI_API_KEY",
    ]
    return any(os.environ.get(k) for k in provider_keys)


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
    Run `opencode run --agent <agent> --message <prompt>` in workspace.
    Returns (exit_code, stdout, stderr).
    """
    cmd = [
        "opencode", "run",
        "--agent", agent,
        "--message", prompt,
        "--no-interactive",
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
