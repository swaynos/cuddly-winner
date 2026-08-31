#!/usr/bin/env python3
"""
audit_run.py — Autonomous loop behavior auditor.

Automates the manual investigation procedure from docs/TESTING-METHODOLOGY.md.
Queries the OpenCode SQLite database and project artifacts to emit
PASS / PARTIAL / FAIL verdicts for a given project session.

Usage:
    python3 tests/audit_run.py --project /path/to/project
    python3 tests/audit_run.py --project /path/to/project --session ses_abc123
    python3 tests/audit_run.py --project /path/to/project --list
    python3 tests/audit_run.py --help

Outputs a Runtime Validation Report to stdout.
Exit codes: 0 = PASS or NOT_APPLICABLE, 1 = PARTIAL, 2 = FAIL, 3 = error/missing data.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_DB = Path.home() / ".local" / "share" / "opencode" / "opencode.db"

KARPATHY_ARTIFACTS = ["SPEC.md", "opencode-autonomous.json"]

# Agent names that indicate strategy subagent execution.
STRATEGY_SUBAGENTS = {"karpathy"}


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

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
    label: str   # PASS | PARTIAL | FAIL | NOT_APPLICABLE | NOT_SELECTED
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


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def open_db(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise FileNotFoundError(f"OpenCode database not found: {db_path}")
    return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)


def list_sessions(conn: sqlite3.Connection, project: str, limit: int = 10) -> list[SessionRow]:
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
    return [SessionRow(*r) for r in rows]


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


def get_child_sessions(conn: sqlite3.Connection, session_id: str) -> list[SessionRow]:
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
    return [SessionRow(*r) for r in rows]


def get_descendant_sessions(conn: sqlite3.Connection, session_id: str) -> list[SessionRow]:
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


def get_assistant_usage(conn: sqlite3.Connection, session_ids: list[str]) -> list[AssistantUsage]:
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
        if not isinstance(created, (int, float)) or not isinstance(completed, (int, float)):
            continue
        if completed < created or not all(isinstance(token, (int, float)) and token >= 0 for token in tokens):
            continue
        usages.append(AssistantUsage(message_id, session_id, int(created), int(completed), int(sum(tokens))))
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
    return [PartRow(*r) for r in rows]


def get_agent_switches(conn: sqlite3.Connection, session_id: str) -> list[AgentSwitch]:
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
    return [AgentSwitch(r[0] or "", r[1]) for r in rows]


def has_promise_token(conn: sqlite3.Connection, session_id: str, token: str) -> bool:
    count = conn.execute(
        "SELECT count(*) FROM message WHERE session_id = ? AND data LIKE ?",
        (session_id, f"%{token}%"),
    ).fetchone()[0]
    return count > 0


def has_prometheus_payload(conn: sqlite3.Connection, session_id: str) -> bool:
    count = conn.execute(
        """SELECT count(*) FROM part
           WHERE session_id = ?
             AND json_extract(data,'$.type') = 'text'
             AND json_extract(data,'$.text') LIKE '%<spec filename=%'""",
        (session_id,),
    ).fetchone()[0]
    return count > 0


# ---------------------------------------------------------------------------
# Artifact helpers
# ---------------------------------------------------------------------------

def read_progress_strategy(project: str) -> Optional[str]:
    for p in sorted((Path(project) / ".opencode" / "progress").glob("*.md")):
        text = p.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"^Selected:\s*(\S+)", text, re.MULTILINE)
        return m.group(1).lower() if m else None
    return None


def spec_has_approaches_considered(project: str) -> bool:
    for name in ("SPEC.md", "spec.md"):
        p = Path(project) / name
        if p.exists():
            return "## Approaches Considered" in p.read_text(encoding="utf-8", errors="replace")
    return False


def karpathy_artifacts_present(project: str) -> dict[str, bool]:
    return {a: (Path(project) / a).exists() for a in KARPATHY_ARTIFACTS}


def read_run_kpis(project: str) -> Optional[RunKpiPolicy]:
    try:
        manifest = json.loads((Path(project) / "opencode-autonomous.json").read_text(encoding="utf-8"))
        run_kpis = manifest.get("run_kpis")
        if not isinstance(run_kpis, dict) or run_kpis.get("enabled") is not True:
            return None
        unattended = run_kpis["unattended_runtime"]
        token_burn = run_kpis["token_burn"]
        values = (
            unattended["target_seconds"],
            token_burn["target_tokens_per_active_minute"],
            token_burn["hard_budget_tokens"],
        )
        if not all(isinstance(value, (int, float)) and value > 0 for value in values):
            return None
        return RunKpiPolicy(*map(float, values))
    except (FileNotFoundError, json.JSONDecodeError, KeyError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Verdict builders
# ---------------------------------------------------------------------------

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


def verdict_run_kpis(policy: Optional[RunKpiPolicy], summary: KpiSummary) -> Verdict:
    if policy is None:
        return Verdict("NOT_APPLICABLE", evidence=["run_kpis is absent or disabled"])
    if summary.active_milliseconds == 0:
        return Verdict("PARTIAL", evidence=["No completed assistant-message telemetry was available"], interpretation="KPI policy is enabled but runtime use cannot be measured.")
    active_seconds = summary.active_milliseconds / 1000
    duration_met = active_seconds >= policy.target_seconds
    rate_met = summary.tokens_per_active_minute <= policy.target_tokens_per_active_minute
    budget_met = summary.tokens <= policy.hard_budget_tokens
    label = "PASS" if duration_met and rate_met and budget_met else "PARTIAL"
    return Verdict(
        label,
        evidence=[
            f"Useful active duration: {active_seconds:.1f}/{policy.target_seconds:.1f}s",
            f"Token rate: {summary.tokens_per_active_minute:.1f}/{policy.target_tokens_per_active_minute:.1f} tokens/min",
            f"Token budget: {summary.tokens}/{policy.hard_budget_tokens:.0f}",
        ],
        interpretation="KPI observations do not replace completion, verification, or safety requirements.",
    )

def verdict_prometheus(
    conn: sqlite3.Connection,
    session: SessionRow,
    switches: list[AgentSwitch],
    tool_calls: list[PartRow],
    project: str,
) -> Verdict:
    prometheus_switches = [s for s in switches if s.agent == "prometheus"]
    if not prometheus_switches:
        return Verdict("NOT_APPLICABLE", evidence=["No agent-switched to prometheus found"])

    # Tool calls are recorded only for the root session and cannot be reliably
    # attributed to a particular agent after an agent switch.
    observed_bash = [t for t in tool_calls if t.tool == "bash"]
    approaches_ok = spec_has_approaches_considered(project)

    evidence = [
        f"Prometheus agent-switched at {prometheus_switches[0].created}",
        f"SPEC.md has ## Approaches Considered: {'yes' if approaches_ok else 'no'}",
    ]
    if observed_bash:
        evidence.append(f"Root-session Bash calls observed without agent attribution: {len(observed_bash)}")
    if approaches_ok:
        return Verdict("PASS", evidence=evidence,
                       interpretation="Prometheus produced a direct SPEC with Approaches Considered; root-session tool calls are non-attributable.")
    return Verdict("PARTIAL", evidence=evidence,
                   interpretation="Prometheus switched into session but canonical SPEC evidence is incomplete.")


def verdict_autonomous_strategy(
    conn: sqlite3.Connection,
    session: SessionRow,
    switches: list[AgentSwitch],
    child_sessions: list[SessionRow],
    project: str,
) -> Verdict:
    autonomous_switches = [s for s in switches if s.agent == "autonomous"]
    if not autonomous_switches:
        return Verdict("NOT_APPLICABLE", evidence=["No agent-switched to autonomous found"])

    child_agents = {c.agent.lower() for c in child_sessions if c.agent}
    delegated_to = child_agents & STRATEGY_SUBAGENTS
    declared = "karpathy" if "karpathy" in delegated_to else "direct"

    evidence = [
        f"Observed strategy: {declared}",
        f"Child session agents: {sorted(child_agents) or 'none'}",
        f"Strategy subagent delegations observed: {sorted(delegated_to) or 'none'}",
    ]

    if declared == "karpathy":
        arts = karpathy_artifacts_present(project)
        has_delegation = "karpathy" in delegated_to
        evidence += [f"Karpathy artifacts: {arts}", f"@karpathy child session: {has_delegation}"]
        if has_delegation and all(arts.values()):
            return Verdict("PASS", evidence=evidence,
                           interpretation="Canonical Karpathy scaffold and advisory delegation observed.")
        if has_delegation:
            return Verdict("PARTIAL", evidence=evidence,
                           interpretation="@karpathy child session exists but canonical scaffold is incomplete.")
        if all(arts.values()):
            return Verdict("PARTIAL", evidence=evidence,
                           interpretation="Karpathy scaffold exists but advisory delegation was not observed.")
        return Verdict("FAIL", evidence=evidence,
                       interpretation="Selected: karpathy but neither delegation nor canonical scaffold was found.")

    # direct / other
    if delegated_to:
        return Verdict("PASS", evidence=evidence,
                       interpretation=f"Selected: {declared}; strategy is direct (no subagent required).")
    return Verdict("PASS", evidence=evidence,
                   interpretation=f"Selected: {declared} — direct execution, no subagent delegation required.")


def verdict_karpathy(
    conn: sqlite3.Connection,
    child_sessions: list[SessionRow],
    project: str,
) -> Verdict:
    karpathy_children = [c for c in child_sessions if (c.agent or "").lower() == "karpathy"]
    if not karpathy_children:
        return Verdict("NOT_SELECTED", evidence=["No @karpathy child session found"])

    arts = karpathy_artifacts_present(project)
    evidence = [
        f"@karpathy child sessions: {len(karpathy_children)}",
        f"SPEC.md: {arts.get('SPEC.md')}",
        f"opencode-autonomous.json: {arts.get('opencode-autonomous.json')}",
    ]

    if all(arts.values()):
        return Verdict("PASS", evidence=evidence,
                       interpretation="Karpathy advisory session used the canonical scaffold.")
    return Verdict("FAIL", evidence=evidence,
                   interpretation="@karpathy child session exists but the canonical scaffold is incomplete.")


# ---------------------------------------------------------------------------
# Report formatting
# ---------------------------------------------------------------------------

VERDICT_EXIT = {"PASS": 0, "NOT_APPLICABLE": 0, "NOT_SELECTED": 0, "PARTIAL": 1, "FAIL": 2}


def _fmt_verdict(v: Verdict) -> str:
    lines = [f"  Verdict: {v.label}"]
    for e in v.evidence:
        lines.append(f"    - {e}")
    if v.interpretation:
        lines.append(f"  Interpretation: {v.interpretation}")
    return "\n".join(lines)


def print_report(
    session: SessionRow,
    child_sessions: list[SessionRow],
    prom_v: Verdict,
    auto_v: Verdict,
    karp_v: Verdict,
    reviewer_approved: bool,
    run_kpis_v: Verdict,
) -> int:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    print(f"""
Runtime Validation Report
Generated: {now}

Target session: {session.id} (slug: {session.slug})
Time window:    {session.created} – {session.updated} (localtime)
Project:        {session.directory}
Agent:          {session.agent}
Child sessions: {len(child_sessions)}
Reviewer APPROVE: {'yes' if reviewer_approved else 'no'}

---

Prometheus verdict:
{_fmt_verdict(prom_v)}

Autonomous strategy verdict:
{_fmt_verdict(auto_v)}

Karpathy verdict:
{_fmt_verdict(karp_v)}

Run KPI verdict:
{_fmt_verdict(run_kpis_v)}

Material difference verdict: {'YES' if child_sessions else 'NO'}
  Evidence: {'Child sessions present: ' + ', '.join(c.agent or '?' for c in child_sessions) if child_sessions else 'No child sessions found.'}
""".strip())
    verdicts = [prom_v, auto_v, karp_v]
    worst = max(
        (VERDICT_EXIT.get(v.label, 0) for v in verdicts),
        default=0,
    )
    return worst


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Audit an @autonomous session against the cuddly-winner runtime contract.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--project", required=True, help="Absolute path to the project directory.")
    p.add_argument("--session", default=None, help="Session ID to audit. Defaults to the most recent autonomous session.")
    p.add_argument("--list", action="store_true", help="List recent sessions for the project and exit.")
    p.add_argument("--db", default=str(DEFAULT_DB), help=f"Path to opencode.db (default: {DEFAULT_DB})")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    project = str(Path(args.project).resolve())
    db_path = Path(args.db)

    try:
        conn = open_db(db_path)
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 3

    sessions = list_sessions(conn, project, limit=20)
    if not sessions:
        print(f"No OpenCode sessions found for project: {project}", file=sys.stderr)
        return 3

    if args.list:
        print(f"{'Session ID':<40} {'Agent':<16} {'Slug':<20} {'Updated'}")
        print("-" * 100)
        for s in sessions:
            print(f"{s.id:<40} {(s.agent or '?'):<16} {(s.slug or '?'):<20} {s.updated}")
        return 0

    if args.session:
        session = get_session(conn, args.session)
        if not session:
            print(f"Session not found: {args.session}", file=sys.stderr)
            return 3
    else:
        # Pick most recent autonomous session.
        autonomous = [s for s in sessions if (s.agent or "").lower() == "autonomous"]
        session = autonomous[0] if autonomous else sessions[0]

    child_sessions = get_descendant_sessions(conn, session.id)
    tool_calls = get_tool_calls(conn, session.id)
    switches = get_agent_switches(conn, session.id)

    reviewer_approved = has_promise_token(conn, session.id, "APPROVE")

    prom_v  = verdict_prometheus(conn, session, switches, tool_calls, project)
    auto_v  = verdict_autonomous_strategy(conn, session, switches, child_sessions, project)
    karp_v  = verdict_karpathy(conn, child_sessions, project)
    run_kpis_v = verdict_run_kpis(
        read_run_kpis(project),
        summarize_kpi_usage(get_assistant_usage(conn, [session.id, *[child.id for child in child_sessions]])),
    )

    exit_code = print_report(
        session, child_sessions, prom_v, auto_v, karp_v,
        reviewer_approved,
        run_kpis_v,
    )
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
