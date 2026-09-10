"""Check every immutable ml-loop package file and exact package membership."""

from __future__ import annotations

import sys

if not sys.flags.isolated:
    raise SystemExit("check_immutable.py requires isolated Python mode (-I)")

import argparse
import json
import logging
from pathlib import Path, PurePosixPath


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
CHECKER_PATH = "tools/check_immutable.py"
TRAIN_BOUNDARY_PATH = "tools/check_train_boundary.py"
MANIFEST_PATH = ".opencode/tasks/improve-classifier.json"
CHECKER_DIGEST_TOKEN = b"<CHECKER_SHA256>"
CHECKER_DIGEST_REFERENCES = {
    MANIFEST_PATH,
    ".opencode/tasks/improve-classifier.md",
    "README.md",
}
EXPECTED_SHA256 = {
    ".opencode/agents/improve-classifier.md": "0b741352d682927589f5b8cae618d958f2bbd67076f02986a8dc900d15c01fa9",
    ".opencode/generated-agents.json": "50d58e92dc20dae4f07b13c938fe39da2a2c46cb41c934993d94fabb42314308",
    ".opencode/tasks/improve-classifier.json": "c1760a5f808169b86693d64dc05e185fda876895ec8bc3359b845c017320e299",
    ".opencode/tasks/improve-classifier.md": "5515205a8270e1e7aee0ab36b9971491fa3cb736fad23a231587cb4832d17539",
    "README.md": "72cb246fa35bd36ee29ae375f5715ccf0fecc4fa023b6ddfc6f51219c08e7e39",
    "prepare.py": "edc09a860ffb7b903b7ab075ab1a39a4a658d68bbf677ff7c9db0c589d2b39fa",
    "tests/test_integrity.py": "dc57fa1ded22efbb54bc374f19c686de60dee67bbbed40f599e3604600a4cd7a",
    "tools/baseline.json": "241dac2bb5191da70117a9f4b9fa9bc41fdf1526fef98b98dcb6a0b309689758",
    "tools/check_train_boundary.py": "7e84b570cba25e0c18c13719b9068b548d5e4beade961be8c98b86a30f257e45",
    "tools/final_verify.py": "9dc2152ac8bb332334220c1543fe69416c348ad39e6f34ae4b4e0f704ce918b6",
    "tools/heldout.py": "b83c7e6795d99e6e497b7e5945f2f5d39f704db478b0a6bd0e2a9fd75518fc06",
    "tools/regression_check.py": "78d223c5bb107830a1b72851a1ce397ebc0881bd34c8cec868017a0b9f589e13",
    "tools/run_experiment.py": "82194eff39928c65623d42a4f12ba0451aae89ae199478b1cfb60820d21364ef",
    "tools/score.py": "0e59729f889f765f7af680306527d49f16edf56a464413b603e2b404dedfc629",
}
EXPECTED_DIRECTORIES = {
    ".opencode",
    ".opencode/agents",
    ".opencode/tasks",
    "artifacts",
    "logs",
    "tests",
    "tools",
}
EXPECTED_BASELINE_ENTRIES = {
    *EXPECTED_DIRECTORIES,
    *EXPECTED_SHA256,
    CHECKER_PATH,
}


def _sha256(content: bytes) -> str:
    logging.disable(logging.CRITICAL)
    try:
        from hashlib import sha256
    finally:
        logging.disable(logging.NOTSET)
    return sha256(content).hexdigest()


def _canonical_path(value: object) -> bool:
    if not isinstance(value, str) or not value or "\\" in value:
        return False
    path = PurePosixPath(value)
    return (
        not path.is_absolute()
        and path.as_posix() == value
        and all(part not in {"", ".", ".."} for part in path.parts)
    )


def _path_set(value: object, name: str, failures: list[str]) -> set[str]:
    if not isinstance(value, list) or not value:
        failures.append(f"{name}: expected a non-empty path list")
        return set()
    paths: set[str] = set()
    for item in value:
        if not _canonical_path(item):
            failures.append(f"{name}: invalid package-relative path {item!r}")
            continue
        if item in paths:
            failures.append(f"{name}: duplicate path {item}")
        paths.add(item)
    return paths


def _declared_paths(root: Path, failures: list[str]) -> tuple[set[str], set[str]]:
    manifest_path = root / MANIFEST_PATH
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        failures.append(f"{MANIFEST_PATH}: could not read manifest paths: {error}")
        return set(), set()
    if not isinstance(manifest, dict):
        failures.append(f"{MANIFEST_PATH}: manifest must be an object")
        return set(), set()

    permissions = manifest.get("permissions")
    strategy = manifest.get("strategy_config")
    if not isinstance(permissions, dict):
        failures.append(f"{MANIFEST_PATH}: permissions must be an object")
        permissions = {}
    if not isinstance(strategy, dict):
        failures.append(f"{MANIFEST_PATH}: strategy_config must be an object")
        strategy = {}

    edit_paths = _path_set(
        permissions.get("edit_paths"),
        "permissions.edit_paths",
        failures,
    )
    implementation_scope = _path_set(
        manifest.get("implementation_scope"),
        "implementation_scope",
        failures,
    )
    mutable_targets = _path_set(
        strategy.get("mutable_targets"),
        "strategy_config.mutable_targets",
        failures,
    )
    if not edit_paths <= implementation_scope:
        failures.append("manifest edit paths must be inside implementation_scope")
    if mutable_targets != edit_paths:
        failures.append(
            "strategy_config.mutable_targets must exactly match permissions.edit_paths"
        )
    return edit_paths, implementation_scope - edit_paths


def _package_entries(root: Path) -> set[str]:
    entries: set[str] = set()
    for path in root.rglob("*"):
        relative = path.relative_to(root)
        entries.add(relative.as_posix())
    return entries


def _regular_file(path: Path) -> bool:
    return not path.is_symlink() and path.is_file()


def check(root: Path) -> list[str]:
    root = root.resolve()
    failures: list[str] = []
    edit_paths, output_paths = _declared_paths(root, failures)
    observed_entries = _package_entries(root)
    required_entries = EXPECTED_BASELINE_ENTRIES | edit_paths
    allowed_entries = required_entries | output_paths

    for relative_path in sorted(observed_entries - allowed_entries):
        failures.append(f"unexpected package entry: {relative_path}")
    for relative_path in sorted(required_entries - observed_entries):
        failures.append(f"missing package entry: {relative_path}")

    for relative_path in sorted(EXPECTED_DIRECTORIES):
        path = root / relative_path
        if path.is_symlink() or not path.is_dir():
            failures.append(f"{relative_path}: missing or not a regular directory")
    for relative_path in sorted(edit_paths):
        if not _regular_file(root / relative_path):
            failures.append(f"{relative_path}: mutable target is not a regular file")
    for relative_path in sorted(output_paths & observed_entries):
        if not _regular_file(root / relative_path):
            failures.append(f"{relative_path}: generated output is not a regular file")

    checker_path = root / CHECKER_PATH
    checker_digest = None
    if not _regular_file(checker_path):
        failures.append(f"{CHECKER_PATH}: missing or not a regular file")
    else:
        checker_digest = _sha256(checker_path.read_bytes()).encode("ascii")

    verified_paths: set[str] = set()
    for relative_path, expected in sorted(EXPECTED_SHA256.items()):
        path = root / relative_path
        if not _regular_file(path):
            failures.append(f"{relative_path}: missing or not a regular file")
            continue
        content = path.read_bytes()
        if relative_path in CHECKER_DIGEST_REFERENCES:
            if checker_digest is None or checker_digest not in content:
                failures.append(
                    f"{relative_path}: does not reference the current checker sha256"
                )
            elif checker_digest is not None:
                content = content.replace(checker_digest, CHECKER_DIGEST_TOKEN)
        actual = _sha256(content)
        if actual != expected:
            failures.append(
                f"{relative_path}: sha256 mismatch (expected {expected}, got {actual})"
            )
        else:
            verified_paths.add(relative_path)

    if TRAIN_BOUNDARY_PATH in verified_paths:
        boundary_path = root / TRAIN_BOUNDARY_PATH
        namespace: dict[str, object] = {
            "__file__": str(boundary_path),
            "__name__": "_ml_loop_train_boundary",
            "__package__": None,
        }
        try:
            exec(compile(boundary_path.read_bytes(), str(boundary_path), "exec"), namespace)
            check_train_source = namespace.get("check_train_source")
            if not callable(check_train_source):
                failures.append(
                    f"{TRAIN_BOUNDARY_PATH}: does not export check_train_source"
                )
            else:
                boundary_failures = check_train_source(root)
                if boundary_failures:
                    failures.append("train.py source boundary failed:")
                    failures.extend(boundary_failures)
        except (OSError, RuntimeError, SyntaxError, TypeError, ValueError) as error:
            failures.append(f"{TRAIN_BOUNDARY_PATH}: could not run check: {error}")
    return failures


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=PACKAGE_ROOT)
    args = parser.parse_args()
    failures = check(args.root)
    if failures:
        raise SystemExit("immutable check failed:\n" + "\n".join(failures))
    print(
        f"immutable-ok: {len(EXPECTED_SHA256)} hashes; "
        f"{len(EXPECTED_BASELINE_ENTRIES)} baseline entries"
    )


if __name__ == "__main__":
    main()
