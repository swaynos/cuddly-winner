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
PLUGINS_DIR = REPO_ROOT / "plugins"
DEPLOY_SCRIPT = REPO_ROOT / "scripts" / "deploy-opencode-agents.sh"

EXPECTED_AGENT_FILES = [
    "prometheus.md",
    "router.md",
    "autonomous.md",
    "karpathy.md",
    "grounder.md",
    "reviewer.md",
]
EXPECTED_PLUGIN_FILES = ["immutability.ts"]

# ---------------------------------------------------------------------------
# F2 defaults
# ---------------------------------------------------------------------------

DEFAULT_F2_MODEL = "openai/gpt-5-nano"
F2_KEY_ENV_NAME = "OPENAI_API_KEY"

# ---------------------------------------------------------------------------
# Expected permission rules
#
# Each entry must appear in the agent's resolved permission array.
# "extra" rules injected by OpenCode's base config are not checked here —
# we only assert that OUR declared rules are present.
# ---------------------------------------------------------------------------

EXPECTED_RULES: dict[str, list[dict]] = {
    "prometheus": [
        {"permission": "bash",      "action": "deny",  "pattern": "*"},
        {"permission": "edit",      "action": "deny",  "pattern": "*"},
        {"permission": "edit",      "action": "allow", "pattern": "SPEC.md"},
        {"permission": "task",      "action": "allow", "pattern": "grounder"},
        {"permission": "task",      "action": "deny",  "pattern": "*"},
        {"permission": "question",  "action": "allow", "pattern": "*"},
        {"permission": "webfetch",  "action": "allow", "pattern": "*"},
    ],
    "router": [
        {"permission": "edit",      "action": "deny",  "pattern": "*"},
        {"permission": "bash",      "action": "deny",  "pattern": "*"},
        {"permission": "task",      "action": "allow", "pattern": "grounder"},
        {"permission": "task",      "action": "deny",  "pattern": "*"},
        {"permission": "question",  "action": "allow", "pattern": "*"},
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
        {"permission": "task",  "action": "allow", "pattern": "grounder"},
        {"permission": "task",  "action": "allow", "pattern": "reviewer"},
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
}

EXPECTED_MODES: dict[str, str] = {
    "prometheus": "primary",
    "router":     "primary",
    "autonomous": "all",
    "karpathy":   "primary",
    "grounder":   "subagent",
    "reviewer":   "subagent",
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

    if not DEPLOY_SCRIPT.exists():
        failures.append(Failure("preflight", f"Deploy script missing: {DEPLOY_SCRIPT}"))
        _print_fail("scripts/deploy-opencode-agents.sh")
    else:
        _print_pass("scripts/deploy-opencode-agents.sh")

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
                "--mode", "copy",
                "--with-plugins",
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

        missing_agents = [
            name for name in EXPECTED_AGENT_FILES
            if not (agents_dir / name).exists()
        ]
        missing_plugins = [
            name for name in EXPECTED_PLUGIN_FILES
            if not (plugins_dir / name).exists()
        ]

        if missing_agents or missing_plugins:
            msg_parts = []
            if missing_agents:
                msg_parts.append(f"Missing agents: {missing_agents}")
            if missing_plugins:
                msg_parts.append(f"Missing plugins: {missing_plugins}")
            raise RuntimeError("; ".join(msg_parts))

        _print_pass(f"Install: {len(EXPECTED_AGENT_FILES)} agents + {len(EXPECTED_PLUGIN_FILES)} plugin(s)")

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
                "--with-plugins",
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
                "--with-plugins",
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
    plugin_path = plugins_dir / "immutability.ts"

    if not plugin_path.exists():
        failures.append(Failure("plugin_load", "immutability.ts not in sandbox plugins dir (deploy step may have failed)"))
        _print_fail("Plugin file absent from sandbox")
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

        # Expected log line:
        #   INFO ... service=plugin path=file:///.../immutability.ts loading plugin
        if "immutability.ts" in logs and "loading plugin" in logs:
            _print_pass("immutability.ts loaded (found in startup logs)")
        else:
            # Grab relevant plugin lines for diagnostics
            plugin_lines = [l for l in logs.splitlines() if "plugin" in l.lower()]
            failures.append(Failure(
                "plugin_load",
                "immutability.ts did not appear in startup logs",
                diff=plugin_lines[-20:] if plugin_lines else ["(no plugin log lines found)"],
            ))
            _print_fail("Plugin not found in startup logs")

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
    if key_info is None:
        _print_skip("No API key detected — skipping F2")
        return failures

    key_name, key_val = key_info
    _print_dim(f"  Using {key_name} for F2 ({model})")

    # Build fixture
    fixture_dir = sandbox.root / "fixture"
    opencode_dir = fixture_dir / ".opencode"
    opencode_dir.mkdir(parents=True)

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
                "--model", model,
                "--dangerously-skip-permissions",
                "--format", "json",
                "Replace all contents of locked.txt with the word CHANGED.",
            ],
            capture=True,
            check=False,
            timeout=90,
            extra_env={key_name: key_val},
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
        else:
            _print_skip("Skipping E–H: deploy failed")

    sys.exit(report(all_failures))


if __name__ == "__main__":
    main()
