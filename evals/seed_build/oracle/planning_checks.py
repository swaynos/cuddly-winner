"""
evals/seed_build/oracle/planning_checks.py

Mechanical scorer for a Prometheus-produced SPEC.md.

Checks the SPEC text against the contract from agents/prometheus.md:
  - Scope narrowing: UI/email/DB is in non-goals or absent from goals
  - >=2 distinct approaches with concrete kill-reasons
  - An explicit security/authorization constraint
  - Objective, placeholder-free acceptance criteria
  - Exactly one <spec …> payload (the payload itself, not the framing prose)
  - A strategy directive (## Autonomous Strategy or strategy: field)

Usage:
    python3 evals/seed_build/oracle/planning_checks.py <path/to/SPEC.md>

Exits 0 if all checks pass, 1 if any fail.
Also importable: call score_spec(text) -> PlanningReport.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class PlanningCheck:
    name: str
    passed: bool
    evidence: str = ""
    note: str = ""


@dataclass
class PlanningReport:
    checks: list[PlanningCheck] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checks)

    @property
    def score(self) -> float:
        if not self.checks:
            return 0.0
        return sum(1 for c in self.checks if c.passed) / len(self.checks)

    def render(self) -> str:
        lines = [f"Planning quality score: {self.score:.0%}  ({'PASS' if self.passed else 'FAIL'})"]
        for c in self.checks:
            mark = "✓" if c.passed else "✗"
            lines.append(f"  {mark} {c.name}")
            if not c.passed and c.note:
                lines.append(f"      → {c.note}")
            if c.evidence:
                lines.append(f"      evidence: {c.evidence[:120]}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------

# Out-of-scope patterns that should appear in Non-goals or be absent from Goals
_OUT_OF_SCOPE_TERMS = [
    r"\bUI\b", r"\bGUI\b", r"user interface", r"visual", r"frontend",
    r"\bemail\b", r"\bwebhook\b", r"\bSMTP\b",
    r"\bdatabase\b", r"\bDB\b", r"\bpersisten", r"\bSQL\b", r"\bORM\b",
    r"\bHTTP\b", r"\bREST\b", r"\bAPI server\b", r"\bFlask\b", r"\bFastAPI\b",
]


def _check_scope_narrowing(text: str) -> PlanningCheck:
    """
    Scope is considered narrowed if SaaS/UI/email/DB terms appear in
    Non-goals or are absent from Goals entirely.
    """
    non_goals_m = re.search(
        r"##\s*Non.?goals?\b(.*?)(?=\n##(?!#)|\Z)", text, re.S | re.I
    )
    non_goals_text = non_goals_m.group(1) if non_goals_m else ""

    goals_m = re.search(r"##\s*Goals?\b(.*?)(?=\n##(?!#)|\Z)", text, re.S | re.I)
    goals_text = goals_m.group(1) if goals_m else ""

    scope_terms_in_non_goals = [
        t for t in _OUT_OF_SCOPE_TERMS
        if re.search(t, non_goals_text, re.I)
    ]
    scope_terms_in_goals = [
        t for t in _OUT_OF_SCOPE_TERMS
        if re.search(t, goals_text, re.I)
    ]

    if scope_terms_in_non_goals:
        return PlanningCheck(
            name="Scope narrowing",
            passed=True,
            evidence=f"Non-goals mentions: {scope_terms_in_non_goals[:3]}",
        )
    if not scope_terms_in_goals:
        return PlanningCheck(
            name="Scope narrowing",
            passed=True,
            evidence="UI/email/DB terms absent from Goals (implicitly out of scope)",
        )
    return PlanningCheck(
        name="Scope narrowing",
        passed=False,
        note="Goals mention UI/email/DB but Non-goals does not exclude them. "
             "Prometheus must narrow the scope of 'workflow automation tool' "
             "to a tractable core.",
        evidence=f"Goals terms not excluded: {scope_terms_in_goals[:3]}",
    )


def _check_approaches_with_kill_reasons(text: str) -> PlanningCheck:
    approaches_section = re.search(
        r"##\s*Approaches?\s+Considered\b(.*?)(?=\n##(?!#)|\Z)", text, re.S | re.I
    )
    if not approaches_section:
        return PlanningCheck(
            name=">=2 distinct approaches with kill-reasons",
            passed=False,
            note="No '## Approaches Considered' section found.",
        )

    body = approaches_section.group(1)
    # Count Approach headings
    approach_headings = re.findall(r"###\s+Approach\s+\d+", body, re.I)
    if len(approach_headings) < 2:
        return PlanningCheck(
            name=">=2 distinct approaches with kill-reasons",
            passed=False,
            note=f"Found {len(approach_headings)} approach(es); need >=2.",
            evidence=str(approach_headings),
        )

    # Check for kill-reasons on rejected approaches
    rejected_blocks = re.findall(
        r"Status.*?Rejected(.*?)(?=###\s+Approach|\Z)", body, re.S | re.I
    )
    kill_reasons_present = [
        b for b in rejected_blocks
        if re.search(r"kill.?reason|rejected|why it", b, re.I)
    ]
    if not kill_reasons_present:
        return PlanningCheck(
            name=">=2 distinct approaches with kill-reasons",
            passed=False,
            note="Rejected approaches found but no concrete kill-reasons.",
        )

    return PlanningCheck(
        name=">=2 distinct approaches with kill-reasons",
        passed=True,
        evidence=f"{len(approach_headings)} approaches, {len(kill_reasons_present)} with kill-reasons",
    )


_AUTH_TERMS = [
    r"auth", r"authoriz", r"owner", r"ownership", r"permission",
    r"access control", r"IDOR", r"user_id", r"credential",
]


def _check_security_constraint(text: str) -> PlanningCheck:
    """Security/authorization must appear in Constraints or Acceptance Criteria."""
    constraints_m = re.search(
        r"##\s*Constraints?\b(.*?)(?=\n##(?!#)|\Z)", text, re.S | re.I
    )
    criteria_m = re.search(
        r"##\s*Acceptance\s+Criteria?\b(.*?)(?=\n##(?!#)|\Z)", text, re.S | re.I
    )

    combined = (constraints_m.group(1) if constraints_m else "") + \
               (criteria_m.group(1) if criteria_m else "")

    for term in _AUTH_TERMS:
        if re.search(term, combined, re.I):
            return PlanningCheck(
                name="Explicit security/authorization constraint",
                passed=True,
                evidence=f"'{term}' found in Constraints or Acceptance Criteria",
            )

    return PlanningCheck(
        name="Explicit security/authorization constraint",
        passed=False,
        note="No ownership/authorization constraint found. "
             "The critical path (who can evaluate which rules) must be explicit.",
    )


_PLACEHOLDER_PATTERNS = [
    r"\bTBD\b", r"\bTODO\b", r"\bfill in\b", r"\bto be determined\b",
    r"\bplaceholder\b", r"\[.*?\]",  # bracketed placeholders
]


def _check_objective_criteria(text: str) -> PlanningCheck:
    criteria_m = re.search(
        r"##\s*Acceptance\s+Criteria?\b(.*?)(?=\n##(?!#)|\Z)", text, re.S | re.I
    )
    if not criteria_m:
        return PlanningCheck(
            name="Objective placeholder-free acceptance criteria",
            passed=False,
            note="No '## Acceptance Criteria' section found.",
        )

    body = criteria_m.group(1)

    # Must have at least 3 numbered items
    numbered = re.findall(r"^\s*\d+\.", body, re.M)
    if len(numbered) < 3:
        return PlanningCheck(
            name="Objective placeholder-free acceptance criteria",
            passed=False,
            note=f"Only {len(numbered)} numbered criteria; need >=3 specific, testable items.",
        )

    # Check for placeholders
    for pat in _PLACEHOLDER_PATTERNS:
        m = re.search(pat, body, re.I)
        if m:
            return PlanningCheck(
                name="Objective placeholder-free acceptance criteria",
                passed=False,
                note=f"Placeholder found: '{m.group(0)}' — all criteria must be specific.",
            )

    return PlanningCheck(
        name="Objective placeholder-free acceptance criteria",
        passed=True,
        evidence=f"{len(numbered)} numbered criteria, no placeholders",
    )


def _check_single_payload(text: str) -> PlanningCheck:
    """The SPEC text should describe or contain a complete payload block."""
    # A Prometheus-produced SPEC is itself the payload content (already extracted).
    # We check that it looks like a complete spec (has Problem + Goals + Verification).
    required_sections = ["## Problem", "## Goals", "## Verification"]
    missing = [s for s in required_sections if s.lower() not in text.lower()]
    if missing:
        return PlanningCheck(
            name="Single complete SPEC payload",
            passed=False,
            note=f"Missing required sections: {missing}",
        )
    return PlanningCheck(
        name="Single complete SPEC payload",
        passed=True,
        evidence="All required SPEC sections present",
    )


def _check_strategy_directive(text: str) -> PlanningCheck:
    strategy_patterns = [
        r"##\s*Autonomous\s+Strategy",
        r"strategy\s*:\s*(karpathy|direct)",
    ]
    for pat in strategy_patterns:
        if re.search(pat, text, re.I):
            m = re.search(pat, text, re.I)
            return PlanningCheck(
                name="Strategy directive present",
                passed=True,
                evidence=m.group(0)[:80],
            )
    return PlanningCheck(
        name="Strategy directive present",
        passed=False,
        note="No '## Autonomous Strategy' section or 'strategy: <value>' field found.",
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def score_spec(text: str) -> PlanningReport:
    report = PlanningReport()
    report.checks.append(_check_scope_narrowing(text))
    report.checks.append(_check_approaches_with_kill_reasons(text))
    report.checks.append(_check_security_constraint(text))
    report.checks.append(_check_objective_criteria(text))
    report.checks.append(_check_single_payload(text))
    report.checks.append(_check_strategy_directive(text))
    return report


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 planning_checks.py <path/to/SPEC.md>")
        sys.exit(2)

    text = Path(sys.argv[1]).read_text(encoding="utf-8")
    report = score_spec(text)
    print(report.render())
    sys.exit(0 if report.passed else 1)
