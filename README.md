# Cuddly Winner | OpenCode Loop Agents

This repo ships a multi-agent autonomous workflow for OpenCode:
- `@prometheus`: planning specialist that writes `spec.md`
- `@autonomous`: spec-driven implementation executor
- `@karpathy`: iterative ML research loop orchestrator

## Assumptions

- OpenCode is installed and already connected to a model provider.
- You are running on macOS or Linux with a working shell.
- Windows users: please figure out what a shell is before trying this setup.

## Repository Layout

```text
.
|-- agents/
|   |-- autonomous.md
|   |-- karpathy.md
|   `-- prometheus.md
|-- scripts/
|   `-- deploy-opencode-agents.sh
|-- prepare.py
|-- train.py
`-- .opencode-deploy.local.env.example
```

## Install Agents Globally

`agents/` is the single source of truth for deployable agent definitions in this repo.

Deploy all files in `agents/*.md` into your global OpenCode agents directory:

```bash
./scripts/deploy-opencode-agents.sh install
```

Then verify deployment:

```bash
./scripts/deploy-opencode-agents.sh status
```

## Pipeline: Prometheus -> Autonomous Loop

1. Start in the target project and invoke `@prometheus`.
2. Let it interview you and generate a complete `spec.md`.
3. Invoke `@autonomous` in the same OpenCode session and let it execute against `spec.md`.

`@autonomous` behavior is OpenCode-native (no external loop script):
- Implements from `spec.md` and updates `progress.txt` checklist entries (`[ ]`, `[x]`).
- Writes exhaustive tests for the spec and runs verification commands.
- Must not emit `<promise>COMPLETE</promise>` until required verification commands pass with exit code `0`.
- Emits `<promise>WORK_STUCK</promise>` only after documenting blockers in `progress.txt`.

## Karpathy Loop Baseline Files

The repo includes sample baseline files for ML loop experiments:
- `prepare.py`: frozen synthetic dataset + strict validation metrics.
- `train.py`: intentionally sub-optimal NumPy classifier with hard wall-clock budget (5 minutes).

Use `@karpathy` on projects that follow the ML loop pattern (`prepare.py`, `train.py`, `program.md`).

## Agent Roles

- `@prometheus` (Planning Specialist)
  - Resolves ambiguity through targeted user interview.
  - Produces detailed `spec.md` with acceptance criteria, constraints, and `[ ]` implementation plan.

- `@autonomous` (Spec-Driven Executor)
  - Requires `spec.md` as source of truth.
  - Tracks progress in `progress.txt` using `[ ]` / `[x]` checkboxes.
  - Enforces automated backpressure: no `<promise>COMPLETE</promise>` until verification commands pass (`0`).
  - On genuine blockers, writes blockers to `progress.txt` and emits `<promise>WORK_STUCK</promise>`.

- `@karpathy` (ML Research Orchestrator)
  - Drives iterative train/eval loop strategy and metric comparisons.
  - Can delegate implementation bursts to `@autonomous`.

## Local Config Files (Gitignored)

Optional deploy overrides:

```bash
cp .opencode-deploy.local.env.example .opencode-deploy.local.env
```

## Promise Semantics

- `<promise>COMPLETE</promise>`: implementation complete and verification passes.
- `<promise>WORK_STUCK</promise>`: blocked after genuine attempts; blockers documented in `progress.txt`.
