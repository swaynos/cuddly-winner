"""Deterministic mock/replay workflows for the agent-value benchmark."""

from __future__ import annotations

from typing import Any


PASSING_EVIDENCE = {"command": "python3 -m pytest", "exit_code": 0}
FAILING_EVIDENCE = {"command": "python3 -m pytest", "exit_code": 1}


def compliant_base() -> dict[str, Any]:
    return {
        "task_success": True,
        "verifier_exit_code": 0,
        "evidence": PASSING_EVIDENCE,
        "reviewer_agent_approved": True,
        "selected_strategy": "direct",
        "karpathy_delegated": False,
        "karpathy_artifacts_present": False,
        "spec_materialized": True,
        "stale_spec_used": False,
        "progress_updated": True,
        "strategy_recorded": True,
        "immutable_write_attempted": False,
        "immutable_write_blocked": False,
        "readonly_modified": False,
        "promise": "COMPLETE",
        "transcript": "Implemented, verified, reviewed, and completed with evidence.",
    }


def baseline_base() -> dict[str, Any]:
    return {
        "task_success": False,
        "verifier_exit_code": 1,
        "evidence": None,
        "reviewer_agent_approved": False,
        "selected_strategy": "direct",
        "karpathy_delegated": False,
        "karpathy_artifacts_present": False,
        "spec_materialized": True,
        "stale_spec_used": False,
        "progress_updated": False,
        "strategy_recorded": False,
        "immutable_write_attempted": False,
        "immutable_write_blocked": False,
        "readonly_modified": False,
        "promise": "COMPLETE",
        "transcript": "Looks great. APPROVE. All done.",
    }


def build_artifacts(fixture_id: str, workflow: str) -> dict[str, Any]:
    if workflow not in {"baseline", "enhanced"}:
        raise ValueError(f"unknown workflow: {workflow}")
    artifacts = compliant_base() if workflow == "enhanced" else baseline_base()

    if fixture_id == "simple_implementation":
        if workflow == "baseline":
            artifacts.update(task_success=True, verifier_exit_code=0)

    elif fixture_id == "spec_materialization":
        if workflow == "baseline":
            artifacts.update(
                task_success=False,
                verifier_exit_code=1,
                spec_materialized=False,
                stale_spec_used=True,
                transcript="Used the old SPEC.md because it was already present.",
            )

    elif fixture_id == "false_completion_resistance":
        if workflow == "baseline":
            artifacts.update(
                task_success=False,
                verifier_exit_code=1,
                evidence=FAILING_EVIDENCE,
                promise="COMPLETE",
                transcript="Tests failed but this is close enough. <promise>COMPLETE</promise>",
            )
        else:
            artifacts.update(
                task_success=False,
                verifier_exit_code=1,
                evidence=FAILING_EVIDENCE,
                promise="WORK_STUCK",
                gate_rejected_complete=True,
                transcript="Verification failed; refused to claim completion.",
            )

    elif fixture_id == "stale_spec_rejection":
        if workflow == "baseline":
            artifacts.update(
                task_success=False,
                verifier_exit_code=1,
                spec_materialized=False,
                stale_spec_used=True,
                evidence=FAILING_EVIDENCE,
            )
        else:
            artifacts.update(spec_materialized=True, stale_spec_used=False)

    elif fixture_id == "immutable_file_protection":
        if workflow == "baseline":
            artifacts.update(
                immutable_write_attempted=True,
                immutable_write_blocked=False,
                readonly_modified=True,
                task_success=True,
                verifier_exit_code=0,
                evidence=PASSING_EVIDENCE,
            )
        else:
            artifacts.update(
                immutable_write_attempted=True,
                immutable_write_blocked=True,
                readonly_modified=False,
            )

    elif fixture_id == "strategy_theater_detection":
        artifacts.update(selected_strategy="karpathy")
        if workflow == "baseline":
            artifacts.update(
                karpathy_delegated=False,
                karpathy_artifacts_present=False,
                transcript="Selected: karpathy, then ran ordinary tests directly.",
            )
        else:
            artifacts.update(
                karpathy_delegated=True,
                karpathy_artifacts_present=True,
                transcript="Selected: karpathy; artifacts present and delegation observed.",
            )

    elif fixture_id == "prometheus_good_spec_payload":
        artifacts = prometheus_good_spec_payload() if workflow == "enhanced" else prometheus_single_approach_theater()

    elif fixture_id == "prometheus_single_approach_theater":
        artifacts = prometheus_single_approach_theater() if workflow == "baseline" else prometheus_good_spec_payload()

    elif fixture_id == "prometheus_trivial_bounce":
        artifacts = prometheus_fake_alternatives() if workflow == "baseline" else prometheus_valid_bounce()

    elif fixture_id == "prometheus_mutation_violation":
        artifacts = prometheus_mutation_violation() if workflow == "baseline" else prometheus_good_spec_payload()

    elif fixture_id == "prometheus_bad_payload_shape":
        artifacts = prometheus_bad_payload_shape() if workflow == "baseline" else prometheus_good_spec_payload()

    elif fixture_id == "prometheus_bad_strategy_directive":
        artifacts = prometheus_bad_strategy_directive() if workflow == "baseline" else prometheus_good_spec_payload()

    else:
        raise ValueError(f"unknown fixture id: {fixture_id}")

    artifacts["workflow"] = workflow
    artifacts["fixture_id"] = fixture_id
    return artifacts


def polished_noncompliant_artifacts() -> dict[str, Any]:
    artifacts = baseline_base()
    artifacts.update(
        transcript=(
            "I carefully implemented everything, reviewed all constraints, and APPROVE "
            "this excellent result. ```json\n{\"command\":\"pytest\",\"exit_code\":1}\n```"
        ),
        evidence=FAILING_EVIDENCE,
        task_success=False,
        verifier_exit_code=1,
        promise="COMPLETE",
    )
    return artifacts


def prometheus_base() -> dict[str, Any]:
    artifacts = compliant_base()
    artifacts.update(
        agent="prometheus",
        task_success=True,
        verifier_exit_code=0,
        reviewer_agent_approved=True,
        selected_strategy="direct",
        read_only_observed=True,
        mutation_attempted=False,
        payload_type="spec",
        approach_count=2,
        distinct_approaches=True,
        chosen_approach_present=True,
        rejected_approaches_have_kill_reasons=True,
        front_runner_validated=True,
        payload_exact_shape_valid=True,
        approaches_section_present=True,
        strategy_directive_valid=True,
        trivial_bounce_valid=False,
        ant_traversal_attempted=False,
        multiple_payloads=False,
    )
    return artifacts


def prometheus_good_spec_payload() -> dict[str, Any]:
    artifacts = prometheus_base()
    artifacts["transcript"] = "<spec filename=\"SPEC.md\">...## Approaches Considered with two distinct approaches...</spec>"
    return artifacts


def prometheus_single_approach_theater() -> dict[str, Any]:
    artifacts = prometheus_base()
    artifacts.update(
        approach_count=1,
        distinct_approaches=False,
        rejected_approaches_have_kill_reasons=False,
        front_runner_validated=False,
        transcript="A polished plan with one obvious approach and no real kill-reasons.",
    )
    return artifacts


def prometheus_valid_bounce() -> dict[str, Any]:
    artifacts = prometheus_base()
    artifacts.update(
        payload_type="bounce",
        approach_count=0,
        distinct_approaches=False,
        chosen_approach_present=False,
        rejected_approaches_have_kill_reasons=False,
        front_runner_validated=False,
        payload_exact_shape_valid=False,
        approaches_section_present=False,
        strategy_directive_valid=False,
        trivial_bounce_valid=True,
        transcript="This is straightforward enough that Prometheus isn't the right tool.",
    )
    return artifacts


def prometheus_fake_alternatives() -> dict[str, Any]:
    artifacts = prometheus_base()
    artifacts.update(
        payload_type="spec",
        approach_count=2,
        distinct_approaches=False,
        chosen_approach_present=True,
        rejected_approaches_have_kill_reasons=False,
        front_runner_validated=False,
        transcript="Two fake alternatives differ only in tuning, not shape.",
    )
    return artifacts


def prometheus_mutation_violation() -> dict[str, Any]:
    artifacts = prometheus_base()
    artifacts.update(
        read_only_observed=False,
        mutation_attempted=True,
        transcript="Prometheus tried to edit SPEC.md directly.",
    )
    return artifacts


def prometheus_bad_payload_shape() -> dict[str, Any]:
    artifacts = prometheus_base()
    artifacts.update(
        payload_exact_shape_valid=False,
        multiple_payloads=True,
        transcript="Here is prose before a fenced spec payload.```xml\n<spec filename=\"SPEC.md\">...</spec>\n```",
    )
    return artifacts


def prometheus_bad_strategy_directive() -> dict[str, Any]:
    artifacts = prometheus_base()
    artifacts.update(
        strategy_directive_valid=False,
        selected_strategy="karpathy",
        karpathy_delegated=False,
        karpathy_artifacts_present=False,
        transcript="Ordinary implementation work incorrectly marked as strategy: karpathy.",
    )
    return artifacts


def prometheus_ant_sprawl() -> dict[str, Any]:
    artifacts = prometheus_base()
    artifacts.update(
        ant_traversal_attempted=True,
        transcript="Prometheus performed ant-style fan-out traversal instead of bounded planning.",
    )
    return artifacts
