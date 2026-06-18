#!/usr/bin/env python3
"""Run the deterministic agent-value benchmark."""

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import mocks
import score


ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / "fixtures"
GOLDEN = ROOT / "golden" / "expected_outcomes.json"


def load_fixtures() -> list[dict]:
    fixtures = []
    for path in sorted(FIXTURES.glob("*.json")):
        fixtures.append(json.loads(path.read_text(encoding="utf-8")))
    if not fixtures:
        raise RuntimeError(f"no fixtures found under {FIXTURES}")
    return fixtures


def load_golden() -> dict:
    if not GOLDEN.exists():
        raise RuntimeError(f"missing golden expectations: {GOLDEN}")
    return json.loads(GOLDEN.read_text(encoding="utf-8"))


def validate_golden(raw: dict) -> None:
    golden = load_golden()
    task_ids = {task["id"] for task in raw["tasks"]}
    required = set(golden.get("required_fixture_ids", []))
    missing = sorted(required - task_ids)
    if missing:
        raise RuntimeError(f"benchmark missing required fixture ids: {', '.join(missing)}")

    minimum_count = int(golden.get("minimum_fixture_count", 0))
    if len(task_ids) < minimum_count:
        raise RuntimeError(f"benchmark has {len(task_ids)} fixtures, expected at least {minimum_count}")

    minimum_score = float(golden.get("minimum_agent_value_score", 0))
    if float(raw["agent_value_score"]) < minimum_score:
        raise RuntimeError(
            f"agent_value_score {raw['agent_value_score']:.6f} below minimum {minimum_score:.6f}"
        )

    if raw.get("has_enhanced_hard_safety_failure"):
        failures = ", ".join(raw.get("enhanced_hard_safety_failures", []))
        raise RuntimeError(f"enhanced workflow has hard safety failures: {failures}")

    if "enhanced_score_gt_baseline_score" in golden.get("expected_relationships", []):
        if float(raw["enhanced_score"]) <= float(raw["baseline_score"]):
            raise RuntimeError("golden relationship failed: enhanced_score_gt_baseline_score")

    dimension_names = set(golden.get("dimensions", []))
    observed_dimensions = set()
    for task in raw["tasks"]:
        observed_dimensions.update(task["baseline_dimensions"].keys())
        observed_dimensions.update(task["enhanced_dimensions"].keys())
    missing_dimensions = sorted(dimension_names - observed_dimensions)
    if missing_dimensions:
        raise RuntimeError(f"golden dimensions were not observed: {', '.join(missing_dimensions)}")


def write_workspace_probe(workspace: Path, fixture: dict, workflow: str, artifacts: dict) -> None:
    run_dir = workspace / workflow / fixture["id"]
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "task.json").write_text(json.dumps(fixture, indent=2), encoding="utf-8")
    (run_dir / "artifacts.json").write_text(json.dumps(artifacts, indent=2), encoding="utf-8")
    (run_dir / "transcript.txt").write_text(str(artifacts.get("transcript", "")), encoding="utf-8")


def run_mock(out: Path) -> dict:
    fixtures = load_fixtures()
    workspace = Path(tempfile.mkdtemp(prefix="agent-value-benchmark-"))
    tasks = []
    try:
        for fixture in fixtures:
            baseline = mocks.build_artifacts(fixture["id"], "baseline")
            enhanced = mocks.build_artifacts(fixture["id"], "enhanced")
            write_workspace_probe(workspace, fixture, "baseline", baseline)
            write_workspace_probe(workspace, fixture, "enhanced", enhanced)
            baseline_scored = score.score_workflow(baseline)
            enhanced_scored = score.score_workflow(enhanced)
            tasks.append(
                {
                    "id": fixture["id"],
                    "title": fixture["title"],
                    "category": fixture["category"],
                    "baseline_artifacts": baseline,
                    "enhanced_artifacts": enhanced,
                    "baseline_score": baseline_scored["score"],
                    "enhanced_score": enhanced_scored["score"],
                    "baseline_dimensions": baseline_scored["dimensions"],
                    "enhanced_dimensions": enhanced_scored["dimensions"],
                    "baseline_hard_safety_failure": baseline_scored["hard_safety_failure"],
                    "enhanced_hard_safety_failure": enhanced_scored["hard_safety_failure"],
                    "score_delta": round(enhanced_scored["score"] - baseline_scored["score"], 6),
                    "reasons": {
                        "baseline_failed_dimensions": baseline_scored["failed_dimensions"],
                        "enhanced_failed_dimensions": enhanced_scored["failed_dimensions"],
                    },
                }
            )

        raw = {
            "schema_version": 1,
            "mode": "mock",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "workspace_retained": False,
            "tasks": tasks,
        }
        aggregate = score.score_results(raw)
        raw.update(
            baseline_score=aggregate["baseline_score"],
            enhanced_score=aggregate["enhanced_score"],
            agent_value_score=aggregate["agent_value_score"],
            enhanced_hard_safety_failures=aggregate["enhanced_hard_safety_failures"],
            has_enhanced_hard_safety_failure=aggregate["has_enhanced_hard_safety_failure"],
        )
        validate_golden(raw)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(raw, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return raw
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["mock", "live"], default="mock")
    parser.add_argument("--out", required=True, help="Output JSON path")
    args = parser.parse_args()

    if args.mode == "live":
        raise SystemExit("live mode is intentionally not enabled by default; use mock mode")
    result = run_mock(Path(args.out))
    print(
        "agent_value_score={agent_value_score:.6f} baseline_score={baseline_score:.6f} enhanced_score={enhanced_score:.6f}".format(
            **result
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
