#!/usr/bin/env python3
"""Static and clean-sandbox validation for the final control plane."""
from __future__ import annotations
import argparse, json, os, pathlib, subprocess, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]

def require(condition: bool, message: str) -> None:
    if not condition: raise AssertionError(message)

def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--skip-llm", action="store_true"); parser.parse_args()
    agents = {p.stem: p.read_text() for p in (ROOT / "agents").glob("*.md")}
    require(set(agents) == {"ask","prometheus","autonomous","karpathy","reviewer","grounder"}, "six-agent roster mismatch")
    require("run: allow" in agents["prometheus"] and "bash: deny" in agents["prometheus"], "Prometheus runner confinement missing")
    require("run: allow" in agents["karpathy"] and "bash: deny" in agents["karpathy"], "Karpathy must use the trusted runner")
    require("python *" not in agents["karpathy"] and "python3 *" not in agents["karpathy"], "Karpathy has a direct interpreter bypass")
    for read_only_agent in ("ask", "reviewer", "grounder"):
        require("bash: deny" in agents[read_only_agent], f"{read_only_agent} has a shell-based control-plane bypass")
    require("write: allow" in agents["prometheus"] and "payload" not in agents["prometheus"].lower(), "Prometheus direct SPEC handoff missing")
    require("advisory" in agents["reviewer"].lower(), "Reviewer must be advisory")
    require("update `.opencode/memory/`" not in agents["grounder"], "Grounder claims writes")
    require((ROOT/"plugins/opencode-autonomous-supervisor/index.js").is_file(), "supervisor missing")
    require(not (ROOT/"plugins/opencode-autonomous-gate.js").exists() and not (ROOT/"plugins/opencode-autonomous-loop.js").exists(), "split control plane remains")
    immutable = json.loads((ROOT/".opencode/immutable.json").read_text())
    require(immutable["write_allowlist"]["prometheus"] == ["SPEC.md", ".spike/**"], "Prometheus policy missing")
    required_readonly = {
        ".opencode/immutable.json", ".opencode/tool/run.ts", ".opencode/runs/**",
        ".opencode/supervisor/**", "plugins/immutability.ts",
        "plugins/opencode-autonomous-supervisor.js", "plugins/opencode-autonomous-supervisor/**",
    }
    require(required_readonly <= set(immutable["readonly"]), "trusted control-plane source or artifacts are forgeable")
    require((ROOT/".opencode/tool/run.ts").is_file(), "runner missing")
    require((ROOT/"skills").is_dir() and not (ROOT/".opencode/skills").exists(), "root skills migration incomplete")
    with tempfile.TemporaryDirectory(prefix="opencode-deploy-") as tmp:
        config = pathlib.Path(tmp)/"config"; project = pathlib.Path(tmp)/"project"; project.mkdir()
        env = os.environ | {"OPENCODE_DEPLOY_CONFIG_DIR": str(config)}
        subprocess.run(["bash",str(ROOT/"scripts/deploy-opencode-agents.sh"),"install","--mode","copy"],cwd=ROOT,env=env,check=True,capture_output=True,text=True)
        runner = config/"tools/run.ts"
        require(runner.is_file(), "global runner not deployed")
        require((config/"plugins/opencode-autonomous-supervisor.js").exists() and (config/"plugins/immutability.ts").exists(), "control-plane plugins not deployed")
        code = f'import {{run}} from {str(runner)!r}; const r=await run({{command:"true",cwd:{str(project)!r}}}); if(r.context!=="execution")process.exit(2)'
        subprocess.run(["node","--input-type=module","-e",code],check=True,capture_output=True,text=True)
        require(any((project/".opencode/runs").glob("*.json")), "runner evidence was not project-local")
        failure = f'import {{run,__testing}} from {str(runner)!r}; try{{await run({{command:"true",cwd:{str(project/"missing")!r}}});process.exit(2)}}catch{{if(__testing.running!==0)process.exit(3)}}'
        subprocess.run(["node","--input-type=module","-e",failure],check=True,capture_output=True,text=True)
        load = f'import Supervisor from {str(config/"plugins/opencode-autonomous-supervisor/index.js")!r}; import {{ImmutabilityGuard}} from {str(config/"plugins/immutability.ts")!r}; if(typeof Supervisor!=="function"||typeof ImmutabilityGuard!=="function")process.exit(2)'
        subprocess.run(["node","--input-type=module","-e",load],check=True,capture_output=True,text=True)
    print("All final control-plane checks passed.")
    return 0

if __name__ == "__main__": raise SystemExit(main())
