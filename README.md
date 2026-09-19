# Cuddly Winner

Cuddly Winner is a small optional OpenCode profile. Native Plan and Build remain
the default for ordinary work. Prometheus is available when a task benefits from
a durable, bounded implementation handoff.

## Profile

The installed profile contains:

- Ask: read-only short answers and narrow local research.
- Grounder: hidden, read-only evidence research.
- Prometheus: planning-only publication of one Direct agent.
- One immutability plugin, one Direct-agent publisher, one resource-selection
  rule, and the existing Playwright browser runtime.

It does not contain Reviewer, task packages, Ralph, optimization, KPI tracking,
task loops, generic skills, feedback capture, session fetch, spikes, or announce
hygiene.

## Direct Workflow

Select Prometheus for planning-ready work. It publishes one task-derived agent:

```text
.opencode/agents/generated/<name>.md
```

The file contains the task instructions, verification, and embedded edit/Bash
policy. Prometheus never replaces an existing generated agent. After publication,
quit and restart OpenCode, start a new conversation in the target project, and
select the named agent. The Direct agent owns implementation and fresh
verification; it does not stage or commit work.

The generated directory is an internal boundary. The visible agent name remains
the task-derived `<name>`, without a required prefix.

## Installation

```sh
bash scripts/deploy-opencode-agents.sh install
```

Use `status` to inspect the managed profile and `remove` to remove only
byte-identical copies or links to this repository. The installer preserves
modified files, browser settings, saved login sessions, and unrelated
configuration. It retires known old profile assets only when ownership is proven.

```sh
bash scripts/deploy-opencode-agents.sh status
bash scripts/deploy-opencode-agents.sh remove
```

Restart OpenCode after installation or any managed-profile change.

## Browser

Playwright is the only browser backend. Task work uses configured headless or
Linux virtual-display mode. A separate visible browser window exists only for
human login. See [Resource Selection](docs/RESOURCE-SELECTION.md) for the
browser, login, upload, download, and interrupted-action rules.

## Validation

```sh
npm test
bash scripts/ci.sh
```

See [Architecture](docs/ARCHITECTURE.md),
[Requirements](docs/REQUIREMENTS.md), and [Test Plan](docs/TEST-PLAN.md) for the
durable contract.
