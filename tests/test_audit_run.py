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


if __name__ == "__main__":
    unittest.main()
