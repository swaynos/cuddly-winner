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
CANONICAL_PACKAGE = Path(__file__).resolve().parent / "canonical"
GENERATED_AGENT_NAME = "workflow-rules-engine"

# Verdict constants matching docs/TESTING-METHODOLOGY.md
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
MUTATION_TOOLS = frozenset({"edit", "write", "patch", "apply_patch"})


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
    execution_mode: str = "live"
    verdict: str = ""
    checks: list[dict] = field(default_factory=list)
    evidence: dict = field(default_factory=dict)
    error: str = ""

    def to_dict(self) -> dict:
        return {
            "test_name": self.test_name,
            "execution_mode": self.execution_mode,
            "verdict": self.verdict,
            "checks": self.checks,
            "evidence": self.evidence,
            "error": self.error,
        }

    def render(self) -> str:
        mode = "DRY-RUN (STUB)" if self.execution_mode == "dry-run" else "LIVE"
        lines = [
            f"\n{'='*60}",
            f"Test: {self.test_name}",
            f"Execution mode: {mode}",
            f"Verdict: {self.verdict}",
        ]
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


def parse_opencode_events(stream: str) -> list[dict]:
    """Parse OpenCode's newline-delimited JSON output, ignoring non-event lines."""
    events: list[dict] = []
    for line in stream.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def verification_event_results(events: list[dict], commands: list[str]) -> list[dict]:
    """Require exact completed Bash commands after the final mutation event."""
    last_mutation_index = -1
    last_mutation_tool = ""
    observed = []
    for index, event in enumerate(events):
        part = event.get("part")
        if event.get("type") != "tool_use" or not isinstance(part, dict):
            continue
        tool = part.get("tool")
        if tool in MUTATION_TOOLS:
            last_mutation_index = index
            last_mutation_tool = tool
            continue
        state = part.get("state")
        if tool != "bash" or not isinstance(state, dict):
            continue
        inputs = state.get("input")
        command = inputs.get("command") if isinstance(inputs, dict) else None
        if isinstance(command, str):
            observed.append({
                "command": command,
                "status": state.get("status"),
                "event_index": index,
            })

    results = []
    for command in commands:
        matching = [item for item in observed if item["command"] == command]
        fresh = [item for item in matching if item["event_index"] > last_mutation_index]
        results.append({
            "command": command,
            "passed": any(item["status"] == "completed" for item in fresh),
            "statuses": [item["status"] for item in matching],
            "fresh_statuses": [item["status"] for item in fresh],
            "last_mutation_event": (
                {"index": last_mutation_index, "tool": last_mutation_tool}
                if last_mutation_index >= 0 else None
            ),
            "observed_commands": [item["command"] for item in observed],
        })
    return results


def opencode_text(stream: str) -> str:
    """Extract assistant text from an OpenCode JSON event stream."""
    parts = []
    for event in parse_opencode_events(stream):
        part = event.get("part")
        if (
            event.get("type") == "text"
            and isinstance(part, dict)
            and isinstance(part.get("text"), str)
        ):
            parts.append(part["text"])
    return "\n".join(parts)


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
    *,
    auto: bool = False,
) -> tuple[int, str, str]:
    """
    Run `opencode run --agent <agent> <prompt>` in workspace.
    Returns (exit_code, stdout, stderr).
    """
    cmd = [
        "opencode", "run",
        "--dir", str(workspace),
        "--agent", agent,
        "--format", "json",
    ]
    if auto:
        cmd.append("--auto")
    cmd.append(prompt)
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

def copy_canonical_package(workspace: Path) -> None:
    """Publish the canonical generated-agent package into a workspace."""
    shutil.copytree(
        CANONICAL_PACKAGE / ".opencode",
        workspace / ".opencode",
        dirs_exist_ok=True,
    )


def dry_run_prometheus(workspace: Path) -> tuple[int, str, str]:
    """
    Simulate Prometheus publishing the canonical schema-v1 task package and
    returning the required fresh-context handoff.
    Returns (exit_code, stdout, stderr) matching run_opencode_agent signature.
    """
    copy_canonical_package(workspace)
    handoff = (CANONICAL_PACKAGE / "PROMETHEUS_HANDOFF.txt").read_text(encoding="utf-8")
    event = {"type": "text", "part": {"text": f"[DRY-RUN STUB]\n{handoff}"}}
    return 0, json.dumps(event) + "\n", ""


def dry_run_generated_agent(workspace: Path) -> tuple[int, str, str]:
    """
    Simulate the canonical project-local generated agent by copying the frozen
    reference implementation into the workspace.
    Returns (exit_code, stdout, stderr) matching run_opencode_agent signature.
    """
    ref_engine = ORACLE / "reference" / "rules_engine.py"
    (workspace / "rules_engine.py").write_text(
        ref_engine.read_text(encoding="utf-8"), encoding="utf-8"
    )
    try:
        manifest = json.loads(
            (workspace / f".opencode/tasks/{GENERATED_AGENT_NAME}.json").read_text(
                encoding="utf-8"
            )
        )
        commands = manifest["verification"]["commands"]
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        return 1, "", f"[DRY-RUN STUB] Cannot load verification commands: {error}"

    events = [{
        "type": "tool_use",
        "part": {
            "tool": "write",
            "state": {
                "input": {"filePath": "rules_engine.py"},
                "status": "completed",
                "output": "[DRY-RUN STUB] synthetic implementation write",
            },
        },
    }]
    events.extend(
        {
            "type": "tool_use",
            "part": {
                "tool": "bash",
                "state": {
                    "input": {"command": command},
                    "status": "completed",
                    "output": "[DRY-RUN STUB] synthetic command completion",
                },
            },
        }
        for command in commands
    )
    events.append({
        "type": "text",
        "part": {
            "text": (
                f"[DRY-RUN STUB] Generated agent {GENERATED_AGENT_NAME} produced "
                "the canonical output; the outer harness performs independent verification."
            )
        },
    })
    return 0, "\n".join(json.dumps(event) for event in events) + "\n", ""
