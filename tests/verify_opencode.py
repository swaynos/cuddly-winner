#!/usr/bin/env python3
"""Validate native compatibility and optional OpenCode extension profiles."""
from __future__ import annotations

import argparse
import os
import pathlib
import shutil
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANAGED_AGENTS = {"ask", "prometheus", "autonomous", "karpathy", "reviewer", "grounder"}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def deploy(config: pathlib.Path, *args: str) -> None:
    env = os.environ | {"OPENCODE_DEPLOY_CONFIG_DIR": str(config)}
    subprocess.run(
        ["bash", str(ROOT / "scripts/deploy-opencode-agents.sh"), "install", *args],
        cwd=ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )


def _run_scenario_agent(agent: str, prompt: str, model: str | None, workspace: pathlib.Path) -> str:
    """Run one OpenCode agent scenario and return combined stdout+stderr."""
    workspace.mkdir(parents=True, exist_ok=True)
    command = ["opencode", "run", "--dir", str(workspace), "--agent", agent]
    if model:
        command.extend(["--model", model])
    command.append(prompt)
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=120,
    )
    return result.stdout + result.stderr


def run_behavioral_scenarios(model: str | None) -> None:
    """Run LLM-in-the-loop scenarios with the configured OpenCode profile."""
    if not shutil.which("opencode"):
        print("opencode not on PATH — skipping LLM behavioral scenarios")
        return

    print("\nRunning LLM behavioral scenarios…")
    failures: list[str] = []

    with tempfile.TemporaryDirectory(prefix="opencode-bscenario-") as tmp:
        root = pathlib.Path(tmp)

        # 1. Ask: must not produce command-dump workarounds for edit requests
        print("  [1/4] Ask refuses edit request without command dump…", end=" ", flush=True)
        out = _run_scenario_agent(
            "ask", "Please add a sort() function to main.py for me.", model, root / "s1"
        )
        if any(m in out for m in ("subprocess.run", "os.system", "sed -i", "awk '{", "cat >> ")):
            failures.append("Ask produced command-dump workaround for an edit request")
            print("FAIL")
        else:
            print("PASS")

        # 2. Ask: must not blame session/environment for role-based limits
        print("  [2/4] Ask does not blame environment for capability limits…", end=" ", flush=True)
        out = _run_scenario_agent(
            "ask", "Why can't you edit my files directly?", model, root / "s2"
        )
        blame = (
            "can't edit files in this session",
            "cannot edit in this environment",
            "session does not allow",
            "environment does not allow",
            "environment restricts",
        )
        if any(p in out.lower() for p in blame):
            failures.append("Ask blamed environment or session for role-based capability limits")
            print("FAIL")
        else:
            print("PASS")

        # 3. Autonomous: must surface missing SPEC.md rather than hallucinating work
        print("  [3/4] Autonomous surfaces missing SPEC.md…", end=" ", flush=True)
        out = _run_scenario_agent(
            "autonomous",
            "Implement the feature described in SPEC.md.",
            model,
            root / "s3",
        )
        if not any(m in out for m in ("SPEC.md", "scaffold", "missing", "escalat", "not found")):
            failures.append("Autonomous did not surface missing SPEC.md — may have hallucinated work")
            print("FAIL")
        else:
            print("PASS")

        # 4. Prometheus: must publish SPEC.md for underspecified request
        print("  [4/4] Prometheus publishes SPEC.md for underspecified request…", end=" ", flush=True)
        ws4 = root / "s4"
        out = _run_scenario_agent("prometheus", "Build me a simple calculator.", model, ws4)
        spec_written = (ws4 / "SPEC.md").is_file()
        if not spec_written and "SPEC.md" not in out:
            failures.append("Prometheus did not publish SPEC.md for an underspecified request")
            print("FAIL")
        else:
            print("PASS")

    if failures:
        raise AssertionError(
            f"LLM behavioral scenario failures ({len(failures)}):\n"
            + "\n".join(f"  - {m}" for m in failures)
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-llm", action="store_true")
    parser.add_argument("--model", help="Override the configured OpenCode default model")
    args = parser.parse_args()

    agents = {p.stem: p.read_text() for p in (ROOT / "agents").glob("*.md")}
    require(set(agents) == MANAGED_AGENTS, "optional managed-agent roster mismatch")
    require("bash: deny" in agents["prometheus"] and "spike: ask" in agents["prometheus"], "Prometheus defaults missing")
    require("Publication is mandatory for every planning-ready Prometheus run" in agents["prometheus"], "Prometheus publication gate missing")
    require("does not wait for a separate user request to write the scaffold" in agents["prometheus"], "Prometheus publication must not require a second request")
    require("Do not ask merely for formats, thresholds, geometry, seeds, quotas" in agents["prometheus"], "Prometheus must apply bounded defaults for unspecified mechanics")
    require("bash: ask" in agents["autonomous"] and "run: allow" not in agents["autonomous"], "Autonomous must use approval-gated native Bash")
    require("Missing implementation files, tests, scripts," in agents["autonomous"], "Autonomous must treat missing deliverables as implementation work")
    require("Do not escalate ordinary local debugging" in agents["autonomous"], "Autonomous escalation boundary is too broad")
    require("reviewer verdicts are not substitutes" in agents["autonomous"], "Autonomous must not substitute reviewer approval for final verification")
    require("advisory and may trigger at most one bounded correction" in agents["autonomous"], "Autonomous reviewer loop must be bounded to one correction")
    require("never commit unless the user explicitly" in agents["autonomous"], "Autonomous must not auto-commit")
    require("must not be rewritten during execution" in agents["autonomous"], "Autonomous must not rewrite checklist boxes during execution")
    require("Use Karpathy only when the manifest explicitly" in agents["autonomous"], "Autonomous must not invoke Karpathy without a complete manifest")
    require("A failed kill criterion requires redesign" in agents["prometheus"], "Prometheus must require redesign on failed kill criterion, not optimistic planning")
    require("without a scaffold only when" in agents["prometheus"], "Prometheus must have bounded exception for finishing without scaffold")
    require("### Selected:" in agents["prometheus"], "Prometheus must require Selected heading in Approaches Considered")
    require("Do not substitute implicit prose" in agents["prometheus"], "Prometheus must prohibit implicit prose substituting for structural labels")
    require("delegates here only when the published" in agents["karpathy"], "Karpathy must require explicit manifest selection — not user-invocable directly")
    require("Do not select a strategy" in agents["karpathy"], "Karpathy must not select its own strategy")
    require("do not infer missing values" in agents["karpathy"], "Karpathy must not infer missing prerequisites")
    require("rather than writing project files" in agents["karpathy"], "Karpathy must return summary to Autonomous, not write files directly")
    require("Never fabricate metrics" in agents["karpathy"], "Karpathy must prohibit fabricated metrics")
    require("never determines completion by itself" in agents["reviewer"], "Reviewer verdict must be advisory, not a completion gate")
    require("The verdict must be the last non-empty content" in agents["reviewer"], "Reviewer must enforce verdict-last output format")
    require("do not rely solely on a rubric passed by the caller" in agents["reviewer"], "Reviewer must read SPEC from disk, not from caller-passed rubric only")
    require("Never send credentials, secrets, private repository code" in agents["grounder"], "Grounder must prohibit sending confidential content to third-party services")
    require("Do not produce manual workarounds, command dumps" in agents["ask"], "Ask must not proxy implementation via workarounds or command dumps")
    require("Never blame the environment or session" in agents["ask"], "Ask must not blame environment for role-based capability limits")
    for name in ("ask", "karpathy", "reviewer", "grounder"):
        require("bash: deny" in agents[name], f"{name} must remain read-only")
    require("Make the change yourself" not in agents["karpathy"], "Karpathy still claims edit ownership")
    require("opencode-autonomous.json" in agents["autonomous"], "Autonomous prompt must reference opencode-autonomous.json")
    require("program.md" not in agents["autonomous"], "Autonomous prompt contains stale program.md reference")
    require("opencode-karpathy.json" not in agents["autonomous"], "Autonomous prompt contains stale opencode-karpathy.json reference")
    require("program.md" not in agents["karpathy"], "Karpathy prompt contains stale program.md reference")
    require("opencode-karpathy.json" not in agents["karpathy"], "Karpathy prompt contains stale opencode-karpathy.json reference")
    require("program.md" not in agents["reviewer"], "Reviewer prompt contains stale program.md reference")

    rules = (ROOT / "AGENTS.md").read_text()
    require("built-in Plan and Build modes are the default workflow" in rules, "project rules do not preserve native Plan/Build")
    require("Implementation / code changes → `@autonomous`" not in rules, "project rules still reroute Build")
    require("Planning / spec writing → `@prometheus`" not in rules, "project rules still reroute Plan")

    plugin = (ROOT / "plugins/immutability.ts").read_text()
    require('MANAGED_AGENTS = new Set(["ask", "prometheus", "autonomous", "karpathy", "reviewer", "grounder"])' in plugin, "managed identity boundary missing")
    require("if (!agent || !MANAGED_AGENTS.has(agent)) return" in plugin, "native/unmanaged bypass missing")

    readme = (ROOT / "README.md").read_text()
    requirements = (ROOT / "docs/REQUIREMENTS.md").read_text()
    architecture = (ROOT / "docs/ARCHITECTURE.md").read_text()
    methodology = (ROOT / "docs/TESTING-METHODOLOGY.md").read_text()
    for name, text in (("README", readme), ("requirements", requirements), ("architecture", architecture), ("methodology", methodology)):
        require("Plan" in text and "Build" in text or name == "methodology", f"{name} omits native Plan/Build compatibility")
    require("does **not** replace, wrap, redirect, restrict" in readme, "README product goal is ambiguous")
    require("outside this project's enforcement boundary" in requirements, "durable native compatibility invariant missing")
    require("Standardized Verdict Definitions" in methodology, "TESTING-METHODOLOGY missing verdict definitions")
    require("before its final response" in requirements and "without waiting for a separate user request" in architecture, "durable Prometheus publication gate missing")

    require(not (ROOT / "progress.txt").exists(), "stale root progress.txt remains")
    require(not any(p.is_file() for p in (ROOT / "evals/agent_value").rglob("*")), "retired agent_value evaluation returned")
    require(not any(p.is_file() for p in (ROOT / "evals/plan_outcome").rglob("*")), "retired plan_outcome evaluation returned")
    require(not (ROOT / "examples/ml-loop/.opencode/immutable.json").exists(), "legacy hidden immutable example remains")

    with tempfile.TemporaryDirectory(prefix="opencode-default-") as tmp:
        config = pathlib.Path(tmp) / "config"
        deploy(config)
        require(not (config / "AGENTS.md").exists(), "repository rules were installed globally")
        require({p.stem for p in (config / "agents").glob("*.md")} == MANAGED_AGENTS, "specialist agents not deployed")
        require((config / "plugins/immutability.ts").is_file(), "managed-agent immutability plugin missing")
        require(not (config / "plugins/opencode-autonomous-supervisor.js").exists(), "obsolete supervisor installed in default profile")
        require(not (config / "tools/spike.ts").exists(), "workflow tools installed in default profile")
        require(not (config / "skills").exists(), "optional skills installed by default")
        installed = {p.stem for p in (config / "agents").glob("*.md")}
        require({"prometheus", "autonomous"} <= installed, "managed agents missing from default profile")
        require(not (config / "node_modules/@opencode-ai/plugin").exists(), "tool SDK present without --with-workflow-tools")

    with tempfile.TemporaryDirectory(prefix="opencode-workflow-tools-") as tmp:
        config = pathlib.Path(tmp) / "config"
        deploy(config, "--with-workflow-tools")
        require(not (config / "plugins/opencode-autonomous-supervisor.js").exists(), "obsolete supervisor deployed")
        require(not (config / "tools/run.ts").exists(), "obsolete protected runner deployed")
        require((config / "tools/spike.ts").is_file(), "spike tool not deployed")
        require((config / "tools/scaffold_gitignore.ts").is_file(), "scaffold_gitignore tool not deployed")
        require((config / "tools/validate_scaffold.ts").is_file(), "validate_scaffold tool not deployed")
        require((config / "node_modules/@opencode-ai/plugin").is_dir(), "tool SDK dependency is not self-contained")
        for tool_file in ("tools/spike.ts", "tools/scaffold_gitignore.ts", "tools/validate_scaffold.ts"):
            code = f'import tool from {str(config / tool_file)!r}; if(typeof tool?.execute!=="function")process.exit(2)'
            subprocess.run(["node", "--input-type=module", "-e", code], check=True, capture_output=True, text=True)

    if not args.skip_llm:
        run_behavioral_scenarios(args.model)

    print("Native Plan/Build compatibility and optional profiles validated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
