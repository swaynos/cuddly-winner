"""Statically check the mutable trainer's evaluator boundary."""

from __future__ import annotations

import sys

if not sys.flags.isolated:
    raise SystemExit("check_train_boundary.py requires isolated Python mode (-I)")

import argparse
import ast
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ALLOWED_LOCAL_IMPORTS = {"prepare"}
FORBIDDEN_IDENTIFIER_PARTS = {
    "accuracy",
    "evaluate",
    "evaluation",
    "evaluator",
    "heldout",
    "metric",
    "metrics",
    "score",
    "scored",
    "scorer",
    "scores",
    "scoring",
}
FORBIDDEN_LITERAL = re.compile(
    r"\b(?:accuracy|evaluat(?:e|ion|or)|held[-_ ]?out|metrics?|scor(?:e|ed|er|es|ing))\b",
    re.IGNORECASE,
)
FORBIDDEN_CALLS = {
    "__import__",
    "builtins.__import__",
    "compile",
    "eval",
    "exec",
    "importlib.import_module",
    "print",
    "sys.stderr.write",
    "sys.stdout.write",
}


def _dotted_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _dotted_name(node.value)
        if parent:
            return f"{parent}.{node.attr}"
    return None


def _identifier_marker(value: str) -> str | None:
    parts = [part for part in re.split(r"[^a-z0-9]+", value.casefold()) if part]
    for part in parts:
        if part in FORBIDDEN_IDENTIFIER_PARTS:
            return part
    if "heldout" in "".join(parts):
        return "heldout"
    return None


def _docstring_nodes(tree: ast.AST) -> set[ast.Constant]:
    docstrings: set[ast.Constant] = set()
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if (
            isinstance(body, list)
            and body
            and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)
        ):
            docstrings.add(body[0].value)
    return docstrings


def _allowed_import(module: str) -> bool:
    root = module.split(".", 1)[0]
    return root in ALLOWED_LOCAL_IMPORTS or root in sys.stdlib_module_names


def check_train_source(root: Path) -> list[str]:
    """Return direct and obvious mutable-source boundary violations."""
    train_path = root.resolve() / "train.py"
    try:
        source = train_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        return [f"train.py: could not read UTF-8 source: {error}"]
    try:
        tree = ast.parse(source, filename=str(train_path))
    except SyntaxError as error:
        return [
            f"train.py:{error.lineno or 0}: syntax error: {error.msg}"
        ]

    failures: list[str] = []
    docstrings = _docstring_nodes(tree)
    for node in ast.walk(tree):
        line = getattr(node, "lineno", 0)
        if isinstance(node, ast.Import):
            for alias in node.names:
                if not _allowed_import(alias.name):
                    failures.append(
                        f"train.py:{line}: import {alias.name!r} is outside "
                        "the standard-library/prepare boundary"
                    )
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if node.level or not module or not _allowed_import(module):
                rendered = "." * node.level + module
                failures.append(
                    f"train.py:{line}: import {rendered!r} is outside "
                    "the standard-library/prepare boundary"
                )
        elif isinstance(node, (ast.Name, ast.Attribute)):
            identifier = node.id if isinstance(node, ast.Name) else node.attr
            marker = _identifier_marker(identifier)
            if marker:
                failures.append(
                    f"train.py:{line}: forbidden evaluator identifier "
                    f"{identifier!r} ({marker})"
                )
        elif (
            isinstance(node, ast.Constant)
            and node not in docstrings
            and isinstance(node.value, str)
        ):
            match = FORBIDDEN_LITERAL.search(node.value)
            if match:
                failures.append(
                    f"train.py:{line}: forbidden evaluator/source literal "
                    f"containing {match.group(0)!r}"
                )

        if isinstance(node, ast.Call):
            call_name = _dotted_name(node.func)
            if call_name in FORBIDDEN_CALLS:
                failures.append(
                    f"train.py:{line}: forbidden output or dynamic-code call "
                    f"{call_name!r}"
                )

    return failures


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    failures = check_train_source(args.root)
    if failures:
        raise SystemExit("train.py source boundary failed:\n" + "\n".join(failures))
    print("train-boundary-ok")


if __name__ == "__main__":
    main()
