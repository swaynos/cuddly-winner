#!/usr/bin/env python3
"""Validate native compatibility and optional OpenCode extension profiles."""
from __future__ import annotations

import argparse
import os
import pathlib
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-llm", action="store_true")
    parser.parse_args()

    agents = {p.stem: p.read_text() for p in (ROOT / "agents").glob("*.md")}
    require(set(agents) == MANAGED_AGENTS, "optional managed-agent roster mismatch")
    require("bash: deny" in agents["prometheus"] and "spike: ask" in agents["prometheus"], "Prometheus defaults missing")
    require("bash: ask" in agents["autonomous"] and "run: allow" not in agents["autonomous"], "Autonomous must use approval-gated native Bash")
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

    print("Native Plan/Build compatibility and optional profiles validated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
