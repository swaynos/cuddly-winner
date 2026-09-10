"""Mechanical scorer for a Prometheus-generated schema-v1 task package."""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import stat
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


MANIFEST_KEYS = {
    "schema_version", "task_id", "agent_name", "agent_definition", "task_brief",
    "strategy", "permissions", "implementation_scope", "durable_context",
    "verification", "limits", "escalation_triggers", "strategy_config", "run_kpis",
}
PERMISSION_KEYS = {"edit_paths", "bash"}
VERIFICATION_KEYS = {
    "commands", "success_evidence", "freshness", "failure_conditions", "independent_review",
}
STRATEGY_KEYS = {
    "direct": {"work_selection"},
    "ralph": {
        "work_selection", "pass_budget", "state_paths", "progress_evidence_before",
        "progress_evidence_after", "pass_failure_treatment", "run_stop_conditions",
        "later_pass_starter",
    },
    "optimization": {
        "work_selection", "objective", "direction", "evaluator", "score_extraction",
        "noise_policy", "mutable_targets", "immutable_targets", "experiment_budget",
        "keep_revert_rule", "stop_conditions",
    },
}
RESERVED_AGENT_NAMES = {
    "build", "plan", "general", "explore", "compaction", "title", "summary",
    "ask", "grounder", "prometheus", "reviewer",
}
BRIEF_SECTIONS = (
    "Outcome",
    "Grounding",
    "Approaches Considered",
    "Acceptance Criteria",
    "Durable Context",
    "Strategy",
    "Implementation Checklist",
    "Verification",
    "Limits and Escalation",
)


@dataclass
class PlanningCheck:
    name: str
    passed: bool
    evidence: str = ""
    note: str = ""


@dataclass
class PlanningReport:
    checks: list[PlanningCheck] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(check.passed for check in self.checks)

    @property
    def score(self) -> float:
        return sum(check.passed for check in self.checks) / len(self.checks) if self.checks else 0.0

    def render(self) -> str:
        return "\n".join(
            [f"Planning quality score: {self.score:.0%}  ({'PASS' if self.passed else 'FAIL'})"]
            + [
                f"  {'PASS' if check.passed else 'FAIL'} {check.name}: "
                f"{check.evidence or check.note}"
                for check in self.checks
            ]
        )


@dataclass
class _Package:
    name: str = ""
    manifest_path: str = ""
    manifest: dict[str, Any] = field(default_factory=dict)
    brief: str = ""
    agent: str = ""
    errors: list[str] = field(default_factory=list)


def _record(value: object) -> bool:
    return isinstance(value, dict)


def _strings(value: object) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) and item for item in value)


def _integer(value: object) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    return isinstance(value, float) and math.isfinite(value) and value.is_integer()


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _canonical_path(value: object) -> bool:
    if not isinstance(value, str) or not value or "\\" in value:
        return False
    if Path(value).is_absolute() or re.match(r"^[A-Za-z]:", value):
        return False
    return all(part not in {"", ".", ".."} for part in value.split("/"))


def _task_id(value: object) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", value))


def _unknown_keys(value: dict[str, Any], allowed: set[str], name: str, errors: list[str]) -> None:
    for key in value:
        if key not in allowed:
            errors.append(f"unknown key inside {name}: {key}")


def _exact_keys(value: dict[str, Any], expected: set[str], name: str, errors: list[str]) -> None:
    _unknown_keys(value, expected, name, errors)
    for key in sorted(expected - value.keys()):
        errors.append(f"missing key inside {name}: {key}")


def _path_list(
    value: object,
    name: str,
    errors: list[str],
    *,
    required: bool = True,
) -> bool:
    if not _strings(value) or (required and not value):
        qualifier = " non-empty" if required else ""
        errors.append(f"{name} must be a{qualifier} string[]")
        return False
    seen: set[str] = set()
    for item in value:
        if not _canonical_path(item):
            errors.append(f"{name} path must be canonical and worktree-relative: {item}")
        if item in seen:
            errors.append(f"{name} contains a duplicate path: {item}")
        seen.add(item)
    return True


def _required_strings(
    value: dict[str, Any],
    keys: tuple[str, ...],
    name: str,
    errors: list[str],
) -> None:
    for key in keys:
        if not isinstance(value.get(key), str) or not value[key].strip():
            errors.append(f"{name}.{key} must be a non-empty string")


def _validate_strategy(manifest: dict[str, Any], errors: list[str]) -> None:
    strategy = manifest.get("strategy")
    config = manifest.get("strategy_config")
    if strategy not in STRATEGY_KEYS:
        errors.append(f'strategy must be "direct", "ralph", or "optimization" (got {strategy!r})')
        return
    if not _record(config):
        errors.append("strategy_config must be an object")
        return

    _unknown_keys(config, STRATEGY_KEYS[strategy], "strategy_config", errors)
    _required_strings(config, ("work_selection",), "strategy_config", errors)
    if strategy == "ralph":
        if not _integer(config.get("pass_budget")) or config["pass_budget"] <= 0:
            errors.append("strategy_config.pass_budget must be a positive integer")
        for key in (
            "state_paths", "progress_evidence_before", "progress_evidence_after",
            "run_stop_conditions",
        ):
            _path_list(config.get(key), f"strategy_config.{key}", errors)
        _required_strings(
            config,
            ("pass_failure_treatment", "later_pass_starter"),
            "strategy_config",
            errors,
        )
    elif strategy == "optimization":
        _required_strings(
            config,
            ("objective", "evaluator", "noise_policy", "keep_revert_rule"),
            "strategy_config",
            errors,
        )
        if config.get("direction") not in {"minimize", "maximize"}:
            errors.append('strategy_config.direction must be "minimize" or "maximize"')
        if config.get("score_extraction") not in {
            "first float on stdout", "last float on stdout",
        }:
            errors.append("strategy_config.score_extraction must be a supported extraction rule")
        if not _canonical_path(config.get("evaluator")):
            errors.append("strategy_config.evaluator must be a canonical worktree-relative path")
        if not _integer(config.get("experiment_budget")) or config["experiment_budget"] <= 0:
            errors.append("strategy_config.experiment_budget must be a positive integer")
        for key in ("mutable_targets", "immutable_targets", "stop_conditions"):
            _path_list(config.get(key), f"strategy_config.{key}", errors)
        mutable = config.get("mutable_targets") if _strings(config.get("mutable_targets")) else []
        immutable = config.get("immutable_targets") if _strings(config.get("immutable_targets")) else []
        for target in [*mutable, *immutable]:
            if re.search(r"[*?\[\]]", target):
                errors.append(f"strategy_config target must not contain glob characters: {target}")
        for target in set(mutable) & set(immutable):
            errors.append(f"strategy_config mutable and immutable targets overlap: {target}")


def _manifest_errors(manifest: object) -> list[str]:
    errors: list[str] = []
    if not _record(manifest):
        return ["manifest must be a JSON object"]

    _unknown_keys(manifest, MANIFEST_KEYS, "manifest", errors)
    if not _integer(manifest.get("schema_version")) or manifest["schema_version"] != 1:
        errors.append(f"schema_version must be 1 (got {manifest.get('schema_version')!r})")
    task_id = manifest.get("task_id")
    if not _task_id(task_id):
        errors.append("task_id must be a lowercase hyphenated slug")
    elif task_id in RESERVED_AGENT_NAMES:
        errors.append(f'task_id must not use reserved agent identity "{task_id}"')
    if manifest.get("agent_name") != task_id:
        errors.append("agent_name must match task_id")
    if _task_id(task_id):
        if manifest.get("agent_definition") != f".opencode/agents/{task_id}.md":
            errors.append("agent_definition must match task_id")
        if manifest.get("task_brief") != f".opencode/tasks/{task_id}.md":
            errors.append("task_brief must match task_id")
    for key in ("agent_definition", "task_brief"):
        if not _canonical_path(manifest.get(key)):
            errors.append(f"{key} must be a canonical worktree-relative path")

    _validate_strategy(manifest, errors)
    scope_ok = _path_list(manifest.get("implementation_scope"), "implementation_scope", errors)
    _path_list(manifest.get("durable_context"), "durable_context", errors)
    _path_list(manifest.get("escalation_triggers"), "escalation_triggers", errors)

    permissions = manifest.get("permissions")
    if not _record(permissions):
        errors.append("permissions must be an object")
    else:
        _unknown_keys(permissions, PERMISSION_KEYS, "permissions", errors)
        edit_ok = _path_list(permissions.get("edit_paths"), "permissions.edit_paths", errors)
        if not isinstance(permissions.get("bash"), bool):
            errors.append("permissions.bash must be a boolean")
        if edit_ok and scope_ok:
            scope = manifest["implementation_scope"]
            for item in permissions["edit_paths"]:
                if item not in scope:
                    errors.append(f"permissions.edit_paths must be within implementation_scope: {item}")

    verification = manifest.get("verification")
    if not _record(verification):
        errors.append("verification must be an object")
    else:
        _exact_keys(verification, VERIFICATION_KEYS, "verification", errors)
        for key in ("commands", "success_evidence", "failure_conditions"):
            _path_list(verification.get(key), f"verification.{key}", errors)
        if not isinstance(verification.get("freshness"), str) or not verification["freshness"].strip():
            errors.append("verification.freshness must be a non-empty string")
        review = verification.get("independent_review")
        if review is not None and (not isinstance(review, str) or not review.strip()):
            errors.append("verification.independent_review must be null or a non-empty string")

    limits = manifest.get("limits")
    if not _record(limits) or not _strings(limits.get("stop_conditions")) or not limits["stop_conditions"]:
        errors.append("limits.stop_conditions must be a non-empty string[]")

    run_kpis = manifest.get("run_kpis")
    if run_kpis is not None:
        if not _record(run_kpis) or not isinstance(run_kpis.get("enabled"), bool):
            errors.append("run_kpis must declare enabled as a boolean")
        elif run_kpis["enabled"]:
            unattended = run_kpis.get("unattended_runtime")
            token_burn = run_kpis.get("token_burn")
            if (
                not _record(unattended)
                or not _number(unattended.get("target_seconds"))
                or unattended["target_seconds"] <= 0
            ):
                errors.append("enabled run_kpis requires a positive unattended_runtime.target_seconds")
            if (
                not _record(token_burn)
                or not _number(token_burn.get("target_tokens_per_active_minute"))
                or token_burn["target_tokens_per_active_minute"] <= 0
                or not _number(token_burn.get("hard_budget_tokens"))
                or token_burn["hard_budget_tokens"] <= 0
            ):
                errors.append("enabled run_kpis requires positive token-burn targets")
    return errors


def _inside(root: Path, target: Path) -> bool:
    try:
        target.relative_to(root)
        return True
    except ValueError:
        return False


def _regular_file(root: Path, relative: str, errors: list[str]) -> Path | None:
    try:
        resolved_root = root.resolve(strict=True)
    except OSError:
        errors.append(f"package artifact is missing: {relative}")
        return None

    artifact = Path(os.path.abspath(resolved_root / relative))
    if not _inside(resolved_root, artifact):
        errors.append(f"package artifact escapes the project root: {relative}")
        return None

    parts = artifact.relative_to(resolved_root).parts
    current = resolved_root
    for index, part in enumerate(parts):
        current /= part
        try:
            mode = current.lstat().st_mode
        except OSError:
            errors.append(f"package artifact is missing: {relative}")
            return None
        if stat.S_ISLNK(mode):
            errors.append(f"package artifact path contains a symlink: {relative}")
            return None
        if index < len(parts) - 1 and not stat.S_ISDIR(mode):
            errors.append(f"package artifact parent must be a directory: {relative}")
            return None
        if index == len(parts) - 1 and not stat.S_ISREG(mode):
            errors.append(f"package artifact must be a regular file: {relative}")
            return None

    try:
        resolved = artifact.resolve(strict=True)
    except OSError:
        errors.append(f"package artifact is missing: {relative}")
        return None
    if not _inside(resolved_root, resolved):
        errors.append(f"package artifact resolves outside the project root: {relative}")
        return None
    return resolved


def _read_json(path: Path, label: str, errors: list[str]) -> object | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        errors.append(f"{label} is missing or invalid JSON")
        return None


def _load_package(root: Path) -> _Package:
    package = _Package()
    registry_path = _regular_file(root, ".opencode/generated-agents.json", package.errors)
    if registry_path is None:
        return package
    registry = _read_json(registry_path, "generated-agent registry", package.errors)
    if not _record(registry):
        if registry is not None:
            package.errors.append("generated-agent registry must be a JSON object")
        return package
    if (
        not _integer(registry.get("schema_version"))
        or registry["schema_version"] != 1
        or not isinstance(registry.get("agents"), list)
    ):
        package.errors.append("generated-agent registry must use schema_version 1 and agents[]")
        return package

    entries: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in registry["agents"]:
        if not _record(entry):
            package.errors.append("generated-agent registry entries must be objects")
            continue
        entries.append(entry)
        name = entry.get("name")
        manifest_path = entry.get("manifest")
        if not _task_id(name) or not _canonical_path(manifest_path):
            package.errors.append("generated-agent registry entry is malformed")
        elif name in RESERVED_AGENT_NAMES:
            package.errors.append(
                f'generated-agent registry name must not use reserved agent identity "{name}"'
            )
        if name in seen:
            package.errors.append(f"generated-agent registry contains a duplicate name: {name}")
        if isinstance(name, str):
            seen.add(name)

    if len(entries) != 1:
        package.errors.append("generated-agent registry must identify one generated agent")
        return package
    entry = entries[0]
    if not _task_id(entry.get("name")) or not _canonical_path(entry.get("manifest")):
        return package
    package.name = entry["name"]
    package.manifest_path = entry["manifest"]

    manifest_file = _regular_file(root, package.manifest_path, package.errors)
    if manifest_file is None:
        return package
    raw_manifest = _read_json(manifest_file, "task manifest", package.errors)
    package.errors.extend(_manifest_errors(raw_manifest))
    if not _record(raw_manifest):
        return package
    package.manifest = raw_manifest
    if raw_manifest.get("agent_name") != package.name:
        package.errors.append("registry name must match manifest agent_name")
    if entry["manifest"] != f".opencode/tasks/{raw_manifest.get('task_id')}.json":
        package.errors.append("registry manifest path must match task_id")

    durable_context = raw_manifest.get("durable_context")
    if _strings(durable_context):
        for relative in durable_context:
            path = root / relative
            try:
                path.lstat()
            except OSError:
                package.errors.append(f"durable context is missing at publication: {relative}")
                continue
            if path.is_symlink() or not (path.is_file() or path.is_dir()):
                package.errors.append(
                    f"durable context must be a regular file or directory: {relative}"
                )

    artifacts = (
        (raw_manifest.get("agent_definition"), "agent"),
        (raw_manifest.get("task_brief"), "brief"),
    )
    for relative, kind in artifacts:
        if not _canonical_path(relative):
            continue
        artifact = _regular_file(root, relative, package.errors)
        if artifact is None:
            continue
        try:
            setattr(package, kind, artifact.read_text(encoding="utf-8"))
        except OSError as error:
            package.errors.append(f"cannot read {kind} artifact: {error}")
    return package


def _section(text: str, heading: str) -> str:
    match = re.search(rf"^## {re.escape(heading)}\s*$", text, re.MULTILINE)
    if not match:
        return ""
    following = re.search(r"^##\s", text[match.end():], re.MULTILINE)
    end = match.end() + following.start() if following else len(text)
    return text[match.end():end]


def _permission_value(
    frontmatter: str,
    tool: str,
) -> tuple[str | None, list[tuple[str, str]] | None, str]:
    """Read one flat action or ordered rule map from OpenCode frontmatter."""
    lines = frontmatter.splitlines()
    header = re.compile(rf"^  {re.escape(tool)}:\s*(?:(allow|ask|deny))?\s*$")
    for index, line in enumerate(lines):
        match = header.match(line)
        if not match:
            continue
        if match.group(1):
            return match.group(1), None, ""

        rules: list[tuple[str, str]] = []
        for nested in lines[index + 1:]:
            if not nested.strip():
                continue
            indentation = len(nested) - len(nested.lstrip(" "))
            if indentation <= 2:
                break
            rule = re.match(r"^    (.+?):\s*(allow|ask|deny)\s*$", nested)
            if not rule:
                return None, None, f"malformed {tool} permission rule: {nested.strip()}"
            pattern = rule.group(1).strip()
            if (
                len(pattern) >= 2
                and pattern[0] == pattern[-1]
                and pattern[0] in {'"', "'"}
            ):
                pattern = pattern[1:-1]
            rules.append((pattern, rule.group(2)))
        return None, rules, "" if rules else f"{tool} permission rules are empty"
    return None, None, f"{tool} permission is missing"


def _positive_instruction(text: str, expression: str) -> bool:
    """Require an action phrase whose full clause is mandatory and positive."""
    disallowed_context = re.compile(
        r"\b(?:"
        r"do\s+not|don't|never|must\s+not|should\s+not|need\s+not|needn't|"
        r"without|no\s+need\s+to|do(?:es)?n't\s+have\s+to|"
        r"not\s+(?:required|needed|necessary|mandatory)|"
        r"optional(?:ly)?|if\s+(?:desired|needed|convenient|you\s+(?:want|wish|prefer))|"
        r"unless\s+you\s+(?:want|wish|prefer)"
        r")\b",
        re.IGNORECASE,
    )
    optional_prefix = re.compile(
        r"\b(?:may|might|could|can)\b[^.!?;]{0,60}$",
        re.IGNORECASE,
    )
    for match in re.finditer(expression, text, re.IGNORECASE):
        clause_start = max(text.rfind(mark, 0, match.start()) for mark in ".!?;")
        endings = [
            position for mark in ".!?;"
            if (position := text.find(mark, match.end())) != -1
        ]
        clause_end = min(endings) if endings else len(text)
        clause = text[clause_start + 1:clause_end]
        prefix = text[clause_start + 1:match.start()]
        if not disallowed_context.search(clause) and not optional_prefix.search(prefix):
            return True
    return False


def _agent_definition_check(package: _Package) -> PlanningCheck:
    errors: list[str] = []
    parts = package.agent.split("---", 2) if package.agent.startswith("---") else []
    if len(parts) != 3:
        return PlanningCheck(
            "Bounded generated-agent definition",
            False,
            note="Agent definition must have OpenCode YAML frontmatter.",
        )
    frontmatter, body = parts[1], parts[2]
    if not re.search(r"^mode:\s*primary\s*$", frontmatter, re.MULTILINE):
        errors.append("mode must be primary")
    raw_permissions = package.manifest.get("permissions", {})
    manifest_permissions = raw_permissions if _record(raw_permissions) else {}
    edit_paths = manifest_permissions.get("edit_paths", [])
    bash_action, bash_rules, bash_error = _permission_value(frontmatter, "bash")
    if bash_error:
        errors.append(bash_error)
    if bash_rules is not None:
        errors.append("bash permission must use one flat action")
    manifest_bash = manifest_permissions.get("bash")
    if manifest_bash is False and bash_action != "deny":
        errors.append("agent must deny Bash when permissions.bash is false")
    elif bash_action == "allow" and manifest_bash is not True:
        errors.append("agent grants Bash beyond the manifest")

    edit_action, edit_rules, edit_error = _permission_value(frontmatter, "edit")
    if edit_error:
        errors.append(edit_error)
    elif edit_action is not None:
        errors.append("agent edit permission must use ordered path rules, not a broad action")
    else:
        expected_rules = [("*", "deny"), *[(path, "allow") for path in edit_paths]]
        if edit_rules != expected_rules:
            errors.append(
                "agent edit rules must put the broad deny first and exact manifest paths last: "
                f"expected {expected_rules}, got {edit_rules}"
            )

    if re.search(r"^  write:\s*", frontmatter, re.MULTILINE):
        errors.append("agent must use OpenCode edit permission for edit, write, and patch tools")

    for tool in ("spike", "scaffold_gitignore", "validate_scaffold"):
        action, rules, _error = _permission_value(frontmatter, tool)
        if action == "allow" or (rules and any(rule_action == "allow" for _, rule_action in rules)):
            errors.append(f"agent grants governance tool {tool}")
    brief_path = package.manifest.get("task_brief")
    if isinstance(brief_path, str) and brief_path not in body:
        errors.append("agent does not name its durable brief")
    if package.manifest_path and package.manifest_path not in body:
        errors.append("agent does not name its manifest")
    for path in package.manifest.get("implementation_scope", []):
        if isinstance(path, str) and path not in body:
            errors.append(f"agent does not state implementation scope path {path}")
    if not re.search(r"return to prometheus", body, re.IGNORECASE):
        errors.append("agent does not route blockers back to Prometheus")
    if not re.search(r"do not rewrite|immutable", body, re.IGNORECASE):
        errors.append("agent does not state package immutability")
    return PlanningCheck(
        "Bounded generated-agent definition",
        not errors,
        evidence=f"agent={package.name or 'unknown'}" if not errors else "",
        note="; ".join(errors),
    )


def _brief_checks(package: _Package) -> list[PlanningCheck]:
    text = package.brief
    checks: list[PlanningCheck] = []
    counts = {
        heading: len(re.findall(rf"^## {re.escape(heading)}\s*$", text, re.MULTILINE))
        for heading in BRIEF_SECTIONS
    }
    checks.append(PlanningCheck(
        "Durable task-brief structure",
        all(count == 1 for count in counts.values()),
        evidence=str(counts),
        note="Every required task-brief section must appear exactly once.",
    ))

    outcome = _section(text, "Outcome").strip()
    grounding = _section(text, "Grounding").strip()
    broad_terms = re.findall(
        r"\b(?:UI|frontend|email|database|persistence|HTTP|REST|API|integration)\b",
        outcome,
        re.IGNORECASE,
    )
    explicit_boundary = bool(re.search(
        r"out(?:side| of) (?:this task|scope)|out of scope|remain outside|no (?:UI|database|network)",
        grounding,
        re.IGNORECASE,
    ))
    checks.append(PlanningCheck(
        "Scope narrowing",
        bool(outcome) and (not broad_terms or explicit_boundary),
        evidence=f"outcome terms={broad_terms[:4]}; explicit boundary={explicit_boundary}",
        note="The brief must narrow the broad seed to a bounded core and exclude unrelated product scope.",
    ))

    approaches = _section(text, "Approaches Considered")
    selected = re.findall(r"^### Selected:\s+\S.+$", approaches, re.MULTILINE)
    rejected = list(re.finditer(r"^### Rejected:\s+\S.+$", approaches, re.MULTILINE))
    missing_kill: list[str] = []
    for index, match in enumerate(rejected):
        end = rejected[index + 1].start() if index + 1 < len(rejected) else len(approaches)
        if not re.search(r"\bKill reason:\s*\S", approaches[match.end():end], re.IGNORECASE):
            missing_kill.append(match.group(0))
    checks.append(PlanningCheck(
        "Approach comparison and kill reasons",
        len(selected) == 1 and bool(rejected) and not missing_kill,
        evidence=f"selected={len(selected)} rejected={len(rejected)}",
        note=(
            "Need exactly one Selected heading and at least one genuine Rejected heading with "
            f"an explicit Kill reason. Missing: {missing_kill}"
        ),
    ))

    acceptance = _section(text, "Acceptance Criteria")
    criteria = re.findall(r"^\s*\d+\.\s+\S", acceptance, re.MULTILINE)
    placeholders = re.search(
        r"\b(?:TBD|TODO|to be determined|placeholder|fill in|later)\b",
        acceptance,
        re.IGNORECASE,
    )
    checks.append(PlanningCheck(
        "Objective acceptance criteria",
        len(criteria) >= 3 and placeholders is None,
        evidence=f"{len(criteria)} criteria",
        note="Need at least three placeholder-free numbered criteria.",
    ))

    security_text = acceptance + _section(text, "Limits and Escalation")
    security = re.search(
        r"authoriz|ownership|owner_id|permission|access control|IDOR",
        security_text,
        re.IGNORECASE,
    )
    checks.append(PlanningCheck(
        "Explicit security or authorization constraint",
        security is not None,
        evidence=security.group(0) if security else "",
        note="The rules-engine brief must make ownership or authorization explicit.",
    ))

    verification = _section(text, "Verification")
    brief_commands = re.findall(r"^- `([^`\n]+)`\s*$", verification, re.MULTILINE)
    manifest_commands = package.manifest.get("verification", {}).get("commands", [])
    checks.append(PlanningCheck(
        "Exact manifest-matched verification commands",
        bool(brief_commands)
        and brief_commands == manifest_commands
        and len(brief_commands) == len(set(brief_commands)),
        evidence=f"brief={len(brief_commands)} manifest={len(manifest_commands)}",
        note="The brief must list each manifest verification command exactly once and in order.",
    ))

    checklist = _section(text, "Implementation Checklist")
    items = re.findall(r"^- \[ \]\s+\S", checklist, re.MULTILINE)
    checks.append(PlanningCheck(
        "Executable implementation checklist",
        len(items) >= 3,
        evidence=f"{len(items)} unchecked items",
        note="Need at least three concrete unchecked implementation steps.",
    ))
    return checks


def _handoff_check(package: _Package, handoff: str) -> PlanningCheck:
    lowered = handoff.lower()
    brief_path = package.manifest.get("task_brief", "")
    manifest_path = package.manifest_path
    selected_agent = (
        rf"\bselect\b[^.!?;]{{0,80}}{re.escape(package.name)}"
        rf"[^.!?;]{{0,30}}\bagent\b"
        if package.name else r"(?!)"
    )
    requirements = {
        "agent name": bool(package.name and package.name.lower() in lowered),
        "durable brief": bool(brief_path and brief_path.lower() in lowered),
        "manifest": bool(manifest_path and manifest_path.lower() in lowered),
        "positive quit instruction": _positive_instruction(handoff, r"\bquit\b"),
        "positive restart instruction": _positive_instruction(handoff, r"\brestart\b"),
        "positive new-conversation instruction": _positive_instruction(
            handoff,
            r"\b(?:start|open|begin|create)\s+(?:a\s+)?new conversation\b",
        ),
        "positive named-agent selection": _positive_instruction(handoff, selected_agent),
    }
    missing = [name for name, present in requirements.items() if not present]
    return PlanningCheck(
        "Fresh-context generated-agent handoff",
        not missing,
        evidence=package.name if not missing else "",
        note=f"Missing handoff elements: {', '.join(missing)}",
    )


def score_package(root: str | Path, handoff: str) -> PlanningReport:
    """Score one registered generated-agent package and Prometheus handoff."""
    root = Path(root)
    package = _load_package(root)
    report = PlanningReport()
    report.checks.append(PlanningCheck(
        "Registered schema-v1 task package",
        not package.errors,
        evidence=f"agent={package.name}; manifest={package.manifest_path}" if not package.errors else "",
        note="; ".join(package.errors),
    ))
    report.checks.append(_agent_definition_check(package))
    report.checks.extend(_brief_checks(package))
    report.checks.append(_handoff_check(package, handoff))

    retired = [
        name for name in ("SPEC.md", "opencode-autonomous.json")
        if (root / name).exists()
    ]
    report.checks.append(PlanningCheck(
        "Retired planning artifacts absent",
        not retired,
        evidence="no SPEC or Autonomous manifest" if not retired else "",
        note=f"Retired artifacts found: {retired}",
    ))
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package_root", type=Path)
    parser.add_argument("--handoff-file", type=Path)
    args = parser.parse_args(argv)
    handoff_path = args.handoff_file or args.package_root / "PROMETHEUS_HANDOFF.txt"
    try:
        handoff = handoff_path.read_text(encoding="utf-8")
    except OSError:
        handoff = ""
    report = score_package(args.package_root, handoff)
    print(report.render())
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
