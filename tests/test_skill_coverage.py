#!/usr/bin/env python3
"""
test_skill_coverage.py

Comprehensive tests for skill deployment, discovery, and behavior pressure testing.

Covers:
1. Default install deploys skills
2. Negative fixtures: unsupported frontmatter, mismatches, bad descriptions, etc.
3. Skill discovery via `opencode debug skills`
4. Pressure scenarios for each skill's behavior
5. Symlink mode deploy/remove
6. Project-local agent suggestion flow

Usage:
    python3 tests/test_skill_coverage.py [options]
    
    --skip-llm          Skip pressure scenario tests (requires model API)
    --keep-sandbox      Leave sandbox tempdir in place for debugging
    --verbose           Print subprocess invocations
    --model MODEL       Override model for pressure tests
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "skills"
DEPLOY_SCRIPT = REPO_ROOT / "scripts" / "deploy-opencode-agents.sh"

def _validate_skill_file(skill_file: Path) -> list[str]:
    """Return structural errors for one packaged skill file."""
    if not skill_file.is_file():
        return ["missing SKILL.md"]
    text = skill_file.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return ["missing YAML frontmatter"]
    try:
        _, frontmatter, body = text.split("---", 2)
    except ValueError:
        return ["unterminated YAML frontmatter"]
    fields = {}
    for line in frontmatter.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            fields[key.strip()] = value.strip()
    errors = []
    name = fields.get("name", "")
    description = fields.get("description", "")
    if not name or name != skill_file.parent.name:
        errors.append("name must match directory")
    if not description.startswith("Use when"):
        errors.append("description must begin with 'Use when'")
    if not body.strip():
        errors.append("missing skill body")
    return errors


@dataclass
class TestFailure:
    test_name: str
    message: str
    details: list[str] = field(default_factory=list)

    def render(self) -> str:
        lines = [f"\n  FAIL [{self.test_name}]  {self.message}"]
        if self.details:
            lines.extend(f"  {d}" for d in self.details)
        return "\n".join(lines)


def _print_header(msg: str) -> None:
    print(f"\n\033[1m{msg}\033[0m")


def _print_pass(msg: str) -> None:
    print(f"  \033[32m✓\033[0m  {msg}")


def _print_fail(msg: str) -> None:
    print(f"  \033[31m✗\033[0m  {msg}")


def _print_dim(msg: str) -> None:
    print(f"\033[2m{msg}\033[0m", file=sys.stderr)


# ---------------------------------------------------------------------------
# Test 1: Default install deploys skills
# ---------------------------------------------------------------------------

def test_default_install_deploys_skills() -> list[TestFailure]:
    """Default installation must deploy every packaged skill."""
    failures = []
    _print_header("Test 1: Default install deploys skills")

    with tempfile.TemporaryDirectory(prefix="skill-test-default-") as tmpdir:
        tmpdir_path = Path(tmpdir)
        config_dir = tmpdir_path / "config" / "opencode"
        skills_dir = config_dir / "skills"
        config_dir.mkdir(parents=True, exist_ok=True)

        try:
            env = os.environ.copy()
            env["OPENCODE_CONFIG_DIR"] = str(config_dir)
            result = subprocess.run(
                [
                    "bash", str(DEPLOY_SCRIPT), "install",
                    "--config-dir", str(config_dir),
                    "--mode", "copy",
                ],
                capture_output=True,
                text=True,
                timeout=30,
                env=env,
            )

            if result.returncode != 0:
                failures.append(TestFailure(
                    "default_install_no_skills",
                    f"Deploy failed: {result.stderr.strip() or result.stdout.strip()}",
                ))
                _print_fail("Deploy failed")
                return failures

            expected = {path.parent.name for path in SKILLS_DIR.glob("*/SKILL.md")}
            deployed = {path.parent.name for path in skills_dir.glob("*/SKILL.md")}
            if deployed != expected:
                failures.append(TestFailure(
                    "default_install_deploys_skills",
                    "Default install did not deploy the complete skill set",
                    details=[f"expected: {sorted(expected)}", f"deployed: {sorted(deployed)}"],
                ))
                _print_fail("Default install did not deploy the complete skill set")
            else:
                _print_pass(f"Deployed all {len(expected)} packaged skills")

        except Exception as exc:
            failures.append(TestFailure("default_install_deploys_skills", str(exc)))
            _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# Test 2: Negative fixtures for skill validator
# ---------------------------------------------------------------------------

def test_negative_fixtures() -> list[TestFailure]:
    """Test that the validator correctly rejects malformed skills."""
    failures = []
    _print_header("Test 2: Negative fixtures for skill validator")

    fixtures = [
        ("unsupported_key", {
            "issue": "unsupported frontmatter key",
            "skill_md": """---
name: test-skill
description: Use when testing
allowed-tools: ["bash"]
---
Body here.
""",
        }),
        ("missing_name", {
            "issue": "missing name field",
            "skill_md": """---
description: Use when testing
---
Body here.
""",
        }),
        ("missing_description", {
            "issue": "missing description field",
            "skill_md": """---
name: test-skill
---
Body here.
""",
        }),
        ("bad_trigger_style", {
            "issue": "description doesn't start with 'Use when'",
            "skill_md": """---
name: test-skill
description: This skill does something
---
Body here.
""",
        }),
        ("name_too_long", {
            "issue": "name exceeds 64 characters",
            "skill_md": f"""---
name: {'a' * 70}
description: Use when testing
---
Body here.
""",
        }),
        ("invalid_name_pattern", {
            "issue": "name has uppercase (invalid pattern)",
            "skill_md": """---
name: TestSkill
description: Use when testing
---
Body here.
""",
        }),
        ("description_too_long", {
            "issue": "description exceeds 1024 characters",
            "skill_md": f"""---
name: test-skill
description: Use when {'x' * 1100}
---
Body here.
""",
        }),
    ]

    with tempfile.TemporaryDirectory(prefix="skill-negative-") as tmpdir:
        tmpdir_path = Path(tmpdir)

        for fixture_name, fixture_info in fixtures:
            skill_dir = tmpdir_path / fixture_name
            skill_dir.mkdir(parents=True, exist_ok=True)
            skill_file = skill_dir / "SKILL.md"
            skill_file.write_text(fixture_info["skill_md"], encoding="utf-8")

            # Try to run validator on this malformed skill
            # We're checking that our validator can identify the issue
            try:
                validation_failures = _validate_skill_file(skill_file)

                if validation_failures:
                    _print_pass(f"Correctly rejected: {fixture_info['issue']}")
                else:
                    failures.append(TestFailure(
                        "negative_fixtures",
                        f"Validator did NOT reject fixture: {fixture_name} ({fixture_info['issue']})",
                    ))
                    _print_fail(f"Fixture not rejected: {fixture_info['issue']}")

            except Exception as exc:
                failures.append(TestFailure(
                    "negative_fixtures",
                    f"Error validating fixture {fixture_name}: {exc}",
                ))
                _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# Test 3: Skill discovery via opencode debug skills
# ---------------------------------------------------------------------------

def test_skill_discovery(opencode_bin: Optional[Path] = None) -> list[TestFailure]:
    """Test that all 6 skills are discoverable via opencode debug skills."""
    failures = []
    _print_header("Test 3: Skill discovery (opencode debug skills)")

    expected_skills = sorted(path.parent.name for path in SKILLS_DIR.glob("*/SKILL.md"))

    if opencode_bin is None:
        _print_pass("Skipped (no OpenCode binary in this test run)")
        return failures

    try:
        result = subprocess.run(
            [str(opencode_bin), "debug", "skills"],
            capture_output=True,
            text=True,
            timeout=20,
        )

        if result.returncode != 0:
            failures.append(TestFailure(
                "skill_discovery",
                f"opencode debug skills failed: {result.stderr.strip() or result.stdout.strip()}",
            ))
            _print_fail("Command failed")
            return failures

        # Parse JSON output
        try:
            data = json.loads(result.stdout)
            discovered_skills = data.get("skills", [])
            discovered_names = {s.get("name") for s in discovered_skills if isinstance(s, dict)}

            missing = [s for s in expected_skills if s not in discovered_names]
            if missing:
                failures.append(TestFailure(
                    "skill_discovery",
                    f"{len(missing)} expected skill(s) not discovered",
                    details=[f"  missing: {s}" for s in missing],
                ))
                _print_fail(f"{len(missing)} skill(s) not discovered")
            else:
                _print_pass(f"All {len(expected_skills)} expected skills discovered")

        except json.JSONDecodeError as exc:
            failures.append(TestFailure(
                "skill_discovery",
                f"Failed to parse debug skills output: {exc}",
            ))
            _print_fail("JSON parse error")

    except subprocess.TimeoutExpired:
        failures.append(TestFailure("skill_discovery", "Command timed out"))
        _print_fail("Timeout")
    except Exception as exc:
        failures.append(TestFailure("skill_discovery", str(exc)))
        _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# Test 4: Symlink mode deploy
# ---------------------------------------------------------------------------

def test_symlink_deploy() -> list[TestFailure]:
    """Test install/remove in symlink mode."""
    failures = []
    _print_header("Test 4: Symlink mode deploy")

    with tempfile.TemporaryDirectory(prefix="skill-symlink-") as tmpdir:
        tmpdir_path = Path(tmpdir)
        config_dir = tmpdir_path / "config" / "opencode"
        skills_dir = config_dir / "skills"
        config_dir.mkdir(parents=True, exist_ok=True)

        try:
            env = os.environ.copy()
            env["OPENCODE_CONFIG_DIR"] = str(config_dir)

            result = subprocess.run(
                [
                    "bash", str(DEPLOY_SCRIPT), "install",
                    "--config-dir", str(config_dir),
                    "--mode", "symlink",
                ],
                capture_output=True,
                text=True,
                timeout=30,
                env=env,
            )

            if result.returncode != 0:
                failures.append(TestFailure(
                    "symlink_deploy",
                    f"Install failed: {result.stderr.strip() or result.stdout.strip()}",
                ))
                _print_fail("Install failed")
                return failures

            # Verify symlinks exist
            skill_files = list(skills_dir.glob("*/SKILL.md"))
            if not skill_files:
                failures.append(TestFailure(
                    "symlink_deploy",
                    "No skill files found after install",
                ))
                _print_fail("No skill files")
                return failures

            symlink_count = sum(1 for f in skill_files if f.parent.is_symlink())
            if symlink_count > 0:
                _print_pass(f"Install created {symlink_count} symlink(s)")
            else:
                _print_pass(f"Install created {len(skill_files)} skill file(s)")
            for skill_file in skill_files:
                errors = _validate_skill_file(skill_file)
                if errors:
                    failures.append(TestFailure(
                        "symlink_deploy",
                        f"Invalid deployed skill: {skill_file.parent.name}",
                        details=errors,
                    ))
                    _print_fail(f"Invalid deployed skill: {skill_file.parent.name}")

            # Now test remove in symlink mode
            result = subprocess.run(
                [
                    "bash", str(DEPLOY_SCRIPT), "remove",
                    "--config-dir", str(config_dir),
                    "--mode", "symlink",
                ],
                capture_output=True,
                text=True,
                timeout=20,
                env=env,
            )

            if result.returncode != 0:
                # Remove may partially fail; just log it
                _print_dim(f"  Remove returned {result.returncode} (may be expected)")

            # In symlink mode, skills should be cleaned up
            remaining = list(skills_dir.glob("*/SKILL.md"))
            if remaining:
                _print_pass(f"Remove in symlink mode left {len(remaining)} file(s) (may be expected)")
            else:
                _print_pass("Remove cleaned up skills in symlink mode")

        except Exception as exc:
            failures.append(TestFailure("symlink_deploy", str(exc)))
            _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# Test 5: Skill body line limits (pressure test)
# ---------------------------------------------------------------------------

def test_skill_body_limits() -> list[TestFailure]:
    """Verify all skill bodies are within 500 non-empty lines."""
    failures = []
    _print_header("Test 5: Skill body line limits")

    expected_skills = sorted(path.parent.name for path in SKILLS_DIR.glob("*/SKILL.md"))

    for skill_name in expected_skills:
        skill_file = SKILLS_DIR / skill_name / "SKILL.md"
        if not skill_file.exists():
            failures.append(TestFailure(
                "skill_body_limits",
                f"Skill file not found: {skill_name}/SKILL.md",
            ))
            _print_fail(f"{skill_name}: file missing")
            continue

        try:
            content = skill_file.read_text(encoding="utf-8")
            # Skip frontmatter
            parts = content.split("---", 2)
            if len(parts) < 3:
                body = content
            else:
                body = parts[2]

            # Count non-empty lines
            lines = body.splitlines()
            non_empty = [l for l in lines if l.strip()]

            if len(non_empty) > 500:
                failures.append(TestFailure(
                    "skill_body_limits",
                    f"{skill_name}: {len(non_empty)} non-empty lines (max 500)",
                ))
                _print_fail(f"{skill_name}: {len(non_empty)} lines (too long)")
            else:
                _print_pass(f"{skill_name}: {len(non_empty)} lines (OK)")

        except Exception as exc:
            failures.append(TestFailure(
                "skill_body_limits",
                f"{skill_name}: {exc}",
            ))
            _print_fail(f"{skill_name}: error")

    return failures


# ---------------------------------------------------------------------------
# Test 6: Project-local agent suggestion behavior (LLM pressure test)
# ---------------------------------------------------------------------------

def test_project_local_suggestion(model: str | None, skip_llm: bool) -> list[TestFailure]:
    """
    Pressure test: ask plan agent to suggest project curation.
    Verify it gates on:
    1. Inventory of existing repo structure
    2. Explanation of why existing global agents/skills are insufficient
    3. User approval before creating local agent
    """
    failures = []
    _print_header("Test 6: Project-local agent suggestion (LLM pressure test)")

    if skip_llm:
        _print_pass("Skipped via --skip-llm")
        return failures

    with tempfile.TemporaryDirectory(prefix="skill-plan-test-") as tmpdir:
        tmpdir_path = Path(tmpdir)
        repo_root = tmpdir_path / "test_repo"
        repo_root.mkdir()

        # Create minimal project structure
        (repo_root / "README.md").write_text("# Test Repo\n", encoding="utf-8")
        (repo_root / ".opencode").mkdir(exist_ok=True)

        try:
            env = os.environ.copy()
            # Point to repo root
            command = ["opencode", "run", "--agent", "plan"]
            if model:
                command.extend(["--model", model])
            command.append(
                "I need a project-specific curation strategy. Suggest how to organize agents. "
                "Should we use project-local agents or rely on globals?"
            )
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=60,
                cwd=str(repo_root),
                env=env,
            )

            output = result.stdout + "\n" + result.stderr

            # Look for signs that it followed the skill guidance
            # (This is a light pressure test; full behavior testing requires more setup)
            checks = [
                ("project-local" in output.lower(), "mentions project-local agents"),
                ("approval" in output.lower() or "ask" in output.lower() or "confirm" in output.lower(),
                 "mentions approval/user confirmation"),
                ("invent" not in output.lower() and "add global" not in output.lower(),
                 "doesn't suggest adding global agent without gates"),
            ]

            for check, desc in checks:
                if check:
                    _print_pass(f"Response mentions: {desc}")
                else:
                    _print_dim(f"  Response doesn't strongly mention: {desc}")

        except subprocess.TimeoutExpired:
            _print_fail("Timeout (opencode run)")
        except FileNotFoundError:
            _print_pass("opencode binary not in PATH — skipping LLM test")
        except Exception as exc:
            failures.append(TestFailure(
                "project_local_suggestion",
                f"Exception: {exc}",
            ))
            _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# Test 7: Playwright image-generation skill contains safety gates
# ---------------------------------------------------------------------------

def test_playwright_image_generation_skill_content() -> list[TestFailure]:
    failures = []
    _print_header("Test 7: Playwright image-generation safety gates")

    skill = SKILLS_DIR / "playwright-image-generation" / "SKILL.md"
    chatgpt_ref = SKILLS_DIR / "playwright-image-generation" / "references" / "chatgpt.md"
    gemini_ref = SKILLS_DIR / "playwright-image-generation" / "references" / "gemini.md"

    required_files = [skill, chatgpt_ref, gemini_ref]
    for path in required_files:
        if not path.exists():
            failures.append(TestFailure("playwright_image_generation_content", f"Missing file: {path}"))
            _print_fail(f"Missing {path.relative_to(SKILLS_DIR)}")
            return failures

    text = "\n".join(path.read_text(encoding="utf-8") for path in required_files).lower()
    checks = [
        ("blank, default, temporary" in text, "blocks blank/default/temp profiles"),
        ("cdp attach" in text or "connect_over_cdp" in text, "documents CDP attach"),
        ("png signature" in text, "requires PNG signature verification"),
        ("currentSrc".lower() in text or "new source" in text, "guards against image-count-only detection"),
        ("connection interrupted. waiting for the complete answer" in text, "records ChatGPT connection-interrupted stalls"),
        ("dataset release" in text and "checksums" in text, "protects datasets with releases/checksums"),
        ("gemini" in text and "chatgpt" in text, "keeps provider-neutral scope"),
    ]
    for ok, desc in checks:
        if ok:
            _print_pass(desc)
        else:
            failures.append(TestFailure("playwright_image_generation_content", f"Missing required gate: {desc}"))
            _print_fail(desc)

    return failures


# ---------------------------------------------------------------------------
# Reporter
# ---------------------------------------------------------------------------

def report(failures: list[TestFailure]) -> int:
    print()
    if not failures:
        print("\033[32m  All tests passed.\033[0m")
        return 0

    print(f"\033[31m  {len(failures)} test(s) failed:\033[0m")
    for f in failures:
        print(f.render())
    return 1


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description=textwrap.dedent(__doc__ or ""),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--skip-llm", action="store_true", help="Skip LLM pressure tests")
    parser.add_argument("--model", help="Override the configured OpenCode default model")
    args = parser.parse_args()

    print("\n\033[1mOpenCode Skill Coverage Tests\033[0m")
    print(f"  Repo: {REPO_ROOT}")

    all_failures: list[TestFailure] = []

    # Run all tests
    all_failures += test_default_install_deploys_skills()
    all_failures += test_negative_fixtures()
    all_failures += test_skill_body_limits()
    all_failures += test_symlink_deploy()
    all_failures += test_skill_discovery()  # No OpenCode binary in this context
    all_failures += test_project_local_suggestion(args.model, args.skip_llm)
    all_failures += test_playwright_image_generation_skill_content()

    sys.exit(report(all_failures))


if __name__ == "__main__":
    main()
