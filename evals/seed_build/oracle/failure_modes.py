"""
evals/seed_build/oracle/failure_modes.py

Conservative static checks for specified rules-engine failure patterns.

Grounded in the research exemplar failure modes:
  - Hardcoded secrets / API keys
  - Auth/ownership bypass (IDOR)
  - Silent failure (bare except swallowing errors)
  - Duplicated condition-evaluation logic
  - Network or filesystem side effects in the core evaluation path
  - Writes to or mutation of module-global state

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
            lines.append("  PASS - no checked failure patterns found")
        else:
            lines.append(f"  FAIL - {len(self.failures)} checked failure pattern(s):")
            for f in self.failures:
                lines.append(f"    x {f}")
        if self.warnings:
            lines.append(f"  WARNINGS ({len(self.warnings)}):")
            for w in self.warnings:
                lines.append(f"    ! {w}")
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

_NETWORK_MODULES = {
    "socket", "urllib", "urllib2", "http", "httpx", "requests", "aiohttp",
    "boto3", "smtplib", "ftplib",
}
_FILE_MUTATION_METHODS = {
    "write", "writelines", "truncate", "write_text", "write_bytes", "touch",
    "unlink", "rename", "mkdir", "rmdir", "chmod", "symlink_to", "hardlink_to",
    "link_to",
}
_OS_MUTATIONS = {
    "remove", "unlink", "rename", "replace", "mkdir", "makedirs", "rmdir",
    "removedirs", "chmod", "truncate", "open", "fdopen",
}
_OS_PROCESS_CALLS = {
    "system", "popen", "spawnl", "spawnle", "spawnlp", "spawnlpe", "spawnv",
    "spawnve", "spawnvp", "spawnvpe",
}
_SUBPROCESS_CALLS = {
    "run", "Popen", "call", "check_call", "check_output", "getoutput",
    "getstatusoutput",
}


def _qualified_name(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _qualified_name(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    return ""

class _NetworkFsVisitor(ast.NodeVisitor):
    def __init__(self):
        self.calls: list[tuple[int, str]] = []
        self.path_constructors = {"Path"}
        self.path_variables: set[str] = set()
        self.pathlib_aliases = {"pathlib"}
        self.os_aliases = {"os"}
        self.shutil_aliases = {"shutil"}
        self.subprocess_aliases = {"subprocess"}
        self.direct_calls: dict[str, str] = {}

    def _record(self, node: ast.AST, name: str) -> None:
        self.calls.append((node.lineno, name))

    def _is_path_value(self, node: ast.expr) -> bool:
        if isinstance(node, ast.Name):
            return node.id in self.path_variables
        if isinstance(node, ast.Call):
            qualified = _qualified_name(node.func)
            if qualified in self.path_constructors:
                return True
            if isinstance(node.func, ast.Attribute) and node.func.attr in {
                "absolute", "expanduser", "joinpath", "resolve", "with_name", "with_suffix",
            }:
                return self._is_path_value(node.func.value)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
            return self._is_path_value(node.left)
        return False

    def visit_Assign(self, node):
        if self._is_path_value(node.value):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    self.path_variables.add(target.id)
        self.generic_visit(node)

    def visit_AnnAssign(self, node):
        if node.value is not None and self._is_path_value(node.value) and isinstance(node.target, ast.Name):
            self.path_variables.add(node.target.id)
        self.generic_visit(node)

    def visit_Call(self, node):
        qualified = _qualified_name(node.func)
        if isinstance(node.func, ast.Name):
            if node.func.id == "open":
                self._record(node, "open")
            elif node.func.id in self.direct_calls:
                self._record(node, self.direct_calls[node.func.id])
        elif isinstance(node.func, ast.Attribute):
            receiver = node.func.value
            attribute = node.func.attr
            root = qualified.split(".", 1)[0]
            if attribute in _FILE_MUTATION_METHODS:
                self._record(node, qualified or attribute)
            elif attribute == "open":
                self._record(
                    node,
                    "Path.open" if self._is_path_value(receiver) else (qualified or "open"),
                )
            elif attribute == "replace" and self._is_path_value(receiver):
                self._record(node, qualified or attribute)
            elif root in self.os_aliases and attribute in _OS_MUTATIONS:
                self._record(node, f"os.{attribute}")
            elif root in self.os_aliases and attribute in _OS_PROCESS_CALLS:
                self._record(node, f"os.{attribute}")
            elif root in self.subprocess_aliases and attribute in _SUBPROCESS_CALLS:
                self._record(node, f"subprocess.{attribute}")
            elif root in self.shutil_aliases:
                self._record(node, f"shutil.{attribute}")
        self.generic_visit(node)

    def visit_Import(self, node):
        for alias in node.names:
            root = alias.name.split(".")[0]
            local_name = alias.asname or root
            if root in _NETWORK_MODULES:
                self._record(node, alias.name)
            elif root == "pathlib":
                self.pathlib_aliases.add(local_name)
                self.path_constructors.add(f"{local_name}.Path")
            elif root == "os":
                self.os_aliases.add(local_name)
            elif root == "shutil":
                self.shutil_aliases.add(local_name)
            elif root == "subprocess":
                self.subprocess_aliases.add(local_name)
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        if node.module:
            root = node.module.split(".")[0]
            if root in _NETWORK_MODULES:
                self._record(node, node.module)
            elif node.module == "pathlib":
                for alias in node.names:
                    if alias.name == "Path":
                        self.path_constructors.add(alias.asname or alias.name)
            elif root == "os":
                for alias in node.names:
                    if alias.name in _OS_MUTATIONS | _OS_PROCESS_CALLS:
                        self.direct_calls[alias.asname or alias.name] = f"os.{alias.name}"
            elif root == "shutil":
                for alias in node.names:
                    self.direct_calls[alias.asname or alias.name] = f"shutil.{alias.name}"
            elif root == "subprocess":
                for alias in node.names:
                    if alias.name in _SUBPROCESS_CALLS:
                        self.direct_calls[alias.asname or alias.name] = f"subprocess.{alias.name}"
            elif root == "builtins":
                for alias in node.names:
                    if alias.name == "open":
                        self.direct_calls[alias.asname or alias.name] = "builtins.open"
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
# Check 6: Writes to or mutation of module-global state
# ---------------------------------------------------------------------------

_MUTATING_METHODS = {
    "add", "append", "clear", "difference_update", "discard", "extend",
    "insert", "intersection_update", "pop", "popitem", "remove", "reverse",
    "setdefault", "sort", "symmetric_difference_update", "update",
    "__delitem__", "__setitem__",
}


def _bound_names(target: ast.expr) -> set[str]:
    if isinstance(target, ast.Name):
        return {target.id}
    if isinstance(target, (ast.Tuple, ast.List)):
        return set().union(*(_bound_names(item) for item in target.elts))
    return set()


def _root_name(node: ast.expr) -> str:
    while isinstance(node, (ast.Attribute, ast.Subscript)):
        node = node.value
    return node.id if isinstance(node, ast.Name) else ""


class _ModuleStateVisitor(ast.NodeVisitor):
    def __init__(self, module_names: set[str]):
        self.module_names = module_names
        self.function_depth = 0
        self.changes: list[tuple[int, str]] = []

    def _in_function(self) -> bool:
        return self.function_depth > 0

    def _visit_function(self, node) -> None:
        self.function_depth += 1
        self.generic_visit(node)
        self.function_depth -= 1

    def visit_FunctionDef(self, node):
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node):
        self._visit_function(node)

    def visit_Lambda(self, node):
        self._visit_function(node)

    def visit_Global(self, node):
        if self._in_function():
            self.changes.append(
                (node.lineno, f"global declaration for {', '.join(node.names)}")
            )

    def _check_target(self, target: ast.expr) -> None:
        if (
            self._in_function()
            and isinstance(target, (ast.Attribute, ast.Subscript))
            and _root_name(target) in self.module_names
        ):
            self.changes.append(
                (target.lineno, f"assignment through module global {_root_name(target)}")
            )

    def visit_Assign(self, node):
        for target in node.targets:
            self._check_target(target)
        self.generic_visit(node)

    def visit_AnnAssign(self, node):
        self._check_target(node.target)
        self.generic_visit(node)

    def visit_AugAssign(self, node):
        self._check_target(node.target)
        self.generic_visit(node)

    def visit_Delete(self, node):
        for target in node.targets:
            self._check_target(target)
        self.generic_visit(node)

    def visit_Call(self, node):
        if self._in_function():
            if isinstance(node.func, ast.Name) and node.func.id == "globals":
                self.changes.append((node.lineno, "access through globals()"))
            elif isinstance(node.func, ast.Attribute):
                root = _root_name(node.func.value)
                if root in self.module_names and node.func.attr in _MUTATING_METHODS:
                    self.changes.append(
                        (node.lineno, f"module-state mutation {root}.{node.func.attr}")
                    )
        self.generic_visit(node)


def _check_module_state_mutation(tree: ast.Module, report: FailureModeReport) -> None:
    module_names: set[str] = set()
    for statement in tree.body:
        if isinstance(statement, ast.Assign):
            for target in statement.targets:
                module_names.update(_bound_names(target))
        elif isinstance(statement, ast.AnnAssign):
            module_names.update(_bound_names(statement.target))

    visitor = _ModuleStateVisitor(module_names)
    visitor.visit(tree)
    for lineno, change in visitor.changes:
        report.failures.append(
            f"Line {lineno}: forbidden module-global state change ({change}). "
            "evaluate and its helpers must leave module state unchanged."
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
    _check_module_state_mutation(tree, report)

    return report


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 failure_modes.py <path/to/rules_engine.py>")
        sys.exit(2)

    report = check_all(sys.argv[1])
    print(report.render())
    sys.exit(0 if report.passed else 1)
