"""Deterministic regression tests for behavioral scenario assertions."""
from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import verify_opencode


def write_runtime_integrity_fixture(config: pathlib.Path) -> dict[str, pathlib.Path]:
    root = pathlib.Path(__file__).parents[1]
    runtime_files: dict[str, pathlib.Path] = {}
    for package, version in (
        ("@opencode-ai/plugin", "1.17.15"),
        ("playwright", "1.58.2"),
    ):
        package_root = config / "node_modules" / package
        package_root.mkdir(parents=True, exist_ok=True)
        (package_root / "package.json").write_text(
            json.dumps({"version": version}), encoding="utf-8"
        )
        runtime_file = package_root / "dist" / "runtime.js"
        runtime_file.parent.mkdir()
        runtime_file.write_text(f"export const packageName = {package!r};\n", encoding="utf-8")
        runtime_files[package] = runtime_file
    transitive_root = config / "node_modules/playwright-core"
    transitive_root.mkdir()
    (transitive_root / "package.json").write_text(
        json.dumps({"version": "1.58.2"}), encoding="utf-8"
    )
    transitive_runtime = transitive_root / "lib/server.js"
    transitive_runtime.parent.mkdir()
    transitive_runtime.write_text("export const runtime = true;\n", encoding="utf-8")
    runtime_files["playwright-core"] = transitive_runtime
    subprocess.run(
        [
            "node",
            str(root / "scripts/opencode-runtime-integrity.mjs"),
            "record",
            "--root",
            str(config / "node_modules"),
            "--state",
            str(config / "node_modules/.cuddly-winner-runtime-integrity.json"),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return runtime_files


class BehavioralAssertionTests(unittest.TestCase):
    def test_live_profile_preflight_fails_closed_by_default(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "install.*restart OpenCode"):
            verify_opencode._live_profile_mode(["active profile differs"], diagnostics=False)

    def test_live_profile_preflight_labels_diagnostic_runs(self) -> None:
        self.assertEqual(
            verify_opencode._live_profile_mode(["active profile differs"], diagnostics=True),
            "active-profile diagnostics",
        )
        self.assertEqual(
            verify_opencode._live_profile_mode([], diagnostics=False),
            "repository-profile validation",
        )
        self.assertNotIn(
            "repository profile validated",
            verify_opencode._live_profile_success_message("active-profile diagnostics").lower(),
        )
        for mode in ("active-profile diagnostics", "repository-profile validation"):
            message = verify_opencode._live_profile_success_message(mode).lower()
            self.assertIn("prometheus publication", message)
            self.assertTrue("unproven" in message or "not validated" in message)

    def test_managed_profile_inventory_detects_tools_skills_rules_runtime_and_wiring(self) -> None:
        root = pathlib.Path(__file__).parents[1]
        with tempfile.TemporaryDirectory() as temporary:
            config = pathlib.Path(temporary)
            for directory in ("agents", "plugins", "tools", "skills", "rules"):
                shutil.copytree(root / directory, config / directory)
            write_runtime_integrity_fixture(config)
            rule_paths = [str(config / "rules" / source.name) for source in (root / "rules").glob("*.md")]
            (config / "opencode.json").write_text(
                json.dumps(
                    {
                        "instructions": rule_paths,
                        "mcp": {
                            "cuddly-winner-browser": {
                                "type": "local",
                                "command": [str(config / "cuddly-winner-browser" / "obscura"), "mcp"],
                                "environment": {"HEADLESS": "true"},
                                "enabled": True,
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            locator = config / "feedback" / "cuddly-winner-feedback-root"
            locator.parent.mkdir()
            locator.write_text(str(root / "feedback") + "\n", encoding="utf-8")

            self.assertEqual(verify_opencode._managed_profile_file_mismatches(config), [])

            workspace_agents = pathlib.Path(temporary) / "workspace/.opencode/agents"
            workspace_agents.mkdir(parents=True)
            (workspace_agents / "generated-task.md").write_text(
                "generated agent\n", encoding="utf-8"
            )
            self.assertEqual(
                verify_opencode._managed_profile_file_mismatches(config), []
            )

            retired_paths = (
                *(
                    (f"{directory}/{name}", "agent file", False)
                    for directory in ("agent", "agents")
                    for name in (
                        "autonomous.md",
                        "implementation-validator.md",
                        "karpathy.md",
                        "out-of-the-box-thinker.md",
                    )
                ),
                ("plugin/opencode-autonomous-supervisor.js", "plugin path", False),
                ("plugins/opencode-autonomous-supervisor.js", "plugin path", False),
                ("plugin/opencode-autonomous-supervisor", "plugin path", True),
                ("plugins/opencode-autonomous-supervisor", "plugin path", True),
                ("tool/run.ts", "tool path", False),
                ("tools/run.ts", "tool path", False),
            )
            for relative, kind, is_directory in retired_paths:
                with self.subTest(retired_path=relative):
                    retired = config / relative
                    retired.parent.mkdir(parents=True, exist_ok=True)
                    if is_directory:
                        retired.mkdir()
                    else:
                        retired.write_text("retired\n", encoding="utf-8")

                    self.assertEqual(
                        verify_opencode._managed_profile_file_mismatches(config),
                        [f"retired global {kind} remains discoverable: {retired}"],
                    )

                    if is_directory:
                        retired.rmdir()
                    else:
                        retired.unlink()

            shutil.copytree(
                config / "skills" / "cuddly-winner-feedback",
                config / "skills" / "cuddly-winner-feedback.bak.legacy",
            )
            (config / "tools" / "spike.ts").unlink()
            (config / "skills" / "cuddly-winner-feedback" / "SKILL.md").write_text("drift\n", encoding="utf-8")
            (config / "node_modules" / "playwright" / "package.json").write_text('{"version":"0"}', encoding="utf-8")
            value = json.loads((config / "opencode.json").read_text(encoding="utf-8"))
            value["instructions"] = []
            value["mcp"]["cuddly-winner-browser"]["command"] = ["visible-browser"]
            (config / "opencode.json").write_text(json.dumps(value), encoding="utf-8")
            locator.write_text("/tmp/wrong-feedback\n", encoding="utf-8")

            mismatches = verify_opencode._managed_profile_file_mismatches(config)
            self.assertTrue(any("missing active profile file" in item and "spike.ts" in item for item in mismatches))
            self.assertTrue(any("active profile differs" in item and "cuddly-winner-feedback" in item for item in mismatches))
            self.assertTrue(any("discoverable managed skill backup present" in item for item in mismatches))
            self.assertTrue(any("playwright package version differs" in item for item in mismatches))
            self.assertTrue(any("rule instruction missing" in item for item in mismatches))
            self.assertTrue(any("managed browser configuration differs" in item for item in mismatches))
            self.assertTrue(any("feedback locator differs" in item for item in mismatches))

    def test_managed_profile_requires_valid_runtime_integrity_state(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            config = pathlib.Path(temporary)
            write_runtime_integrity_fixture(config)
            state = config / "node_modules/.cuddly-winner-runtime-integrity.json"

            state.unlink()
            missing = verify_opencode._managed_profile_file_mismatches(config)
            self.assertTrue(any("runtime integrity" in item for item in missing))

            state.write_text("not json\n", encoding="utf-8")
            state.chmod(0o600)
            invalid = verify_opencode._managed_profile_file_mismatches(config)
            self.assertTrue(any("runtime integrity" in item for item in invalid))

    def test_managed_profile_detects_runtime_content_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            config = pathlib.Path(temporary)
            runtime_files = write_runtime_integrity_fixture(config)
            runtime_files["playwright-core"].write_text(
                "tampered runtime\n", encoding="utf-8"
            )

            mismatches = verify_opencode._managed_profile_file_mismatches(config)
            runtime_files["playwright-core"].unlink()
            missing = verify_opencode._managed_profile_file_mismatches(config)

        self.assertTrue(
            any(
                "runtime integrity" in item
                and "modified" in item
                and "node_modules" in item
                for item in mismatches
            )
        )
        self.assertFalse(any("package version differs" in item for item in mismatches))

        self.assertTrue(
            any("runtime integrity" in item and "modified" in item for item in missing)
        )
        self.assertFalse(any("package version differs" in item for item in missing))

    def test_task_permission_specific_allows_follow_the_catch_all_deny(self) -> None:
        root = pathlib.Path(__file__).parents[1] / "agents"
        expected = {
            "ask.md": ['"grounder": allow'],
            "prometheus.md": ["grounder: allow"],
        }

        for filename, specific_allows in expected.items():
            text = (root / filename).read_text(encoding="utf-8")
            for specific_allow in specific_allows:
                self.assertLess(text.index('"*": deny'), text.index(specific_allow), f"{filename}: {specific_allow}")

    def test_last_nonempty_line_does_not_accept_an_earlier_verdict(self) -> None:
        output = "### Verdict\nREQUEST_CHANGES\nMore explanation after the verdict\n"

        self.assertEqual(verify_opencode._last_nonempty_line(output), "More explanation after the verdict")

    def test_reviewer_verdict_requires_an_exact_final_token(self) -> None:
        cases = (
            ("APPROVE\n", "APPROVE", True),
            ("Evidence\n\nREQUEST_CHANGES\n\n", "REQUEST_CHANGES", True),
            ("APPROVE with caveats\n", "APPROVE", False),
            ("Verdict: APPROVE\n", "APPROVE", False),
            ("REQUEST_CHANGES: fix this\n", "REQUEST_CHANGES", False),
            ("Please REQUEST_CHANGES\n", "REQUEST_CHANGES", False),
        )
        for output, expected, accepted in cases:
            with self.subTest(output=output, expected=expected):
                self.assertEqual(
                    verify_opencode._has_exact_reviewer_verdict(output, expected),
                    accepted,
                )

    def test_response_excerpt_normalizes_and_bounds_diagnostics(self) -> None:
        self.assertEqual(verify_opencode._response_excerpt("  one\n\n two  "), "one two")
        self.assertEqual(verify_opencode._response_excerpt("abcdefgh", limit=5), "abcde...")

    def test_subagent_fallback_is_not_attributed_to_the_requested_agent(self) -> None:
        output = 'agent "reviewer" is a subagent, not a primary agent. Falling back to default agent'

        self.assertTrue(verify_opencode._subagent_fallback(output, "reviewer"))
        self.assertFalse(verify_opencode._subagent_fallback(output, "grounder"))

    def test_subagent_scenario_fails_if_opencode_falls_back(self) -> None:
        fallback = verify_opencode.ScenarioResult(
            0,
            "default agent response",
            [],
            'agent "reviewer" is a subagent, not a primary agent. Falling back to default agent',
        )
        with mock.patch.object(
            verify_opencode, "_run_scenario_agent", return_value=fallback
        ):
            result = verify_opencode._run_subagent_scenario(
                "reviewer", "review", None, pathlib.Path(".")
            )

        self.assertEqual(result.returncode, 1)

    def test_subagent_scenario_rejects_parent_text_without_task_delegation(self) -> None:
        false_positive = verify_opencode.ScenarioResult(
            0,
            "APPROVE",
            [{"type": "text", "part": {"text": "APPROVE"}}],
            '{"type":"text","part":{"text":"APPROVE"}}',
        )
        with mock.patch.object(
            verify_opencode, "_run_scenario_agent", return_value=false_positive
        ):
            result = verify_opencode._run_subagent_scenario(
                "reviewer", "review", None, pathlib.Path(".")
            )

        self.assertEqual(result.returncode, 1)
        self.assertIn("delegation was not proven", result.raw_output)

    def test_subagent_scenario_returns_the_requested_child_output(self) -> None:
        child_output = (
            '<task id="ses_child" state="completed">\n'
            "<task_result>\nChild APPROVE\n</task_result>\n</task>"
        )
        delegated = verify_opencode.ScenarioResult(
            0,
            "Parent summary that must not drive the assertion",
            [
                {
                    "type": "tool_use",
                    "part": {
                        "tool": "task",
                        "state": {
                            "status": "completed",
                            "input": {"subagent_type": "reviewer"},
                            "output": child_output,
                        },
                    },
                }
            ],
            "raw output",
        )
        with (
            mock.patch.object(
                verify_opencode, "_run_scenario_agent", return_value=delegated
            ),
            mock.patch.object(
                verify_opencode,
                "_export_delegated_tools",
                return_value=frozenset({"read"}),
            ),
        ):
            result = verify_opencode._run_subagent_scenario(
                "reviewer", "review", None, pathlib.Path(".")
            )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.output, "Child APPROVE")
        self.assertEqual(result.delegated_tools, frozenset({"read"}))

    def test_private_tool_claim_requires_child_session_visibility(self) -> None:
        unproven = verify_opencode.ScenarioResult(0, "local", [], "raw")
        visible_clean = verify_opencode.ScenarioResult(
            0, "local", [], "raw", delegated_tools=frozenset({"read"})
        )
        visible_webfetch = verify_opencode.ScenarioResult(
            0, "local", [], "raw", delegated_tools=frozenset({"webfetch"})
        )

        self.assertIsNone(verify_opencode._delegated_tool_used(unproven, "webfetch"))
        self.assertFalse(
            verify_opencode._delegated_tool_used(visible_clean, "webfetch")
        )
        self.assertTrue(
            verify_opencode._delegated_tool_used(visible_webfetch, "webfetch")
        )

    def test_child_export_exposes_delegated_tool_evidence(self) -> None:
        exported = {
            "info": {"id": "ses_child", "agent": "grounder"},
            "messages": [
                {
                    "parts": [
                        {
                            "type": "tool",
                            "tool": "webfetch",
                            "state": {"status": "completed"},
                        },
                        {"type": "text", "text": "answer"},
                    ]
                }
            ],
        }
        completed = subprocess.CompletedProcess(
            ["opencode", "export", "ses_child"], 0, json.dumps(exported), ""
        )
        with mock.patch.object(
            verify_opencode.subprocess, "run", return_value=completed
        ):
            tools = verify_opencode._export_delegated_tools(
                "ses_child", "grounder", pathlib.Path(".")
            )

        self.assertEqual(tools, frozenset({"webfetch"}))

    def test_json_events_extract_text_and_delegated_child(self) -> None:
        stream = "\n".join(
            [
                '{"type":"text","part":{"text":"Parent summary"}}',
                '{"type":"tool_use","part":{"tool":"task","state":{"status":"completed","input":{"subagent_type":"grounder"},"output":"<task id=\\"ses_child\\" state=\\"completed\\">\\n<task_result>Child result</task_result>\\n</task>"}}}',
            ]
        )

        events, text = verify_opencode._parse_json_events(stream)

        self.assertEqual(text, "Parent summary")
        self.assertEqual(verify_opencode._primary_tools(events), {"task"})

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

if __name__ == "__main__":
    unittest.main()
