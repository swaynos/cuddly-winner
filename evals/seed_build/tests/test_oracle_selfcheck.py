"""
evals/seed_build/tests/test_oracle_selfcheck.py

Deterministic self-test proving the oracle and generated-agent fixtures are
self-consistent.

Tests:
  1. Reference implementation passes all acceptance tests.
  2. Reference implementation passes all failure-mode checks.
  3. Canonical generated-agent package and handoff pass all planning checks.
  4. Bad-reference fixture is flagged by failure-mode checks.
  5. Weak and retired package forms fail planning checks.
  6. Dry-run plumbing publishes and executes the current package contract.
  7. Both CLI dry-runs pass and report current contract checks.

Run with:
    python3 -m unittest discover -s evals/seed_build/tests -p "test_*.py"
"""
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

ROOT    = Path(__file__).resolve().parents[3]
ORACLE  = Path(__file__).resolve().parents[1] / "oracle"
CANONICAL = Path(__file__).resolve().parents[1] / "canonical"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
SEED_BUILD = Path(__file__).resolve().parents[1]


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod  # register before exec so @dataclass can resolve annotations
    spec.loader.exec_module(mod)
    return mod


class TestHarnessEnvironment(unittest.TestCase):
    def test_dotenv_loading_and_redaction(self):
        harness = _load_module("seed_build_harness", SEED_BUILD / "_harness.py")
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env"
            env_file.write_text(
                "OPENAI_API_KEY='secret-value'\nIGNORED_WITHOUT_VALUE\n",
                encoding="utf-8",
            )
            loaded = harness.load_dotenv(env_file)
            self.assertEqual(loaded, {"OPENAI_API_KEY": "secret-value"})
            self.assertEqual(
                harness.redact_secrets("failure secret-value", loaded),
                "failure [REDACTED]",
            )

    def test_agent_environment_uses_workspace_runtime_directories(self):
        harness = _load_module("seed_build_harness_runtime", SEED_BUILD / "_harness.py")
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            env, _ = harness.agent_environment(workspace, dotenv_path=workspace / "missing")
            self.assertEqual(env["PWD"], str(workspace))
            for name in ("XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"):
                runtime_path = Path(env[name])
                self.assertTrue(runtime_path.is_dir())
                self.assertTrue(runtime_path.is_relative_to(workspace))


class TestAcceptanceSuiteOnReference(unittest.TestCase):
    """The reference implementation must pass all acceptance tests."""

    def test_reference_passes_acceptance_suite(self):
        reference_engine = ORACLE / "reference" / "rules_engine.py"
        acceptance_dir   = ORACLE / "acceptance"

        result = subprocess.run(
            [sys.executable, "-m", "unittest", "discover",
             "-s", str(acceptance_dir), "-p", "test_*.py", "-v"],
            env={**os.environ, "RULES_ENGINE_PATH": str(reference_engine)},
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            result.returncode, 0,
            f"Reference implementation failed acceptance tests:\n{result.stdout}\n{result.stderr}",
        )


class TestFailureModeChecks(unittest.TestCase):
    """failure_modes.py must flag the bad fixture and pass the reference."""

    def _check(self, engine_path: Path):
        fm = _load_module("failure_modes", ORACLE / "failure_modes.py")
        return fm.check_all(engine_path)

    def test_reference_passes_failure_mode_checks(self):
        report = self._check(ORACLE / "reference" / "rules_engine.py")
        self.assertTrue(
            report.passed,
            f"Reference implementation has failure modes:\n{report.render()}",
        )

    def test_bad_fixture_fails_failure_mode_checks(self):
        report = self._check(FIXTURES / "bad_rules_engine.py")
        self.assertFalse(
            report.passed,
            "Bad fixture should have been flagged by failure-mode checks but wasn't.",
        )
        # Must detect at least hardcoded secret and duplicated logic
        failures_text = "\n".join(report.failures).lower()
        self.assertTrue(
            "secret" in failures_text or "hardcod" in failures_text or "api" in failures_text,
            f"Expected secret detection; failures:\n{report.render()}",
        )
        self.assertTrue(
            "duplic" in failures_text or "multiple function" in failures_text
            or "centraliz" in failures_text,
            f"Expected duplication detection; failures:\n{report.render()}",
        )


class TestPlanningChecks(unittest.TestCase):
    """The package scorer must distinguish the canonical and weak fixtures."""

    def _score(self, package_root: Path):
        planning = _load_module("planning_checks", SEED_BUILD / "planning_checks.py")
        handoff = (package_root / "PROMETHEUS_HANDOFF.txt").read_text(encoding="utf-8")
        return planning.score_package(package_root, handoff)

    def test_canonical_package_passes_planning_checks(self):
        report = self._score(CANONICAL)
        self.assertTrue(
            report.passed,
            f"Canonical package failed planning checks:\n{report.render()}",
        )

    def test_weak_package_fails_planning_checks(self):
        report = self._score(FIXTURES / "weak_package")
        self.assertFalse(
            report.passed,
            "Weak package fixture should have failed planning checks but passed.",
        )
        failed_names = [c.name for c in report.checks if not c.passed]
        self.assertTrue(
            len(failed_names) >= 2,
            f"Expected >=2 check failures on weak package; got: {failed_names}\n{report.render()}",
        )

    def test_handoff_requires_restart_and_new_conversation(self):
        planning = _load_module("planning_checks_handoff", SEED_BUILD / "planning_checks.py")
        report = planning.score_package(CANONICAL, "Select workflow-rules-engine now.")
        failed_names = [c.name for c in report.checks if not c.passed]
        self.assertIn("Fresh-context generated-agent handoff", failed_names)

    def test_retired_schema_version_is_rejected(self):
        planning = _load_module("planning_checks_schema", SEED_BUILD / "planning_checks.py")
        with tempfile.TemporaryDirectory() as tmp:
            package = Path(tmp) / "package"
            shutil.copytree(CANONICAL, package)
            manifest_path = package / ".opencode/tasks/workflow-rules-engine.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["schema_version"] = 3
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            handoff = (package / "PROMETHEUS_HANDOFF.txt").read_text(encoding="utf-8")
            report = planning.score_package(package, handoff)
        registered = next(
            check for check in report.checks
            if check.name == "Registered schema-v1 task package"
        )
        self.assertFalse(registered.passed)


class TestDryRunPlumbing(unittest.TestCase):
    def test_prometheus_stub_publishes_registered_package(self):
        harness = _load_module("seed_build_harness_planning", SEED_BUILD / "_harness.py")
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            rc, stdout, stderr = harness.dry_run_prometheus(workspace)
            self.assertEqual((rc, stderr), (0, ""))
            self.assertIn("new conversation", stdout.lower())
            self.assertTrue((workspace / ".opencode/generated-agents.json").is_file())
            self.assertTrue((workspace / ".opencode/agents/workflow-rules-engine.md").is_file())
            self.assertTrue((workspace / ".opencode/tasks/workflow-rules-engine.md").is_file())
            self.assertTrue((workspace / ".opencode/tasks/workflow-rules-engine.json").is_file())
            self.assertFalse((workspace / "SPEC.md").exists())
            self.assertFalse((workspace / "opencode-autonomous.json").exists())

    def test_generated_agent_stub_builds_reference_output(self):
        harness = _load_module("seed_build_harness_build", SEED_BUILD / "_harness.py")
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            harness.copy_canonical_package(workspace)
            rc, stdout, stderr = harness.dry_run_generated_agent(workspace)
            self.assertEqual((rc, stderr), (0, ""))
            self.assertIn("generated agent", stdout.lower())
            self.assertIn('"type": "tool_use"', stdout)
            self.assertIn("[DRY-RUN STUB]", stdout)
            self.assertTrue((workspace / "rules_engine.py").is_file())
            events = harness.parse_opencode_events(stdout)
            mutation_indexes = [
                index for index, event in enumerate(events)
                if event.get("type") == "tool_use"
                and (event.get("part") or {}).get("tool") in {"edit", "write", "apply_patch", "patch"}
            ]
            bash_indexes = [
                index for index, event in enumerate(events)
                if event.get("type") == "tool_use"
                and (event.get("part") or {}).get("tool") == "bash"
            ]
            self.assertTrue(mutation_indexes)
            self.assertTrue(bash_indexes)
            self.assertTrue(all(index > max(mutation_indexes) for index in bash_indexes))


class TestBuildContractChecks(unittest.TestCase):
    def test_package_mutation_is_detected(self):
        build = _load_module("seed_build_test_build", SEED_BUILD / "test_build.py")
        harness = _load_module("seed_build_harness_mutation", SEED_BUILD / "_harness.py")
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            harness.copy_canonical_package(workspace)
            before = build._package_bytes(workspace)
            manifest = workspace / ".opencode/tasks/workflow-rules-engine.json"
            manifest.write_text("{}\n", encoding="utf-8")
            checks = build._check_contract_compliance(before, workspace)
        immutable = next(
            check for check in checks
            if check["name"] == "Published generated-agent package remains unchanged"
        )
        self.assertFalse(immutable["passed"])


class TestDryRun(unittest.TestCase):
    """Both live tests must return PASS in dry-run mode."""

    def _run_test(self, script: str) -> tuple[int, str]:
        result = subprocess.run(
            [sys.executable, str(SEED_BUILD / script), "--dry-run"],
            capture_output=True,
            text=True,
            cwd=str(ROOT),
        )
        return result.returncode, result.stdout + result.stderr

    def test_planning_dry_run_passes(self):
        rc, output = self._run_test("test_planning.py")
        self.assertEqual(rc, 0, f"test_planning --dry-run failed:\n{output}")
        self.assertIn("PASS", output, f"Expected PASS verdict:\n{output}")
        self.assertIn("Registered schema-v1 task package", output)
        self.assertIn("Fresh-context generated-agent handoff", output)
        self.assertNotIn("Autonomous handoff", output)
        self.assertNotIn("schema-v3", output)

    def test_build_dry_run_passes(self):
        rc, output = self._run_test("test_build.py")
        self.assertEqual(rc, 0, f"test_build --dry-run failed:\n{output}")
        self.assertIn("PASS", output, f"Expected PASS verdict:\n{output}")
        self.assertIn("Published generated-agent package remains unchanged", output)
        self.assertIn("Fresh declared verification command 2 exits 0", output)
        self.assertNotIn("Published SPEC", output)
        self.assertNotIn("Published Autonomous", output)

    def test_live_tests_fail_closed_when_credentials_are_missing(self):
        env = {
            key: value for key, value in os.environ.items()
            if key not in {
                "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY",
                "GEMINI_API_KEY", "AWS_ACCESS_KEY_ID",
            }
        }
        env["OPENCODE_EVAL_DOTENV"] = "0"
        for script in ("test_planning.py", "test_build.py"):
            result = subprocess.run(
                [sys.executable, str(SEED_BUILD / script)],
                capture_output=True,
                text=True,
                cwd=str(ROOT),
                env=env,
            )
            self.assertNotEqual(result.returncode, 0, script)
            self.assertIn("SKIPPED", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
