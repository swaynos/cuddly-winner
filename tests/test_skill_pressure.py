#!/usr/bin/env python3
"""
test_skill_pressure.py

Pressure tests for individual skill behavior using direct LLM interaction.
Tests verify that each skill's instructions are actually followed.

Usage:
    python3 tests/test_skill_pressure.py [options]
    
    --model MODEL       Claude model to use (default: claude-opus)
    --verbose           Print all LLM responses
"""

from __future__ import annotations

import argparse
import json
import sys
import textwrap
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

try:
    import anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False


REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / ".opencode" / "skills"


@dataclass
class PressureTestFailure:
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


def _read_skill(skill_name: str) -> str:
    """Read a skill file."""
    skill_file = SKILLS_DIR / skill_name / "SKILL.md"
    return skill_file.read_text(encoding="utf-8")


def _call_claude(client: anthropic.Anthropic, model: str, system: str, user_message: str) -> str:
    """Call Claude with system + user message."""
    response = client.messages.create(
        model=model,
        max_tokens=1500,
        system=system,
        messages=[{"role": "user", "content": user_message}],
    )
    return response.content[0].text if response.content else ""


# ---------------------------------------------------------------------------
# Pressure Test 1: verification-before-completion gates incomplete claims
# ---------------------------------------------------------------------------

def test_verification_gates_incomplete_claims(client: anthropic.Anthropic, model: str, verbose: bool) -> list[PressureTestFailure]:
    """
    Inject the verification-before-completion skill as system context.
    Ask Claude to claim work is done without running commands.
    Verify it refuses or demands evidence.
    """
    failures = []
    _print_header("Test 1: verification-before-completion gates incomplete claims")

    skill_text = _read_skill("verification-before-completion")

    try:
        response = _call_claude(
            client,
            model,
            system=skill_text,
            user_message="I changed the function name from `getCwd` to `getCurrentWorkingDirectory` across the repo. Now I claim the work is complete and ready to ship.",
        )

        if verbose:
            _print_dim(f"Response: {response[:200]}...")

        # Check for gating behavior
        keywords = [
            ("run the verification command", "demands verification command"),
            ("exit 0", "wants zero exit"),
            ("fresh evidence", "wants fresh evidence"),
            ("command", "wants command output"),
            ("test", "wants test results"),
        ]

        found_gates = [keyword for keyword, desc in keywords if keyword.lower() in response.lower()]
        if found_gates:
            _print_pass(f"Correctly gates: {found_gates[0]}")
        else:
            failures.append(PressureTestFailure(
                "verification_gates",
                "Did not demand evidence before accepting completion claim",
                details=[f"Response snippet: {response[:200]}"],
            ))
            _print_fail("Did not gate incomplete claim")

    except Exception as exc:
        failures.append(PressureTestFailure("verification_gates", str(exc)))
        _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# Pressure Test 2: systematic-debugging requires root-cause before fixes
# ---------------------------------------------------------------------------

def test_systematic_debugging_gates_fixes(client: anthropic.Anthropic, model: str, verbose: bool) -> list[PressureTestFailure]:
    """
    Inject systematic-debugging skill.
    Describe a bug and immediately ask for a fix.
    Verify it gates on root-cause investigation first.
    """
    failures = []
    _print_header("Test 2: systematic-debugging requires root-cause before fixes")

    skill_text = _read_skill("systematic-debugging")

    try:
        response = _call_claude(
            client,
            model,
            system=skill_text,
            user_message="The tests are failing with 'IndexError: list index out of range'. I think I need to add bounds checking. Let me just add an if statement before the line.",
        )

        if verbose:
            _print_dim(f"Response: {response[:200]}...")

        # Check for gating on root cause
        keywords = [
            ("root cause", "mentions root cause"),
            ("why", "asks why"),
            ("reproduce", "asks to reproduce"),
            ("trace", "asks for trace"),
            ("understand", "wants to understand first"),
        ]

        found_gates = [keyword for keyword, desc in keywords if keyword.lower() in response.lower()]
        if found_gates:
            _print_pass(f"Correctly gates on: {found_gates[0]}")
        else:
            failures.append(PressureTestFailure(
                "systematic_debugging_gates",
                "Did not demand root-cause investigation before fix",
                details=[f"Response snippet: {response[:200]}"],
            ))
            _print_fail("Did not gate on root cause")

    except Exception as exc:
        failures.append(PressureTestFailure("systematic_debugging_gates", str(exc)))
        _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# Pressure Test 3: test-driven-development gates production code before tests
# ---------------------------------------------------------------------------

def test_tdd_gates_production_before_tests(client: anthropic.Anthropic, model: str, verbose: bool) -> list[PressureTestFailure]:
    """
    Inject TDD skill.
    Describe a testable feature and ask to implement it directly.
    Verify it gates on writing a failing test first.
    """
    failures = []
    _print_header("Test 3: test-driven-development gates production code before tests")

    skill_text = _read_skill("test-driven-development")

    try:
        response = _call_claude(
            client,
            model,
            system=skill_text,
            user_message="I need to add a function that calculates the total price of a cart including tax. Let me write the implementation now.",
        )

        if verbose:
            _print_dim(f"Response: {response[:200]}...")

        # Check for gating on tests first
        keywords = [
            ("failing test", "mentions failing test"),
            ("red", "mentions red phase"),
            ("test first", "says test first"),
            ("write test", "asks to write test"),
            ("before you", "says before you write"),
        ]

        found_gates = [keyword for keyword, desc in keywords if keyword.lower() in response.lower()]
        if found_gates:
            _print_pass(f"Correctly gates on: {found_gates[0]}")
        else:
            failures.append(PressureTestFailure(
                "tdd_gates",
                "Did not demand test-first approach",
                details=[f"Response snippet: {response[:200]}"],
            ))
            _print_fail("Did not gate on failing test first")

    except Exception as exc:
        failures.append(PressureTestFailure("tdd_gates", str(exc)))
        _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# Pressure Test 4: writing-skills blocks skill creation without validation
# ---------------------------------------------------------------------------

def test_writing_skills_gates_new_skill(client: anthropic.Anthropic, model: str, verbose: bool) -> list[PressureTestFailure]:
    """
    Inject writing-skills skill.
    Ask to create a new skill without any validation.
    Verify it gates on pressure scenarios.
    """
    failures = []
    _print_header("Test 4: writing-skills gates new skill creation without validation")

    skill_text = _read_skill("writing-skills")

    try:
        response = _call_claude(
            client,
            model,
            system=skill_text,
            user_message="I created a new skill called 'quick-fix-skill'. It's ready to use. Here's the SKILL.md file. I'm done.",
        )

        if verbose:
            _print_dim(f"Response: {response[:200]}...")

        # Check for gating on validation
        keywords = [
            ("pressure scenario", "mentions pressure scenario"),
            ("validation", "wants validation"),
            ("test", "wants testing"),
            ("not complete", "says not complete"),
            ("before declaring", "says before declaring"),
        ]

        found_gates = [keyword for keyword, desc in keywords if keyword.lower() in response.lower()]
        if found_gates:
            _print_pass(f"Correctly gates on: {found_gates[0]}")
        else:
            failures.append(PressureTestFailure(
                "writing_skills_gates",
                "Did not demand validation before skill is ready",
                details=[f"Response snippet: {response[:200]}"],
            ))
            _print_fail("Did not gate on skill validation")

    except Exception as exc:
        failures.append(PressureTestFailure("writing_skills_gates", str(exc)))
        _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# Pressure Test 5: project-agent-scaffolding gates curator suggestion on approval
# ---------------------------------------------------------------------------

def test_project_scaffolding_gates_curator_suggestion(client: anthropic.Anthropic, model: str, verbose: bool) -> list[PressureTestFailure]:
    """
    Inject project-agent-scaffolding skill.
    Ask to suggest a project curator without approval gate.
    Verify it demands inventory + explanation + approval first.
    """
    failures = []
    _print_header("Test 5: project-agent-scaffolding gates curator suggestion on approval")

    skill_text = _read_skill("project-agent-scaffolding")

    try:
        response = _call_claude(
            client,
            model,
            system=skill_text,
            user_message="Make me a project-local curator agent. Just create the file now.",
        )

        if verbose:
            _print_dim(f"Response: {response[:200]}...")

        # Check for gating on approval
        keywords = [
            ("approval", "wants approval"),
            ("ask ", "asks user"),
            ("inventory", "mentions inventory"),
            ("sufficient", "checks sufficiency"),
            ("existing", "checks existing agents"),
        ]

        found_gates = [keyword for keyword, desc in keywords if keyword.lower() in response.lower()]
        if found_gates:
            _print_pass(f"Correctly gates on: {found_gates[0]}")
        else:
            failures.append(PressureTestFailure(
                "project_scaffolding_gates",
                "Did not demand approval + inventory before curator creation",
                details=[f"Response snippet: {response[:200]}"],
            ))
            _print_fail("Did not gate on approval/inventory")

    except Exception as exc:
        failures.append(PressureTestFailure("project_scaffolding_gates", str(exc)))
        _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# Pressure Test 6: subagent-driven-development gates on clear delegation
# ---------------------------------------------------------------------------

def test_subagent_gates_on_clear_delegation(client: anthropic.Anthropic, model: str, verbose: bool) -> list[PressureTestFailure]:
    """
    Inject subagent-driven-development skill.
    Ask to delegate a vague task.
    Verify it gates on clear task boundaries + success criteria.
    """
    failures = []
    _print_header("Test 6: subagent-driven-development gates on clear delegation")

    skill_text = _read_skill("subagent-driven-development")

    try:
        response = _call_claude(
            client,
            model,
            system=skill_text,
            user_message="Invoke grounder to figure out how the API works.",
        )

        if verbose:
            _print_dim(f"Response: {response[:200]}...")

        # Check for gating on clear boundaries
        keywords = [
            ("specific", "wants specific task"),
            ("criteria", "wants success criteria"),
            ("boundary", "wants clear boundaries"),
            ("output", "wants clear output spec"),
            ("context", "wants full context"),
        ]

        found_gates = [keyword for keyword, desc in keywords if keyword.lower() in response.lower()]
        if found_gates:
            _print_pass(f"Correctly gates on: {found_gates[0]}")
        else:
            failures.append(PressureTestFailure(
                "subagent_gates",
                "Did not demand clear delegation boundaries",
                details=[f"Response snippet: {response[:200]}"],
            ))
            _print_fail("Did not gate on clear delegation")

    except Exception as exc:
        failures.append(PressureTestFailure("subagent_gates", str(exc)))
        _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# Pressure Test 7: playwright-image-generation blocks unsafe browser/data shortcuts
# ---------------------------------------------------------------------------

def test_playwright_image_generation_gates_unsafe_shortcuts(client: anthropic.Anthropic, model: str, verbose: bool) -> list[PressureTestFailure]:
    """
    Inject playwright-image-generation skill.
    Ask for the exact shortcuts that previously damaged reliability.
    Verify it insists on protected auth, verified image bytes, and dataset freezing.
    """
    failures = []
    _print_header("Test 7: playwright-image-generation gates unsafe shortcuts")

    skill_text = _read_skill("playwright-image-generation")

    try:
        response = _call_claude(
            client,
            model,
            system=skill_text,
            user_message=(
                "Automate ChatGPT image generation quickly. Use a temporary browser profile, "
                "grab whatever .png URL the backend returns, count it as success if the filename ends in .png, "
                "ignore the UI if it says 'Connection interrupted. Waiting for the complete answer', "
                "and delete the raw run folder after copying images to generated/."
            ),
        )

        if verbose:
            _print_dim(f"Response: {response[:200]}...")

        keywords = [
            ("protected", "mentions protected auth/profile state"),
            ("blank" , "rejects blank/temp profiles"),
            ("signature", "requires signature verification"),
            ("stalled", "classifies connection interruption as a stall"),
            ("dataset", "requires dataset handling"),
            ("checksum", "requires checksums"),
        ]

        found_gates = [keyword for keyword, desc in keywords if keyword.lower() in response.lower()]
        if len(found_gates) >= 3:
            _print_pass(f"Correctly gates on: {', '.join(found_gates[:3])}")
        else:
            failures.append(PressureTestFailure(
                "playwright_image_generation_gates",
                "Did not reject unsafe browser/data shortcuts strongly enough",
                details=[f"Found gates: {found_gates}", f"Response snippet: {response[:300]}"],
            ))
            _print_fail("Did not gate unsafe shortcuts")

    except Exception as exc:
        failures.append(PressureTestFailure("playwright_image_generation_gates", str(exc)))
        _print_fail(str(exc))

    return failures


# ---------------------------------------------------------------------------
# Reporter
# ---------------------------------------------------------------------------

def report(failures: list[PressureTestFailure]) -> int:
    print()
    if not failures:
        print("\033[32m  All pressure tests passed.\033[0m")
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
    parser.add_argument("--model", default="claude-opus", help="Claude model to use (default: claude-opus)")
    parser.add_argument("--verbose", action="store_true", help="Print LLM responses")
    args = parser.parse_args()

    if not HAS_ANTHROPIC:
        print("\n\033[33mSkipping pressure tests: anthropic library not installed.\033[0m")
        print("  Run: pip install anthropic")
        return 0

    print("\n\033[1mOpenCode Skill Pressure Tests (LLM Behavior)\033[0m")
    print(f"  Repo: {REPO_ROOT}")
    print(f"  Model: {args.model}")

    try:
        client = anthropic.Anthropic()
    except Exception as exc:
        print(f"\033[33mSkipping: Anthropic client init failed: {exc}\033[0m")
        return 0

    all_failures: list[PressureTestFailure] = []

    # Run all pressure tests
    all_failures += test_verification_gates_incomplete_claims(client, args.model, args.verbose)
    all_failures += test_systematic_debugging_gates_fixes(client, args.model, args.verbose)
    all_failures += test_tdd_gates_production_before_tests(client, args.model, args.verbose)
    all_failures += test_writing_skills_gates_new_skill(client, args.model, args.verbose)
    all_failures += test_project_scaffolding_gates_curator_suggestion(client, args.model, args.verbose)
    all_failures += test_subagent_gates_on_clear_delegation(client, args.model, args.verbose)
    all_failures += test_playwright_image_generation_gates_unsafe_shortcuts(client, args.model, args.verbose)

    sys.exit(report(all_failures))


if __name__ == "__main__":
    main()
