# Architecture

This document describes the system structure needed to rebuild the project.

## System Overview

Cuddly Winner is a project-owned OpenCode agent suite. It packages agents,
skills, plugins, validation tests, examples, and documentation that together
define an autonomous workflow.

The architecture is intentionally layered:

- **Agents** define LLM roles, permissions, and behavioral contracts.
- **Skills** define reusable procedures that agents may load.
- **Plugins** enforce or observe runtime invariants.
- **Examples** provide runnable reference projects.
- **Tests** validate static configuration and plugin behavior.
- **Docs** define durable requirements and rebuild instructions.

## Repository Layout

```text
.
|-- AGENTS.md                         Repo-wide agent rules and doc maintenance rule
|-- README.md                         User-facing overview and install guide
|-- agents/                           Core OpenCode agent files
|-- .opencode/
|   |-- immutable.json                 Project-local frozen benchmark protections
|   |-- skills/                       Core reusable OpenCode skills
|   `-- strategies.json               Loop strategy registry
|-- docs/                             Durable requirements and architecture docs
|-- evals/                            Deterministic benchmark/evaluation harnesses
|   `-- agent_value/                  Baseline-vs-enhanced workflow value benchmark
|-- examples/                         Reference configs and runnable examples
|-- plugins/                          OpenCode plugins shipped by this repo
|-- scripts/                          Deployment scripts
`-- tests/                            Static, integration, and runtime-audit tooling
```

## Agents Directory

Agent files live in `agents/<name>.md`. Each non-trivial agent should use file
form rather than inline OpenCode config.

Each agent file has YAML frontmatter followed by the prompt body:

```yaml
---
description: <short role description>
mode: primary | subagent | all
hidden: true      # for non-user-facing subagents
permission:
  <tool>: <rule>
---
```

The frontmatter is executable OpenCode configuration. The body is the role
contract sent to the model.

Core agents are deployed globally by `scripts/deploy-opencode-agents.sh`. After
changing any agent file, OpenCode must be restarted because config-time files are
loaded at startup.

## Skills Directory

Core skills live under `.opencode/skills/<skill-name>/SKILL.md`. Skills are not
agents. They are reusable process instructions loaded by an agent when the task
matches the skill description.

Skill frontmatter must include:

```yaml
---
name: <folder-name>
description: Use when ...
---
```

The validator checks expected skill files and basic skill metadata.

## Plugin Directory

Plugins live under `plugins/`. This project currently ships:

- `plugins/immutability.ts`
- `plugins/opencode-autonomous-gate/`
- `plugins/opencode-autonomous-loop/`

Plugins are installed by the deployment script when requested with
`--with-plugins`. They are loaded by OpenCode at startup, so changes require a
restart.

Plugins do not replace agent contracts. They enforce, observe, or correct
contract violations at runtime.

## Strategy Registry

`.opencode/strategies.json` declares loop strategies available to
`@autonomous`. Each entry contains:

- `name`
- `agent`
- `applicability`
- `status`

Active and reference entries must point to conformant hidden subagent files.
Planned entries are documented future slots.

The registry is not a general subagent registry. Research agents, reviewers,
worker subagents, and perception arms are excluded unless they satisfy the loop
strategy contract.

## Deployment Model

`scripts/deploy-opencode-agents.sh` installs or removes repo-owned OpenCode
assets. The script supports global deployment of agents, skills, and plugins.

Expected operations:

```bash
./scripts/deploy-opencode-agents.sh install
./scripts/deploy-opencode-agents.sh install --with-skills --with-plugins
./scripts/deploy-opencode-agents.sh status --with-skills --with-plugins
./scripts/deploy-opencode-agents.sh remove --with-skills --with-plugins
```

Deployment must not mutate a user's live config during validation. The validator
uses a disposable sandbox and isolated OpenCode paths.

## Runtime Artifacts

Target projects may contain runtime files created or used by agents:

- `SPEC.md` — optional current implementation brief.
- `progress.txt` — autonomous execution progress and strategy record.
- `program.md` — Karpathy loop objective, metric, constraints, and stop criteria.
- `experiments.md` — Karpathy baseline, noise, and keep/revert records.
- `.opencode/karpathy.json` — deterministic loop configuration.
- `.opencode/immutable.json` — file immutability rules.
- `.opencode/autonomous-loop/runs.json` — persisted autonomous run state.
- `.opencode/autonomous-loop/status.json` — machine-readable status snapshot.

`SPEC.md`, `progress.txt`, `program.md`, `experiments.md`, and
`.opencode/karpathy.json` are runtime or loop artifacts. They are not required to
exist in this repository unless the repository is actively carrying a current
implementation brief or loop setup. Durable project behavior belongs in `docs/`.

## Evaluation Harnesses

`evals/agent_value/` contains the deterministic agent-value benchmark. It is a
project-owned validation harness, not a runtime artifact from a single OpenCode
session.

The harness includes:

- frozen fixtures under `evals/agent_value/fixtures/`;
- golden expectations under `evals/agent_value/golden/`;
- a deterministic runner, scorer, mock/replay artifacts, and unit tests;
- generated results under `evals/agent_value/results/`, which are ignored by Git.

The root `.opencode/immutable.json` protects the frozen benchmark fixtures,
golden expectations, scorer, and tests from accidental agent edits.

## Trust And Permissions

Per-agent permissions override broad project trust. A trusted target project can
pre-authorize tools in `.opencode/opencode.json`, but read-only agents must
remain read-only because their own permission blocks take precedence.

The immutability plugin is separate from OpenCode permissions. Even if a tool is
allowed, plugin rules can still block writes to protected files.

## Validation Layers

The architecture is validated at multiple layers:

- static file presence checks;
- agent mode and permission resolution checks;
- strategy registry and contract checks;
- static prompt marker checks for key invariants;
- plugin unit tests;
- deterministic benchmark tests under `evals/agent_value/`;
- sandbox deployment checks;
- optional LLM-backed plugin hook checks;
- runtime audit checks against OpenCode logs and database state.

See `VALIDATION.md` and `testing-methodology.md` for details.

## Restart Requirement

OpenCode loads agents, skills, plugins, and config at startup. Any change to
those files requires quitting and restarting OpenCode before the behavior is
active.
