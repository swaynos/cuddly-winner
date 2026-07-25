"""Deterministic regression tests for behavioral scenario assertions."""
from __future__ import annotations

import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import verify_opencode


class BehavioralAssertionTests(unittest.TestCase):
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
