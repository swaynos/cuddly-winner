"""Focused fixtures for the session auditor's non-attributable observations."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import audit_run as audit


class AuditVerdictTests(unittest.TestCase):
    def test_root_bash_after_prometheus_switch_is_not_attributed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "SPEC.md").write_text("## Approaches Considered\n", encoding="utf-8")
            verdict = audit.verdict_prometheus(
                None,
                audit.SessionRow("s", None, "autonomous", None, str(root), "", ""),
                [audit.AgentSwitch("prometheus", "")],
                [audit.PartRow("bash", "", "")],
                str(root),
            )
        self.assertEqual(verdict.label, "PASS")
        self.assertIn("without agent attribution", "\n".join(verdict.evidence))

    def test_missing_prometheus_switch_is_not_applicable(self) -> None:
        verdict = audit.verdict_prometheus(
            None,
            audit.SessionRow("s", None, "autonomous", None, ".", "", ""),
            [], [], ".",
        )
        self.assertEqual(verdict.label, "NOT_APPLICABLE")

    def test_kpi_summary_merges_overlapping_active_intervals(self) -> None:
        summary = audit.summarize_kpi_usage([
            audit.AssistantUsage("m1", "root", 0, 60_000, 20),
            audit.AssistantUsage("m2", "child", 30_000, 90_000, 10),
            audit.AssistantUsage("m3", "root", 120_000, 180_000, 30),
        ])
        self.assertEqual(summary.tokens, 60)
        self.assertEqual(summary.active_milliseconds, 150_000)
        self.assertEqual(summary.tokens_per_active_minute, 24)

    def test_kpi_verdict_is_observational_and_disabled_by_default(self) -> None:
        summary = audit.KpiSummary(tokens=120, active_milliseconds=60_000, tokens_per_active_minute=120)
        self.assertEqual(audit.verdict_run_kpis(None, summary).label, "NOT_APPLICABLE")
        verdict = audit.verdict_run_kpis(
            audit.RunKpiPolicy(target_seconds=30, target_tokens_per_active_minute=100, hard_budget_tokens=200),
            summary,
        )
        self.assertEqual(verdict.label, "PARTIAL")
    def test_assistant_usage_with_optional_cache_tokens(self) -> None:
        import json
        import sqlite3
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE TABLE message (id TEXT, session_id TEXT, data TEXT)")
        msg_with_cache = {
            "role": "assistant",
            "time": {"created": 1000, "completed": 5000},
            "tokens": {"input": 10, "output": 20, "reasoning": 5, "cache": {"read": 2, "write": 1}},
        }
        msg_without_cache = {
            "role": "assistant",
            "time": {"created": 6000, "completed": 10000},
            "tokens": {"input": 15, "output": 25, "reasoning": 0},
        }
        conn.execute("INSERT INTO message VALUES (?, ?, ?)", ("m1", "s1", json.dumps(msg_with_cache)))
        conn.execute("INSERT INTO message VALUES (?, ?, ?)", ("m2", "s1", json.dumps(msg_without_cache)))
        usages = audit.get_assistant_usage(conn, ["s1"])
        self.assertEqual(len(usages), 2)
        self.assertEqual(usages[0].tokens, 38)
        self.assertEqual(usages[1].tokens, 40)


if __name__ == "__main__":
    unittest.main()
