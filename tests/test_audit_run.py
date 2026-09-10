"""Focused fixtures for current generic and generated-agent audit evidence."""
from __future__ import annotations

import argparse
import io
import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import audit_run as audit


def valid_manifest(task_id: str = "fix-widget") -> dict[str, object]:
    return {
        "schema_version": 1,
        "task_id": task_id,
        "agent_name": task_id,
        "agent_definition": f".opencode/agents/{task_id}.md",
        "task_brief": f".opencode/tasks/{task_id}.md",
        "strategy": "direct",
        "permissions": {"edit_paths": ["src/widget.py"], "bash": True},
        "implementation_scope": ["src/widget.py", "tests/test_widget.py"],
        "durable_context": ["README.md"],
        "verification": {
            "commands": ["python -m unittest tests/test_widget.py"],
            "success_evidence": ["Fresh passing test output."],
            "freshness": "Run after the final edit.",
            "failure_conditions": ["A required command fails."],
            "independent_review": None,
        },
        "limits": {"stop_conditions": ["Scope must expand."]},
        "escalation_triggers": ["Acceptance is materially ambiguous."],
        "strategy_config": {
            "work_selection": "Complete brief items in dependency order."
        },
        "run_kpis": {
            "enabled": True,
            "unattended_runtime": {"target_seconds": 30},
            "token_burn": {
                "target_tokens_per_active_minute": 100,
                "hard_budget_tokens": 200,
            },
        },
    }


def write_package(
    root: Path,
    *,
    task_id: str = "fix-widget",
    manifest: object | None = None,
    entries: list[object] | None = None,
) -> None:
    (root / ".opencode/agents").mkdir(parents=True)
    (root / ".opencode/tasks").mkdir()
    (root / f".opencode/agents/{task_id}.md").write_text(
        "agent\n", encoding="utf-8"
    )
    (root / f".opencode/tasks/{task_id}.md").write_text(
        "brief\n", encoding="utf-8"
    )
    (root / f".opencode/tasks/{task_id}.json").write_text(
        json.dumps(valid_manifest(task_id) if manifest is None else manifest),
        encoding="utf-8",
    )
    (root / ".opencode/generated-agents.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "agents": entries
                if entries is not None
                else [
                    {
                        "name": task_id,
                        "manifest": f".opencode/tasks/{task_id}.json",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )


class AuditEvidenceTests(unittest.TestCase):
    def test_user_approve_text_is_not_reviewer_approval(self) -> None:
        conn = self._session_database()
        session = audit.SessionRow("root", None, "build", "root", "/project", "", "")
        conn.execute(
            "INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)",
            ("user-message", "root", json.dumps({"role": "user", "text": "APPROVE"})),
        )
        conn.execute(
            "INSERT INTO part (id, message_id, session_id, data, time_created) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                "user-text",
                "user-message",
                "root",
                json.dumps({"type": "text", "text": "APPROVE"}),
                1,
            ),
        )

        self.assertFalse(audit.has_reviewer_approval(conn, [session]))

    def test_exact_final_token_from_reviewer_child_is_approval_evidence(self) -> None:
        conn = self._session_database()
        root = audit.SessionRow("root", None, "build", "root", "/project", "", "")
        reviewer = audit.SessionRow(
            "review", "root", "reviewer", "review", "/project", "", ""
        )
        conn.execute(
            "INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)",
            ("review-message", "review", json.dumps({"role": "assistant"})),
        )
        conn.execute(
            "INSERT INTO part (id, message_id, session_id, data, time_created) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                "review-text",
                "review-message",
                "review",
                json.dumps({"type": "text", "text": "Evidence: clean.\nAPPROVE\n"}),
                1,
            ),
        )

        self.assertTrue(audit.has_reviewer_approval(conn, [root, reviewer]))
        conn.execute(
            "UPDATE part SET data = ? WHERE id = ?",
            (
                json.dumps(
                    {"type": "text", "text": "Evidence: clean.\nAPPROVE with caveats\n"}
                ),
                "review-text",
            ),
        )
        self.assertFalse(audit.has_reviewer_approval(conn, [root, reviewer]))

    def test_report_does_not_attribute_root_bash_after_an_agent_switch(self) -> None:
        session = audit.SessionRow("s", None, "ask", None, "/project", "", "")
        output = io.StringIO()
        with redirect_stdout(output):
            status = audit.print_report(
                session,
                [],
                [audit.AgentSwitch("prometheus", "")],
                [audit.PartRow("bash", "command", "")],
                None,
                False,
                audit.verdict_run_kpis(None, audit.KpiSummary(0, 0, 0)),
            )

        self.assertEqual(status, 0)
        self.assertIn(
            "Root-session Bash calls: 1 (not attributed to a switched agent)",
            output.getvalue(),
        )
        self.assertIn("Reviewer approval: no", output.getvalue())

    def test_reads_kpis_from_the_selected_schema_v1_generated_agent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_package(root)

            evidence = audit.read_generated_agent_evidence(str(root), "fix-widget")
            policy = audit.read_run_kpis(str(root), "fix-widget")

        self.assertIsNotNone(evidence)
        self.assertEqual(evidence.strategy, "direct")
        self.assertTrue(evidence.agent_definition_present)
        self.assertTrue(evidence.task_brief_present)
        self.assertEqual(policy, audit.RunKpiPolicy(30, 100, 200))

    def test_ignores_unregistered_and_noncurrent_generated_manifests(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".opencode/tasks").mkdir(parents=True)
            (root / ".opencode/tasks/fix-widget.json").write_text(
                json.dumps(
                    {
                        "schema_version": 2,
                        "task_id": "fix-widget",
                        "agent_name": "fix-widget",
                    }
                ),
                encoding="utf-8",
            )
            (root / ".opencode/generated-agents.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "agents": [
                            {
                                "name": "fix-widget",
                                "manifest": ".opencode/tasks/fix-widget.json",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            self.assertIsNone(
                audit.read_generated_agent_evidence(str(root), "fix-widget")
            )
            self.assertIsNone(
                audit.read_generated_agent_evidence(str(root), "other-agent")
            )

    def test_rejects_incomplete_generated_agent_manifests(self) -> None:
        for missing in (
            "permissions",
            "implementation_scope",
            "verification",
            "limits",
            "strategy_config",
        ):
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                manifest = valid_manifest()
                del manifest[missing]
                write_package(root, manifest=manifest)

                self.assertIsNone(
                    audit.read_generated_agent_evidence(str(root), "fix-widget")
                )

    def test_rejects_duplicate_and_malformed_registry_entries(self) -> None:
        valid_entry = {
            "name": "fix-widget",
            "manifest": ".opencode/tasks/fix-widget.json",
        }
        cases = {
            "duplicate": [valid_entry, dict(valid_entry)],
            "malformed object": [valid_entry, {"name": "Bad Name", "manifest": "../bad"}],
            "non-object": [valid_entry, "bad-entry"],
        }
        for name, entries in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                write_package(root, entries=entries)

                self.assertIsNone(
                    audit.read_generated_agent_evidence(str(root), "fix-widget")
                )

    def test_rejects_every_reserved_built_in_and_shipped_agent_name(self) -> None:
        classes = {
            "built-in": {
                "build",
                "plan",
                "general",
                "explore",
                "compaction",
                "title",
                "summary",
            },
            "shipped": {"ask", "grounder", "prometheus", "reviewer"},
        }
        self.assertEqual(audit.RESERVED_AGENT_NAMES, set().union(*classes.values()))

        for name_class, names in classes.items():
            for name in sorted(names):
                with (
                    self.subTest(name_class=name_class, name=name),
                    tempfile.TemporaryDirectory() as directory,
                ):
                    root = Path(directory)
                    write_package(root, task_id=name)

                    self.assertIsNone(
                        audit.read_generated_agent_evidence(str(root), name)
                    )
                    self.assertTrue(
                        any(
                            "reserved agent identity" in error
                            for error in audit._manifest_errors(valid_manifest(name))
                        )
                    )

    def test_reserved_registry_name_invalidates_an_unrelated_selected_entry(self) -> None:
        for name_class, reserved_name in (("built-in", "build"), ("shipped", "reviewer")):
            with (
                self.subTest(name_class=name_class),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory)
                write_package(
                    root,
                    entries=[
                        {
                            "name": "fix-widget",
                            "manifest": ".opencode/tasks/fix-widget.json",
                        },
                        {
                            "name": reserved_name,
                            "manifest": f".opencode/tasks/{reserved_name}.json",
                        },
                    ],
                )

                self.assertIsNone(
                    audit.read_generated_agent_evidence(str(root), "fix-widget")
                )

    def test_explicit_session_must_belong_to_the_requested_project(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "target"
            foreign = Path(directory) / "foreign"
            target.mkdir()
            foreign.mkdir()
            conn = sqlite3.connect(":memory:")
            conn.execute(
                "CREATE TABLE session (id TEXT, parent_id TEXT, agent TEXT, slug TEXT, "
                "directory TEXT, time_created INTEGER, time_updated INTEGER)"
            )
            conn.execute("CREATE TABLE part (session_id TEXT, data TEXT, time_created INTEGER)")
            conn.execute(
                "CREATE TABLE session_message (session_id TEXT, type TEXT, data TEXT, "
                "time_created INTEGER, seq INTEGER)"
            )
            conn.execute("CREATE TABLE message (id TEXT, session_id TEXT, data TEXT)")
            conn.executemany(
                "INSERT INTO session VALUES (?, NULL, ?, ?, ?, 0, 0)",
                [
                    ("target-session", "ask", "target", str(target.resolve())),
                    ("foreign-session", "ask", "foreign", str(foreign.resolve())),
                ],
            )
            args = argparse.Namespace(
                project=str(target),
                session="foreign-session",
                list=False,
                db="unused",
            )
            stderr = io.StringIO()
            with (
                mock.patch.object(audit, "parse_args", return_value=args),
                mock.patch.object(audit, "open_db", return_value=conn),
                redirect_stdout(io.StringIO()),
                redirect_stderr(stderr),
            ):
                status = audit.main()

        self.assertEqual(status, 3)
        self.assertIn("foreign-session", stderr.getvalue())
        self.assertIn("does not belong to requested project", stderr.getvalue())

    def test_session_schema_without_directory_metadata_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            conn = sqlite3.connect(":memory:")
            conn.execute(
                "CREATE TABLE session (id TEXT, parent_id TEXT, agent TEXT, slug TEXT, "
                "time_created INTEGER, time_updated INTEGER)"
            )
            conn.execute(
                "INSERT INTO session VALUES ('selected', NULL, 'ask', 'selected', 0, 0)"
            )
            args = argparse.Namespace(
                project=str(target), session="selected", list=False, db="unused"
            )
            stderr = io.StringIO()
            with (
                mock.patch.object(audit, "parse_args", return_value=args),
                mock.patch.object(audit, "open_db", return_value=conn),
                redirect_stderr(stderr),
            ):
                status = audit.main()

        self.assertEqual(status, 3)
        self.assertIn("directory/worktree metadata", stderr.getvalue())

    def test_cross_project_descendant_fails_before_evidence_aggregation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "target"
            foreign = Path(directory) / "foreign"
            target.mkdir()
            foreign.mkdir()
            conn = self._session_database()
            conn.executemany(
                "INSERT INTO session VALUES (?, ?, ?, ?, ?, 0, 0)",
                [
                    ("root", None, "fix-widget", "root", str(target.resolve())),
                    ("foreign-child", "root", "reviewer", "child", str(foreign.resolve())),
                ],
            )
            args = argparse.Namespace(
                project=str(target), session="root", list=False, db="unused"
            )
            stderr = io.StringIO()
            with (
                mock.patch.object(audit, "parse_args", return_value=args),
                mock.patch.object(audit, "open_db", return_value=conn),
                redirect_stdout(io.StringIO()),
                redirect_stderr(stderr),
            ):
                status = audit.main()

        self.assertEqual(status, 3)
        self.assertIn("foreign-child", stderr.getvalue())
        self.assertIn("does not belong to requested project", stderr.getvalue())

    def test_same_normalized_project_descendant_is_included(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "target"
            target.mkdir()
            conn = self._session_database()
            conn.executemany(
                "INSERT INTO session VALUES (?, ?, ?, ?, ?, 0, 0)",
                [
                    ("root", None, "fix-widget", "root", str(target.resolve())),
                    (
                        "same-project-child",
                        "root",
                        "reviewer",
                        "child",
                        str(target / "unused" / ".."),
                    ),
                ],
            )
            args = argparse.Namespace(
                project=str(target), session="root", list=False, db="unused"
            )
            stdout = io.StringIO()
            with (
                mock.patch.object(audit, "parse_args", return_value=args),
                mock.patch.object(audit, "open_db", return_value=conn),
                redirect_stdout(stdout),
                redirect_stderr(io.StringIO()),
            ):
                status = audit.main()

        self.assertEqual(status, 0)
        self.assertIn("Child sessions: 1", stdout.getvalue())
        self.assertIn("Child agents:   reviewer", stdout.getvalue())

    def test_descendant_without_unambiguous_project_metadata_fails_closed(self) -> None:
        for child_directory in (None, "", "relative/project"):
            with (
                self.subTest(child_directory=child_directory),
                tempfile.TemporaryDirectory() as directory,
            ):
                target = Path(directory)
                conn = self._session_database()
                conn.executemany(
                    "INSERT INTO session VALUES (?, ?, ?, ?, ?, 0, 0)",
                    [
                        ("root", None, "fix-widget", "root", str(target.resolve())),
                        (
                            "ambiguous-child",
                            "root",
                            "reviewer",
                            "child",
                            child_directory,
                        ),
                    ],
                )
                args = argparse.Namespace(
                    project=str(target), session="root", list=False, db="unused"
                )
                stderr = io.StringIO()
                with (
                    mock.patch.object(audit, "parse_args", return_value=args),
                    mock.patch.object(audit, "open_db", return_value=conn),
                    redirect_stdout(io.StringIO()),
                    redirect_stderr(stderr),
                ):
                    status = audit.main()

                self.assertEqual(status, 3)
                self.assertIn("ambiguous-child", stderr.getvalue())
                self.assertIn("directory/worktree metadata", stderr.getvalue())

    @staticmethod
    def _session_database() -> sqlite3.Connection:
        conn = sqlite3.connect(":memory:")
        conn.execute(
            "CREATE TABLE session (id TEXT, parent_id TEXT, agent TEXT, slug TEXT, "
            "directory TEXT, time_created INTEGER, time_updated INTEGER)"
        )
        conn.execute(
            "CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, data TEXT, "
            "time_created INTEGER)"
        )
        conn.execute(
            "CREATE TABLE session_message (session_id TEXT, type TEXT, data TEXT, "
            "time_created INTEGER, seq INTEGER)"
        )
        conn.execute("CREATE TABLE message (id TEXT, session_id TEXT, data TEXT)")
        return conn

    def test_kpi_summary_merges_overlapping_active_intervals(self) -> None:
        summary = audit.summarize_kpi_usage(
            [
                audit.AssistantUsage("m1", "root", 0, 60_000, 20),
                audit.AssistantUsage("m2", "child", 30_000, 90_000, 10),
                audit.AssistantUsage("m3", "root", 120_000, 180_000, 30),
            ]
        )
        self.assertEqual(summary.tokens, 60)
        self.assertEqual(summary.active_milliseconds, 150_000)
        self.assertEqual(summary.tokens_per_active_minute, 24)

    def test_kpi_verdict_is_observational_and_disabled_by_default(self) -> None:
        summary = audit.KpiSummary(
            tokens=120,
            active_milliseconds=60_000,
            tokens_per_active_minute=120,
        )
        self.assertEqual(audit.verdict_run_kpis(None, summary).label, "NOT_APPLICABLE")
        verdict = audit.verdict_run_kpis(
            audit.RunKpiPolicy(
                target_seconds=30,
                target_tokens_per_active_minute=100,
                hard_budget_tokens=200,
            ),
            summary,
        )
        self.assertEqual(verdict.label, "PARTIAL")

    def test_assistant_usage_accepts_optional_cache_tokens(self) -> None:
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE TABLE message (id TEXT, session_id TEXT, data TEXT)")
        msg_with_cache = {
            "role": "assistant",
            "time": {"created": 1000, "completed": 5000},
            "tokens": {
                "input": 10,
                "output": 20,
                "reasoning": 5,
                "cache": {"read": 2, "write": 1},
            },
        }
        msg_without_cache = {
            "role": "assistant",
            "time": {"created": 6000, "completed": 10000},
            "tokens": {"input": 15, "output": 25, "reasoning": 0},
        }
        conn.execute(
            "INSERT INTO message VALUES (?, ?, ?)",
            ("m1", "s1", json.dumps(msg_with_cache)),
        )
        conn.execute(
            "INSERT INTO message VALUES (?, ?, ?)",
            ("m2", "s1", json.dumps(msg_without_cache)),
        )

        usages = audit.get_assistant_usage(conn, ["s1"])

        self.assertEqual(len(usages), 2)
        self.assertEqual(usages[0].tokens, 38)
        self.assertEqual(usages[1].tokens, 40)


if __name__ == "__main__":
    unittest.main()
