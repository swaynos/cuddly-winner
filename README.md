# Cuddly Winner

Cuddly Winner is a small optional OpenCode profile that works seamlessly with
default OpenCode Plan and Build without altering their native behavior. The only
addition to native Build is access to publish_goal_agent, so a Build session
can publish a Goal Agent without switching to Prometheus. Any new behaviors
introduced by this project work strictly within their intended surfaces.
Native Plan and Build remain the default for ordinary work. Prometheus is available
when a task benefits from a durable, bounded goal-oriented handoff.

## Profile

The installed profile contains:

- Ask: read-only short answers and narrow local research.
- Grounder: hidden, read-only evidence research.
- Prometheus: planning-only publication of one Goal Agent.
- An immutability plugin, a goal runtime plugin, one Goal Agent publisher, one resource-selection
  rule, and the existing Playwright browser runtime.

It does not contain Reviewer, task packages, Ralph, optimization, KPI tracking,
external task-loop scaffolds, generic skills, feedback capture, session fetch, spikes, or announce
hygiene.

## Goal Agent Workflow

Select Prometheus to ground and clarify a goal. It asks focused questions about
unresolved requirements, then publishes one task-derived Goal Agent:

```text
.opencode/agents/generated/<name>.md
```

The Goal Agent file contains the task instructions, verification, and embedded
edit/Bash policy. Prometheus never replaces an existing generated agent. After
publication, quit and restart OpenCode, start a new conversation in the target
project, and select the named agent. The Goal Agent owns build AND validation: each cycle
uses a fresh builder session and a separate fresh validator session. Failed
validation returns findings to another fresh builder; premature coordinator stops
resume automatically. Only validated criteria complete the goal. Cancellation,
denied permissions, and genuine blockers stop it as incomplete. It does not stage
or commit work. Both children inherit the model currently selected in the Goal
Agent session (normally the user's configured default), unless Prometheus sets a
verified `builder_model` or `validator_model` override for that role.

The generated directory is an internal boundary. The visible agent name remains
the task-derived `<name>`, without a required prefix.

### Updating or removing a Goal Agent

To update a Goal Agent, delete `.opencode/agents/generated/<name>.md`, run
Prometheus again, and restart OpenCode. To remove one, delete the file and
restart OpenCode. Publishing over an existing name fails with
`agent name already exists: <name>`; the publisher never replaces an existing
agent. The refusal is covered by `tests/plugins/publish_goal_agent.test.mjs`.

## Installation

```sh
bash scripts/deploy-opencode-agents.sh install
```

Use `status` to inspect the managed profile and `remove` to remove only
byte-identical copies or links to this repository. The installer preserves
modified files, browser settings, saved login sessions, and unrelated
configuration. It retires known old profile assets only when ownership is proven,
except that install and remove forcibly delete a file or symlink at the retired
`tools/publish_direct_agent.ts` path. `status` reports that retired file if it
still exists.

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

`npm test` runs the plugin and integration tests locally.
`bash scripts/ci.sh` validates the Node version, installs the managed profile in
an isolated temporary config, runs `npm test`, checks profile status, and removes
the isolated profile. GitHub Actions runs `bash scripts/ci.sh`.

See [Architecture](docs/ARCHITECTURE.md),
[Requirements](docs/REQUIREMENTS.md), and [Test Plan](docs/TEST-PLAN.md) for the
durable contract.
