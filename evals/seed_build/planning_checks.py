"""Mechanical scorer for the canonical Prometheus SPEC contract."""
from __future__ import annotations

import re
from dataclasses import dataclass, field


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
        return all(check.passed for check in self.checks)

    @property
    def score(self) -> float:
        return sum(check.passed for check in self.checks) / len(self.checks) if self.checks else 0.0

    def render(self) -> str:
        return "\n".join(
            [f"Planning quality score: {self.score:.0%}  ({'PASS' if self.passed else 'FAIL'})"]
            + [f"  {'PASS' if check.passed else 'FAIL'} {check.name}: {check.evidence or check.note}" for check in self.checks]
        )


SECTIONS = (
    "Grounding",
    "Approaches Considered",
    "Acceptance Criteria",
    "Verification",
    "Implementation Checklist",
)


def _section(text: str, heading: str) -> str:
    match = re.search(rf"^## {re.escape(heading)}\s*$", text, re.M)
    if not match:
        return ""
    following = re.search(r"^##\s", text[match.end():], re.M)
    end = match.end() + following.start() if following else len(text)
    return text[match.end():end]


def score_spec(text: str) -> PlanningReport:
    report = PlanningReport()
    counts = {heading: len(re.findall(rf"^## {re.escape(heading)}\s*$", text, re.M)) for heading in SECTIONS}
    report.checks.append(PlanningCheck(
        "Canonical section structure",
        all(count == 1 for count in counts.values()),
        evidence=str(counts),
        note="Every canonical section must appear exactly once.",
    ))

    grounding = _section(text, "Grounding").strip()
    report.checks.append(PlanningCheck(
        "Grounded repository evidence",
        len(grounding) >= 80,
        evidence=f"{len(grounding)} characters",
        note="Grounding must contain substantive evidence.",
    ))

    approaches = _section(text, "Approaches Considered")
    headings = re.findall(r"^###\s+.+$", approaches, re.M)
    has_selection = bool(re.search(r"selected|chosen", approaches, re.I))
    has_rejection = bool(re.search(r"rejected", approaches, re.I))
    has_kill_reason = bool(re.search(r"kill reason|kill criterion|rejected because|reason:|rejected\b.{20,}", approaches, re.I | re.S))
    report.checks.append(PlanningCheck(
        "Approach comparison and kill reasons",
        len(headings) >= 2 and has_selection and has_rejection and has_kill_reason,
        evidence=f"{len(headings)} approaches",
        note="Need at least two approaches, a selection, and a concrete rejection reason.",
    ))

    acceptance = _section(text, "Acceptance Criteria")
    criteria = re.findall(r"^\s*(?:\d+\.|-)\s+\S", acceptance, re.M)
    placeholders = re.search(r"\b(?:TBD|TODO|to be determined|placeholder)\b", acceptance, re.I)
    report.checks.append(PlanningCheck(
        "Objective acceptance criteria",
        len(criteria) >= 3 and not placeholders,
        evidence=f"{len(criteria)} criteria",
        note="Need at least three placeholder-free list criteria.",
    ))

    verification = _section(text, "Verification")
    commands = re.findall(r"^- `([^`\n]+)`\s*$", verification, re.M)
    malformed = [line for line in verification.splitlines() if line.startswith("- ") and not re.fullmatch(r"- `[^`\n]+`", line)]
    report.checks.append(PlanningCheck(
        "Exact verification commands",
        bool(commands) and len(commands) == len(set(commands)) and not malformed,
        evidence=f"{len(commands)} unique commands",
        note="Verification must contain unique exact command items.",
    ))

    checklist = _section(text, "Implementation Checklist")
    items = re.findall(r"^- \[ \]\s+\S", checklist, re.M)
    report.checks.append(PlanningCheck(
        "Executable implementation checklist",
        len(items) >= 3,
        evidence=f"{len(items)} unchecked items",
        note="Need at least three unchecked implementation items.",
    ))

    footer = "Invoke @autonomous to execute SPEC.md."
    report.checks.append(PlanningCheck(
        "Exact Autonomous handoff",
        text.rstrip().endswith(footer) and text.count(footer) == 1,
        evidence=footer,
        note="SPEC must end with the exact handoff sentence.",
    ))
    return report
