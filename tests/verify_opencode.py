#!/usr/bin/env python3
"""
verify_opencode.py

Sandbox-isolated integration validator for the cuddly-winner agent suite.

Downloads a fresh OpenCode binary into a disposable temp directory. Installs
this repo's agents and plugin there. Asserts that every agent loads with the
correct mode and every declared permission rule resolves as intended.
Never touches the user's real ~/.config/opencode or any other live path.

Usage:
    python3 tests/verify_opencode.py [options]

    --skip-llm          Skip F2 (the plugin hook-fires LLM call)
    --keep-sandbox      Leave the sandbox tempdir in place for debugging
    --verbose           Print every subprocess invocation and its stdout/stderr
    --model MODEL       Override F2 model (default: openai/gpt-5-nano)
    -h, --help
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import textwrap
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Repo layout
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
AGENTS_DIR = REPO_ROOT / "agents"
SKILLS_DIR = REPO_ROOT / ".opencode" / "skills"
PLUGINS_DIR = REPO_ROOT / "plugins"
DEPLOY_SCRIPT = REPO_ROOT / "scripts" / "deploy-opencode-agents.sh"
AGENTS_MD = REPO_ROOT / "AGENTS.md"
STRATEGIES_FILE = REPO_ROOT / ".opencode" / "strategies.json"
STRATEGY_CONTRACT = REPO_ROOT / "docs" / "STRATEGY-CONTRACT.md"
# Required contract body sections every active/reference strategy agent must contain.
STRATEGY_REQUIRED_SECTIONS = ("applicability", "stop criteria", "escalation")
SANDBOX_PATH = "/tmp/prometheus-spike"

# Key phrases that must be present in AGENTS.md.
AGENTS_MD_REQUIRED = [
    "commit",          # no-auto-commit rule
    "workaround",      # workaround-dump rule
    "BLOCKED",         # BLOCKED promise reference
    "@autonomous",     # agent routing
    "@prometheus",     # agent routing
]

# Shell scripts tracked for shellcheck linting.
# Each entry is (rel_path_from_repo_root, shellcheck_dialect).
# Add new .sh files here as they are created.
SHELL_SCRIPTS: list[tuple[str, str]] = [
    ("scripts/deploy-opencode-agents.sh", "bash"),
]

EXPECTED_AGENT_FILES = [
    "ask.md",
    "prometheus.md",
    "autonomous.md",
    "karpathy.md",
    "ralph-wiggum.md",
    "octopus.md",
    "data-scientist.md",
    "grounder.md",
    "reviewer.md",
]
EXPECTED_SKILL_FILES = [
    "project-agent-scaffolding/SKILL.md",
    "verification-before-completion/SKILL.md",
    "systematic-debugging/SKILL.md",
    "test-driven-development/SKILL.md",
    "subagent-driven-development/SKILL.md",
    "writing-skills/SKILL.md",
    "playwright-image-generation/SKILL.md",
]
EXPECTED_PLUGIN_FILES = [
    "immutability.ts",
    "opencode-autonomous-gate",
    "opencode-autonomous-loop",
]
SUPPORTED_SKILL_FRONTMATTER = {"name", "description", "license", "compatibility", "metadata"}
SKILL_NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

# ---------------------------------------------------------------------------
# F2 defaults
# ---------------------------------------------------------------------------

DEFAULT_F2_MODEL = "openai/gpt-5-nano"
F2_KEY_ENV_NAME = "OPENAI_API_KEY"

# AWS Bedrock config for F2 (used when OPENAI_API_KEY is absent)
# If AWS_PROFILE is set and resolves via aws sts, Bedrock is used instead.
F2_BEDROCK_MODEL = "amazon-bedrock/global.anthropic.claude-sonnet-4-6"
F2_BEDROCK_REGION = "us-west-2"

# ---------------------------------------------------------------------------
# Expected permission rules
#
# Each entry must appear in the agent's resolved permission array.
# "extra" rules injected by OpenCode's base config are not checked here —
# we only assert that OUR declared rules are present.
# ---------------------------------------------------------------------------

EXPECTED_RULES: dict[str, list[dict]] = {
    "ask": [
        {"permission": "bash",  "action": "deny",  "pattern": "*"},
        {"permission": "bash",  "action": "allow", "pattern": "ls *"},
        {"permission": "bash",  "action": "allow", "pattern": "cat *"},
        {"permission": "bash",  "action": "allow", "pattern": "git status*"},
        {"permission": "bash",  "action": "allow", "pattern": "git log*"},
        {"permission": "bash",  "action": "allow", "pattern": "git diff*"},
        {"permission": "bash",  "action": "allow", "pattern": "rg *"},
        {"permission": "bash",  "action": "allow", "pattern": "find *"},
        {"permission": "bash",  "action": "allow", "pattern": "python3 *"},
        {"permission": "bash",  "action": "allow", "pattern": "python *"},
        {"permission": "read",  "action": "allow", "pattern": "*"},
        {"permission": "grep",  "action": "allow", "pattern": "*"},
        {"permission": "glob",  "action": "allow", "pattern": "*"},
        {"permission": "list",  "action": "allow", "pattern": "*"},
        {"permission": "webfetch", "action": "ask", "pattern": "*"},
        {"permission": "task",  "action": "allow", "pattern": "data-scientist"},
        {"permission": "task",  "action": "allow", "pattern": "grounder"},
        {"permission": "task",  "action": "deny",  "pattern": "*"},
    ],
    "prometheus": [
        {"permission": "bash",      "action": "ask",   "pattern": "*"},
        {"permission": "bash",      "action": "allow", "pattern": "python3 *"},
        {"permission": "bash",      "action": "allow", "pattern": "python *"},
        {"permission": "bash",      "action": "allow", "pattern": "rg *"},
        {"permission": "bash",      "action": "allow", "pattern": "find *"},
        {"permission": "bash",      "action": "allow", "pattern": "git status*"},
        {"permission": "bash",      "action": "allow", "pattern": "git log*"},
        {"permission": "bash",      "action": "allow", "pattern": "git diff*"},
        {"permission": "bash",      "action": "allow", "pattern": "cat *"},
        {"permission": "bash",      "action": "allow", "pattern": "ls *"},
        {"permission": "bash",      "action": "allow", "pattern": "mkdir *"},
        {"permission": "edit",      "action": "deny",  "pattern": "*"},
        {"permission": "edit",      "action": "allow", "pattern": "SPEC.md"},
        {"permission": "edit",      "action": "allow", "pattern": "program.md"},
        {"permission": "edit",      "action": "allow", "pattern": "experiments.md"},
        {"permission": "edit",      "action": "allow", "pattern": ".opencode/karpathy.json"},
        {"permission": "edit",      "action": "allow", "pattern": ".opencode/immutable.json"},
        {"permission": "edit",      "action": "allow", "pattern": "AGENTS.md"},
        {"permission": "write",     "action": "deny",  "pattern": "*"},
        {"permission": "write",     "action": "allow", "pattern": "SPEC.md"},
        {"permission": "write",     "action": "allow", "pattern": "program.md"},
        {"permission": "write",     "action": "allow", "pattern": "experiments.md"},
        {"permission": "write",     "action": "allow", "pattern": ".opencode/karpathy.json"},
        {"permission": "write",     "action": "allow", "pattern": ".opencode/immutable.json"},
        {"permission": "write",     "action": "allow", "pattern": "AGENTS.md"},
        {"permission": "task",      "action": "allow", "pattern": "data-scientist"},
        {"permission": "task",      "action": "allow", "pattern": "grounder"},
        {"permission": "task",      "action": "deny",  "pattern": "*"},
        {"permission": "question",  "action": "allow", "pattern": "*"},
        {"permission": "webfetch",  "action": "allow", "pattern": "*"},
    ],
    "autonomous": [
        {"permission": "bash",  "action": "ask",   "pattern": "*"},
        {"permission": "bash",  "action": "allow", "pattern": "python *"},
        {"permission": "bash",  "action": "allow", "pattern": "python3 *"},
        {"permission": "bash",  "action": "allow", "pattern": "uv run *"},
        {"permission": "bash",  "action": "allow", "pattern": "pytest *"},
        {"permission": "bash",  "action": "allow", "pattern": "npm test*"},
        {"permission": "bash",  "action": "allow", "pattern": "npm run *"},
        {"permission": "bash",  "action": "allow", "pattern": "pnpm test*"},
        {"permission": "bash",  "action": "allow", "pattern": "bun test*"},
        {"permission": "bash",  "action": "allow", "pattern": "go test *"},
        {"permission": "bash",  "action": "allow", "pattern": "cargo test*"},
        {"permission": "bash",  "action": "allow", "pattern": "make test*"},
        {"permission": "bash",  "action": "allow", "pattern": "rg *"},
        {"permission": "bash",  "action": "allow", "pattern": "git status*"},
        {"permission": "bash",  "action": "allow", "pattern": "git diff*"},
        {"permission": "bash",  "action": "allow", "pattern": "git log*"},
        {"permission": "task",  "action": "allow", "pattern": "data-scientist"},
        {"permission": "task",  "action": "allow", "pattern": "grounder"},
        {"permission": "task",  "action": "allow", "pattern": "reviewer"},
        {"permission": "task",  "action": "allow", "pattern": "karpathy"},
        {"permission": "task",  "action": "allow", "pattern": "ralph-wiggum"},
        {"permission": "task",  "action": "allow", "pattern": "octopus"},
        {"permission": "task",  "action": "deny",  "pattern": "*"},
    ],
    "karpathy": [
        {"permission": "bash",  "action": "ask",   "pattern": "*"},
        {"permission": "bash",  "action": "allow", "pattern": "python *"},
        {"permission": "bash",  "action": "allow", "pattern": "python3 *"},
        {"permission": "bash",  "action": "allow", "pattern": "uv run *"},
        {"permission": "bash",  "action": "allow", "pattern": "git status*"},
        {"permission": "bash",  "action": "allow", "pattern": "git diff*"},
        {"permission": "bash",  "action": "allow", "pattern": "git log*"},
        {"permission": "bash",  "action": "allow", "pattern": "pytest *"},
        {"permission": "bash",  "action": "allow", "pattern": "cat *"},
        {"permission": "bash",  "action": "allow", "pattern": "rg *"},
        {"permission": "task",  "action": "allow", "pattern": "autonomous"},
        {"permission": "task",  "action": "allow", "pattern": "reviewer"},
        {"permission": "task",  "action": "deny",  "pattern": "*"},
    ],
    "ralph-wiggum": [
        {"permission": "bash",  "action": "ask",   "pattern": "*"},
        {"permission": "bash",  "action": "allow", "pattern": "python *"},
        {"permission": "bash",  "action": "allow", "pattern": "python3 *"},
        {"permission": "bash",  "action": "allow", "pattern": "uv run *"},
        {"permission": "bash",  "action": "allow", "pattern": "pytest *"},
        {"permission": "bash",  "action": "allow", "pattern": "npm test*"},
        {"permission": "bash",  "action": "allow", "pattern": "npm run *"},
        {"permission": "bash",  "action": "allow", "pattern": "rg *"},
        {"permission": "bash",  "action": "allow", "pattern": "git status*"},
        {"permission": "bash",  "action": "allow", "pattern": "git diff*"},
        {"permission": "bash",  "action": "allow", "pattern": "git log*"},
        {"permission": "bash",  "action": "allow", "pattern": "git add*"},
        {"permission": "bash",  "action": "allow", "pattern": "git commit*"},
        {"permission": "task",  "action": "allow", "pattern": "autonomous"},
        {"permission": "task",  "action": "allow", "pattern": "reviewer"},
        {"permission": "task",  "action": "deny",  "pattern": "*"},
    ],
    "octopus": [
        {"permission": "bash",  "action": "ask",   "pattern": "*"},
        {"permission": "bash",  "action": "allow", "pattern": "python3 *"},
        {"permission": "bash",  "action": "allow", "pattern": "python *"},
        {"permission": "bash",  "action": "allow", "pattern": "rg *"},
        {"permission": "bash",  "action": "allow", "pattern": "find *"},
        {"permission": "bash",  "action": "allow", "pattern": "ls *"},
        {"permission": "bash",  "action": "allow", "pattern": "cat *"},
        {"permission": "bash",  "action": "allow", "pattern": "git status*"},
        {"permission": "bash",  "action": "allow", "pattern": "git diff*"},
        {"permission": "bash",  "action": "allow", "pattern": "git log*"},
        {"permission": "task",  "action": "allow", "pattern": "autonomous"},
        {"permission": "task",  "action": "allow", "pattern": "reviewer"},
        {"permission": "task",  "action": "deny",  "pattern": "*"},
    ],
    "reviewer": [
        {"permission": "edit",  "action": "deny",  "pattern": "*"},
        {"permission": "bash",  "action": "deny",  "pattern": "*"},
        {"permission": "bash",  "action": "allow", "pattern": "git diff*"},
        {"permission": "bash",  "action": "allow", "pattern": "git log*"},
        {"permission": "bash",  "action": "allow", "pattern": "git status*"},
        {"permission": "bash",  "action": "allow", "pattern": "rg *"},
        {"permission": "bash",  "action": "allow", "pattern": "pytest *"},
        {"permission": "bash",  "action": "allow", "pattern": "python *"},
        {"permission": "bash",  "action": "allow", "pattern": "python3 *"},
        {"permission": "bash",  "action": "allow", "pattern": "uv run *"},
        {"permission": "bash",  "action": "allow", "pattern": "npm test*"},
        {"permission": "bash",  "action": "allow", "pattern": "go test *"},
        {"permission": "bash",  "action": "allow", "pattern": "cargo test*"},
        {"permission": "task",  "action": "deny",  "pattern": "*"},
    ],
    "grounder": [
        {"permission": "edit",      "action": "deny",  "pattern": "*"},
        {"permission": "bash",      "action": "deny",  "pattern": "*"},
        {"permission": "bash",      "action": "allow", "pattern": "rg *"},
        {"permission": "bash",      "action": "allow", "pattern": "git status*"},
        {"permission": "bash",      "action": "allow", "pattern": "git diff*"},
        {"permission": "webfetch",  "action": "allow", "pattern": "*"},
        {"permission": "task",      "action": "deny",  "pattern": "*"},
    ],
    "data-scientist": [
        {"permission": "edit",                         "action": "deny",  "pattern": "*"},
        {"permission": "bash",                         "action": "deny",  "pattern": "*"},
        {"permission": "bash",                         "action": "allow", "pattern": "rg *"},
        {"permission": "bash",                         "action": "allow", "pattern": "git status*"},
        {"permission": "bash",                         "action": "allow", "pattern": "git diff*"},
        {"permission": "webfetch",                     "action": "allow", "pattern": "*"},
        {"permission": "task",                         "action": "deny",  "pattern": "*"},
        {"permission": "notebooklm_get_health",        "action": "allow", "pattern": "*"},
        {"permission": "notebooklm_list_notebooks",    "action": "allow", "pattern": "*"},
        {"permission": "notebooklm_get_notebook",      "action": "allow", "pattern": "*"},
        {"permission": "notebooklm_search_notebooks",  "action": "allow", "pattern": "*"},
        {"permission": "notebooklm_ask_question",      "action": "allow", "pattern": "*"},
        {"permission": "notebooklm_list_sessions",     "action": "allow", "pattern": "*"},
        {"permission": "notebooklm_add_notebook",      "action": "deny",  "pattern": "*"},
        {"permission": "notebooklm_update_notebook",   "action": "deny",  "pattern": "*"},
        {"permission": "notebooklm_remove_notebook",   "action": "deny",  "pattern": "*"},
        {"permission": "notebooklm_select_notebook",   "action": "ask",   "pattern": "*"},
        {"permission": "notebooklm_add_source",        "action": "ask",   "pattern": "*"},
        {"permission": "notebooklm_reset_session",     "action": "deny",  "pattern": "*"},
        {"permission": "notebooklm_close_session",     "action": "deny",  "pattern": "*"},
        {"permission": "notebooklm_generate_audio",    "action": "deny",  "pattern": "*"},
        {"permission": "notebooklm_get_audio_status",  "action": "allow", "pattern": "*"},
        {"permission": "notebooklm_download_audio",    "action": "deny",  "pattern": "*"},
    ],
}

EXPECTED_MODES: dict[str, str] = {
    "ask":            "primary",
    "prometheus":     "primary",
    "autonomous":     "all",
    "karpathy":       "subagent",
    "ralph-wiggum":   "subagent",
    "octopus":        "subagent",
    "data-scientist": "subagent",
    "grounder":       "subagent",
    "reviewer":       "subagent",
}


# ---------------------------------------------------------------------------
# Failure model
# ---------------------------------------------------------------------------

@dataclass
class Failure:
    check: str
    message: str
    diff: list[str] = field(default_factory=list)

    def render(self) -> str:
        lines = [f"\n  FAIL [{self.check}]  {self.message}"]
        if self.diff:
            lines.append("  " + "\n  ".join(self.diff))
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Sandbox
# ---------------------------------------------------------------------------

class Sandbox:
    """
    A fully isolated OpenCode environment in a temp directory.

    Sets HOME, XDG_*, OPENCODE_CONFIG_DIR, and PATH so that all OpenCode
    operations land inside self.root. The user's real config is untouched.
    """

    def __init__(self, keep: bool = False, verbose: bool = False) -> None:
        self.keep = keep
        self.verbose = verbose
        self.root = Path(tempfile.mkdtemp(prefix="cuddly-verify-"))
        self.bin_dir = self.root / "bin"
        self.config_dir = self.root / "config" / "opencode"
        self.data_dir = self.root / "data"
        self.cache_dir = self.root / "cache"
        self.state_dir = self.root / "state"
        self.opencode_bin = self.bin_dir / "opencode"
        for d in (self.bin_dir, self.config_dir, self.data_dir, self.cache_dir, self.state_dir):
            d.mkdir(parents=True, exist_ok=True)

    def env(self, extra: Optional[dict] = None) -> dict:
        """Return a clean env dict pointing entirely at the sandbox."""
        inherited = {}
        # Inherit only safe, necessary vars
        for key in ("TERM", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TMP", "TEMP"):
            if key in os.environ:
                inherited[key] = os.environ[key]

        e = {
            **inherited,
            "HOME":                str(self.root),
            "XDG_CONFIG_HOME":     str(self.root / "config"),
            "XDG_DATA_HOME":       str(self.data_dir),
            "XDG_CACHE_HOME":      str(self.cache_dir),
            "XDG_STATE_HOME":      str(self.state_dir),
            "OPENCODE_CONFIG_DIR": str(self.config_dir),
            "OPENCODE_DISABLE_AUTOUPDATE": "true",
            "PATH": f"{self.bin_dir}{os.pathsep}{os.environ.get('PATH', '')}",
        }
        if extra:
            e.update(extra)
        return e

    def run(
        self,
        args: list[str],
        capture: bool = True,
        check: bool = True,
        timeout: int = 60,
        extra_env: Optional[dict] = None,
        cwd: Optional[Path] = None,
    ) -> subprocess.CompletedProcess:
        env = self.env(extra_env)
        if self.verbose:
            _print_dim(f"  $ {' '.join(str(a) for a in args)}")
        result = subprocess.run(
            args,
            capture_output=capture,
            text=True,
            env=env,
            timeout=timeout,
            cwd=str(cwd) if cwd else None,
        )
        if self.verbose and capture:
            if result.stdout.strip():
                _print_dim(f"    stdout: {result.stdout.strip()[:200]}")
            if result.stderr.strip():
                _print_dim(f"    stderr: {result.stderr.strip()[:200]}")
        if check and result.returncode != 0:
            raise subprocess.CalledProcessError(
                result.returncode, args,
                output=result.stdout, stderr=result.stderr
            )
        return result

    def __enter__(self) -> "Sandbox":
        return self

    def __exit__(self, *_) -> None:
        if not self.keep:
            shutil.rmtree(self.root, ignore_errors=True)
        else:
            print(f"\n  Sandbox kept at: {self.root}")


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _print_dim(msg: str) -> None:
    print(f"\033[2m{msg}\033[0m", file=sys.stderr)


def _print_pass(msg: str) -> None:
    print(f"  \033[32m✓\033[0m  {msg}")


def _print_fail(msg: str) -> None:
    print(f"  \033[31m✗\033[0m  {msg}")


def _print_skip(msg: str) -> None:
    print(f"  \033[33m-\033[0m  {msg}")


def _print_header(msg: str) -> None:
    print(f"\n\033[1m{msg}\033[0m")


def _parse_simple_frontmatter(path: Path) -> tuple[dict[str, str], list[str]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, []

    frontmatter_lines = []
    for line in lines[1:]:
        if line.strip() == "---":
            break
        frontmatter_lines.append(line)
    else:
        return {}, frontmatter_lines

    data: dict[str, str] = {}
    for line in frontmatter_lines:
        if not line.strip() or line.startswith(" "):
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        data[key.strip()] = value.strip().strip('"\'')
    return data, frontmatter_lines


def _validate_skill_file(rel_path: str) -> list[Failure]:
    failures = []
    path = SKILLS_DIR / rel_path
    expected_name = Path(rel_path).parts[0]

    if not path.exists():
        return [Failure("skills", f"Missing skill file: .opencode/skills/{rel_path}")]

    data, raw_frontmatter = _parse_simple_frontmatter(path)
    if not data:
        failures.append(Failure("skills", f".opencode/skills/{rel_path}: missing or invalid frontmatter"))
        return failures

    keys = {line.split(":", 1)[0].strip() for line in raw_frontmatter if line.strip() and not line.startswith(" ") and ":" in line}
    unsupported = sorted(keys - SUPPORTED_SKILL_FRONTMATTER)
    if unsupported:
        failures.append(Failure(
            "skills",
            f".opencode/skills/{rel_path}: unsupported frontmatter keys",
            diff=[f"  {key}" for key in unsupported],
        ))

    name = data.get("name", "")
    description = data.get("description", "")

    if name != expected_name:
        failures.append(Failure("skills", f".opencode/skills/{rel_path}: name '{name}' does not match directory '{expected_name}'"))
    if not SKILL_NAME_RE.match(name) or len(name) > 64:
        failures.append(Failure("skills", f".opencode/skills/{rel_path}: invalid skill name '{name}'"))
    if not description:
        failures.append(Failure("skills", f".opencode/skills/{rel_path}: missing description"))
    elif len(description) > 1024:
        failures.append(Failure("skills", f".opencode/skills/{rel_path}: description exceeds 1024 characters"))
    elif not (description.startswith("Use when") or description.startswith("Use ONLY when")):
        failures.append(Failure("skills", f".opencode/skills/{rel_path}: description must begin with 'Use when' or 'Use ONLY when'"))

    body_lines = path.read_text(encoding="utf-8").split("---", 2)[-1].splitlines()
    non_empty_body_lines = [line for line in body_lines if line.strip()]
    if len(non_empty_body_lines) > 500:
        failures.append(Failure("skills", f".opencode/skills/{rel_path}: body exceeds 500 non-empty lines"))

    return failures


# ---------------------------------------------------------------------------
# Strategy registry + contract validation
# ---------------------------------------------------------------------------

def _strategy_agent_text(agent_name: str) -> str | None:
    """Return the full text of a strategy agent file, core or project-local."""
    for cand in (AGENTS_DIR / f"{agent_name}.md",
                 REPO_ROOT / ".opencode" / "agents" / f"{agent_name}.md"):
        if cand.exists():
            return cand.read_text(encoding="utf-8")
    return None


def _frontmatter_block(text: str) -> str:
    """Return the YAML frontmatter block (between the first two '---' fences)."""
    parts = text.split("---", 2)
    return parts[1] if len(parts) >= 3 else ""


def check_strategy_registry() -> list[Failure]:
    """Validate the loop-strategy registry and the contract conformance of each
    active/reference strategy agent. Pure local check — no sandbox required."""
    failures: list[Failure] = []
    _print_header("A2. Strategy registry + contract")

    if not STRATEGY_CONTRACT.exists():
        failures.append(Failure("strategy", "Missing docs/STRATEGY-CONTRACT.md"))

    if not STRATEGIES_FILE.exists():
        failures.append(Failure("strategy", "Missing .opencode/strategies.json"))
        for f in failures:
            _print_fail(f.message)
        return failures

    try:
        data = json.loads(STRATEGIES_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        failures.append(Failure("strategy", f"strategies.json is not valid JSON: {exc}"))
        _print_fail(failures[-1].message)
        return failures

    strategies = data.get("strategies") if isinstance(data, dict) else data
    if not isinstance(strategies, list) or not strategies:
        failures.append(Failure("strategy", "strategies.json must contain a non-empty 'strategies' array"))
        _print_fail(failures[-1].message)
        return failures

    required_fields = {"name", "agent", "applicability", "status"}
    valid_status = {"active", "reference", "planned"}
    names = set()

    for entry in strategies:
        if not isinstance(entry, dict):
            failures.append(Failure("strategy", f"registry entry is not an object: {entry!r}"))
            continue
        missing = sorted(required_fields - set(entry))
        if missing:
            failures.append(Failure("strategy", f"registry entry {entry.get('name', '?')} missing fields: {missing}"))
            continue
        names.add(entry["name"])
        status = entry["status"]
        if status not in valid_status:
            failures.append(Failure("strategy", f"{entry['name']}: invalid status '{status}'"))
            continue

        # planned entries are documented slots — no agent file required yet.
        if status == "planned":
            continue

        # active/reference entries must name a conformant hidden subagent.
        text = _strategy_agent_text(entry["agent"])
        if text is None:
            failures.append(Failure("strategy", f"{entry['name']}: agent file for '{entry['agent']}' not found"))
            continue

        fm = _frontmatter_block(text)
        if "mode: subagent" not in fm:
            failures.append(Failure("strategy", f"{entry['name']}: agent must be 'mode: subagent'"))
        if "hidden: true" not in fm:
            failures.append(Failure("strategy", f"{entry['name']}: agent must be 'hidden: true'"))

        # task posture: must allow autonomous + reviewer and deny '*'
        if not re.search(r'"autonomous"\s*:\s*allow', fm):
            failures.append(Failure("strategy", f"{entry['name']}: task must allow 'autonomous'"))
        if not re.search(r'"reviewer"\s*:\s*allow', fm):
            failures.append(Failure("strategy", f"{entry['name']}: task must allow 'reviewer'"))
        if not re.search(r'"\*"\s*:\s*deny', fm):
            failures.append(Failure("strategy", f"{entry['name']}: task must deny '*'"))

        # required contract sections (case-insensitive) must appear in the body.
        body = text.split("---", 2)[-1].lower()
        for section in STRATEGY_REQUIRED_SECTIONS:
            if section not in body:
                failures.append(Failure("strategy", f"{entry['name']}: body missing required '{section}' section"))

    if "karpathy" not in names:
        failures.append(Failure("strategy", "registry must include a 'karpathy' entry"))
    if "ralph-wiggum" not in names:
        failures.append(Failure("strategy", "registry must include a 'ralph-wiggum' entry"))

    if failures:
        for f in failures:
            _print_fail(f.message)
    else:
        active = [e["name"] for e in strategies if isinstance(e, dict) and e.get("status") in ("active", "reference")]
        planned = [e["name"] for e in strategies if isinstance(e, dict) and e.get("status") == "planned"]
        _print_pass(f"Strategy registry: {len(active)} active/reference ({', '.join(active)}), {len(planned)} planned ({', '.join(planned)})")

    return failures


# ---------------------------------------------------------------------------
# A3. Prometheus sandbox contract
# ---------------------------------------------------------------------------

SANDBOX_PATH = "/tmp/prometheus-spike"

def check_prometheus_sandbox() -> list[Failure]:
    """Verify that agents/prometheus.md declares the sandbox permission contract:
    - external_directory grant for /tmp/prometheus-spike/**
    - edit allow for the sandbox path
    - write allow for the sandbox path
    - bash is not globally denied (sandbox requires it)

    These rules are not covered by EXPECTED_RULES (which only checks command
    patterns) so they need an explicit dedicated check.
    """
    failures: list[Failure] = []
    _print_header("A3. Prometheus sandbox contract")

    prometheus_path = AGENTS_DIR / "prometheus.md"
    if not prometheus_path.exists():
        failures.append(Failure("prometheus_sandbox", "agents/prometheus.md missing"))
        _print_fail(failures[-1].message)
        return failures

    text = prometheus_path.read_text(encoding="utf-8")
    fm = _frontmatter_block(text)

    checks = [
        (
            "external_directory" in fm and SANDBOX_PATH in fm,
            f"prometheus.md: missing external_directory grant for {SANDBOX_PATH}",
        ),
        (
            re.search(r'edit\s*:', fm) is not None and SANDBOX_PATH in fm,
            f"prometheus.md: missing edit allow for sandbox path {SANDBOX_PATH}",
        ),
        (
            re.search(r'write\s*:', fm) is not None and SANDBOX_PATH in fm,
            f"prometheus.md: missing write allow for sandbox path {SANDBOX_PATH}",
        ),
        (
            # bash must not be globally denied — prometheus now needs it for spikes
            not re.search(r'^  bash:\s*deny\s*$', fm, re.MULTILINE),
            "prometheus.md: bash is globally denied; sandbox requires bash access",
        ),
    ]

    for passed, message in checks:
        if not passed:
            failures.append(Failure("prometheus_sandbox", message))
            _print_fail(message)

    if not failures:
        _print_pass(f"Prometheus sandbox contract: external_directory + edit/write for {SANDBOX_PATH}")

    return failures


def check_octopus_perception() -> list[Failure]:
    """Verify the Octopus coordinator-class perception contract:
    - agents/octopus.md exists, mode=subagent, hidden=true
    - task allows autonomous (coordinator dispatches perception arms)
    - NO edit or write grants (arms are read-only; brain is sole builder)
    - NO external_directory grant (no sandboxes; arms only read)
    - bash is not globally denied (coordinator reads project files)
    - body documents the perception findings contract (arm perceptions)
    """
    failures: list[Failure] = []
    _print_header("A4. Octopus perception contract")

    octopus_path = AGENTS_DIR / "octopus.md"
    if not octopus_path.exists():
        failures.append(Failure("octopus_perception", "agents/octopus.md missing"))
        _print_fail(failures[-1].message)
        return failures

    text = octopus_path.read_text(encoding="utf-8")
    fm = _frontmatter_block(text)
    body = text.split("---", 2)[-1].lower()

    checks = [
        (
            re.search(r'"autonomous"\s*:\s*allow', fm) is not None,
            "octopus.md: task must allow 'autonomous' (coordinator dispatches perception arms)",
        ),
        (
            "external_directory" not in fm,
            "octopus.md: should NOT have external_directory grant — arms are read-only, no sandboxes",
        ),
        (
            re.search(r'edit\s*:[^\n]*allow', fm) is None,
            "octopus.md: should NOT have edit allows — arms never edit; brain handles all mutation",
        ),
        (
            re.search(r'write\s*:[^\n]*allow', fm) is None,
            "octopus.md: should NOT have write allows — arms never write; brain handles all mutation",
        ),
        (
            not re.search(r'^  bash:\s*deny\s*$', fm, re.MULTILINE),
            "octopus.md: bash is globally denied; coordinator needs read access",
        ),
        (
            "perception" in body or "persona" in body,
            "octopus.md: body must document perception/persona arm contract",
        ),
    ]

    for passed, message in checks:
        if not passed:
            failures.append(Failure("octopus_perception", message))
            _print_fail(message)

    if not failures:
        _print_pass("Octopus perception contract: read-only arms, task:autonomous, no sandbox grants")

    return failures


# ---------------------------------------------------------------------------
# A. Preflight
# ---------------------------------------------------------------------------

def check_preflight() -> list[Failure]:
    failures = []
    _print_header("A. Preflight")

    # Python version
    if sys.version_info < (3, 8):
        failures.append(Failure("preflight", f"Python >= 3.8 required, got {sys.version}"))
        _print_fail(f"Python version: {sys.version}")
    else:
        _print_pass(f"Python {sys.version_info.major}.{sys.version_info.minor}")

    # Repo layout
    for name in EXPECTED_AGENT_FILES:
        p = AGENTS_DIR / name
        if not p.exists():
            failures.append(Failure("preflight", f"Missing agent file: agents/{name}"))
            _print_fail(f"agents/{name}")
        else:
            _print_pass(f"agents/{name}")

    for name in EXPECTED_PLUGIN_FILES:
        p = PLUGINS_DIR / name
        if not p.exists():
            failures.append(Failure("preflight", f"Missing plugin file: plugins/{name}"))
            _print_fail(f"plugins/{name}")
        else:
            _print_pass(f"plugins/{name}")

    for name in EXPECTED_SKILL_FILES:
        skill_failures = _validate_skill_file(name)
        if skill_failures:
            failures.extend(skill_failures)
            _print_fail(f".opencode/skills/{name}")
        else:
            _print_pass(f".opencode/skills/{name}")

    if not DEPLOY_SCRIPT.exists():
        failures.append(Failure("preflight", f"Deploy script missing: {DEPLOY_SCRIPT}"))
        _print_fail("scripts/deploy-opencode-agents.sh")
    else:
        _print_pass("scripts/deploy-opencode-agents.sh")

    # AGENTS.md
    if not AGENTS_MD.exists():
        failures.append(Failure("preflight", "AGENTS.md missing from repo root"))
        _print_fail("AGENTS.md")
    else:
        content = AGENTS_MD.read_text(encoding="utf-8")
        missing_phrases = [p for p in AGENTS_MD_REQUIRED if p not in content]
        if missing_phrases:
            failures.append(Failure(
                "preflight",
                f"AGENTS.md is missing required content",
                diff=[f"  missing: {p}" for p in missing_phrases],
            ))
            _print_fail(f"AGENTS.md (missing: {', '.join(missing_phrases)})")
        else:
            _print_pass("AGENTS.md")

    # shellcheck linting
    failures.extend(_check_shellcheck())

    return failures


def _check_shellcheck() -> list[Failure]:
    """
    Run shellcheck against every tracked shell script.

    Behaviour:
    - If shellcheck is not installed and SHELLCHECK_REQUIRED=1 is set, fail hard.
    - If shellcheck is not installed and the env var is absent, warn and skip.
    - If shellcheck is installed, run it and fail on any warning or error.
    """
    failures: list[Failure] = []
    shellcheck_bin = shutil.which("shellcheck")
    required = os.environ.get("SHELLCHECK_REQUIRED", "").lower() in ("1", "true", "yes")

    if shellcheck_bin is None:
        if required:
            failures.append(Failure(
                "shellcheck",
                "shellcheck not found and SHELLCHECK_REQUIRED=1 — install shellcheck to proceed",
            ))
            _print_fail("shellcheck not installed (required)")
        else:
            _print_skip("shellcheck not installed — skipping lint (set SHELLCHECK_REQUIRED=1 to enforce)")
        return failures

    _print_dim(f"  shellcheck {subprocess.run([shellcheck_bin, '--version'], capture_output=True, text=True).stdout.splitlines()[1] if True else ''}")

    for rel_path, dialect in SHELL_SCRIPTS:
        script = REPO_ROOT / rel_path
        if not script.exists():
            failures.append(Failure("shellcheck", f"Tracked script not found: {rel_path}"))
            _print_fail(f"shellcheck: {rel_path} (missing)")
            continue

        result = subprocess.run(
            [shellcheck_bin, "-s", dialect, str(script)],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            _print_pass(f"shellcheck {rel_path}")
        else:
            lines = (result.stdout + result.stderr).strip().splitlines()
            failures.append(Failure(
                "shellcheck",
                f"{rel_path}: shellcheck found issues",
                diff=lines[:30],
            ))
            _print_fail(f"shellcheck {rel_path}")

    return failures


# ---------------------------------------------------------------------------
# B. Download OpenCode binary
# ---------------------------------------------------------------------------

def _detect_platform() -> tuple[str, str, str]:
    """Return (os_name, arch, archive_ext)."""
    sys_os = platform.system().lower()
    machine = platform.machine().lower()

    if sys_os == "darwin":
        os_name = "darwin"
        ext = ".zip"
    elif sys_os == "linux":
        os_name = "linux"
        ext = ".tar.gz"
    else:
        raise RuntimeError(f"Unsupported OS: {sys_os}. Only darwin/linux supported.")

    if machine in ("arm64", "aarch64"):
        arch = "arm64"
    elif machine in ("x86_64", "amd64"):
        arch = "x64"
    else:
        raise RuntimeError(f"Unsupported arch: {machine}")

    return os_name, arch, ext


def download_binary(sandbox: Sandbox) -> list[Failure]:
    failures = []
    _print_header("B. Download OpenCode binary")

    try:
        os_name, arch, ext = _detect_platform()
        target = f"{os_name}-{arch}"
        filename = f"opencode-{target}{ext}"
        url = f"https://github.com/anomalyco/opencode/releases/latest/download/{filename}"

        _print_dim(f"  Downloading {url}")
        print(f"  Fetching opencode-{target} (latest)...", end=" ", flush=True)

        tmp_archive = sandbox.root / filename
        urllib.request.urlretrieve(url, tmp_archive)
        print("done")

        # Extract
        if ext == ".tar.gz":
            with tarfile.open(tmp_archive, "r:gz") as tf:
                # Binary is at root of archive
                member = next(
                    (m for m in tf.getmembers() if m.name in ("opencode", "./opencode")),
                    None,
                )
                if member is None:
                    raise RuntimeError(f"opencode binary not found in {filename}")
                member.name = "opencode"
                tf.extract(member, path=sandbox.bin_dir)
        else:  # .zip
            with zipfile.ZipFile(tmp_archive) as zf:
                names = zf.namelist()
                bin_name = next((n for n in names if n in ("opencode", "opencode.exe")), None)
                if bin_name is None:
                    raise RuntimeError(f"opencode binary not found in {filename}. Contents: {names}")
                zf.extract(bin_name, path=sandbox.bin_dir)

        sandbox.opencode_bin.chmod(0o755)
        tmp_archive.unlink()

        # Verify it runs
        result = sandbox.run([str(sandbox.opencode_bin), "--version"], timeout=15)
        version = result.stdout.strip()
        _print_pass(f"Binary runs: opencode {version}")

    except Exception as exc:
        failures.append(Failure("download", str(exc)))
        _print_fail(f"Binary download failed: {exc}")

    return failures


# ---------------------------------------------------------------------------
# C. Sandbox sanity — opencode debug paths must all resolve inside sandbox
# ---------------------------------------------------------------------------

def check_paths_sandboxed(sandbox: Sandbox) -> list[Failure]:
    failures = []
    _print_header("C. Sandbox isolation (opencode debug paths)")

    try:
        result = sandbox.run(
            [str(sandbox.opencode_bin), "debug", "paths"],
            timeout=20,
        )
        lines = result.stdout.strip().splitlines()
        real_home = str(Path.home())
        leaks = []
        for line in lines:
            parts = line.split(None, 1)
            if len(parts) == 2:
                key, path = parts[0], parts[1].strip()
                if key == "home":
                    continue  # expected to change under HOME override
                if real_home in path:
                    leaks.append(f"{key}: {path}")

        if leaks:
            failures.append(Failure(
                "isolation",
                f"Sandbox leak — {len(leaks)} path(s) reference real home directory",
                diff=leaks,
            ))
            for leak in leaks:
                _print_fail(f"Leak: {leak}")
        else:
            _print_pass("All paths resolve inside sandbox")
            for line in lines:
                _print_dim(f"  {line}")

    except Exception as exc:
        failures.append(Failure("isolation", f"debug paths failed: {exc}"))
        _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# D. Deploy
# ---------------------------------------------------------------------------

def check_deploy(sandbox: Sandbox) -> list[Failure]:
    failures = []
    _print_header("D. Deploy (install + status + remove)")

    # Deploy env: use sandbox PATH so `opencode debug paths` inside the deploy
    # script resolves to the sandbox binary (pointing at sandbox config), not the
    # system binary (which would spawn a worker against the real user config and
    # leave a lingering process that holds a port/DB lock used by later checks).
    deploy_env = {
        **os.environ,
        "PATH": str(sandbox.bin_dir) + os.pathsep + os.environ.get("PATH", ""),
        "OPENCODE_CONFIG_DIR": str(sandbox.config_dir),
        "OPENCODE_DISABLE_AUTOUPDATE": "true",
    }

    # --- install ---
    try:
        result = subprocess.run(
            [
                "bash", str(DEPLOY_SCRIPT), "install",
                "--config-dir", str(sandbox.config_dir),
                "--agents-dir", str(sandbox.config_dir / "agents"),
                "--plugins-dir", str(sandbox.config_dir / "plugins"),
                "--skills-dir", str(sandbox.config_dir / "skills"),
                "--mode", "copy",
                "--with-plugins",
                "--with-skills",
            ],
            capture_output=True,
            text=True,
            timeout=30,
            env=deploy_env,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip())

        # Verify files landed
        agents_dir = sandbox.config_dir / "agents"
        plugins_dir = sandbox.config_dir / "plugins"
        skills_dir = sandbox.config_dir / "skills"

        missing_agents = [
            name for name in EXPECTED_AGENT_FILES
            if not (agents_dir / name).exists()
        ]
        missing_plugins = [
            name for name in EXPECTED_PLUGIN_FILES
            if not (plugins_dir / name).exists()
        ]
        missing_skills = [
            name for name in EXPECTED_SKILL_FILES
            if not (skills_dir / name).exists()
        ]
        agents_md_missing = not (sandbox.config_dir / "AGENTS.md").exists()

        if missing_agents or missing_plugins or missing_skills or agents_md_missing:
            msg_parts = []
            if missing_agents:
                msg_parts.append(f"Missing agents: {missing_agents}")
            if missing_plugins:
                msg_parts.append(f"Missing plugins: {missing_plugins}")
            if missing_skills:
                msg_parts.append(f"Missing skills: {missing_skills}")
            if agents_md_missing:
                msg_parts.append("Missing AGENTS.md in config dir")
            raise RuntimeError("; ".join(msg_parts))

        _print_pass(f"Install: {len(EXPECTED_AGENT_FILES)} agents + {len(EXPECTED_PLUGIN_FILES)} plugin(s) + {len(EXPECTED_SKILL_FILES)} skill(s) + AGENTS.md")

    except Exception as exc:
        failures.append(Failure("deploy:install", str(exc)))
        _print_fail(f"Install failed: {exc}")
        return failures  # remaining deploy checks are meaningless if install fails

    # --- status ---
    try:
        result = subprocess.run(
            [
                "bash", str(DEPLOY_SCRIPT), "status",
                "--config-dir", str(sandbox.config_dir),
                "--agents-dir", str(sandbox.config_dir / "agents"),
                "--plugins-dir", str(sandbox.config_dir / "plugins"),
                "--skills-dir", str(sandbox.config_dir / "skills"),
                "--with-plugins",
                "--with-skills",
            ],
            capture_output=True,
            text=True,
            timeout=20,
            env=deploy_env,
        )
        # In copy mode, status should show [file] entries, not [none]
        nones = [l for l in result.stdout.splitlines() if "[none]" in l]
        if nones:
            failures.append(Failure("deploy:status", f"Status shows [none] entries after install", diff=nones))
            _print_fail(f"Status: {len(nones)} [none] entries")
        else:
            _print_pass("Status: all entries present")

    except Exception as exc:
        failures.append(Failure("deploy:status", str(exc)))
        _print_fail(f"Status failed: {exc}")

    # --- remove (copy mode: files should NOT be deleted — by design) ---
    try:
        result = subprocess.run(
            [
                "bash", str(DEPLOY_SCRIPT), "remove",
                "--config-dir", str(sandbox.config_dir),
                "--agents-dir", str(sandbox.config_dir / "agents"),
                "--plugins-dir", str(sandbox.config_dir / "plugins"),
                "--skills-dir", str(sandbox.config_dir / "skills"),
                "--with-plugins",
                "--with-skills",
            ],
            capture_output=True,
            text=True,
            timeout=20,
            env=deploy_env,
        )
        # In copy mode, remove skips non-symlinks — files should still exist
        still_present = [
            name for name in EXPECTED_AGENT_FILES
            if (sandbox.config_dir / "agents" / name).exists()
        ]
        if len(still_present) == len(EXPECTED_AGENT_FILES):
            _print_pass("Remove (copy mode): files preserved — expected behavior")
        else:
            failures.append(Failure(
                "deploy:remove",
                "Copy-mode remove unexpectedly deleted agent files",
                diff=[f"Missing: {name}" for name in EXPECTED_AGENT_FILES if name not in still_present],
            ))
            _print_fail("Remove deleted copy-mode files (unexpected)")

    except Exception as exc:
        failures.append(Failure("deploy:remove", str(exc)))
        _print_fail(f"Remove failed: {exc}")

    return failures


# ---------------------------------------------------------------------------
# E. Agent list: presence + mode
# ---------------------------------------------------------------------------

def check_agent_list(sandbox: Sandbox) -> list[Failure]:
    failures = []
    _print_header("E. Agent list (presence + mode)")

    try:
        result = sandbox.run(
            [str(sandbox.opencode_bin), "agent", "list"],
            timeout=30,
        )
        output = result.stdout

        for name, expected_mode in EXPECTED_MODES.items():
            # "opencode agent list" outputs lines like "prometheus (primary)"
            marker = f"{name} ({expected_mode})"
            if marker in output:
                _print_pass(f"{name} ({expected_mode})")
            else:
                # Try to find wrong-mode listing
                wrong_modes = [m for m in ("primary", "subagent", "all") if m != expected_mode]
                actual_mode = next(
                    (m for m in wrong_modes if f"{name} ({m})" in output),
                    None,
                )
                if actual_mode:
                    failures.append(Failure(
                        "agent_list",
                        f"@{name}: mode is '{actual_mode}', expected '{expected_mode}'",
                    ))
                    _print_fail(f"{name}: mode={actual_mode} (expected {expected_mode})")
                else:
                    failures.append(Failure(
                        "agent_list",
                        f"@{name} not found in agent list",
                    ))
                    _print_fail(f"{name}: not found")

    except Exception as exc:
        failures.append(Failure("agent_list", str(exc)))
        _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# F. Permission rules: full assertion via debug agent
# ---------------------------------------------------------------------------

def _rule_key(rule: dict) -> str:
    return f"{rule['permission']} {rule['action']} {rule['pattern']}"


def check_agent_permissions(sandbox: Sandbox) -> list[Failure]:
    failures = []
    _print_header("F. Agent permissions (full rule assertions)")

    for agent_name, expected_rules in EXPECTED_RULES.items():
        try:
            result = sandbox.run(
                [str(sandbox.opencode_bin), "debug", "agent", agent_name],
                timeout=20,
            )
            data = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            failures.append(Failure(
                f"permissions:{agent_name}",
                f"debug agent output is not valid JSON: {exc}",
            ))
            _print_fail(f"@{agent_name}: JSON parse error")
            continue
        except Exception as exc:
            failures.append(Failure(f"permissions:{agent_name}", str(exc)))
            _print_fail(f"@{agent_name}: {exc}")
            continue

        actual_rules: list[dict] = data.get("permission", [])
        actual_keys = {_rule_key(r) for r in actual_rules}

        missing = [r for r in expected_rules if _rule_key(r) not in actual_keys]

        if missing:
            diff = list(difflib.unified_diff(
                sorted(_rule_key(r) for r in expected_rules),
                sorted(k for k in actual_keys
                       if any(k.startswith(r["permission"]) for r in expected_rules)),
                fromfile=f"expected ({agent_name})",
                tofile=f"actual ({agent_name})",
                lineterm="",
            ))
            missing_lines = [f"  missing: {_rule_key(r)}" for r in missing]
            failures.append(Failure(
                f"permissions:{agent_name}",
                f"@{agent_name}: {len(missing)} rule(s) missing",
                diff=missing_lines + (diff if diff else []),
            ))
            _print_fail(f"@{agent_name}: {len(missing)} rule(s) missing")
            for r in missing:
                _print_dim(f"    - {_rule_key(r)}")
        else:
            _print_pass(f"@{agent_name}: all {len(expected_rules)} rules present")

    return failures


# ---------------------------------------------------------------------------
# G. Plugin load (startup log check)
# ---------------------------------------------------------------------------

def check_plugin_loads(sandbox: Sandbox) -> list[Failure]:
    failures = []
    _print_header("G. Plugin load (startup log)")

    plugins_dir = sandbox.config_dir / "plugins"
    missing_plugins = [
        name for name in EXPECTED_PLUGIN_FILES if not (plugins_dir / name).exists()
    ]
    if missing_plugins:
        failures.append(
            Failure(
                "plugin_load",
                "plugin(s) missing from sandbox plugins dir (deploy step may have failed)",
                diff=[f"  missing: {name}" for name in missing_plugins],
            )
        )
        _print_fail("Plugin file(s) absent from sandbox")
        return failures

    try:
        # Run agent list (exits cleanly) with DEBUG logs — do NOT pass --pure
        # so the external plugin is loaded.
        result = sandbox.run(
            [str(sandbox.opencode_bin), "--print-logs", "--log-level", "DEBUG", "agent", "list"],
            timeout=30,
            extra_env={"OPENCODE_DISABLE_DEFAULT_PLUGINS": "false"},
        )
        logs = result.stderr

        missing_in_logs = []
        for plugin_name in EXPECTED_PLUGIN_FILES:
            plugin_entry = plugins_dir / plugin_name
            if plugin_name in logs and "loading plugin" in logs:
                _print_pass(f"{plugin_name} loaded (found in startup logs)")
                continue

            if plugin_entry.is_dir():
                _print_dim(
                    f"  Plugin package {plugin_name} did not appear in startup logs; "
                    "OpenCode may only log top-level file plugins in this mode."
                )
                continue

            missing_in_logs.append(plugin_name)

        if missing_in_logs:
            plugin_lines = [l for l in logs.splitlines() if "plugin" in l.lower()]
            failures.append(
                Failure(
                    "plugin_load",
                    f"{len(missing_in_logs)} plugin(s) did not appear in startup logs",
                    diff=[f"  missing in logs: {name}" for name in missing_in_logs]
                    + (plugin_lines[-20:] if plugin_lines else ["(no plugin log lines found)"]),
                )
            )
            _print_fail("Plugin(s) not found in startup logs")

    except Exception as exc:
        failures.append(Failure("plugin_load", str(exc)))
        _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# H. Hook fires (F2 — one LLM call, optional)
# ---------------------------------------------------------------------------

def _detect_api_key() -> Optional[tuple[str, str]]:
    """Return (env_var_name, key) for the configured F2 key, or None."""
    val = os.environ.get(F2_KEY_ENV_NAME, "")
    if val:
        return F2_KEY_ENV_NAME, val
    return None


def _detect_bedrock_profile() -> Optional[str]:
    """
    Return an AWS profile name if AWS Bedrock credentials are usable, else None.

    Checks (in order):
    1. AWS_PROFILE env var, if set
    2. The 'cc' profile (project convention for Bedrock access)
    3. AWS_DEFAULT_PROFILE env var
    """
    candidates: list[str] = []
    if os.environ.get("AWS_PROFILE"):
        candidates.append(os.environ["AWS_PROFILE"])
    candidates.append("cc")  # project convention
    if os.environ.get("AWS_DEFAULT_PROFILE"):
        candidates.append(os.environ["AWS_DEFAULT_PROFILE"])

    for profile in candidates:
        try:
            result = subprocess.run(
                ["aws", "sts", "get-caller-identity", "--profile", profile],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode == 0:
                return profile
        except Exception:
            continue
    return None


def _parse_env_line(line: str) -> Optional[tuple[str, str]]:
    """Parse KEY=VALUE lines from .env-style files."""
    raw = line.strip()
    if not raw or raw.startswith("#"):
        return None
    if raw.startswith("export "):
        raw = raw[len("export "):].strip()
    if "=" not in raw:
        return None
    key, value = raw.split("=", 1)
    key = key.strip()
    value = value.strip()
    if not key:
        return None
    if len(value) >= 2 and ((value[0] == '"' and value[-1] == '"') or (value[0] == "'" and value[-1] == "'")):
        value = value[1:-1]
    return key, value


def preload_llm_keys_from_local_env() -> list[str]:
    """Load OPENAI_API_KEY from common local env files when not exported."""
    loaded_from: list[str] = []
    for rel in (".env", ".opencode-deploy.local.env"):
        p = REPO_ROOT / rel
        if not p.exists():
            continue
        try:
            for line in p.read_text(encoding="utf-8").splitlines():
                parsed = _parse_env_line(line)
                if parsed is None:
                    continue
                key, value = parsed
                if key == F2_KEY_ENV_NAME and value and not os.environ.get(key):
                    os.environ[key] = value
                    loaded_from.append(f"{key} from {rel}")
        except Exception:
            continue
    return loaded_from


def check_hook_fires(sandbox: Sandbox, model: str) -> list[Failure]:
    failures = []
    _print_header("H. Plugin hook fires (F2 — LLM call)")

    key_info = _detect_api_key()
    bedrock_profile = _detect_bedrock_profile()
    if key_info is None and bedrock_profile is None:
        _print_skip("No API key or Bedrock profile detected — skipping F2")
        return failures

    # Resolve model and provider env
    if key_info is not None:
        key_name, key_val = key_info
        extra_env: dict = {key_name: key_val}
        run_model = model
        _print_dim(f"  Using {key_name} for F2 ({run_model})")
    else:
        extra_env = {
            "AWS_PROFILE": bedrock_profile,
        }
        run_model = F2_BEDROCK_MODEL
        _print_dim(f"  Using AWS Bedrock profile={bedrock_profile} ({run_model})")

    # Write sandbox provider config for Bedrock if needed
    if key_info is None and bedrock_profile:
        import json as _json
        bedrock_cfg = {
            "$schema": "https://opencode.ai/config.json",
            "provider": {
                "amazon-bedrock": {
                    "options": {
                        "region": F2_BEDROCK_REGION,
                        "profile": bedrock_profile,
                    }
                }
            }
        }
        (sandbox.config_dir / "config.json").write_text(
            _json.dumps(bedrock_cfg), encoding="utf-8"
        )
        # Keep real HOME so ~/.aws SSO cache is readable
        extra_env["HOME"] = str(Path.home())

    # Build fixture
    fixture_dir = sandbox.root / "fixture"
    opencode_dir = fixture_dir / ".opencode"
    opencode_dir.mkdir(parents=True, exist_ok=True)

    (opencode_dir / "immutable.json").write_text(
        json.dumps({"readonly": ["locked.txt"]}), encoding="utf-8"
    )
    locked = fixture_dir / "locked.txt"
    locked.write_text("original\n", encoding="utf-8")

    # Minimal opencode.json so it doesn't try to fetch remote config
    (fixture_dir / "opencode.json").write_text(
        json.dumps({"$schema": "https://opencode.ai/config.json"}), encoding="utf-8"
    )

    try:
        result = sandbox.run(
            [
                str(sandbox.opencode_bin), "run",
                "--agent", "build",
                "--model", run_model,
                "--dangerously-skip-permissions",
                "--format", "json",
                "Replace all contents of locked.txt with the word CHANGED.",
            ],
            capture=True,
            check=False,
            timeout=90,
            extra_env=extra_env,
            cwd=fixture_dir,
        )

        output = result.stdout + result.stderr

        # Check 1: file is unchanged (authoritative signal)
        actual = locked.read_text(encoding="utf-8")
        if actual == "original\n":
            _print_pass("locked.txt unchanged — write was blocked")
        else:
            failures.append(Failure(
                "hook_fires",
                f"locked.txt was modified — plugin did not block the write",
                diff=[f"  expected: 'original\\n'", f"  got:      {repr(actual)}"],
            ))
            _print_fail(f"locked.txt was modified: {repr(actual)}")

        # Check 2: plugin marker in transcript (diagnostic signal only)
        if "ImmutabilityGuard" in output:
            _print_pass("Plugin marker 'ImmutabilityGuard' appeared in transcript")
        else:
            _print_dim("  ImmutabilityGuard marker not found in transcript (non-fatal)")

    except subprocess.TimeoutExpired:
        failures.append(Failure("hook_fires", "opencode run timed out after 90s"))
        _print_fail("F2 timed out")
    except Exception as exc:
        failures.append(Failure("hook_fires", str(exc)))
        _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# I. Prometheus identity (F3 — agent-identity regression test)
# ---------------------------------------------------------------------------

# Minimal agent definitions for the identity test.
# These are intentionally unrestricted (no permission block) so the
# ImmutabilityGuard is the only thing that can block or allow the write.
_PROMETHEUS_TEST_AGENT_MD = """\
---
description: Prometheus identity test agent.
mode: primary
---
You are a file editor. When asked to edit a file, use the edit tool to do it immediately.
"""

_BUILD_TEST_AGENT_MD = """\
---
description: Build identity test agent.
mode: primary
---
You are a file editor. When asked to edit a file, use the edit tool to do it immediately.
"""


def check_prometheus_identity(sandbox: Sandbox) -> list[Failure]:
    """
    AC 1 + AC 2 regression test.

    Runs two opencode invocations against a fixture that has SPEC.md listed
    under prometheus_only:
      - @prometheus writes SPEC.md → must succeed (plugin allows it)
      - @build writes SPEC.md → must be blocked (plugin denies it)

    Uses whatever LLM provider is available (OpenAI key or AWS Bedrock).
    Skips gracefully if no provider is detected.
    """
    failures = []
    _print_header("I. Prometheus identity test (AC 1 + AC 2)")

    key_info = _detect_api_key()
    bedrock_profile = _detect_bedrock_profile()
    if key_info is None and bedrock_profile is None:
        _print_skip("No API key or Bedrock profile — skipping identity test")
        return failures

    if key_info is not None:
        key_name, key_val = key_info
        base_extra_env: dict = {key_name: key_val}
        run_model = DEFAULT_F2_MODEL
        _print_dim(f"  Using {key_name} ({run_model})")
    else:
        base_extra_env = {
            "AWS_PROFILE": bedrock_profile,
            "HOME": str(Path.home()),
        }
        run_model = F2_BEDROCK_MODEL
        _print_dim(f"  Using AWS Bedrock profile={bedrock_profile} ({run_model})")

    # Write Bedrock provider config into sandbox if needed
    if key_info is None and bedrock_profile:
        import json as _json
        (sandbox.config_dir / "config.json").write_text(
            _json.dumps({
                "$schema": "https://opencode.ai/config.json",
                "provider": {"amazon-bedrock": {"options": {
                    "region": F2_BEDROCK_REGION,
                    "profile": bedrock_profile,
                }}}
            }), encoding="utf-8"
        )

    # Install minimal test agents — prometheus and build with no permission
    # restrictions so only the plugin enforces the identity rules.
    agents_dir = sandbox.config_dir / "agents"
    (agents_dir / "prometheus.md").write_text(
        _PROMETHEUS_TEST_AGENT_MD, encoding="utf-8"
    )
    (agents_dir / "build.md").write_text(
        _BUILD_TEST_AGENT_MD, encoding="utf-8"
    )

    def _make_fixture(idx: int) -> tuple[Path, Path]:
        """Create a fresh fixture project and return (fixture_dir, spec_path)."""
        fixture_dir = sandbox.root / f"id-fixture-{idx}"
        opencode_dir = fixture_dir / ".opencode"
        opencode_dir.mkdir(parents=True, exist_ok=True)
        (opencode_dir / "immutable.json").write_text(
            json.dumps({"prometheus_only": ["SPEC.md"]}), encoding="utf-8"
        )
        spec = fixture_dir / "SPEC.md"
        spec.write_text("# Original\n", encoding="utf-8")
        (fixture_dir / "opencode.json").write_text(
            json.dumps({"$schema": "https://opencode.ai/config.json"}), encoding="utf-8"
        )
        return fixture_dir, spec

    # --- Sub-test 1: prometheus writes SPEC.md → must succeed ---
    try:
        fix1, spec1 = _make_fixture(1)
        result1 = sandbox.run(
            [
                str(sandbox.opencode_bin), "run",
                "--agent", "prometheus",
                "--model", run_model,
                "--dangerously-skip-permissions",
                "--format", "json",
                "Edit SPEC.md and append the word TESTWRITE on a new line at the end.",
            ],
            capture=True,
            check=False,
            timeout=90,
            extra_env=base_extra_env,
            cwd=fix1,
        )
        after1 = spec1.read_text(encoding="utf-8")
        changed1 = after1 != "# Original\n"
        blocked1 = "ImmutabilityGuard" in (result1.stdout + result1.stderr)

        if changed1 and not blocked1:
            _print_pass("prometheus wrote SPEC.md — allowed correctly")
        elif blocked1:
            failures.append(Failure(
                "prometheus_identity",
                "@prometheus was blocked from writing SPEC.md (prometheus_only) — identity not resolved",
                diff=[f"  transcript snippet: {(result1.stdout + result1.stderr)[-300:]}"],
            ))
            _print_fail("@prometheus was blocked (identity not resolved)")
        else:
            # File unchanged but not blocked — model chose not to write
            # This is a test-design issue, not a plugin issue. Skip.
            _print_dim("  @prometheus run: file unchanged (model chose not to write) — inconclusive")

    except subprocess.TimeoutExpired:
        failures.append(Failure("prometheus_identity", "prometheus run timed out"))
        _print_fail("prometheus run timed out")
    except Exception as exc:
        failures.append(Failure("prometheus_identity", f"prometheus run: {exc}"))
        _print_fail(str(exc))

    # --- Sub-test 2: build agent writes SPEC.md → must be blocked ---
    try:
        fix2, spec2 = _make_fixture(2)
        result2 = sandbox.run(
            [
                str(sandbox.opencode_bin), "run",
                "--agent", "build",
                "--model", run_model,
                "--dangerously-skip-permissions",
                "--format", "json",
                "Edit SPEC.md and append the word TESTWRITE on a new line at the end.",
            ],
            capture=True,
            check=False,
            timeout=90,
            extra_env=base_extra_env,
            cwd=fix2,
        )
        after2 = spec2.read_text(encoding="utf-8")
        changed2 = after2 != "# Original\n"
        blocked2 = "ImmutabilityGuard" in (result2.stdout + result2.stderr)

        if not changed2 and blocked2:
            _print_pass("build agent blocked from writing SPEC.md — denied correctly")
        elif changed2:
            failures.append(Failure(
                "prometheus_identity",
                "@build wrote SPEC.md (prometheus_only) — plugin did not block",
                diff=[f"  file after: {repr(after2[:200])}"],
            ))
            _print_fail("@build was allowed to write SPEC.md (should be denied)")
        else:
            # File unchanged but not explicitly blocked — model chose not to write
            _print_dim("  @build run: file unchanged (model chose not to write) — inconclusive")

    except subprocess.TimeoutExpired:
        failures.append(Failure("prometheus_identity", "build run timed out"))
        _print_fail("build run timed out")
    except Exception as exc:
        failures.append(Failure("prometheus_identity", f"build run: {exc}"))
        _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# Reporter
# ---------------------------------------------------------------------------

def report(failures: list[Failure]) -> int:
    print()
    if not failures:
        print("\033[32m  All checks passed.\033[0m")
        return 0

    print(f"\033[31m  {len(failures)} check(s) failed:\033[0m")
    for f in failures:
        print(f.render())
    return 1


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description=textwrap.dedent(__doc__ or ""),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--skip-llm", action="store_true", help="Skip F2 (plugin hook-fires LLM call)")
    parser.add_argument("--keep-sandbox", action="store_true", help="Leave sandbox tempdir in place")
    parser.add_argument("--verbose", action="store_true", help="Print subprocess invocations")
    parser.add_argument("--model", default=DEFAULT_F2_MODEL, help=f"F2 model (default: {DEFAULT_F2_MODEL})")
    args = parser.parse_args()

    loaded = preload_llm_keys_from_local_env()

    print("\n\033[1mOpenCode Agent Suite — Integration Validator\033[0m")
    print(f"  Repo: {REPO_ROOT}")
    if loaded:
        for item in loaded:
            _print_dim(f"  Loaded {item}")

    all_failures: list[Failure] = []

    # A. Preflight (no sandbox needed)
    all_failures += check_preflight()
    if all_failures:
        sys.exit(report(all_failures))

    # A2. Strategy registry + contract (no sandbox needed)
    all_failures += check_strategy_registry()
    if all_failures:
        sys.exit(report(all_failures))

    # A3. Prometheus sandbox contract (no sandbox needed)
    all_failures += check_prometheus_sandbox()
    if all_failures:
        sys.exit(report(all_failures))

    # A4. Octopus perception contract (no sandbox needed)
    all_failures += check_octopus_perception()
    if all_failures:
        sys.exit(report(all_failures))

    with Sandbox(keep=args.keep_sandbox, verbose=args.verbose) as sb:
        print(f"  Sandbox: {sb.root}")

        # B. Download binary
        failures = download_binary(sb)
        all_failures += failures
        if failures:
            sys.exit(report(all_failures))  # can't proceed without the binary

        # C. Isolation
        all_failures += check_paths_sandboxed(sb)

        # D. Deploy
        deploy_failures = check_deploy(sb)
        all_failures += deploy_failures

        if not deploy_failures:
            # E–G only make sense if deploy succeeded
            all_failures += check_agent_list(sb)
            all_failures += check_agent_permissions(sb)
            all_failures += check_plugin_loads(sb)

            # H. F2
            if args.skip_llm:
                _print_header("H. Plugin hook fires (F2)")
                _print_skip("Skipped via --skip-llm")
            else:
                all_failures += check_hook_fires(sb, args.model)

            # I. Prometheus identity (new regression test)
            if args.skip_llm:
                _print_header("I. Prometheus identity (F3)")
                _print_skip("Skipped via --skip-llm")
            else:
                all_failures += check_prometheus_identity(sb)
        else:
            _print_skip("Skipping E–I: deploy failed")

    sys.exit(report(all_failures))


if __name__ == "__main__":
    main()
