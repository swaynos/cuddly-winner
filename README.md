# OpenCode Agent Control Plane

This repository deploys six agents backed by a trusted runner, project
immutability policy, and one durable autonomous supervisor.

## Install

```bash
bash scripts/deploy-opencode-agents.sh install
```

The default installs agents, root `skills/`, `tools/run.ts`, the supervisor, and the
immutability hook into the resolved OpenCode config. Use `status` to inspect the
destinations. Restart OpenCode after installation because configuration and
plugins are loaded at startup.

Committed project configuration uses visible root files such as
`opencode-immutable.json`; `.opencode/` is reserved for ignored runtime evidence
and supervisor state. If Autonomous reports that `run` is unavailable, reinstall
and restart OpenCode. The supervisor records that condition as a terminal
infrastructure blocker instead of repeatedly requesting impossible verification.

## Workflow

1. Invoke Prometheus to investigate and write root `SPEC.md`. Measured spikes
   are isolated below `.spike/<id>/`.
2. Invoke Autonomous. It fingerprints the SPEC, implements the checklist, and
   runs exact verification commands through `run`.
3. Inspect `.opencode/runs/*.json` for execution evidence and
   `.opencode/supervisor/*.json` for durable verdict state. Reviewer comments
   are advisory; only exact, fresh passing artifacts establish completion.

## Validation

Never use system Python. Provision the pyenv virtualenv first:

```bash
PYTHON="$(bash scripts/ensure-venv.sh)"
"$PYTHON" tests/verify_opencode.py --skip-llm
node --test tests/plugins/*.test.mjs
"$PYTHON" -m unittest discover -s evals/mutation/tests -p 'test_*.py'
"$PYTHON" evals/seed_build/test_planning.py
bash scripts/deploy-opencode-agents.sh status
```
