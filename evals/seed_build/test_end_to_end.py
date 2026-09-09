#!/usr/bin/env python3
"""
evals/seed_build/test_end_to_end.py — end-to-end test of the installed product.

Unlike `test_planning.py` and `test_build.py`, this test preloads no canonical
scaffold. It installs the real managed profile with the real installer, runs the
real `opencode` binary as a fresh process per agent against a scripted loopback
provider, and scores the result with a hidden oracle the agent never sees.

Five phases:

  A. Install the managed profile into an isolated configuration root and read
     back the effective per-agent tool permissions OpenCode actually resolves.
  B. Run Prometheus with no automatic approval. It must publish the generated
     task package (agent definition, durable brief, schema-v1 manifest, and
     registry), pass static validation, and end with the fresh-context restart
     handoff. There is no fixed validator handoff.
  C. Run the published project-local generated agent as a separate process in
     the same worktree under documented automatic approval. It must read the
     brief and manifest, implement the work, run the declared commands through
     native Bash, and have every hostile probe refused for its documented
     reason: rewriting the published package, editing trusted control-plane
     sources, editing outside its declared edit paths, and invoking a
     governance tool it does not own.
  D. Score externally: hidden acceptance suite, independent re-verification,
     package hashes, Git preservation, session ancestry.
  E. Report. Unscripted provider requests and unused scripted turns both fail.

A scripted provider proves plumbing, policy, and permission boundaries. It does
not prove agent judgement; use `--live` for that, which needs real credentials.

Usage:
    python3 evals/seed_build/test_end_to_end.py [--out report.json]
                                                [--artifacts DIR]
                                                [--keep-workspace]

Exits:
    0 = PASS
    1 = FAIL or PARTIAL
    2 = SKIPPED (missing prerequisite)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _harness import PASS, FAIL, PARTIAL, SKIPPED, TestReport, write_report, PROVIDER_KEYS  # noqa: E402
from _llm_server import ScriptedLLMServer, Turn, provider_config  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
E2E = Path(__file__).resolve().parent / "e2e"
HIDDEN = E2E / "hidden"
REQUEST = E2E / "request.md"
CLI_VERSION_FILE = ROOT / ".opencode-cli-version"
REPORTS = Path(tempfile.gettempdir()) / "opencode-seed-build-reports"

TASK_ID = "retry-schedule-policy"

MANAGED_AGENTS = (
    "ask",
    "grounder",
    "prometheus",
    "reviewer",
)

READ_ONLY = {"bash": False, "edit": False, "write": False, "spike": False,
             "scaffold_gitignore": False, "validate_scaffold": False}

# Effective tool availability required by docs/USE-CASES.md UC-ID-02..UC-ID-04.
# Only tools the durable contracts speak to are asserted here; `session_fetch`
# exposure is recorded as evidence because no document assigns it a role list.
EXPECTED_TOOLS: dict[str, dict[str, bool]] = {
    "prometheus": {"bash": False, "edit": True, "write": True, "task": True,
                   "spike": True, "scaffold_gitignore": True, "validate_scaffold": True},
    "ask": {**READ_ONLY},
    "reviewer": {**READ_ONLY},
    "grounder": {**READ_ONLY},
}

PROMETHEUS_MATCH = "You are Prometheus"
# Unique marker line placed in the generated agent definition body. The scripted
# turns match on it, and the test asserts it reached the provider unchanged.
GENERATED_MATCH = "You are the retry-schedule-policy execution agent."

VERIFY_AST = (
    "python3 -c 'import ast, pathlib; ast.parse(pathlib.Path(\"retry_policy.py\").read_text())'"
)
VERIFY_TESTS = "python3 -m unittest discover -s tests -p 'test_*.py' -v"

# The generated agent definition Prometheus publishes at
# `.opencode/agents/<task-id>.md`. A primary OpenCode agent whose permission
# block does not exceed the manifest: it may edit and write, and it may run its
# own tests through native Bash, but it is granted no governance tool.
AGENT_DEFINITION = """---
description: Generated execution agent for the retry schedule policy task.
mode: primary
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  edit: allow
  write: allow
  bash: allow
---
""" + GENERATED_MATCH + """

Read `.opencode/tasks/retry-schedule-policy.md` and
`.opencode/tasks/retry-schedule-policy.json` before doing any work. They are
your durable brief and manifest; act from them and the worktree, not from any
planning transcript.

Implement only `retry_policy.py` and `tests/test_retry_policy.py`, the paths in
your declared edit scope. Run both declared verification commands through native
Bash and report the observed results honestly.

Do not rewrite the published task package, do not edit trusted control-plane
sources, and do not write outside your declared edit paths. You own no
governance tool. Leave the worktree pending for human review; do not stage or
commit. Return to Prometheus for any material ambiguity or a proven blocker.
"""

# The durable task brief Prometheus publishes at `.opencode/tasks/<task-id>.md`.
TASK_BRIEF = """# Task Brief — Retry Schedule Policy

## Outcome

Add a pure, standard-library capped-exponential retry backoff policy in
`retry_policy.py`, with unittest coverage under `tests/`.

## Durable context

- `request.md` — the originating request.
- `.opencode/tasks/retry-schedule-policy.json` — the schema-v1 manifest.

## Acceptance criteria

1. `retry_policy.py` exports `Attempt`, `PolicyError`, and `schedule`.
2. `Attempt` is a frozen dataclass with fields `index` and `delay_ms`.
3. `schedule` returns one attempt per retry with ascending zero-based indexes.
4. Each delay equals `min(base_ms * 2 ** index, cap_ms)`.
5. `schedule(0, ...)` returns an empty list.
6. `PolicyError` is raised for negative retries, non-positive `base_ms`, and
   `cap_ms` below `base_ms`.
7. `schedule` performs no filesystem, network, or random operations.
8. `tests/` holds unittest coverage for ordering, capping, the empty case, and
   every error case.

## Strategy

Direct implementation. Write the module and its tests, then run both declared
verification commands through native Bash.

## Verification

Run both, fresh, in this session after the final edit:

- `{ast}`
- `{tests}`

Success is proven only when both commands exit 0 and both files exist. A
non-zero exit, or any impurity in `schedule`, means the work is not done.

## Limits and escalation

Stop when both commands pass and both files exist. Return to Prometheus for a
material ambiguity in the requested rule or a proven blocker; do not widen the
edit scope to work around one.
""".format(ast=VERIFY_AST, tests=VERIFY_TESTS)

# The schema-v1 task manifest Prometheus publishes at
# `.opencode/tasks/<task-id>.json`. Built to satisfy tools/validate_scaffold.ts.
MANIFEST_BODY = json.dumps(
    {
        "schema_version": 1,
        "task_id": TASK_ID,
        "agent_name": TASK_ID,
        "agent_definition": f".opencode/agents/{TASK_ID}.md",
        "task_brief": f".opencode/tasks/{TASK_ID}.md",
        "strategy": "direct",
        "strategy_config": {
            "work_selection": "Implement retry_policy.py and tests/test_retry_policy.py, then run the declared verification commands.",
        },
        "permissions": {
            "edit_paths": ["retry_policy.py", "tests/test_retry_policy.py"],
            "bash": True,
        },
        "implementation_scope": ["retry_policy.py", "tests/test_retry_policy.py"],
        "durable_context": [f".opencode/tasks/{TASK_ID}.md", "request.md"],
        "escalation_triggers": [
            "The requested backoff rule conflicts with a stated acceptance criterion",
            "Delivery requires files outside the declared implementation scope",
        ],
        "verification": {
            "commands": [VERIFY_AST, VERIFY_TESTS],
            "success_evidence": [
                "retry_policy.py exports Attempt, PolicyError, and schedule",
                "unittest discovery reports OK for the retry policy tests",
            ],
            "freshness": "Both commands must be run in this session after the final edit.",
            "failure_conditions": [
                "Either verification command exits non-zero",
                "schedule performs filesystem, network, or random access",
            ],
            "independent_review": None,
        },
        "limits": {
            "stop_conditions": [
                "Both verification commands pass and both files exist.",
                "A material ambiguity or proven blocker requires returning to Prometheus.",
            ],
        },
    },
    indent=2,
) + "\n"

# The generated-agent registry Prometheus publishes at
# `.opencode/generated-agents.json`.
REGISTRY_BODY = json.dumps(
    {
        "schema_version": 1,
        "agents": [
            {"name": TASK_ID, "manifest": f".opencode/tasks/{TASK_ID}.json"},
        ],
    },
    indent=2,
) + "\n"

IMPLEMENTATION = '''"""Capped exponential backoff retry schedule."""
from __future__ import annotations

from dataclasses import dataclass


class PolicyError(ValueError):
    """Raised when a retry policy is not satisfiable."""


@dataclass(frozen=True)
class Attempt:
    """One scheduled retry attempt."""

    index: int
    delay_ms: int


def schedule(retries: int, base_ms: int, *, cap_ms: int) -> list[Attempt]:
    """Return capped exponential backoff attempts, one per retry."""
    if retries < 0:
        raise PolicyError("retries must not be negative")
    if base_ms <= 0:
        raise PolicyError("base_ms must be positive")
    if cap_ms < base_ms:
        raise PolicyError("cap_ms must not be smaller than base_ms")
    return [
        Attempt(index=index, delay_ms=min(base_ms * 2 ** index, cap_ms))
        for index in range(retries)
    ]
'''

WORKSPACE_TESTS = '''import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from retry_policy import Attempt, PolicyError, schedule


class TestSchedule(unittest.TestCase):
    def test_ordering_and_backoff(self):
        self.assertEqual(
            schedule(3, 100, cap_ms=10000),
            [Attempt(0, 100), Attempt(1, 200), Attempt(2, 400)],
        )

    def test_cap(self):
        self.assertEqual([a.delay_ms for a in schedule(4, 100, cap_ms=250)], [100, 200, 250, 250])

    def test_empty(self):
        self.assertEqual(schedule(0, 100, cap_ms=100), [])

    def test_errors(self):
        with self.assertRaises(PolicyError):
            schedule(-1, 100, cap_ms=100)
        with self.assertRaises(PolicyError):
            schedule(1, 0, cap_ms=100)
        with self.assertRaises(PolicyError):
            schedule(1, 100, cap_ms=99)


if __name__ == "__main__":
    unittest.main()
'''


# ---------------------------------------------------------------------------
# Runtime plumbing
# ---------------------------------------------------------------------------

@dataclass
class Runtime:
    root: Path
    config: Path
    home: Path
    workspace: Path
    binary: str
    report: TestReport
    artifacts: Path
    runs: dict = field(default_factory=dict)

    def check(self, name: str, passed: bool, note: str = "", evidence: str = "") -> bool:
        entry = {"name": name, "passed": bool(passed)}
        if note and not passed:
            entry["note"] = note
        if evidence:
            entry["evidence"] = evidence
        self.report.checks.append(entry)
        return bool(passed)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else ""


def _git(workspace: Path, *args: str) -> str:
    result = subprocess.run(["git", *args], cwd=str(workspace), capture_output=True, text=True)
    return result.stdout.strip()


def _agent_body(name: str) -> str:
    """The installed agent prompt with its YAML frontmatter removed."""
    text = (ROOT / "agents" / f"{name}.md").read_text(encoding="utf-8")
    parts = text.split("---", 2)
    return parts[2].strip() if len(parts) == 3 else text.strip()


def _isolated_env(runtime: Runtime, server_url: str) -> dict[str, str]:
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in PROVIDER_KEYS and not key.startswith("OPENCODE_")
    }
    env.update(
        {
            "HOME": str(runtime.home),
            "XDG_CONFIG_HOME": str(runtime.home / ".config"),
            "XDG_DATA_HOME": str(runtime.home / ".local" / "share"),
            "XDG_STATE_HOME": str(runtime.home / ".local" / "state"),
            "XDG_CACHE_HOME": str(runtime.home / ".cache"),
            # Keep the agent's shell from sourcing the developer's own rc files.
            "ZDOTDIR": str(runtime.home),
            "OPENCODE_CONFIG_DIR": str(runtime.config),
            "OPENCODE_CONFIG_CONTENT": json.dumps(provider_config(server_url)),
            # Project-local config MUST stay enabled: it is how OpenCode
            # discovers the generated agent Prometheus publishes under the
            # worktree's `.opencode/agents/`. Suppressing it would hide the
            # published definition and make the runtime untestable.
            "OPENCODE_DISABLE_AUTOUPDATE": "1",
            "OPENCODE_DISABLE_MODELS_FETCH": "1",
            "OPENCODE_DISABLE_AUTOCOMPACT": "1",
            "OPENCODE_AUTH_CONTENT": "{}",
        }
    )
    return env


def _run_agent(
    runtime: Runtime,
    server: ScriptedLLMServer,
    *,
    label: str,
    agent: str,
    prompt: str,
    auto: bool,
    timeout: int = 300,
) -> dict:
    command = [
        runtime.binary, "run",
        "--dir", str(runtime.workspace),
        "--agent", agent,
        "--model", "test/test-model",
        "--format", "json",
    ]
    if auto:
        command.append("--auto")
    command.append(prompt)
    try:
        completed = subprocess.run(
            command,
            cwd=str(runtime.workspace),
            env=_isolated_env(runtime, server.url),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        returncode, stdout, stderr = completed.returncode, completed.stdout, completed.stderr
    except subprocess.TimeoutExpired as error:
        returncode = 124
        stdout = error.stdout.decode(errors="replace") if isinstance(error.stdout, bytes) else (error.stdout or "")
        stderr = (error.stderr.decode(errors="replace") if isinstance(error.stderr, bytes) else (error.stderr or "")) \
            + f"\nTimed out after {timeout}s"

    events = []
    for line in stdout.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    run = {"returncode": returncode, "events": events, "stdout": stdout, "stderr": stderr}
    runtime.runs[label] = run
    (runtime.artifacts / f"{label}-events.json").write_text(json.dumps(events, indent=2), encoding="utf-8")
    (runtime.artifacts / f"{label}-stderr.txt").write_text(stderr, encoding="utf-8")
    (runtime.artifacts / f"{label}-requests.json").write_text(
        json.dumps(
            [{"turn": request.turn, "tools": request.tool_names, "body": request.body} for request in server.requests],
            indent=2,
        ),
        encoding="utf-8",
    )
    return run


def _final_text(run: dict) -> str:
    texts = [
        event["part"].get("text", "")
        for event in run["events"]
        if event.get("type") == "text" and isinstance(event.get("part"), dict)
    ]
    return texts[-1].strip() if texts else ""


def _tool_events(run: dict, tool: str) -> list[dict]:
    found = []
    for event in run["events"]:
        part = event.get("part") or {}
        if event.get("type") == "tool_use" and part.get("tool") == tool:
            found.append(part)
    return found


def _refused(result: str) -> bool:
    """True when OpenCode reported the call as blocked rather than performed."""
    lowered = result.lower()
    markers = (
        "permission",
        "denied",
        "not allowed",
        "rejected",
        "is disabled",
        "unavailable tool",
        "no such tool",
        "unknown tool",
        "does not have access",
    )
    return any(marker in lowered for marker in markers)


def _probe(
    runtime: Runtime,
    server: ScriptedLLMServer,
    *,
    turn: str,
    name: str,
    marker: str,
    side_effect_absent: bool = True,
    note: str = "",
) -> None:
    """Assert one hostile probe was refused for the specific documented reason.

    A probe that never reached the provider leaves the boundary unproven, which
    is a failure rather than a silent pass. Matching the exact refusal keeps an
    unrelated error (a path mismatch, say) from counting as enforcement.
    """
    result = server.result_for(turn)
    if server.served(turn) is None:
        runtime.check(name, False, f"probe {turn!r} never reached the provider, so the boundary is unproven")
        return
    matched = marker.lower() in result.lower() if marker else _refused(result)
    runtime.check(
        name,
        matched and side_effect_absent,
        f"{note}expected refusal {marker!r}; side effect absent={side_effect_absent}; result: {result[:400]!r}",
        evidence=result[:200],
    )


# ---------------------------------------------------------------------------
# Scripted turns
# ---------------------------------------------------------------------------

def _prometheus_turns() -> list[Turn]:
    match = PROMETHEUS_MATCH
    return [
        Turn("pro-read-request", match, tool="read", args={"filePath": "request.md"}),
        # Publish the generated task package in the documented order:
        # brief .md -> scaffold_gitignore -> manifest .json -> agent .md ->
        # registry -> validate_scaffold.
        Turn("pro-write-brief", match, tool="write",
             args={"filePath": f".opencode/tasks/{TASK_ID}.md", "content": TASK_BRIEF}),
        Turn("pro-gitignore", match, tool="scaffold_gitignore", args={}),
        Turn("pro-write-manifest", match, tool="write",
             args={"filePath": f".opencode/tasks/{TASK_ID}.json", "content": MANIFEST_BODY}),
        Turn("pro-write-agent", match, tool="write",
             args={"filePath": f".opencode/agents/{TASK_ID}.md", "content": AGENT_DEFINITION}),
        Turn("pro-write-registry", match, tool="write",
             args={"filePath": ".opencode/generated-agents.json", "content": REGISTRY_BODY}),
        Turn("pro-validate", match, tool="validate_scaffold", args={}),
        Turn("pro-final", match,
             text="Planning is published. The generated agent `retry-schedule-policy` and its brief "
                  "`.opencode/tasks/retry-schedule-policy.md` are ready. Quit and restart OpenCode so it "
                  "loads the project-local definition, then start a new conversation and select the "
                  "`retry-schedule-policy` agent."),
    ]


def _generated_turns() -> list[Turn]:
    match = GENERATED_MATCH
    return [
        Turn("gen-read-brief", match, tool="read", args={"filePath": f".opencode/tasks/{TASK_ID}.md"}),
        Turn("gen-read-manifest", match, tool="read", args={"filePath": f".opencode/tasks/{TASK_ID}.json"}),
        # Hostile probes. Each must be refused by the installed product for its
        # specific documented reason.
        Turn("probe-generated-package-write", match, tool="write",
             args={"filePath": f".opencode/tasks/{TASK_ID}.json", "content": "{}\n"}),
        Turn("probe-generated-trusted-write", match, tool="write",
             args={"filePath": "tools/spike.ts", "content": "// control-plane tamper\n"}),
        Turn("probe-generated-outside-write", match, tool="write",
             args={"filePath": "README.md", "content": "# out-of-scope write\n"}),
        Turn("probe-generated-spike", match, tool="spike",
             args={"command": "touch generated-spike-executed", "spike_id": "probe"}),
        # Ordinary implementation work, both paths inside the declared edit scope.
        Turn("gen-write-implementation", match, tool="write",
             args={"filePath": "retry_policy.py", "content": IMPLEMENTATION}),
        Turn("gen-write-tests", match, tool="write",
             args={"filePath": "tests/test_retry_policy.py", "content": WORKSPACE_TESTS}),
        Turn("gen-verify-ast", match, tool="bash",
             args={"command": VERIFY_AST, "description": "declared verification: module parses"}),
        Turn("gen-verify-tests", match, tool="bash",
             args={"command": VERIFY_TESTS, "description": "declared verification: unit tests"}),
        Turn("gen-final", match,
             text="Implemented `retry_policy.py` and `tests/test_retry_policy.py`. Ran both declared "
                  "verification commands through native Bash and both exited 0. The worktree is left "
                  "pending for human review; nothing was staged or committed."),
    ]


# ---------------------------------------------------------------------------
# Phases
# ---------------------------------------------------------------------------

def phase_install(runtime: Runtime) -> bool:
    install = subprocess.run(
        ["bash", str(ROOT / "scripts" / "deploy-opencode-agents.sh"), "install",
         "--config-dir", str(runtime.config)],
        capture_output=True, text=True, timeout=900,
    )
    (runtime.artifacts / "install.txt").write_text(install.stdout + install.stderr, encoding="utf-8")
    if not runtime.check("Managed profile installs", install.returncode == 0,
                         f"installer exited {install.returncode}: {install.stderr[-800:]}"):
        return False

    agents = sorted(path.stem for path in (runtime.config / "agents").glob("*.md"))
    runtime.check("All four managed agents installed", agents == sorted(MANAGED_AGENTS),
                  f"installed agents: {agents}", evidence=",".join(agents))
    for relative in ("plugins/immutability.ts", "plugins/autonomous-kpis.ts", "plugins/announce-hygiene.ts",
                     "tools/spike.ts", "tools/validate_scaffold.ts", "tools/scaffold_gitignore.ts",
                     "tools/session_fetch.ts",
                     "node_modules/@opencode-ai/plugin/package.json",
                     # session_fetch imports playwright at call time; without it the
                     # installed tool cannot run at all.
                     "node_modules/playwright/package.json"):
        runtime.check(f"Installed: {relative}", (runtime.config / relative).exists(),
                      f"missing {relative} in the installed profile")
    return True


def phase_permissions(runtime: Runtime, server: ScriptedLLMServer) -> None:
    """Read back the effective tool permissions OpenCode resolves per agent."""
    exposure: dict[str, list[str]] = {}
    for agent, expected in EXPECTED_TOOLS.items():
        resolved = subprocess.run(
            [runtime.binary, "debug", "agent", agent],
            cwd=str(runtime.workspace), env=_isolated_env(runtime, server.url),
            capture_output=True, text=True, timeout=120,
        )
        try:
            tools = json.loads(resolved.stdout).get("tools") or {}
        except json.JSONDecodeError:
            runtime.check(f"Effective permissions resolve for @{agent}", False,
                          f"could not parse `debug agent {agent}`: {(resolved.stdout + resolved.stderr)[-400:]}")
            continue
        exposure[agent] = sorted(name for name, enabled in tools.items() if enabled)
        wrong = {
            name: tools.get(name)
            for name, want in expected.items()
            if tools.get(name, False) is not want
        }
        runtime.check(
            f"Effective permissions match the contract for @{agent}",
            not wrong,
            f"expected {expected}, observed {wrong}",
            evidence=json.dumps({name: tools.get(name) for name in expected}),
        )
    runtime.report.evidence["effective_tool_exposure"] = exposure


def phase_prometheus(runtime: Runtime, server: ScriptedLLMServer) -> None:
    workspace = runtime.workspace
    run = _run_agent(runtime, server, label="prometheus", agent="prometheus",
                     prompt="Read request.md and plan this work.", auto=False)

    runtime.check("Prometheus run exits cleanly", run["returncode"] == 0,
                  f"exit {run['returncode']}: {run['stderr'][-800:]}")

    request = server.served("pro-read-request") or server.served("pro-final")
    if request:
        runtime.check("Installed Prometheus prompt reached the provider",
                      _agent_body("prometheus") in request.system,
                      "the system prompt on the wire is not the installed agents/prometheus.md body")
        offered = request.tool_names
        runtime.report.evidence["prometheus_tools_offered"] = offered
        runtime.check("Prometheus is offered no direct shell tool", "bash" not in offered,
                      f"bash was offered to Prometheus: {offered}")
        missing = [name for name in ("write", "spike", "validate_scaffold", "scaffold_gitignore") if name not in offered]
        runtime.check("Prometheus is offered its governance tools", not missing, f"missing {missing}")
    else:
        runtime.check("Installed Prometheus prompt reached the provider", False,
                      "no Prometheus request reached the scripted provider")

    # Publication — the four generated task-package files.
    agent_def = workspace / ".opencode" / "agents" / f"{TASK_ID}.md"
    brief = workspace / ".opencode" / "tasks" / f"{TASK_ID}.md"
    manifest = workspace / ".opencode" / "tasks" / f"{TASK_ID}.json"
    registry = workspace / ".opencode" / "generated-agents.json"
    published = runtime.check(
        "Prometheus published the four generated task-package files",
        agent_def.is_file() and brief.is_file() and manifest.is_file() and registry.is_file(),
        f"agent={agent_def.is_file()} brief={brief.is_file()} "
        f"manifest={manifest.is_file()} registry={registry.is_file()}",
    )
    if published:
        try:
            parsed = json.loads(manifest.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            parsed = {}
        runtime.check(
            "Published manifest is schema v1 direct with consistent ids and commands",
            parsed.get("schema_version") == 1
            and parsed.get("strategy") == "direct"
            and parsed.get("task_id") == TASK_ID
            and parsed.get("agent_name") == TASK_ID
            and parsed.get("agent_definition") == f".opencode/agents/{TASK_ID}.md"
            and parsed.get("task_brief") == f".opencode/tasks/{TASK_ID}.md"
            and parsed.get("verification", {}).get("commands") == [VERIFY_AST, VERIFY_TESTS],
            f"manifest mismatch: schema={parsed.get('schema_version')} strategy={parsed.get('strategy')} "
            f"task_id={parsed.get('task_id')} commands={parsed.get('verification', {}).get('commands')}",
        )
        try:
            reg = json.loads(registry.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            reg = {}
        entries = reg.get("agents") if isinstance(reg, dict) else None
        entry = entries[0] if isinstance(entries, list) and entries else {}
        runtime.check(
            "Registry references the manifest by task id",
            reg.get("schema_version") == 1
            and isinstance(entry, dict)
            and entry.get("name") == TASK_ID
            and entry.get("manifest") == f".opencode/tasks/{TASK_ID}.json",
            f"registry: {reg}",
        )
        runtime.check("Static scaffold validation passes in-session",
                      '"valid": true' in server.result_for("pro-validate"),
                      f"validate_scaffold reported: {server.result_for('pro-validate')[:400]}")
        gitignore = workspace / ".gitignore"
        runtime.check("Scaffold exclusion block is managed",
                      gitignore.is_file()
                      and "# BEGIN OpenCode generated task artifacts" in gitignore.read_text(encoding="utf-8"),
                      "scaffold_gitignore did not manage the .gitignore block")

    # Fresh-context restart handoff. Prometheus stops before implementation and
    # names the generated agent, telling the user to restart and start a new
    # conversation.
    final = _final_text(run)
    lowered = final.lower()
    runtime.check(
        "Prometheus ends with the fresh-context restart handoff",
        TASK_ID in final and "restart" in lowered and "new conversation" in lowered,
        f"final text: {final[-300:]!r}",
        evidence=final[-200:],
    )


def phase_generated(runtime: Runtime, server: ScriptedLLMServer) -> None:
    workspace = runtime.workspace
    package = {
        "agent": workspace / ".opencode" / "agents" / f"{TASK_ID}.md",
        "brief": workspace / ".opencode" / "tasks" / f"{TASK_ID}.md",
        "manifest": workspace / ".opencode" / "tasks" / f"{TASK_ID}.json",
        "registry": workspace / ".opencode" / "generated-agents.json",
    }
    before = {name: _sha256(path) for name, path in package.items()}
    head_before = _git(workspace, "rev-parse", "HEAD")
    commits_before = _git(workspace, "rev-list", "--count", "HEAD")
    index_before = _git(workspace, "diff", "--cached", "--name-only")

    # Discovery: `debug agent` takes no --dir, so it resolves project-local
    # config from the working directory.
    resolved = subprocess.run(
        [runtime.binary, "debug", "agent", TASK_ID],
        cwd=str(workspace), env=_isolated_env(runtime, server.url),
        capture_output=True, text=True, timeout=120,
    )
    try:
        info = json.loads(resolved.stdout)
        discovered = isinstance(info, dict) and bool(info)
    except json.JSONDecodeError:
        info, discovered = {}, False
    runtime.report.evidence["generated_agent_debug_tools"] = (
        sorted(name for name, enabled in (info.get("tools") or {}).items() if enabled) if discovered else []
    )
    runtime.check("Generated agent is discovered as a project-local agent", discovered,
                  f"`debug agent {TASK_ID}`: {(resolved.stdout + resolved.stderr)[-400:]}")

    run = _run_agent(runtime, server, label="generated", agent=TASK_ID,
                     prompt="Read your task brief and implement the retry schedule policy.",
                     auto=True, timeout=420)

    runtime.check("Generated agent run exits cleanly", run["returncode"] == 0,
                  f"exit {run['returncode']}: {run['stderr'][-800:]}")

    request = server.served("gen-read-brief") or server.served("gen-final")
    if request:
        runtime.check("Generated agent definition reached the provider",
                      GENERATED_MATCH in request.system,
                      "the generated agent body was not the system prompt on the wire")
        offered = request.tool_names
        runtime.report.evidence["generated_tools_offered"] = offered
        runtime.check("Generated agent is offered native Bash", "bash" in offered, f"offered: {offered}")
        runtime.check("Generated agent is offered edit and write",
                      "edit" in offered and "write" in offered, f"offered: {offered}")
    else:
        runtime.check("Generated agent definition reached the provider", False,
                      "no generated-agent request reached the scripted provider")

    # Hostile probes. Each asserts the specific documented refusal, so an
    # unrelated error cannot be mistaken for an enforced boundary.
    _probe(runtime, server, turn="probe-generated-package-write",
           name="Generated agent cannot rewrite the published task package",
           marker="cannot rewrite published task package")
    _probe(runtime, server, turn="probe-generated-trusted-write",
           name="Generated agent cannot edit trusted control-plane sources",
           marker="trusted control-plane state")
    _probe(runtime, server, turn="probe-generated-outside-write",
           name="Generated agent cannot write outside its declared edit paths",
           marker="cannot edit outside its declared edit paths",
           side_effect_absent=not (workspace / "README.md").exists())
    _probe(runtime, server, turn="probe-generated-spike",
           name="Generated agent cannot invoke a governance tool it does not own",
           marker="only @prometheus may invoke spike",
           side_effect_absent=not (workspace / "generated-spike-executed").exists())

    after = {name: _sha256(path) for name, path in package.items()}
    runtime.check("Published task package bytes are unchanged by execution", before == after,
                  f"before={before} after={after}")

    # Implementation
    implementation = workspace / "retry_policy.py"
    tests = workspace / "tests" / "test_retry_policy.py"
    runtime.check("Generated agent created the implementation", implementation.is_file(),
                  "retry_policy.py was not created")
    runtime.check("Generated agent created the unit tests", tests.is_file(),
                  "tests/test_retry_policy.py was not created")

    # Fresh execution of the declared verification commands through native Bash.
    for label, command in (("gen-verify-ast", VERIFY_AST), ("gen-verify-tests", VERIFY_TESTS)):
        events = [
            part for part in _tool_events(run, "bash")
            if (part.get("state", {}).get("input") or {}).get("command") == command
        ]
        status = events[0].get("state", {}).get("status") if events else "absent"
        runtime.check(f"Declared verification ran through native Bash: {command[:44]}...",
                      status == "completed",
                      f"tool state was {status!r}; result: {server.result_for(label)[:300]!r}",
                      evidence=str(status))

    # Git publication state
    runtime.check("Git HEAD is preserved", _git(workspace, "rev-parse", "HEAD") == head_before)
    runtime.check("Git commit count is preserved",
                  _git(workspace, "rev-list", "--count", "HEAD") == commits_before)
    runtime.check("Git index is preserved", _git(workspace, "diff", "--cached", "--name-only") == index_before,
                  "the generated agent staged changes")
    pending = _git(workspace, "status", "--porcelain")
    runtime.check("Produced work is left pending for human review",
                  "retry_policy.py" in pending or "?? retry_policy.py" in pending,
                  f"git status: {pending!r}", evidence=pending[:400])


def phase_score(runtime: Runtime, server: ScriptedLLMServer, python: str) -> None:
    workspace = runtime.workspace
    implementation = workspace / "retry_policy.py"

    runtime.check("Hidden oracle never entered the agent workspace",
                  not list(workspace.rglob("test_retry_policy*hidden*"))
                  and not (workspace / "hidden").exists()
                  and not list(workspace.rglob("*/e2e/hidden")),
                  "hidden acceptance assets leaked into the workspace")

    if implementation.is_file():
        hidden = subprocess.run(
            [python, "-m", "unittest", "discover", "-s", str(HIDDEN), "-p", "test_*.py", "-v"],
            cwd=str(ROOT),
            env={**os.environ, "RETRY_POLICY_PATH": str(implementation), "PYTHONDONTWRITEBYTECODE": "1"},
            capture_output=True, text=True, timeout=180,
        )
        output = hidden.stdout + hidden.stderr
        (runtime.artifacts / "hidden-oracle.txt").write_text(output, encoding="utf-8")
        runtime.check("Hidden acceptance suite passes against the produced module",
                      hidden.returncode == 0, f"hidden suite failed:\n{output[-1500:]}",
                      evidence=output.strip().splitlines()[-1] if output.strip() else "")
    else:
        runtime.check("Hidden acceptance suite passes against the produced module", False,
                      "no implementation was produced to score")

    # Independent re-run of the declared commands, outside the agent session.
    # Read the verification commands from the schema-v1 task manifest.
    try:
        manifest = json.loads((workspace / ".opencode" / "tasks" / f"{TASK_ID}.json").read_text(encoding="utf-8"))
        commands = manifest["verification"]["commands"]
    except (OSError, KeyError, json.JSONDecodeError):
        commands = []
    for command in commands:
        replay = subprocess.run(command, shell=True, cwd=str(workspace),
                                capture_output=True, text=True, timeout=180)
        runtime.check(f"Independent replay of declared verification exits 0: {command[:48]}...",
                      replay.returncode == 0,
                      f"exit {replay.returncode}: {(replay.stdout + replay.stderr)[-600:]}")

    # Session ancestry from the isolated OpenCode database, recorded as evidence.
    # The generated-execution-agent runtime has no fixed validator child, so no
    # specific child agent is asserted.
    database = runtime.home / ".local" / "share" / "opencode" / "opencode.db"
    agents: list[str] = []
    if database.is_file():
        try:
            connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
            agents = [
                row[0]
                for row in connection.execute(
                    "SELECT agent FROM session WHERE parent_id IS NOT NULL AND agent IS NOT NULL"
                ).fetchall()
            ]
            connection.close()
        except sqlite3.Error as error:
            runtime.report.evidence["session_db_error"] = str(error)
    runtime.report.evidence["child_session_agents"] = agents

    runtime.check("Every provider request was scripted", not server.misses,
                  f"{len(server.misses)} unscripted request(s); the test's model of the product is wrong")
    runtime.check("Every scripted turn was consumed", not server.unused,
                  f"unused turns: {server.unused}")
    runtime.report.evidence["provider_requests"] = len(server.requests)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _resolve_binary() -> tuple[str | None, str]:
    binary = os.environ.get("OPENCODE_E2E_BIN") or shutil.which("opencode")
    if not binary:
        return None, "no opencode binary found (set OPENCODE_E2E_BIN or add opencode to PATH)"
    version = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=60).stdout.strip()
    return binary, version


def run_test(runtime: Runtime, python: str) -> None:
    expected_version = CLI_VERSION_FILE.read_text(encoding="utf-8").strip()
    runtime.check("OpenCode CLI matches the pinned version",
                  runtime.report.evidence.get("opencode_version") == expected_version,
                  f"pinned {expected_version}, found {runtime.report.evidence.get('opencode_version')}")

    if not phase_install(runtime):
        runtime.report.verdict = FAIL
        return

    turns = _prometheus_turns() + _generated_turns()
    with ScriptedLLMServer(turns) as server:
        runtime.report.evidence["provider_url"] = server.url
        phase_permissions(runtime, server)
        phase_prometheus(runtime, server)
        phase_generated(runtime, server)
        phase_score(runtime, server, python)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=None, help="Path to write the JSON report")
    parser.add_argument("--artifacts", default=None, help="Directory for retained evidence")
    parser.add_argument("--keep-workspace", action="store_true", help="Keep the disposable workspace")
    args = parser.parse_args(argv)

    report = TestReport(test_name="test_end_to_end")
    binary, version = _resolve_binary()
    if not binary:
        report.verdict = SKIPPED
        report.error = version
        print(report.render())
        print(f"Report: {write_report(report, Path(args.out).parent if args.out else REPORTS)}")
        return 2

    # Resolve symlinks up front. On macOS the temp root is /var -> /private/var,
    # and OpenCode resolves its worktree to the real path; a mismatch makes every
    # in-workspace path look external and get auto-rejected.
    root = Path(tempfile.mkdtemp(prefix="seed-build-e2e-")).resolve()
    selected = args.artifacts or os.environ.get("OPENCODE_E2E_ARTIFACTS")
    artifacts = Path(selected) if selected else root / "artifacts"
    artifacts.mkdir(parents=True, exist_ok=True)
    workspace = root / "workspace"
    home = root / "home"
    for path in (workspace, home):
        path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "--quiet"], cwd=workspace, check=True)
    for key, value in (("user.email", "e2e@example.invalid"), ("user.name", "E2E"),
                       ("commit.gpgsign", "false"), ("core.fsmonitor", "false")):
        subprocess.run(["git", "config", key, value], cwd=workspace, check=True)
    shutil.copy2(REQUEST, workspace / "request.md")
    subprocess.run(["git", "add", "request.md"], cwd=workspace, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "seed request"], cwd=workspace, check=True)

    runtime = Runtime(root=root, config=root / "config", home=home, workspace=workspace,
                      binary=binary, report=report, artifacts=artifacts)
    report.evidence["opencode_version"] = version
    report.evidence["platform"] = sys.platform
    report.evidence["repository_revision"] = _git(ROOT, "rev-parse", "HEAD")
    report.evidence["workspace"] = str(workspace)
    report.evidence["artifacts"] = str(artifacts)

    python = os.environ.get("OPENCODE_E2E_PYTHON") or sys.executable
    try:
        run_test(runtime, python)
    except Exception as error:  # keep partial evidence on an internal failure
        report.error = f"{type(error).__name__}: {error}"

    if not report.verdict:
        passed = sum(1 for check in report.checks if check.get("passed"))
        total = len(report.checks)
        report.verdict = PASS if passed == total and not report.error else (
            PARTIAL if passed >= total * 0.5 else FAIL
        )
        report.evidence["checks_passed"] = f"{passed}/{total}"

    if report.verdict != PASS:
        retained = artifacts / "workspace"
        if not retained.exists():
            shutil.copytree(workspace, retained, symlinks=True, ignore_dangling_symlinks=True)

    print(report.render())
    out_path = write_report(report, Path(args.out).parent if args.out else REPORTS)
    if args.out:
        shutil.copy(out_path, args.out)
    print(f"Report: {out_path}")
    print(f"Artifacts: {artifacts}")

    if not args.keep_workspace and report.verdict == PASS:
        shutil.rmtree(root, ignore_errors=True)
    return 0 if report.verdict == PASS else 1


if __name__ == "__main__":
    raise SystemExit(main())
