# Cuddly Winner

Cuddly Winner is a small optional OpenCode profile that works seamlessly with
default OpenCode Plan and Build without altering their native behavior. Any new
behaviors introduced by this project work strictly within their intended surfaces.
Native Plan and Build remain the default for ordinary work. Prometheus is available
when a task benefits from a durable, bounded implementation handoff.

## Profile

The installed profile contains:

- Ask: read-only short answers and narrow local research.
- Grounder: hidden, read-only evidence research.
- Prometheus: planning-only publication of one Direct agent.
- An immutability plugin, a Direct goal plugin, one Direct-agent publisher, one resource-selection
  rule, and the existing Playwright browser runtime.

It does not contain Reviewer, task packages, Ralph, optimization, KPI tracking,
external task-loop scaffolds, generic skills, feedback capture, session fetch, spikes, or announce
hygiene.

## Direct Workflow

Select Prometheus to ground and clarify a goal. It asks focused questions about
unresolved requirements, then publishes one task-derived agent:

```text
.opencode/agents/generated/<name>.md
```

The file contains the task instructions, verification, and embedded edit/Bash
policy. Prometheus never replaces an existing generated agent. After publication,
quit and restart OpenCode, start a new conversation in the target project, and
select the named agent. The Direct agent owns build AND validation: each cycle
uses a fresh builder session and a separate fresh validator session. Failed
validation returns findings to another fresh builder; premature coordinator stops
resume automatically. Only validated criteria complete the goal. Cancellation,
denied permissions, and genuine blockers stop it as incomplete. It does not stage
or commit work. Both children use the selected model unless Prometheus pins a
verified provider/model identifier in the generated agent.

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
