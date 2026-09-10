"""Focused regressions for seed-build false-green paths."""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[3]
SEED_BUILD = Path(__file__).resolve().parents[1]
CANONICAL = SEED_BUILD / "canonical"
ORACLE = SEED_BUILD / "oracle"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
AGENT_NAME = "workflow-rules-engine"
EXPECTED_EDIT_RULES = (
    '  edit:\n'
    '    "*": deny\n'
    '    "rules_engine.py": allow'
)


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _copy_package(workspace: Path) -> None:
    shutil.copytree(CANONICAL / ".opencode", workspace / ".opencode")
    shutil.copy2(SEED_BUILD / "seed" / "idea.md", workspace / "idea.md")


def _planning_check(report, name: str):
    return next(check for check in report.checks if check.name == name)


def _tool_event(command: str, status: str = "completed") -> str:
    return json.dumps({
        "type": "tool_use",
        "part": {
            "tool": "bash",
            "state": {"input": {"command": command}, "status": status},
        },
    })


def _mutation_event(tool: str) -> str:
    return json.dumps({
        "type": "tool_use",
        "part": {
            "tool": tool,
            "state": {
                "input": {"filePath": "rules_engine.py"},
                "status": "completed",
            },
        },
    })


class TestWorkspaceIsolation(unittest.TestCase):
    def test_live_agent_input_excludes_oracle_and_invented_toolchain(self):
        build = _load_module("seed_build_isolation", SEED_BUILD / "test_build.py")
        reference = (ORACLE / "reference" / "rules_engine.py").read_bytes()
        called = False

        def inspect_input(*, workspace, **_kwargs):
            nonlocal called
            called = True
            self.assertFalse((workspace / ".oracle_readonly").exists())
            self.assertFalse((workspace / "oracle").exists())
            self.assertFalse((workspace / ".python-version").exists())
            self.assertFalse((workspace / "scripts" / "ensure-venv.sh").exists())
            for path in workspace.rglob("*"):
                if path.is_file() and not path.is_symlink():
                    self.assertNotEqual(path.read_bytes(), reference, path)
            return 0, json.dumps({"type": "text", "part": {"text": "finished"}}), ""

        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(build, "run_opencode_agent", side_effect=inspect_input):
                report = build.run_test(Path(tmp), dry_run=False)

        self.assertTrue(called)
        isolation = next(
            check for check in report.checks
            if check["name"] == "Golden implementation and hidden acceptance stay outside generated-agent input"
        )
        self.assertTrue(isolation["passed"], isolation["note"])


class TestCanonicalPackageInputs(unittest.TestCase):
    def test_package_is_self_contained_in_seed_only_workspace(self):
        planning = _load_module("planning_self_contained", SEED_BUILD / "planning_checks.py")
        harness = _load_module("harness_self_contained", SEED_BUILD / "_harness.py")
        handoff = (CANONICAL / "PROMETHEUS_HANDOFF.txt").read_text(encoding="utf-8")

        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            shutil.copy2(SEED_BUILD / "seed" / "idea.md", workspace / "idea.md")
            harness.copy_canonical_package(workspace)
            manifest = json.loads(
                (workspace / f".opencode/tasks/{AGENT_NAME}.json").read_text(encoding="utf-8")
            )
            for relative in manifest["durable_context"]:
                self.assertTrue((workspace / relative).is_file(), relative)
            report = planning.score_package(workspace, handoff)

        self.assertTrue(report.passed, report.render())

    def test_package_does_not_reference_hidden_or_invented_inputs(self):
        brief = (CANONICAL / f".opencode/tasks/{AGENT_NAME}.md").read_text(encoding="utf-8")
        manifest_text = (CANONICAL / f".opencode/tasks/{AGENT_NAME}.json").read_text(encoding="utf-8")
        manifest = json.loads(manifest_text)
        package_text = brief + manifest_text

        self.assertNotIn(".oracle_readonly", package_text)
        self.assertNotIn("scripts/ensure-venv.sh", package_text)
        self.assertTrue(manifest["verification"]["commands"])
        for command in manifest["verification"]["commands"]:
            self.assertIn("python", command)
            self.assertNotIn("ensure-venv", command)

    def test_missing_durable_context_is_rejected_at_publication(self):
        planning = _load_module("planning_missing_context", SEED_BUILD / "planning_checks.py")
        handoff = (CANONICAL / "PROMETHEUS_HANDOFF.txt").read_text(encoding="utf-8")

        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            _copy_package(workspace)
            manifest_path = workspace / f".opencode/tasks/{AGENT_NAME}.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["durable_context"].append("missing-context.md")
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            report = planning.score_package(workspace, handoff)

        registered = _planning_check(report, "Registered schema-v1 task package")
        self.assertFalse(registered.passed)
        self.assertIn("missing-context.md", registered.note)

    def test_missing_independent_review_key_is_rejected(self):
        planning = _load_module("planning_missing_review", SEED_BUILD / "planning_checks.py")
        handoff = (CANONICAL / "PROMETHEUS_HANDOFF.txt").read_text(encoding="utf-8")

        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            _copy_package(workspace)
            manifest_path = workspace / f".opencode/tasks/{AGENT_NAME}.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertIsNone(manifest["verification"].pop("independent_review"))
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            report = planning.score_package(workspace, handoff)

        registered = _planning_check(report, "Registered schema-v1 task package")
        self.assertFalse(registered.passed)
        self.assertIn("missing key inside verification: independent_review", registered.note)

    def test_symlinked_package_parent_components_are_rejected(self):
        planning = _load_module("planning_symlinked_parents", SEED_BUILD / "planning_checks.py")
        handoff = (CANONICAL / "PROMETHEUS_HANDOFF.txt").read_text(encoding="utf-8")

        for component in (".opencode", "tasks", "agents"):
            with self.subTest(component=component):
                with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as outside_tmp:
                    workspace = Path(tmp)
                    outside = Path(outside_tmp)
                    _copy_package(workspace)
                    source = (
                        workspace / component
                        if component == ".opencode"
                        else workspace / ".opencode" / component
                    )
                    target = outside / component.removeprefix(".")
                    source.rename(target)
                    source.symlink_to(target, target_is_directory=True)

                    report = planning.score_package(workspace, handoff)

                registered = _planning_check(report, "Registered schema-v1 task package")
                self.assertFalse(registered.passed, component)
                self.assertIn("symlink", registered.note, component)


class TestAgentPermissionScoring(unittest.TestCase):
    def _score_replacement(self, replacement: str):
        planning = _load_module(
            f"planning_permissions_{abs(hash(replacement))}",
            SEED_BUILD / "planning_checks.py",
        )
        handoff = (CANONICAL / "PROMETHEUS_HANDOFF.txt").read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            _copy_package(workspace)
            agent_path = workspace / f".opencode/agents/{AGENT_NAME}.md"
            source = agent_path.read_text(encoding="utf-8")
            self.assertIn(EXPECTED_EDIT_RULES, source)
            agent_path.write_text(source.replace(EXPECTED_EDIT_RULES, replacement), encoding="utf-8")
            return planning.score_package(workspace, handoff)

    def test_canonical_edit_rules_are_ordered_and_exact(self):
        agent = (CANONICAL / f".opencode/agents/{AGENT_NAME}.md").read_text(encoding="utf-8")
        self.assertIn(EXPECTED_EDIT_RULES, agent)
        self.assertNotIn("\n  write:", agent)

    def test_broad_or_misordered_write_grants_are_rejected(self):
        cases = {
            "flat broad edit": "  edit: allow",
            "wildcard allow": '  edit:\n    "*": allow\n    "rules_engine.py": allow',
            "deny after exact allow": '  edit:\n    "rules_engine.py": allow\n    "*": deny',
            "extra allowed path": EXPECTED_EDIT_RULES + '\n    "README.md": allow',
            "separate broad write": EXPECTED_EDIT_RULES + "\n  write: allow",
        }
        for label, replacement in cases.items():
            with self.subTest(label=label):
                bounded = _planning_check(
                    self._score_replacement(replacement),
                    "Bounded generated-agent definition",
                )
                self.assertFalse(bounded.passed, bounded.evidence)

    def test_manifest_bash_false_rejects_agent_ask(self):
        planning = _load_module(
            "planning_permissions_false_bash",
            SEED_BUILD / "planning_checks.py",
        )
        handoff = (CANONICAL / "PROMETHEUS_HANDOFF.txt").read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            _copy_package(workspace)
            manifest_path = workspace / f".opencode/tasks/{AGENT_NAME}.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["permissions"]["bash"] = False
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            agent_path = workspace / f".opencode/agents/{AGENT_NAME}.md"
            agent_path.write_text(
                agent_path.read_text(encoding="utf-8").replace("  bash: allow", "  bash: ask"),
                encoding="utf-8",
            )
            report = planning.score_package(workspace, handoff)

        bounded = _planning_check(report, "Bounded generated-agent definition")
        self.assertFalse(bounded.passed, bounded.evidence)
        self.assertIn("Bash", bounded.note)


class TestEndToEndFixtureContract(unittest.TestCase):
    def _e2e(self, name: str):
        return _load_module(name, SEED_BUILD / "test_end_to_end.py")

    def test_generated_agent_frontmatter_has_only_manifest_edit_paths(self):
        e2e = self._e2e("seed_build_e2e_permissions")
        planning = _load_module("seed_build_e2e_permission_parser", SEED_BUILD / "planning_checks.py")
        frontmatter = e2e.AGENT_DEFINITION.split("---", 2)[1]
        manifest = json.loads(e2e.MANIFEST_BODY)
        expected = [
            ("*", "deny"),
            *[(path, "allow") for path in manifest["permissions"]["edit_paths"]],
        ]

        edit_action, edit_rules, edit_error = planning._permission_value(frontmatter, "edit")
        self.assertEqual(edit_error, "")
        self.assertIsNone(edit_action)
        self.assertEqual(edit_rules, expected)
        self.assertNotRegex(frontmatter, r"(?m)^  write:")

    def test_resolved_generated_agent_contract_rejects_broad_or_write_grants(self):
        e2e = self._e2e("seed_build_e2e_resolved_permissions")
        expected = [("*", "deny"), ("retry_policy.py", "allow"),
                    ("tests/test_retry_policy.py", "allow")]
        exact = {
            "permission": [
                {"permission": "*", "pattern": "*", "action": "allow"},
                *[
                    {"permission": "edit", "pattern": pattern, "action": action}
                    for pattern, action in expected
                ],
            ]
        }
        broad = {"permission": [{"permission": "edit", "pattern": "*", "action": "allow"}]}
        write = {"permission": [*exact["permission"],
                                {"permission": "write", "pattern": "*", "action": "allow"}]}

        self.assertEqual(e2e._resolved_permission_rules(exact, "edit"), expected)
        self.assertTrue(e2e._resolved_generated_agent_contract(exact)[0])
        self.assertFalse(e2e._resolved_generated_agent_contract(broad)[0])
        self.assertFalse(e2e._resolved_generated_agent_contract(write)[0])

    def test_prometheus_validation_names_generated_agent(self):
        e2e = self._e2e("seed_build_e2e_validate_name")
        turns = {turn.name: turn for turn in e2e._prometheus_turns()}
        self.assertEqual(turns["pro-validate"].args, {"agent_name": e2e.TASK_ID})

    def test_handoff_requires_every_fresh_context_element(self):
        e2e = self._e2e("seed_build_e2e_handoff")
        turns = {turn.name: turn for turn in e2e._prometheus_turns()}
        handoff = turns["pro-final"].text
        self.assertEqual(e2e._handoff_missing(handoff), [])

        removals = {
            "agent": e2e.TASK_ID,
            "brief": f".opencode/tasks/{e2e.TASK_ID}.md",
            "manifest": f".opencode/tasks/{e2e.TASK_ID}.json",
            "quit": "Quit",
            "restart": "restart",
            "new conversation": "new conversation",
            "select": "select",
        }
        for label, required_text in removals.items():
            with self.subTest(label=label):
                incomplete = handoff.replace(required_text, "omitted")
                self.assertIn(label, e2e._handoff_missing(incomplete))

    def test_help_describes_actual_live_agent_invocation(self):
        e2e = self._e2e("seed_build_e2e_help")
        self.assertNotIn("`--live`", e2e.__doc__)
        self.assertRegex(e2e.__doc__, r"without\s+`--dry-run`")


class TestJsonVerificationEvidence(unittest.TestCase):
    def test_opencode_helper_requests_json_output(self):
        harness = _load_module("harness_json_mode", SEED_BUILD / "_harness.py")
        completed = subprocess.CompletedProcess(["opencode"], 0, stdout="", stderr="")
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(harness.subprocess, "run", return_value=completed) as run:
                harness.run_opencode_agent("agent", "prompt", Path(tmp))
        command = run.call_args.args[0]
        self.assertIn("--format", command)
        self.assertEqual(command[command.index("--format") + 1], "json")

    def test_missing_verification_tool_event_fails(self):
        build = _load_module("build_missing_event", SEED_BUILD / "test_build.py")
        commands = ["python first.py", "python second.py"]
        results = build._session_verification_results(_tool_event(commands[0]), commands)
        self.assertEqual([result["passed"] for result in results], [True, False])

    def test_wrong_or_incomplete_verification_tool_event_fails(self):
        build = _load_module("build_wrong_event", SEED_BUILD / "test_build.py")
        command = "python verify.py"
        wrong = build._session_verification_results(_tool_event(command + " "), [command])
        incomplete = build._session_verification_results(_tool_event(command, "running"), [command])
        self.assertFalse(wrong[0]["passed"])
        self.assertFalse(incomplete[0]["passed"])

    def test_verification_before_later_mutation_is_stale(self):
        build = _load_module("build_stale_event", SEED_BUILD / "test_build.py")
        command = "python verify.py"

        for tool in ("edit", "write", "apply_patch", "patch"):
            with self.subTest(tool=tool):
                stream = "\n".join((_tool_event(command), _mutation_event(tool)))
                result = build._session_verification_results(stream, [command])[0]
                self.assertFalse(result["passed"], tool)

    def test_every_command_must_complete_after_final_mutation(self):
        build = _load_module("build_each_fresh_event", SEED_BUILD / "test_build.py")
        commands = ["python first.py", "python second.py"]
        stream = "\n".join((
            _tool_event(commands[0]),
            _mutation_event("write"),
            _tool_event(commands[1]),
        ))

        results = build._session_verification_results(stream, commands)

        self.assertEqual([result["passed"] for result in results], [False, True])

    def test_rerun_after_final_mutation_is_fresh(self):
        build = _load_module("build_rerun_event", SEED_BUILD / "test_build.py")
        command = "python verify.py"
        stream = "\n".join((
            _tool_event(command),
            _mutation_event("apply_patch"),
            _tool_event(command),
        ))

        result = build._session_verification_results(stream, [command])[0]

        self.assertTrue(result["passed"])

    def test_independent_replay_is_gated_by_session_events(self):
        build = _load_module("build_replay_gate", SEED_BUILD / "test_build.py")

        def no_verification_events(**_kwargs):
            return 0, json.dumps({"type": "text", "part": {"text": "done"}}), ""

        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(build, "run_opencode_agent", side_effect=no_verification_events):
                with mock.patch.object(build, "_run_declared_verification") as replay:
                    report = build.run_test(Path(tmp), dry_run=False)

        replay.assert_not_called()
        checks = [
            check for check in report.checks
            if check["name"].startswith("Generated-session declared verification command")
        ]
        self.assertTrue(checks)
        self.assertTrue(all(not check["passed"] for check in checks))


class TestHandoffScoring(unittest.TestCase):
    def _handoff_check(self, handoff: str):
        planning = _load_module(
            f"planning_handoff_{abs(hash(handoff))}",
            SEED_BUILD / "planning_checks.py",
        )
        return _planning_check(
            planning.score_package(CANONICAL, handoff),
            "Fresh-context generated-agent handoff",
        )

    def test_handoff_names_agent_brief_and_manifest(self):
        handoff = (
            "The generated agent `workflow-rules-engine`, brief "
            "`.opencode/tasks/workflow-rules-engine.md`, and manifest "
            "`.opencode/tasks/workflow-rules-engine.json` are ready. "
            "Quit and restart OpenCode. Start a new conversation and select the "
            "`workflow-rules-engine` agent."
        )
        self.assertTrue(self._handoff_check(handoff).passed)
        without_manifest = handoff.replace("`.opencode/tasks/workflow-rules-engine.json`", "the task data")
        self.assertFalse(self._handoff_check(without_manifest).passed)

    def test_negated_restart_handoff_is_rejected(self):
        handoff = (
            "The generated agent `workflow-rules-engine`, brief "
            "`.opencode/tasks/workflow-rules-engine.md`, and manifest "
            "`.opencode/tasks/workflow-rules-engine.json` are ready. "
            "Do not quit or restart OpenCode. Do not start a new conversation. "
            "Do not select the `workflow-rules-engine` agent."
        )
        check = self._handoff_check(handoff)
        self.assertFalse(check.passed, check.evidence)

    def test_suffix_negation_and_optional_actions_are_rejected(self):
        prefix = (
            "The generated agent `workflow-rules-engine`, brief "
            "`.opencode/tasks/workflow-rules-engine.md`, and manifest "
            "`.opencode/tasks/workflow-rules-engine.json` are ready. "
        )
        cases = {
            "quit and restart not required": (
                "Quit and restart are not required. Start a new conversation. "
                "Select the `workflow-rules-engine` agent."
            ),
            "quit optional": (
                "You may quit. Restart OpenCode. Start a new conversation. "
                "Select the `workflow-rules-engine` agent."
            ),
            "restart optional": (
                "Quit OpenCode. Restart OpenCode if desired. Start a new conversation. "
                "Select the `workflow-rules-engine` agent."
            ),
            "new conversation optional": (
                "Quit OpenCode. Restart OpenCode. Start a new conversation if you want. "
                "Select the `workflow-rules-engine` agent."
            ),
            "agent selection optional": (
                "Quit OpenCode. Restart OpenCode. Start a new conversation. "
                "Optionally select the `workflow-rules-engine` agent."
            ),
        }
        for label, instructions in cases.items():
            with self.subTest(label=label):
                check = self._handoff_check(prefix + instructions)
                self.assertFalse(check.passed, check.evidence)


class TestExecutionModeEvidence(unittest.TestCase):
    def test_report_makes_stub_and_live_modes_distinct(self):
        harness = _load_module("harness_execution_mode", SEED_BUILD / "_harness.py")
        dry = harness.TestReport("dry", execution_mode="dry-run")
        live = harness.TestReport("live", execution_mode="live")

        self.assertEqual(dry.to_dict()["execution_mode"], "dry-run")
        self.assertIn("DRY-RUN", dry.render())
        self.assertIn("STUB", dry.render())
        self.assertIn("LIVE", live.render())
        self.assertNotIn("DRY-RUN", live.render())
        self.assertNotIn("STUB", live.render())


class TestOracleGuards(unittest.TestCase):
    def test_auth_after_condition_candidate_fails_acceptance(self):
        result = subprocess.run(
            [sys.executable, "-m", "unittest", "discover", "-s", str(ORACLE / "acceptance"),
             "-p", "test_*.py", "-v"],
            env={
                **os.environ,
                "RULES_ENGINE_PATH": str(FIXTURES / "auth_after_condition_rules_engine.py"),
                "PYTHONDONTWRITEBYTECODE": "1",
            },
            capture_output=True,
            text=True,
        )
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn("test_authorization_checked_before_conditions", output)
        self.assertIn("condition evaluated before authorization", output)

    def test_auth_after_condition_candidate_fails_all_rules_order_case(self):
        result = subprocess.run(
            [sys.executable, "-m", "unittest", "discover", "-s", str(ORACLE / "acceptance"),
             "-p", "test_*.py", "-v"],
            env={
                **os.environ,
                "RULES_ENGINE_PATH": str(FIXTURES / "auth_after_condition_rules_engine.py"),
                "PYTHONDONTWRITEBYTECODE": "1",
            },
            capture_output=True,
            text=True,
        )
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn("test_all_rules_are_authorized_before_any_condition_access", output)
        self.assertIn("early owned condition accessed before later authorization", output)

    def test_static_guard_rejects_module_global_writes_and_mutation(self):
        failure_modes = _load_module("failure_modes_module_state", ORACLE / "failure_modes.py")
        report = failure_modes.check_all(FIXTURES / "mutable_global_rules_engine.py")
        failures = "\n".join(report.failures)
        self.assertFalse(report.passed, report.render())
        self.assertIn("global", failures.lower())
        self.assertIn("EVALUATION_LOG.append", failures)

    def test_runtime_snapshot_rejects_mutable_module_global_mutation(self):
        result = subprocess.run(
            [sys.executable, "-m", "unittest", "discover", "-s", str(ORACLE / "acceptance"),
             "-p", "test_*.py", "-v"],
            env={
                **os.environ,
                "RULES_ENGINE_PATH": str(FIXTURES / "mutable_global_rules_engine.py"),
                "PYTHONDONTWRITEBYTECODE": "1",
            },
            capture_output=True,
            text=True,
        )
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn("test_evaluate_leaves_module_global_state_unchanged", output)
        self.assertIn("module global state changed during evaluate", output)
        self.assertIn("EVALUATION_LOG", output)

    def test_static_guard_names_path_and_os_mutations(self):
        failure_modes = _load_module("failure_modes_mutations", ORACLE / "failure_modes.py")
        report = failure_modes.check_all(FIXTURES / "file_mutation_rules_engine.py")
        failures = "\n".join(report.failures)
        self.assertFalse(report.passed, report.render())
        for call in (
            "write_text", "write_bytes", "touch", "unlink", "rename", "replace",
            "os.remove", "os.unlink", "os.rename", "os.replace", "Path.open",
            "open", "os.system", "subprocess.run", "subprocess.Popen",
        ):
            self.assertIn(call, failures)

    def test_static_guard_catches_aliased_open_and_process_calls(self):
        failure_modes = _load_module("failure_modes_processes", ORACLE / "failure_modes.py")
        report = failure_modes.check_all(FIXTURES / "aliased_process_rules_engine.py")
        failures = "\n".join(report.failures)
        self.assertFalse(report.passed, report.render())
        for call in ("builtins.open", "os.system", "subprocess.run"):
            self.assertIn(call, failures)
        self.assertGreaterEqual(failures.count("builtins.open"), 2)

    def test_runtime_snapshot_rejects_filesystem_mutation(self):
        marker = FIXTURES / "_runtime_side_effect.txt"
        marker.unlink(missing_ok=True)
        try:
            result = subprocess.run(
                [sys.executable, "-m", "unittest", "discover", "-s", str(ORACLE / "acceptance"),
                 "-p", "test_*.py", "-v"],
                env={
                    **os.environ,
                    "RULES_ENGINE_PATH": str(FIXTURES / "runtime_side_effect_rules_engine.py"),
                    "PYTHONDONTWRITEBYTECODE": "1",
                },
                capture_output=True,
                text=True,
            )
        finally:
            marker.unlink(missing_ok=True)
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn("filesystem snapshot changed during evaluate", output)


class TestReservedAgentIdentities(unittest.TestCase):
    def test_planning_scorer_rejects_all_authoritative_reserved_names(self):
        planning = _load_module("planning_reserved_names", SEED_BUILD / "planning_checks.py")
        classes = {
            "native": {"build", "plan", "general", "explore", "compaction", "title", "summary"},
            "shipped": {"ask", "grounder", "prometheus", "reviewer"},
        }
        reserved = set().union(*classes.values())
        self.assertEqual(planning.RESERVED_AGENT_NAMES, reserved)

        template = json.loads(
            (CANONICAL / f".opencode/tasks/{AGENT_NAME}.json").read_text(encoding="utf-8")
        )
        for name_class, names in classes.items():
            for name in sorted(names):
                with self.subTest(name_class=name_class, name=name):
                    manifest = dict(template)
                    manifest.update({
                        "task_id": name,
                        "agent_name": name,
                        "agent_definition": f".opencode/agents/{name}.md",
                        "task_brief": f".opencode/tasks/{name}.md",
                    })
                    self.assertIn(
                        f'task_id must not use reserved agent identity "{name}"',
                        planning._manifest_errors(manifest),
                    )

    def test_reserved_registry_name_is_reported(self):
        planning = _load_module("planning_reserved_registry", SEED_BUILD / "planning_checks.py")
        handoff = (CANONICAL / "PROMETHEUS_HANDOFF.txt").read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            _copy_package(workspace)
            registry_path = workspace / ".opencode/generated-agents.json"
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            registry["agents"][0]["name"] = "reviewer"
            registry_path.write_text(json.dumps(registry), encoding="utf-8")
            report = planning.score_package(workspace, handoff)

        registered = _planning_check(report, "Registered schema-v1 task package")
        self.assertFalse(registered.passed)
        self.assertIn('reserved agent identity "reviewer"', registered.note)


class TestJsonIntegerParity(unittest.TestCase):
    def test_python_integer_check_matches_number_is_integer(self):
        planning = _load_module("planning_integer_parity", SEED_BUILD / "planning_checks.py")
        self.assertTrue(planning._integer(1))
        self.assertTrue(planning._integer(1.0))
        self.assertFalse(planning._integer(True))
        self.assertFalse(planning._integer(1.5))
        self.assertFalse(planning._integer(float("inf")))


if __name__ == "__main__":
    unittest.main()
