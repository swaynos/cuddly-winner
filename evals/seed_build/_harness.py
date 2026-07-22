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
PROVIDER_KEYS = (
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
)


def load_dotenv(path: Path = ROOT / ".env") -> dict[str, str]:
    """Load simple KEY=VALUE entries without mutating or logging the environment."""
    if os.environ.get("OPENCODE_EVAL_DOTENV") == "0":
        return {}
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or not key.replace("_", "a").isalnum() or key[0].isdigit():
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def redact_secrets(text: str, secrets: dict[str, str]) -> str:
    for value in sorted((value for value in secrets.values() if value), key=len, reverse=True):
        text = text.replace(value, "[REDACTED]")
    return text


def agent_environment(
    workspace: Path,
    dotenv_path: Path = ROOT / ".env",
) -> tuple[dict[str, str], dict[str, str]]:
    dotenv = load_dotenv(dotenv_path)
    env = os.environ.copy()
    for key, value in dotenv.items():
        env.setdefault(key, value)
    secrets = {
        key: value
        for key, value in env.items()
        if value and (key in PROVIDER_KEYS or key in dotenv)
    }
    runtime = workspace / ".opencode-runtime"
    env["PWD"] = str(workspace)
    for variable, child in (
        ("XDG_DATA_HOME", "data"),
        ("XDG_CACHE_HOME", "cache"),
        ("XDG_STATE_HOME", "state"),
    ):
        target = runtime / child
        target.mkdir(parents=True, exist_ok=True)
        env[variable] = str(target)
    return env, secrets


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
        if self.verdict not in (PASS, ""):
            for key in ("opencode_exit_code", "stdout_tail", "stderr_tail"):
                value = self.evidence.get(key)
                if value not in (None, ""):
                    lines.append(f"  {key}: {value}")
        lines.append("="*60)
        return "\n".join(lines)


def opencode_available() -> bool:
    """Return True if the opencode binary is on PATH."""
    return shutil.which("opencode") is not None


def credentials_available() -> bool:
    """Heuristic: a real model API key (not just a profile name) is set."""
    dotenv = load_dotenv()
    return any(os.environ.get(key) or dotenv.get(key) for key in PROVIDER_KEYS)


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
    subprocess.run(
        ["git", "init", "--quiet"],
        cwd=d,
        check=True,
        capture_output=True,
        text=True,
    )
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
        "--dir", str(workspace),
        "--agent", agent,
        prompt,
    ]
    env, secrets = agent_environment(workspace)
    try:
        result = subprocess.run(
            cmd,
            cwd=str(workspace),
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        return (
            result.returncode,
            redact_secrets(result.stdout, secrets),
            redact_secrets(result.stderr, secrets),
        )
    except subprocess.TimeoutExpired as error:
        stdout = error.stdout.decode(errors="replace") if isinstance(error.stdout, bytes) else (error.stdout or "")
        stderr = error.stderr.decode(errors="replace") if isinstance(error.stderr, bytes) else (error.stderr or "")
        return (
            1,
            redact_secrets(stdout, secrets),
            redact_secrets(f"{stderr}\nTimed out after {timeout_seconds}s", secrets),
        )
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
    canonical = ROOT / "evals" / "seed_build" / "CANONICAL_SPEC.md"
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
    stub_stdout = "Stub @autonomous response for dry-run; native verification is simulated.\n"
    return 0, stub_stdout, ""
