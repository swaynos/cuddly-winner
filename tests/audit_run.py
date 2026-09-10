#!/usr/bin/env python3
"""Audit generic and generated-agent evidence from an OpenCode session.

The report is investigative. It validates package shape before reporting
generated-agent evidence, but does not prove permission enforcement or fresh
verification-command execution.

Usage:
    python3 tests/audit_run.py --project /path/to/project
    python3 tests/audit_run.py --project /path/to/project --session ses_abc123
    python3 tests/audit_run.py --project /path/to/project --list
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

DEFAULT_DB = Path.home() / ".local" / "share" / "opencode" / "opencode.db"
MANIFEST_KEYS = {
    "schema_version",
    "task_id",
    "agent_name",
    "agent_definition",
    "task_brief",
    "strategy",
    "permissions",
    "implementation_scope",
    "durable_context",
    "verification",
    "limits",
    "escalation_triggers",
    "strategy_config",
    "run_kpis",
}
PERMISSION_KEYS = {"edit_paths", "bash"}
VERIFICATION_KEYS = {
    "commands",
    "success_evidence",
    "freshness",
    "failure_conditions",
    "independent_review",
}
STRATEGY_KEYS = {
    "direct": {"work_selection"},
    "ralph": {
        "work_selection",
        "pass_budget",
        "state_paths",
        "progress_evidence_before",
        "progress_evidence_after",
        "pass_failure_treatment",
        "run_stop_conditions",
        "later_pass_starter",
    },
    "optimization": {
        "work_selection",
        "objective",
        "direction",
        "evaluator",
        "score_extraction",
        "noise_policy",
        "mutable_targets",
        "immutable_targets",
        "experiment_budget",
        "keep_revert_rule",
        "stop_conditions",
    },
}
RESERVED_AGENT_NAMES = {
    "build",
    "plan",
    "general",
    "explore",
    "compaction",
    "title",
    "summary",
    "ask",
    "grounder",
    "prometheus",
    "reviewer",
}


@dataclass
class SessionRow:
    id: str
    parent_id: Optional[str]
    agent: Optional[str]
    slug: Optional[str]
    directory: Optional[str]
    created: str
    updated: str


@dataclass
class PartRow:
    tool: Optional[str]
    hint: str
    created: str


@dataclass
class AgentSwitch:
    agent: str
    created: str


@dataclass
class Verdict:
    label: str
    evidence: list[str] = field(default_factory=list)
    interpretation: str = ""


@dataclass
class AssistantUsage:
    message_id: str
    session_id: str
    created: int
    completed: int
    tokens: int


@dataclass
class KpiSummary:
    tokens: int
    active_milliseconds: int
    tokens_per_active_minute: float


@dataclass
class RunKpiPolicy:
    target_seconds: float
    target_tokens_per_active_minute: float
    hard_budget_tokens: float


@dataclass
class GeneratedAgentEvidence:
    manifest_path: str
    strategy: Optional[str]
    agent_definition: Optional[str]
    task_brief: Optional[str]
    agent_definition_present: bool
    task_brief_present: bool
    manifest: dict[str, object] = field(repr=False)


def open_db(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise FileNotFoundError(f"OpenCode database not found: {db_path}")
    return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)


def list_sessions(
    conn: sqlite3.Connection, project: str, limit: int = 10
) -> list[SessionRow]:
    rows = conn.execute(
        """
        SELECT id, parent_id, agent, slug, directory,
               datetime(time_created/1000,'unixepoch','localtime') AS created,
               datetime(time_updated/1000,'unixepoch','localtime') AS updated
        FROM session
        WHERE directory = ?
        ORDER BY time_updated DESC
        LIMIT ?
        """,
        (project, limit),
    ).fetchall()
    return [SessionRow(*row) for row in rows]


def get_session(conn: sqlite3.Connection, session_id: str) -> Optional[SessionRow]:
    row = conn.execute(
        """
        SELECT id, parent_id, agent, slug, directory,
               datetime(time_created/1000,'unixepoch','localtime') AS created,
               datetime(time_updated/1000,'unixepoch','localtime') AS updated
        FROM session WHERE id = ?
        """,
        (session_id,),
    ).fetchone()
    return SessionRow(*row) if row else None


def get_child_sessions(
    conn: sqlite3.Connection, session_id: str
) -> list[SessionRow]:
    rows = conn.execute(
        """
        SELECT id, parent_id, agent, slug, directory,
               datetime(time_created/1000,'unixepoch','localtime') AS created,
               datetime(time_updated/1000,'unixepoch','localtime') AS updated
        FROM session WHERE parent_id = ?
        ORDER BY time_created
        """,
        (session_id,),
    ).fetchall()
    return [SessionRow(*row) for row in rows]


def get_descendant_sessions(
    conn: sqlite3.Connection, session_id: str
) -> list[SessionRow]:
    descendants: list[SessionRow] = []
    seen = {session_id}
    pending = [session_id]
    while pending:
        parent = pending.pop()
        for child in get_child_sessions(conn, parent):
            if child.id in seen:
                continue
            seen.add(child.id)
            descendants.append(child)
            pending.append(child.id)
    return descendants


def get_assistant_usage(
    conn: sqlite3.Connection, session_ids: list[str]
) -> list[AssistantUsage]:
    if not session_ids:
        return []
    placeholders = ",".join("?" for _ in session_ids)
    rows = conn.execute(
        f"""
        SELECT id, session_id,
               json_extract(data, '$.time.created'),
               json_extract(data, '$.time.completed'),
               json_extract(data, '$.tokens.input'),
               json_extract(data, '$.tokens.output'),
               json_extract(data, '$.tokens.reasoning'),
               coalesce(json_extract(data, '$.tokens.cache.read'), 0),
               coalesce(json_extract(data, '$.tokens.cache.write'), 0)
        FROM message
        WHERE session_id IN ({placeholders})
          AND json_valid(data)
          AND json_extract(data, '$.role') = 'assistant'
          AND json_extract(data, '$.time.completed') IS NOT NULL
        """,
        session_ids,
    ).fetchall()
    usages: list[AssistantUsage] = []
    for row in rows:
        message_id, session_id, created, completed, *tokens = row
        if not isinstance(created, (int, float)) or not isinstance(
            completed, (int, float)
        ):
            continue
        if completed < created or not all(
            isinstance(token, (int, float)) and token >= 0 for token in tokens
        ):
            continue
        usages.append(
            AssistantUsage(
                message_id,
                session_id,
                int(created),
                int(completed),
                int(sum(tokens)),
            )
        )
    return usages


def get_tool_calls(conn: sqlite3.Connection, session_id: str) -> list[PartRow]:
    rows = conn.execute(
        """
        SELECT json_extract(data,'$.tool') AS tool,
               substr(coalesce(
                 json_extract(data,'$.state.input.filePath'),
                 json_extract(data,'$.state.input.command'),
                 json_extract(data,'$.state.input.pattern'),
                 json_extract(data,'$.state.input.description'),
                 ''
               ), 1, 120) AS hint,
               datetime(time_created/1000,'unixepoch','localtime') AS created
        FROM part
        WHERE session_id = ?
          AND json_extract(data,'$.type') = 'tool'
        ORDER BY time_created
        """,
        (session_id,),
    ).fetchall()
    return [PartRow(*row) for row in rows]


def get_agent_switches(
    conn: sqlite3.Connection, session_id: str
) -> list[AgentSwitch]:
    rows = conn.execute(
        """
        SELECT json_extract(data,'$.agent') AS agent,
               datetime(time_created/1000,'unixepoch','localtime') AS created
        FROM session_message
        WHERE session_id = ? AND type = 'agent-switched'
        ORDER BY seq
        """,
        (session_id,),
    ).fetchall()
    return [AgentSwitch(row[0] or "", row[1]) for row in rows]


def _last_nonempty_line(text: str) -> str:
    return next((line.strip() for line in reversed(text.splitlines()) if line.strip()), "")


def has_reviewer_approval(
    conn: sqlite3.Connection, sessions: list[SessionRow]
) -> bool:
    reviewer_ids = [session.id for session in sessions if session.agent == "reviewer"]
    if not reviewer_ids:
        return False
    placeholders = ",".join("?" for _ in reviewer_ids)
    rows = conn.execute(
        f"""
        SELECT part.session_id, json_extract(part.data, '$.text')
        FROM part
        JOIN message
          ON message.id = part.message_id
         AND message.session_id = part.session_id
        WHERE part.session_id IN ({placeholders})
          AND json_valid(part.data)
          AND json_extract(part.data, '$.type') = 'text'
          AND typeof(json_extract(part.data, '$.text')) = 'text'
          AND json_valid(message.data)
          AND json_extract(message.data, '$.role') = 'assistant'
        ORDER BY part.session_id, part.time_created, part.rowid
        """,
        reviewer_ids,
    ).fetchall()
    output_by_session = {session_id: [] for session_id in reviewer_ids}
    for session_id, text in rows:
        output_by_session[session_id].append(text)
    return any(
        _last_nonempty_line("\n".join(output)) == "APPROVE"
        for output in output_by_session.values()
    )


def _strings(value: object) -> bool:
    return isinstance(value, list) and all(
        isinstance(item, str) and bool(item) for item in value
    )


def _integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _number(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _task_id(value: object) -> bool:
    return isinstance(value, str) and bool(
        re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", value)
    )


def _canonical_relative_path(value: object) -> bool:
    if not isinstance(value, str) or not value or "\\" in value:
        return False
    if Path(value).is_absolute() or re.match(r"^[A-Za-z]:", value):
        return False
    return all(part not in {"", ".", ".."} for part in value.split("/"))


def _unknown_keys(
    value: dict[str, object],
    allowed: set[str],
    name: str,
    errors: list[str],
) -> None:
    for key in value:
        if key not in allowed:
            errors.append(f"unknown key inside {name}: {key}")


def _path_list(
    value: object, name: str, errors: list[str], *, required: bool = True
) -> bool:
    if not _strings(value) or (required and not value):
        qualifier = " non-empty" if required else ""
        errors.append(f"{name} must be a{qualifier} string[]")
        return False
    seen: set[str] = set()
    for item in value:
        if not _canonical_relative_path(item):
            errors.append(
                f"{name} path must be canonical and worktree-relative: {item}"
            )
        if item in seen:
            errors.append(f"{name} contains a duplicate path: {item}")
        seen.add(item)
    return True


def _required_strings(
    value: dict[str, object], keys: tuple[str, ...], name: str, errors: list[str]
) -> None:
    for key in keys:
        if not isinstance(value.get(key), str) or not value[key].strip():
            errors.append(f"{name}.{key} must be a non-empty string")


def _validate_strategy(manifest: dict[str, object], errors: list[str]) -> None:
    strategy = manifest.get("strategy")
    config = manifest.get("strategy_config")
    if not isinstance(strategy, str) or strategy not in STRATEGY_KEYS:
        errors.append(
            'strategy must be "direct", "ralph", or "optimization" '
            f"(got {strategy!r})"
        )
        return
    if not isinstance(config, dict):
        errors.append("strategy_config must be an object")
        return

    _unknown_keys(config, STRATEGY_KEYS[strategy], "strategy_config", errors)
    _required_strings(config, ("work_selection",), "strategy_config", errors)
    if strategy == "ralph":
        if not _integer(config.get("pass_budget")) or config["pass_budget"] <= 0:
            errors.append("strategy_config.pass_budget must be a positive integer")
        for key in (
            "state_paths",
            "progress_evidence_before",
            "progress_evidence_after",
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
            "first float on stdout",
            "last float on stdout",
        }:
            errors.append(
                "strategy_config.score_extraction must be a supported extraction rule"
            )
        if not _canonical_relative_path(config.get("evaluator")):
            errors.append(
                "strategy_config.evaluator must be a canonical worktree-relative path"
            )
        if (
            not _integer(config.get("experiment_budget"))
            or config["experiment_budget"] <= 0
        ):
            errors.append(
                "strategy_config.experiment_budget must be a positive integer"
            )
        for key in ("mutable_targets", "immutable_targets", "stop_conditions"):
            _path_list(config.get(key), f"strategy_config.{key}", errors)
        mutable = (
            config.get("mutable_targets")
            if _strings(config.get("mutable_targets"))
            else []
        )
        immutable = (
            config.get("immutable_targets")
            if _strings(config.get("immutable_targets"))
            else []
        )
        for target in [*mutable, *immutable]:
            if re.search(r"[*?\[\]]", target):
                errors.append(
                    f"strategy_config target must not contain glob characters: {target}"
                )
        for target in set(mutable) & set(immutable):
            errors.append(
                f"strategy_config mutable and immutable targets overlap: {target}"
            )


def _manifest_errors(manifest: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(manifest, dict):
        return ["manifest must be a JSON object"]

    _unknown_keys(manifest, MANIFEST_KEYS, "manifest", errors)
    if not _integer(manifest.get("schema_version")) or manifest["schema_version"] != 1:
        errors.append(
            f"schema_version must be 1 (got {manifest.get('schema_version')!r})"
        )
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
        if not _canonical_relative_path(manifest.get(key)):
            errors.append(f"{key} must be a canonical worktree-relative path")

    _validate_strategy(manifest, errors)
    scope_ok = _path_list(
        manifest.get("implementation_scope"), "implementation_scope", errors
    )
    _path_list(manifest.get("durable_context"), "durable_context", errors)
    _path_list(manifest.get("escalation_triggers"), "escalation_triggers", errors)

    permissions = manifest.get("permissions")
    if not isinstance(permissions, dict):
        errors.append("permissions must be an object")
    else:
        _unknown_keys(permissions, PERMISSION_KEYS, "permissions", errors)
        edit_ok = _path_list(
            permissions.get("edit_paths"), "permissions.edit_paths", errors
        )
        if not isinstance(permissions.get("bash"), bool):
            errors.append("permissions.bash must be a boolean")
        if edit_ok and scope_ok:
            scope = manifest["implementation_scope"]
            for item in permissions["edit_paths"]:
                if item not in scope:
                    errors.append(
                        "permissions.edit_paths must be within implementation_scope: "
                        f"{item}"
                    )

    verification = manifest.get("verification")
    if not isinstance(verification, dict):
        errors.append("verification must be an object")
    else:
        _unknown_keys(verification, VERIFICATION_KEYS, "verification", errors)
        for key in ("commands", "success_evidence", "failure_conditions"):
            _path_list(verification.get(key), f"verification.{key}", errors)
        freshness = verification.get("freshness")
        if not isinstance(freshness, str) or not freshness.strip():
            errors.append("verification.freshness must be a non-empty string")
        review = verification.get("independent_review")
        if "independent_review" not in verification or (
            review is not None
            and (not isinstance(review, str) or not review.strip())
        ):
            errors.append(
                "verification.independent_review must be null or a non-empty string"
            )

    limits = manifest.get("limits")
    if (
        not isinstance(limits, dict)
        or not _strings(limits.get("stop_conditions"))
        or not limits["stop_conditions"]
    ):
        errors.append("limits.stop_conditions must be a non-empty string[]")

    if "run_kpis" in manifest:
        run_kpis = manifest["run_kpis"]
        if not isinstance(run_kpis, dict) or not isinstance(
            run_kpis.get("enabled"), bool
        ):
            errors.append("run_kpis must declare enabled as a boolean")
        elif run_kpis["enabled"]:
            unattended = run_kpis.get("unattended_runtime")
            token_burn = run_kpis.get("token_burn")
            if (
                not isinstance(unattended, dict)
                or not _number(unattended.get("target_seconds"))
                or unattended["target_seconds"] <= 0
            ):
                errors.append(
                    "enabled run_kpis requires a positive "
                    "unattended_runtime.target_seconds"
                )
            if (
                not isinstance(token_burn, dict)
                or not _number(token_burn.get("target_tokens_per_active_minute"))
                or token_burn["target_tokens_per_active_minute"] <= 0
                or not _number(token_burn.get("hard_budget_tokens"))
                or token_burn["hard_budget_tokens"] <= 0
            ):
                errors.append(
                    "enabled run_kpis requires positive token-burn targets"
                )
    return errors


def _regular_file(path: Path) -> bool:
    try:
        path.lstat()
    except OSError:
        return False
    return not path.is_symlink() and path.is_file()


def read_generated_agent_evidence(
    project: str, agent: Optional[str]
) -> Optional[GeneratedAgentEvidence]:
    if not agent or not _task_id(agent):
        return None
    root = Path(project).resolve()
    try:
        registry = json.loads(
            (root / ".opencode/generated-agents.json").read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError):
        return None
    if (
        not isinstance(registry, dict)
        or not _integer(registry.get("schema_version"))
        or registry["schema_version"] != 1
        or not isinstance(registry.get("agents"), list)
    ):
        return None

    entries: list[dict[str, object]] = []
    seen: set[str] = set()
    for item in registry["agents"]:
        if not isinstance(item, dict):
            return None
        name = item.get("name")
        manifest_path = item.get("manifest")
        if not _task_id(name) or not _canonical_relative_path(manifest_path):
            return None
        if name in RESERVED_AGENT_NAMES:
            return None
        if name in seen:
            return None
        seen.add(name)
        entries.append(item)

    entry = next((item for item in entries if item.get("name") == agent), None)
    manifest_ref = entry.get("manifest") if isinstance(entry, dict) else None
    if not _canonical_relative_path(manifest_ref):
        return None
    manifest_file = root / manifest_ref
    if not _regular_file(manifest_file):
        return None

    try:
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if _manifest_errors(manifest) or not isinstance(manifest, dict):
        return None
    if manifest.get("agent_name") != agent:
        return None
    if manifest_ref != f".opencode/tasks/{manifest.get('task_id')}.json":
        return None

    definition = manifest.get("agent_definition")
    brief = manifest.get("task_brief")
    strategy = manifest.get("strategy")
    if (
        not isinstance(definition, str)
        or not isinstance(brief, str)
        or not _regular_file(root / definition)
        or not _regular_file(root / brief)
    ):
        return None
    return GeneratedAgentEvidence(
        manifest_path=manifest_ref,
        strategy=strategy if isinstance(strategy, str) else None,
        agent_definition=definition,
        task_brief=brief,
        agent_definition_present=True,
        task_brief_present=True,
        manifest=manifest,
    )


def _run_kpi_policy(manifest: Optional[dict[str, object]]) -> Optional[RunKpiPolicy]:
    try:
        run_kpis = manifest.get("run_kpis") if manifest is not None else None
        if not isinstance(run_kpis, dict) or run_kpis.get("enabled") is not True:
            return None
        unattended = run_kpis["unattended_runtime"]
        token_burn = run_kpis["token_burn"]
        if not isinstance(unattended, dict) or not isinstance(token_burn, dict):
            return None
        values = (
            unattended["target_seconds"],
            token_burn["target_tokens_per_active_minute"],
            token_burn["hard_budget_tokens"],
        )
        if not all(isinstance(value, (int, float)) and value > 0 for value in values):
            return None
        return RunKpiPolicy(*map(float, values))
    except (KeyError, TypeError):
        return None


def read_run_kpis(project: str, agent: Optional[str]) -> Optional[RunKpiPolicy]:
    evidence = read_generated_agent_evidence(project, agent)
    return _run_kpi_policy(evidence.manifest if evidence else None)


def summarize_kpi_usage(usages: list[AssistantUsage]) -> KpiSummary:
    tokens = sum(usage.tokens for usage in usages)
    intervals = sorted((usage.created, usage.completed) for usage in usages)
    active = 0
    start: Optional[int] = None
    end: Optional[int] = None
    for next_start, next_end in intervals:
        if start is None or end is None:
            start, end = next_start, next_end
        elif next_start <= end:
            end = max(end, next_end)
        else:
            active += end - start
            start, end = next_start, next_end
    if start is not None and end is not None:
        active += end - start
    rate = tokens / (active / 60_000) if active else 0
    return KpiSummary(tokens, active, rate)


def verdict_run_kpis(
    policy: Optional[RunKpiPolicy], summary: KpiSummary
) -> Verdict:
    if policy is None:
        return Verdict(
            "NOT_APPLICABLE",
            evidence=["run_kpis is absent or disabled in the selected agent manifest"],
        )
    if summary.active_milliseconds == 0:
        return Verdict(
            "PARTIAL",
            evidence=["No completed assistant-message telemetry was available"],
            interpretation="KPI policy is enabled but runtime use cannot be measured.",
        )
    active_seconds = summary.active_milliseconds / 1000
    duration_met = active_seconds >= policy.target_seconds
    rate_met = (
        summary.tokens_per_active_minute
        <= policy.target_tokens_per_active_minute
    )
    budget_met = summary.tokens <= policy.hard_budget_tokens
    label = "PASS" if duration_met and rate_met and budget_met else "PARTIAL"
    return Verdict(
        label,
        evidence=[
            f"Useful active duration: {active_seconds:.1f}/{policy.target_seconds:.1f}s",
            "Token rate: "
            f"{summary.tokens_per_active_minute:.1f}/"
            f"{policy.target_tokens_per_active_minute:.1f} tokens/min",
            f"Token budget: {summary.tokens}/{policy.hard_budget_tokens:.0f}",
        ],
        interpretation=(
            "KPI observations do not replace completion, verification, or safety "
            "requirements."
        ),
    )


VERDICT_EXIT = {
    "PASS": 0,
    "NOT_APPLICABLE": 0,
    "NOT_SELECTED": 0,
    "PARTIAL": 1,
    "FAIL": 2,
}


def _fmt_verdict(verdict: Verdict) -> str:
    lines = [f"  Verdict: {verdict.label}"]
    for evidence in verdict.evidence:
        lines.append(f"    - {evidence}")
    if verdict.interpretation:
        lines.append(f"  Interpretation: {verdict.interpretation}")
    return "\n".join(lines)


def print_report(
    session: SessionRow,
    child_sessions: list[SessionRow],
    switches: list[AgentSwitch],
    tool_calls: list[PartRow],
    generated: Optional[GeneratedAgentEvidence],
    reviewer_approved: bool,
    run_kpis_v: Verdict,
) -> int:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    child_agents = [child.agent or "?" for child in child_sessions]
    switch_agents = [switch.agent or "?" for switch in switches]
    bash_calls = [call for call in tool_calls if call.tool == "bash"]
    if generated:
        generated_lines = (
            f"Registry-linked manifest: {generated.manifest_path}\n"
            f"  Strategy field: {generated.strategy or 'missing'}\n"
            f"  Agent definition: {generated.agent_definition or 'missing'} "
            f"({'present' if generated.agent_definition_present else 'missing'})\n"
            f"  Task brief: {generated.task_brief or 'missing'} "
            f"({'present' if generated.task_brief_present else 'missing'})"
        )
    else:
        generated_lines = (
            "No valid registry-linked schema-v1 package found for the selected agent."
        )

    print(
        f"""
Runtime Validation Report
Generated: {now}

Target session: {session.id} (slug: {session.slug})
Time window:    {session.created} - {session.updated} (localtime)
Project:        {session.directory}
Agent:          {session.agent}
Child sessions: {len(child_sessions)}
Child agents:   {', '.join(child_agents) if child_agents else 'none'}
Agent switches: {', '.join(switch_agents) if switch_agents else 'none'}
Root-session Bash calls: {len(bash_calls)} (not attributed to a switched agent)
Reviewer approval: {'yes' if reviewer_approved else 'no'} (requires an exact final APPROVE token from attributed Reviewer assistant output)

Generated-agent evidence:
  {generated_lines}

Run KPI verdict:
{_fmt_verdict(run_kpis_v)}

Material difference observation: {'YES' if child_sessions else 'NO'}
  Evidence: {'Child sessions present: ' + ', '.join(child_agents) if child_sessions else 'No child sessions found.'}
""".strip()
    )
    return VERDICT_EXIT.get(run_kpis_v.label, 0)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit generic and generated-agent OpenCode session evidence.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--project", required=True, help="Absolute path to the project directory."
    )
    parser.add_argument(
        "--session",
        default=None,
        help="Session ID to audit. Defaults to the most recent project session.",
    )
    parser.add_argument(
        "--list", action="store_true", help="List recent sessions and exit."
    )
    parser.add_argument(
        "--db", default=str(DEFAULT_DB), help=f"Path to opencode.db (default: {DEFAULT_DB})"
    )
    return parser.parse_args()


def _session_project_error(session: SessionRow, project: str) -> Optional[str]:
    directory = session.directory
    if not isinstance(directory, str) or not directory.strip():
        return (
            f"Session {session.id} has no usable directory/worktree metadata; "
            f"cannot verify requested project {project}."
        )
    stored = Path(directory)
    if not stored.is_absolute():
        return (
            f"Session {session.id} has non-absolute directory/worktree metadata "
            f"{directory!r}; cannot verify requested project {project}."
        )
    try:
        stored_project = stored.resolve()
        requested_project = Path(project).resolve()
    except OSError as error:
        return (
            f"Session {session.id} directory/worktree metadata could not be resolved: "
            f"{error}"
        )
    if stored_project != requested_project:
        return (
            f"Session {session.id} belongs to {stored_project}, which does not belong "
            f"to requested project {requested_project}."
        )
    return None


def main() -> int:
    args = parse_args()
    project = str(Path(args.project).resolve())
    db_path = Path(args.db)

    try:
        conn = open_db(db_path)
    except FileNotFoundError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 3

    try:
        if args.list:
            sessions = list_sessions(conn, project, limit=20)
            if not sessions:
                print(
                    f"No OpenCode sessions found for project: {project}",
                    file=sys.stderr,
                )
                return 3
            print(f"{'Session ID':<40} {'Agent':<24} {'Slug':<20} {'Updated'}")
            print("-" * 108)
            for listed in sessions:
                print(
                    f"{listed.id:<40} {(listed.agent or '?'):<24} "
                    f"{(listed.slug or '?'):<20} {listed.updated}"
                )
            return 0

        if args.session:
            session = get_session(conn, args.session)
            if not session:
                print(f"Session not found: {args.session}", file=sys.stderr)
                return 3
        else:
            sessions = list_sessions(conn, project, limit=20)
            if not sessions:
                print(
                    f"No OpenCode sessions found for project: {project}",
                    file=sys.stderr,
                )
                return 3
            session = sessions[0]
    except sqlite3.DatabaseError as error:
        print(
            "ERROR: Could not read OpenCode session directory/worktree metadata; "
            f"unsupported or incomplete session schema: {error}",
            file=sys.stderr,
        )
        return 3

    project_error = _session_project_error(session, project)
    if project_error:
        print(f"ERROR: {project_error}", file=sys.stderr)
        return 3

    try:
        child_sessions = get_descendant_sessions(conn, session.id)
        for child in child_sessions:
            child_project_error = _session_project_error(child, project)
            if child_project_error:
                print(
                    f"ERROR: Descendant session rejected: {child_project_error}",
                    file=sys.stderr,
                )
                return 3
        tool_calls = get_tool_calls(conn, session.id)
        switches = get_agent_switches(conn, session.id)
        reviewer_approved = has_reviewer_approval(
            conn, [session, *child_sessions]
        )
        usages = get_assistant_usage(
            conn,
            [session.id, *[child.id for child in child_sessions]],
        )
    except sqlite3.DatabaseError as error:
        print(f"ERROR: Could not read OpenCode session evidence: {error}", file=sys.stderr)
        return 3

    generated = read_generated_agent_evidence(project, session.agent)
    run_kpis_v = verdict_run_kpis(
        _run_kpi_policy(generated.manifest if generated else None),
        summarize_kpi_usage(usages),
    )

    return print_report(
        session,
        child_sessions,
        switches,
        tool_calls,
        generated,
        reviewer_approved,
        run_kpis_v,
    )


if __name__ == "__main__":
    sys.exit(main())
