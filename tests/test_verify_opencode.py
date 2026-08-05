"""Deterministic regression tests for behavioral scenario assertions."""
from __future__ import annotations

import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import verify_opencode


class BehavioralAssertionTests(unittest.TestCase):
    def test_autonomous_uses_a_concise_final_handoff(self) -> None:
        agent = (pathlib.Path(__file__).parents[1] / "agents" / "autonomous.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("Goals and validated outcomes", agent)
        self.assertIn("Brief change summary", agent)
        self.assertIn("each exact verification command", agent)
        self.assertIn("validator verdict", agent)
        self.assertIn("detailed PR Contract", agent)
        self.assertIn("full validator\nreport remains in that delegated task result", agent)
        self.assertIn("unavailable, do not report success or label any\nrequested goal `Validated`", agent)
        self.assertIn("Do not emit\n`<promise>COMPLETE</promise>`", agent)
        self.assertIn('"*": deny\n    grounder: allow', agent)
        self.assertIn("placeholder test, ignored verification flag, disabled", agent)
        self.assertIn("Attempt the required validator delegation after this candidate-readiness check", agent)

    def test_task_permission_specific_allows_follow_the_catch_all_deny(self) -> None:
        root = pathlib.Path(__file__).parents[1] / "agents"
        expected = {
            "ask.md": '"grounder": allow',
            "prometheus.md": "grounder: allow",
            "autonomous.md": "implementation-validator: allow",
            "karpathy.md": '"reviewer": allow',
        }

        for filename, specific_allow in expected.items():
            text = (root / filename).read_text(encoding="utf-8")
            self.assertLess(text.index('"*": deny'), text.index(specific_allow), filename)

    def test_last_nonempty_line_does_not_accept_an_earlier_verdict(self) -> None:
        output = "### Verdict\nREQUEST_CHANGES\nMore explanation after the verdict\n"

        self.assertEqual(verify_opencode._last_nonempty_line(output), "More explanation after the verdict")

    def test_response_excerpt_normalizes_and_bounds_diagnostics(self) -> None:
        self.assertEqual(verify_opencode._response_excerpt("  one\n\n two  "), "one two")
        self.assertEqual(verify_opencode._response_excerpt("abcdefgh", limit=5), "abcde...")

    def test_subagent_fallback_is_not_attributed_to_the_requested_agent(self) -> None:
        output = 'agent "reviewer" is a subagent, not a primary agent. Falling back to default agent'

        self.assertTrue(verify_opencode._subagent_fallback(output, "reviewer"))
        self.assertTrue(
            verify_opencode._subagent_fallback(
                'agent "karpathy" is a subagent, not a primary agent. Falling back to default agent',
                "karpathy",
            )
        )
        self.assertFalse(verify_opencode._subagent_fallback(output, "grounder"))

    def test_json_events_extract_text_and_delegated_child(self) -> None:
        stream = "\n".join(
            [
                '{"type":"text","part":{"text":"Parent summary"}}',
                '{"type":"tool_use","part":{"tool":"task","state":{"input":{"subagent_type":"grounder"},"output":"<task_result>Child result</task_result>"}}}',
            ]
        )

        events, text = verify_opencode._parse_json_events(stream)

        self.assertEqual(text, "Parent summary")
        self.assertTrue(verify_opencode._delegated_to(events, "grounder"))
        self.assertEqual(verify_opencode._delegated_result(events, "grounder"), "<task_result>Child result</task_result>")

    def test_task_result_text_removes_task_wrapper(self) -> None:
        output = "<task id=\"ses_123\" state=\"completed\">\n<task_result>\nAPPROVE\n</task_result>\n</task>"

        self.assertEqual(verify_opencode._task_result_text(output), "APPROVE")

    def test_agent_timeout_becomes_a_scenario_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with mock.patch.object(
                verify_opencode.subprocess,
                "run",
                side_effect=subprocess.TimeoutExpired(["opencode"], 300, output="partial output"),
            ):
                result = verify_opencode._run_scenario_agent("ask", "test", None, pathlib.Path(temporary))

        self.assertEqual(result.returncode, 124)
        self.assertIn("Timed out after 300 seconds", result.raw_output)

    def test_canonical_scaffold_requires_both_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            (root / "SPEC.md").write_text("placeholder\n", encoding="utf-8")

            self.assertEqual(
                verify_opencode._canonical_scaffold_errors(
                    root / "SPEC.md", root / "opencode-autonomous.json"
                ),
                ["both SPEC.md and opencode-autonomous.json must exist"],
            )

    def test_canonical_scaffold_rejects_duplicate_sections_and_nonfinal_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            verify_opencode._write_ralph_scaffold(root)
            spec = root / "SPEC.md"
            spec.write_text(
                spec.read_text(encoding="utf-8").replace(
                    "## Grounding", "## Grounding\n\n## Grounding", 1
                )
                + "Additional content\n",
                encoding="utf-8",
            )

            errors = verify_opencode._canonical_scaffold_errors(
                spec, root / "opencode-autonomous.json"
            )

            self.assertIn("missing or duplicate section: ## Grounding", errors)
            self.assertIn("missing final Autonomous handoff", errors)

    def test_ralph_fixture_is_a_canonical_scaffold(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            verify_opencode._write_ralph_scaffold(root)

            self.assertEqual(
                verify_opencode._canonical_scaffold_errors(
                    root / "SPEC.md", root / "opencode-autonomous.json"
                ),
                [],
            )


if __name__ == "__main__":
    unittest.main()
