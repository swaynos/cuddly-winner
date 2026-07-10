#!/usr/bin/env python3
"""
Plan-outcome scorer.

Reads .opencode/plan-outcomes.jsonl and produces a per-spec-hash quality
report.  Each record in the ledger is written by the gate plugin whenever a
session crosses a scoreable event:

  COMPLETE          — plan reached accepted completion
  COMPLETE_REJECTED — COMPLETE attempt was rejected (iterating)
  WORK_STUCK        — implementation got stuck
  BLOCKED           — environment limitation (not plan quality)
  REQUEST_CHANGES   — reviewer found issues with the implementation
  SPEC_REVISED      — SPEC.md was edited after initial Prometheus payload

Scoring per spec_hash
---------------------
  plan_converged      bool  — terminal event was COMPLETE
  plan_stuck          bool  — at least one WORK_STUCK recorded
  plan_required_rework bool — at least one REQUEST_CHANGES recorded
  plan_required_revision bool — at least one SPEC_REVISED recorded
  rejection_count     int   — number of COMPLETE_REJECTED events
  plan_quality_score  float — composite 0.0–1.0 (higher is better)

plan_quality_score formula:
  start at 1.0
  -0.25 if not converged
  -0.15 per WORK_STUCK
  -0.10 per REQUEST_CHANGES
  -0.10 per SPEC_REVISED
  -0.05 per COMPLETE_REJECTED (capped at 3)
  clamped to [0.0, 1.0]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


def load_ledger(ledger_path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if not ledger_path.exists():
        return records
    for line in ledger_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return records


def score_plan(records: list[dict[str, Any]]) -> dict[str, Any]:
    events = [r["event"] for r in records]

    converged = "COMPLETE" in events
    stuck = "WORK_STUCK" in events
    rework = "REQUEST_CHANGES" in events
    revision = "SPEC_REVISED" in events
    rejection_count = events.count("COMPLETE_REJECTED")

    quality = 1.0
    if not converged:
        quality -= 0.25
    quality -= 0.15 * events.count("WORK_STUCK")
    quality -= 0.10 * events.count("REQUEST_CHANGES")
    quality -= 0.10 * events.count("SPEC_REVISED")
    quality -= 0.05 * min(rejection_count, 3)
    quality = max(0.0, min(1.0, quality))

    return {
        "plan_converged": converged,
        "plan_stuck": stuck,
        "plan_required_rework": rework,
        "plan_required_revision": revision,
        "rejection_count": rejection_count,
        "plan_quality_score": round(quality, 4),
        "event_count": len(records),
    }


def score_ledger(ledger_path: Path) -> dict[str, Any]:
    records = load_ledger(ledger_path)

    by_hash: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in records:
        key = r.get("spec_hash") or "__unkeyed__"
        by_hash[key].append(r)

    plans = {}
    for spec_hash, plan_records in sorted(by_hash.items()):
        plans[spec_hash] = score_plan(plan_records)

    if not plans:
        return {
            "plans": {},
            "summary": {
                "total_plans": 0,
                "converged": 0,
                "stuck": 0,
                "mean_quality_score": None,
            },
        }

    scores = [p["plan_quality_score"] for p in plans.values()]
    return {
        "plans": plans,
        "summary": {
            "total_plans": len(plans),
            "converged": sum(1 for p in plans.values() if p["plan_converged"]),
            "stuck": sum(1 for p in plans.values() if p["plan_stuck"]),
            "mean_quality_score": round(sum(scores) / len(scores), 4),
        },
    }


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

def _self_test() -> None:
    import tempfile
    import os

    def make_ledger(events: list[tuple[str, str | None]]) -> list[dict[str, Any]]:
        return [
            {"ts": "2026-01-01T00:00:00Z", "session_id": "s1", "spec_hash": spec_hash, "event": ev, "detail": ""}
            for ev, spec_hash in events
        ]

    failures: list[str] = []

    def check(name: str, condition: bool, msg: str = "") -> None:
        if not condition:
            failures.append(f"FAIL [{name}]{': ' + msg if msg else ''}")

    # Case 1: clean completion
    records = make_ledger([("COMPLETE", "abc")])
    result = score_plan(records)
    check("clean_complete/converged", result["plan_converged"])
    check("clean_complete/not_stuck", not result["plan_stuck"])
    check("clean_complete/quality_1.0", result["plan_quality_score"] == 1.0)

    # Case 2: stuck then complete
    records = make_ledger([("WORK_STUCK", "abc"), ("COMPLETE", "abc")])
    result = score_plan(records)
    check("stuck_then_complete/converged", result["plan_converged"])
    check("stuck_then_complete/stuck", result["plan_stuck"])
    check("stuck_then_complete/quality_lt_1", result["plan_quality_score"] < 1.0)
    check("stuck_then_complete/quality_gte_0.8", result["plan_quality_score"] >= 0.8,
          f"got {result['plan_quality_score']}")

    # Case 3: never completed
    records = make_ledger([("WORK_STUCK", "abc"), ("COMPLETE_REJECTED", "abc")])
    result = score_plan(records)
    check("no_complete/not_converged", not result["plan_converged"])
    check("no_complete/quality_lt_0.65", result["plan_quality_score"] < 0.65)

    # Case 4: REQUEST_CHANGES penalised
    records = make_ledger([("REQUEST_CHANGES", "abc"), ("COMPLETE", "abc")])
    result = score_plan(records)
    check("rework/rework_flag", result["plan_required_rework"])
    check("rework/quality_lt_1", result["plan_quality_score"] < 1.0)

    # Case 5: SPEC_REVISED penalised
    records = make_ledger([("SPEC_REVISED", "abc"), ("COMPLETE", "abc")])
    result = score_plan(records)
    check("spec_revised/revision_flag", result["plan_required_revision"])
    check("spec_revised/quality_lt_1", result["plan_quality_score"] < 1.0)

    # Case 6: multi-plan ledger via file
    with tempfile.TemporaryDirectory() as tmp:
        ledger_path = Path(tmp) / ".opencode" / "plan-outcomes.jsonl"
        ledger_path.parent.mkdir(parents=True)
        lines = [
            json.dumps({"ts": "2026-01-01T00:00:00Z", "session_id": "s1", "spec_hash": "hash1", "event": "COMPLETE", "detail": ""}),
            json.dumps({"ts": "2026-01-01T00:00:01Z", "session_id": "s2", "spec_hash": "hash2", "event": "WORK_STUCK", "detail": ""}),
        ]
        ledger_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        report = score_ledger(ledger_path)
        check("multi_plan/total", report["summary"]["total_plans"] == 2)
        check("multi_plan/converged", report["summary"]["converged"] == 1)
        check("multi_plan/mean_score_present", report["summary"]["mean_quality_score"] is not None)

    # Case 7: empty ledger
    with tempfile.TemporaryDirectory() as tmp:
        ledger_path = Path(tmp) / ".opencode" / "plan-outcomes.jsonl"
        report = score_ledger(ledger_path)
        check("empty/no_plans", report["summary"]["total_plans"] == 0)
        check("empty/mean_none", report["summary"]["mean_quality_score"] is None)

    if failures:
        for f in failures:
            print(f, file=sys.stderr)
        sys.exit(1)

    print(f"self-test: {7} cases OK")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Score plan outcomes from the gate ledger")
    parser.add_argument(
        "--ledger",
        default=".opencode/plan-outcomes.jsonl",
        help="Path to the JSONL ledger (default: .opencode/plan-outcomes.jsonl)",
    )
    parser.add_argument("--self-test", action="store_true", help="Run built-in self-tests and exit")
    parser.add_argument("--json", action="store_true", help="Output raw JSON (default: human-readable)")
    args = parser.parse_args()

    if args.self_test:
        _self_test()
        return

    ledger_path = Path(args.ledger)
    report = score_ledger(ledger_path)

    if args.json:
        print(json.dumps(report, indent=2))
        return

    s = report["summary"]
    print(f"Plans scored : {s['total_plans']}")
    if s["total_plans"] == 0:
        print("No outcome records found.")
        return
    print(f"Converged    : {s['converged']}/{s['total_plans']}")
    print(f"Stuck        : {s['stuck']}/{s['total_plans']}")
    print(f"Mean quality : {s['mean_quality_score']:.4f}")
    print()
    for spec_hash, plan in sorted(report["plans"].items()):
        flags = []
        if plan["plan_converged"]:
            flags.append("COMPLETE")
        if plan["plan_stuck"]:
            flags.append("STUCK")
        if plan["plan_required_rework"]:
            flags.append("REWORK")
        if plan["plan_required_revision"]:
            flags.append("REVISED")
        tag = ", ".join(flags) if flags else "no terminal event"
        print(f"  {spec_hash[:16]}  score={plan['plan_quality_score']:.4f}  [{tag}]")


if __name__ == "__main__":
    main()
