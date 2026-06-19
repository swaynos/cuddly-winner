"""
evals/seed_build/oracle/failure_modes.py

Static and behavioral checks that distinguish a GREAT vibe-coded rules engine
from a technical-debt factory.

Grounded in the research exemplar failure modes:
  - Hardcoded secrets / API keys
  - Auth/ownership bypass (IDOR)
  - Silent failure (bare except swallowing errors)
  - Duplicated condition-evaluation logic
  - Network or filesystem side effects in the core evaluation path

Usage:
    python3 evals/seed_build/oracle/failure_modes.py <path/to/rules_engine.py>

Exits 0 if no failure modes are detected, 1 otherwise.
Also importable: call check_all(path) -> FailureModeReport.
"""

from __future__ import annotations

import ast
import importlib.util
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

@dataclass
class FailureModeReport:
    path: str
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return len(self.failures) == 0

    def render(self) -> str:
        lines = [f"Failure mode check: {self.path}"]
        if self.passed:
            lines.append("  PASS — no failure modes detected")
        else:
            lines.append(f"  FAIL — {len(self.failures)} failure mode(s):")
            for f in self.failures:
                lines.append(f"    ✗ {f}")
        if self.warnings:
            lines.append(f"  WARNINGS ({len(self.warnings)}):")
            for w in self.warnings:
                lines.append(f"    ⚠ {w}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Check 1: Hardcoded secrets
# ---------------------------------------------------------------------------

_SECRET_PATTERNS = [
    re.compile(r'(?i)(api[_-]?key|secret|token|password|passwd|auth[_-]?token)\s*=\s*["\'][^"\']{4,}["\']'),
    re.compile(r'["\'][A-Za-z0-9/+]{32,}["\']'),  # long base64-ish literals
    re.compile(r'sk-[A-Za-z0-9]{20,}'),             # OpenAI-style key
    re.compile(r'ghp_[A-Za-z0-9]{30,}'),            # GitHub PAT
]

def _check_hardcoded_secrets(source: str, report: FailureModeReport) -> None:
    for pattern in _SECRET_PATTERNS:
        m = pattern.search(source)
        if m:
            report.failures.append(
                f"Hardcoded secret detected: '{m.group(0)[:60]}...' — "
                "inject credentials via environment variables, never embed them."
            )
            return  # one report per file is enough


# ---------------------------------------------------------------------------
# Check 2: Auth/ownership bypass — no authorization check before evaluate
# ---------------------------------------------------------------------------

def _check_auth_bypass(tree: ast.Module, source: str, report: FailureModeReport) -> None:
    """
    Warn if there is no function or method that explicitly references
    owner/auth/authorization before the condition evaluation happens.
    """
    auth_keywords = {"owner", "auth", "authorization", "permission", "user_id"}
    auth_found = any(
        keyword in source.lower()
        for keyword in auth_keywords
    )
    if not auth_found:
        report.failures.append(
            "No ownership/authorization check found. The engine must verify "
            "that the calling user owns each rule before evaluating conditions "
            "(IDOR/auth-bypass failure mode)."
        )


# ---------------------------------------------------------------------------
# Check 3: Silent failure — broad bare-except blocks
# ---------------------------------------------------------------------------

class _BareExceptVisitor(ast.NodeVisitor):
    def __init__(self):
        self.bare_excepts: list[int] = []

    def visit_ExceptHandler(self, node):
        if node.type is None:
            # bare except:
            self.bare_excepts.append(node.lineno)
        elif isinstance(node.type, ast.Name) and node.type.id == "Exception":
            # except Exception: with no re-raise or specific handling is a risk
            # Check body — if it's just `pass` that's silent failure
            if len(node.body) == 1 and isinstance(node.body[0], ast.Pass):
                self.bare_excepts.append(node.lineno)
        self.generic_visit(node)


def _check_silent_failure(tree: ast.Module, report: FailureModeReport) -> None:
    visitor = _BareExceptVisitor()
    visitor.visit(tree)
    for lineno in visitor.bare_excepts:
        report.failures.append(
            f"Line {lineno}: broad/bare except that may swallow errors silently. "
            "Raise specific, typed exceptions so callers know exactly what went wrong."
        )


# ---------------------------------------------------------------------------
# Check 4: Duplicated condition evaluation logic
# ---------------------------------------------------------------------------

_CONDITION_KEYWORDS = [
    "event_type_matches", "payload_field_equals", "payload_field_gt",
    "condition_type", "evaluate_condition",
]

def _check_duplicated_logic(tree: ast.Module, source: str, report: FailureModeReport) -> None:
    """
    Heuristic: count how many distinct function definitions contain condition-
    evaluation logic. If more than one function independently implements the
    same condition-type dispatch, that is duplication.
    """
    functions_with_condition_logic: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            func_src = ast.get_source_segment(source, node) or ""
            condition_hits = sum(
                1 for kw in _CONDITION_KEYWORDS if kw in func_src
            )
            if condition_hits >= 2:
                functions_with_condition_logic.append(node.name)

    if len(functions_with_condition_logic) > 1:
        report.failures.append(
            f"Condition evaluation logic found in multiple functions: "
            f"{functions_with_condition_logic}. "
            "Centralize condition evaluation in a single function to avoid "
            "duplication and divergence (technical-debt failure mode)."
        )


# ---------------------------------------------------------------------------
# Check 5: Network/filesystem calls in core evaluation path
# ---------------------------------------------------------------------------

_NETWORK_FS_CALLS = {
    # network
    "socket", "urllib", "urllib2", "http.client", "httpx", "requests",
    "aiohttp", "boto3", "smtplib", "ftplib",
    # filesystem writes in evaluate path
    "open", "write", "os.remove", "shutil",
}

class _NetworkFsVisitor(ast.NodeVisitor):
    def __init__(self):
        self.calls: list[tuple[int, str]] = []

    def visit_Call(self, node):
        name = ""
        if isinstance(node.func, ast.Attribute):
            name = node.func.attr
        elif isinstance(node.func, ast.Name):
            name = node.func.id
        if name in _NETWORK_FS_CALLS:
            self.calls.append((node.lineno, name))
        self.generic_visit(node)

    def visit_Import(self, node):
        for alias in node.names:
            root = alias.name.split(".")[0]
            if root in _NETWORK_FS_CALLS:
                self.calls.append((node.lineno, alias.name))
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        if node.module:
            root = node.module.split(".")[0]
            if root in _NETWORK_FS_CALLS:
                self.calls.append((node.lineno, node.module))
        self.generic_visit(node)


def _check_network_fs_calls(tree: ast.Module, report: FailureModeReport) -> None:
    visitor = _NetworkFsVisitor()
    visitor.visit(tree)
    for lineno, name in visitor.calls:
        report.failures.append(
            f"Line {lineno}: potential network/filesystem call '{name}' detected in "
            "core engine module. The evaluation function must be pure and side-effect-free."
        )


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def check_all(engine_path: str | Path) -> FailureModeReport:
    p = Path(engine_path)
    report = FailureModeReport(path=str(p))

    try:
        source = p.read_text(encoding="utf-8")
    except OSError as e:
        report.failures.append(f"Cannot read file: {e}")
        return report

    try:
        tree = ast.parse(source, filename=str(p))
    except SyntaxError as e:
        report.failures.append(f"Syntax error: {e}")
        return report

    _check_hardcoded_secrets(source, report)
    _check_auth_bypass(tree, source, report)
    _check_silent_failure(tree, report)
    _check_duplicated_logic(tree, source, report)
    _check_network_fs_calls(tree, report)

    return report


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 failure_modes.py <path/to/rules_engine.py>")
        sys.exit(2)

    report = check_all(sys.argv[1])
    print(report.render())
    sys.exit(0 if report.passed else 1)
