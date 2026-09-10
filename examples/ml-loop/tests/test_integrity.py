"""Regression tests for the immutable ml-loop execution and scoring boundary."""

from __future__ import annotations

import importlib.util
import json
import logging
import py_compile
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

logging.disable(logging.CRITICAL)
try:
    from hashlib import sha256
finally:
    logging.disable(logging.NOTSET)


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_REGRESSION_TESTS = 16


def _checker_sha256(root: Path) -> str:
    return sha256((root / "tools" / "check_immutable.py").read_bytes()).hexdigest()


def _run_tool(root: Path, name: str, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            "-I",
            "-B",
            str(root / "tools" / name),
            "--root",
            str(root),
            "--checker-sha256",
            _checker_sha256(root),
            *arguments,
        ],
        cwd=root,
        check=False,
        capture_output=True,
        text=True,
    )


def _enable_intended_candidate(root: Path) -> str:
    train_path = root / "train.py"
    source = train_path.read_text(encoding="utf-8")
    if "ACTIVE_FEATURES = 3" not in source:
        raise AssertionError("starter trainer does not expose the intended candidate lever")
    return source.replace("ACTIVE_FEATURES = 3", "ACTIVE_FEATURES = 4")


class PackageCopyTestCase(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory(prefix="ml-loop-test-")
        self.root = Path(self.temporary_directory.name) / "package"
        shutil.copytree(ROOT, self.root)

    def tearDown(self):
        self.temporary_directory.cleanup()


class TestImmutableRunner(PackageCopyTestCase):
    def test_runner_rejects_non_isolated_python(self):
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                str(self.root / "tools" / "run_experiment.py"),
                "--root",
                str(self.root),
                "--checker-sha256",
                _checker_sha256(self.root),
                "--seed",
                "1",
            ],
            cwd=self.root,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("isolated Python mode", result.stdout + result.stderr)

    def test_direct_evaluator_mutation_is_rejected_before_training(self):
        (self.root / "train.py").write_text(
            "from pathlib import Path\n"
            "import os\n"
            "Path(__file__).with_name('tools').joinpath('score.py').write_text('# tampered\\n')\n"
            "Path(os.environ['CANDIDATE_ARTIFACT_PATH']).write_text('{}\\n')\n",
            encoding="utf-8",
        )
        result = _run_tool(self.root, "run_experiment.py", "--seed", "1")
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn("pre-training immutable check failed", output)
        self.assertIn("train.py source boundary failed", output)
        self.assertIn("score", output)
        self.assertNotIn("EVALUATOR_RESULT", result.stdout)

    def test_new_tool_shadow_module_during_training_is_rejected(self):
        (self.root / "train.py").write_text(
            "from pathlib import Path\n"
            "Path(__file__).with_name('tools').joinpath('json.py').write_text('raise RuntimeError()\\n')\n",
            encoding="utf-8",
        )
        result = _run_tool(self.root, "run_experiment.py", "--seed", "1")
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn("post-training immutable check failed", output)
        self.assertIn("unexpected package entry: tools/json.py", output)
        self.assertNotIn("EVALUATOR_RESULT", result.stdout)

    def test_root_unittest_shadow_added_during_training_is_rejected(self):
        train_path = self.root / "train.py"
        source = train_path.read_text(encoding="utf-8")
        train_path.write_text(
            source
            + "\nfrom pathlib import Path\n"
            "Path(__file__).with_name('unittest.py').write_text("
            "'raise AssertionError(\\\"root unittest shadow loaded\\\")\\n')\n",
            encoding="utf-8",
        )
        result = _run_tool(self.root, "run_experiment.py", "--seed", "2026")
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn("post-training immutable check failed", output)
        self.assertIn("unexpected package entry: unittest.py", output)

    def test_opencode_mutation_during_training_is_rejected(self):
        train_path = self.root / "train.py"
        source = train_path.read_text(encoding="utf-8")
        train_path.write_text(
            source
            + "\nfrom pathlib import Path\n"
            "Path(__file__).with_name('.opencode').joinpath("
            "'agents', 'improve-classifier.md').write_text('# tampered\\n')\n",
            encoding="utf-8",
        )
        result = _run_tool(self.root, "run_experiment.py", "--seed", "2026")
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn("post-training immutable check failed", output)
        self.assertIn(
            ".opencode/agents/improve-classifier.md: sha256 mismatch",
            output,
        )

    def test_readme_mutation_before_training_is_rejected(self):
        (self.root / "README.md").write_text("rewritten package\n", encoding="utf-8")
        result = _run_tool(self.root, "run_experiment.py", "--seed", "1")
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn("pre-training immutable check failed", output)
        self.assertIn("README.md: sha256 mismatch", output)

    def test_boundary_checker_mutation_before_training_is_rejected(self):
        boundary_path = self.root / "tools" / "check_train_boundary.py"
        boundary_path.write_text("# tampered\n", encoding="utf-8")
        result = _run_tool(self.root, "run_experiment.py", "--seed", "1")
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn("pre-training immutable check failed", output)
        self.assertIn("tools/check_train_boundary.py: sha256 mismatch", output)

    def test_forged_prepare_bytecode_cache_is_rejected_before_training(self):
        marker = Path(self.temporary_directory.name) / "forged-prepare-loaded"
        forged_source = Path(self.temporary_directory.name) / "forged_prepare.py"
        forged_source.write_text(
            "from pathlib import Path\n"
            f"Path({str(marker)!r}).write_text('loaded')\n"
            "raise RuntimeError('forged prepare cache loaded')\n",
            encoding="utf-8",
        )
        cache_path = Path(importlib.util.cache_from_source(str(self.root / "prepare.py")))
        cache_path.parent.mkdir()
        py_compile.compile(
            str(forged_source),
            cfile=str(cache_path),
            dfile=str(self.root / "prepare.py"),
            doraise=True,
            invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH,
        )

        for tool, arguments in (
            ("run_experiment.py", ("--seed", "1")),
            ("final_verify.py", ()),
        ):
            with self.subTest(tool=tool):
                marker.unlink(missing_ok=True)
                result = _run_tool(self.root, tool, *arguments)
                output = result.stdout + result.stderr
                self.assertNotEqual(result.returncode, 0, output)
                self.assertIn("unexpected package entry: __pycache__", output)
                self.assertIn(
                    "unexpected package entry: "
                    f"{cache_path.relative_to(self.root).as_posix()}",
                    output,
                )
                self.assertFalse(marker.exists(), output)

    def test_forged_heldout_score_from_trainer_is_rejected(self):
        train_path = self.root / "train.py"
        train_path.write_text(
            _enable_intended_candidate(self.root)
            + '\nprint("Held-out score: 1.000000")\n',
            encoding="utf-8",
        )
        result = _run_tool(self.root, "run_experiment.py", "--seed", "1")
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn("train.py source boundary failed", output)
        self.assertIn("print", output)
        self.assertNotIn('{"score":', result.stdout)

    def test_direct_heldout_import_and_read_from_trainer_is_rejected(self):
        train_path = self.root / "train.py"
        train_path.write_text(
            _enable_intended_candidate(self.root)
            + "\nfrom tools.heldout import get_heldout_data\n"
            "get_heldout_data()\n",
            encoding="utf-8",
        )
        result = _run_tool(self.root, "run_experiment.py", "--seed", "1")
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn("train.py source boundary failed", output)
        self.assertIn("tools.heldout", output)
        self.assertNotIn('{"score":', result.stdout)

    def test_non_score_trainer_output_is_rejected(self):
        train_path = self.root / "train.py"
        train_path.write_text(
            _enable_intended_candidate(self.root)
            + '\nos.write(2, b"training diagnostic\\n")\n',
            encoding="utf-8",
        )
        result = _run_tool(self.root, "run_experiment.py", "--seed", "1")
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn("trainer stdout/stderr must be empty", output)
        self.assertNotIn('{"score":', result.stdout)


class TestFinalVerifier(PackageCopyTestCase):
    def test_forged_score_log_cannot_make_baseline_pass(self):
        score_log = self.root / "logs" / "latest_score.txt"
        score_log.write_text("1.000000\n", encoding="utf-8")
        result = _run_tool(self.root, "final_verify.py")
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn("final verification failed", output)
        self.assertIn("median", output)
        self.assertIn("0.850000", output)

    def test_intended_interaction_feature_candidate_passes(self):
        train_path = self.root / "train.py"
        train_path.write_text(_enable_intended_candidate(self.root), encoding="utf-8")
        result = _run_tool(self.root, "final_verify.py")
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0, output)
        self.assertIn("final-verification-ok", output)
        self.assertIn("improvement", output)


class TestRegressionRunner(unittest.TestCase):
    def _write_suite(self, root: Path, count: int) -> Path:
        tests = root / "tests"
        tests.mkdir(parents=True)
        (tests / "test_synthetic.py").write_text(
            "import unittest\n"
            "\n"
            "class SyntheticTest(unittest.TestCase):\n"
            + "".join(
                f"    def test_{index:02d}(self):\n        pass\n"
                for index in range(count)
            ),
            encoding="utf-8",
        )
        tools = root / "tools"
        tools.mkdir()
        shutil.copy2(ROOT / "tools" / "regression_check.py", tools)
        return tests

    def test_runner_uses_isolated_stdlib_and_reports_expected_count(self):
        with tempfile.TemporaryDirectory(prefix="ml-loop-regression-") as temp_dir:
            root = Path(temp_dir)
            marker = root / "shadow-loaded"
            self._write_suite(root, EXPECTED_REGRESSION_TESTS)
            (root / "unittest.py").write_text(
                "from pathlib import Path\n"
                f"Path({str(marker)!r}).write_text('loaded')\n"
                "raise AssertionError('root unittest shadow loaded')\n",
                encoding="utf-8",
            )
            result = subprocess.run(
                [
                    sys.executable,
                    "-I",
                    "-B",
                    str(root / "tools" / "regression_check.py"),
                ],
                cwd=root,
                check=False,
                capture_output=True,
                text=True,
            )
            output = result.stdout + result.stderr
            self.assertEqual(result.returncode, 0, output)
            self.assertIn(f"{EXPECTED_REGRESSION_TESTS} tests", output)
            self.assertFalse(marker.exists(), output)

    def test_runner_rejects_an_incomplete_exit_zero_suite(self):
        with tempfile.TemporaryDirectory(prefix="ml-loop-regression-") as temp_dir:
            root = Path(temp_dir)
            self._write_suite(root, EXPECTED_REGRESSION_TESTS - 1)
            result = subprocess.run(
                [
                    sys.executable,
                    "-I",
                    "-B",
                    str(root / "tools" / "regression_check.py"),
                ],
                cwd=root,
                check=False,
                capture_output=True,
                text=True,
            )
            output = result.stdout + result.stderr
            self.assertNotEqual(result.returncode, 0, output)
            self.assertIn(
                f"expected {EXPECTED_REGRESSION_TESTS} tests, ran "
                f"{EXPECTED_REGRESSION_TESTS - 1}",
                output,
            )


class TestPublishedContract(unittest.TestCase):
    def test_manifest_uses_final_verifier_and_finishes_with_integrity_check(self):
        manifest = json.loads(
            (ROOT / ".opencode" / "tasks" / "improve-classifier.json").read_text(
                encoding="utf-8"
            )
        )
        commands = manifest["verification"]["commands"]
        self.assertTrue(any("tools/final_verify.py" in command for command in commands))
        self.assertIn("tools/check_immutable.py", commands[-1])
        self.assertFalse(any("train.py &&" in command for command in commands))
        self.assertIn("median", manifest["strategy_config"]["keep_revert_rule"].lower())
        self.assertIn("0.005", manifest["strategy_config"]["keep_revert_rule"])
        self.assertEqual(manifest["permissions"]["edit_paths"], ["train.py"])
        self.assertEqual(manifest["strategy_config"]["mutable_targets"], ["train.py"])
        self.assertEqual(
            manifest["implementation_scope"],
            ["train.py", "artifacts/candidate.json", "logs/latest_score.txt"],
        )
        self.assertIn(
            "tools/check_train_boundary.py",
            manifest["strategy_config"]["immutable_targets"],
        )
        self.assertIn(
            "tools/check_train_boundary.py",
            manifest["durable_context"],
        )


if __name__ == "__main__":
    unittest.main()
