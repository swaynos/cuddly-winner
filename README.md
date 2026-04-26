# Cuddly Winner | OpenCode Loop Agents

This repo stores reusable OpenCode agents for autonomous coding loops.

It currently ships two loop styles from one deploy flow:
- `@karpathy` for iterative ML research orchestration
- `@autonomous` for strict spec-driven execution with verification gating

## Assumptions

- OpenCode is already installed.
- OpenCode is already configured with a model provider (for example ChatGPT Codex).
- You are on macOS or Linux with a working shell.
- Windows users: please figure out what a shell is before trying this setup.

## Repository Layout

```text
.
|-- agents/
|   |-- autonomous.md
|   `-- karpathy.md
|-- scripts/
|   `-- deploy-opencode-agents.sh
|-- .opencode-deploy.local.env.example
`-- README.md
```

## Install Agents Globally

Install all agents in `agents/*.md` into your global OpenCode agents directory.

```bash
./scripts/deploy-opencode-agents.sh install
```

By default the script:
1. Resolves OpenCode config with `opencode debug paths`.
2. Uses `<config>/agents` as destination.
3. Creates file-level symlinks for each markdown agent.

Check what is installed:

```bash
./scripts/deploy-opencode-agents.sh status
```

Remove managed symlinks:

```bash
./scripts/deploy-opencode-agents.sh remove
```

## Using The Agents

OpenCode loads these by filename after deployment.

From any project directory:

```bash
opencode
```

Invoke either loop style:

```text
@karpathy
@autonomous
```

## Agent Roles

- `@karpathy`: strategy/orchestrator loop for iterative ML optimization. It can delegate focused implementation bursts to `autonomous` via Task.
- `@autonomous`: spec-driven executor. It requires `spec.md`, tracks progress with `[ ]` and `[x]` checkboxes in `progress.txt`, enforces full test coverage against the spec, and gates completion on passing verification commands.

## Required Files In The Project You Run On

For `@karpathy` workflows:
- `prepare.py` (immutable evaluator)
- `train.py` (mutable training target)
- `program.md` (loop strategy and constraints)

For `@autonomous` workflows:
- `spec.md` (required source of truth)
- `progress.txt` (created/updated by the agent)
- project-specific verification commands (tests/build/lint as applicable)

## Promise Semantics

- `<promise>COMPLETE</promise>`: work is complete and verification passed.
- `<promise>WORK_STUCK</promise>`: agent is blocked after genuine attempts and has documented blockers in `progress.txt`.

## Path Override Strategy

Override precedence:
1. CLI flags
2. Environment variables
3. `.opencode-deploy.local.env`
4. `opencode debug paths`
5. Script defaults

Supported environment variables:
- `OPENCODE_DEPLOY_SOURCE_DIR`
- `OPENCODE_DEPLOY_CONFIG_DIR`
- `OPENCODE_DEPLOY_AGENTS_DIR`
- `OPENCODE_DEPLOY_MODE`

Create local overrides (gitignored):

```bash
cp .opencode-deploy.local.env.example .opencode-deploy.local.env
```
