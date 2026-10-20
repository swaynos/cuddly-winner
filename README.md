# Cuddly Winner

> Moving to OpenCode V2? Read [Migrate to Prometheus](docs/MIGRATION-TO-PROMETHEUS.md).
> The replacement [Prometheus project](https://github.com/swaynos/prometheus) is experimental.
> It is distinct from this profile's planning-only Prometheus agent.

Goal Agents are persistent named workers: they implement and explore in their root
conversation, automatically continuing partial work and failed experiments. Fresh
independent evaluators provide feedback and final acceptance. Publication, passing
partial tests and feedback do not establish completion. `goal_run(operation="inspect")`
reports the loaded `persistent-worker-v1` contract, recorded state, authority and
independent evidence; it also reads the same conversation's historical Goal checkpoint
after switching to Build/Plan. An unstarted Goal has no invented authorization.
Installation status describes disk contents; restart OpenCode (and its server for
`opencode attach`) before checking the loaded runtime through inspection.

Cuddly Winner is a small optional OpenCode profile that works seamlessly with
default OpenCode Plan and Build without altering their native behavior. Native
Build can publish through publish_goal_agent and inspect existing Goal evidence
without becoming a Goal worker or switching to Prometheus. Any new behaviors
introduced by this project work strictly within their intended surfaces.
Native Plan and Build remain the default for ordinary work. Prometheus is available
when a task benefits from a durable goal-oriented definition and independent evaluation.

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
edit/Bash policy. Creation is no-clobber; explicit revisions are fingerprint-checked. After
publication, quit and restart OpenCode, start a new conversation in the target
project, and select the named agent. The root worker calls `goal_run(operation="start")`
with the actual `completion_target` and existing `authorized_actions` before mutation,
then prepares, implements, experiments and repairs directly in that same conversation.
It uses `goal_evaluate(mode="feedback", focus=..., artifacts=[...])` for fresh
independent feedback and `goal_evaluate(mode="final", artifacts=[...])` for full
acceptance. Evaluators receive the definition, baseline, candidate and relevant
findings, never the worker's chat. Only the active evaluator can record `goal_verdict`.
Final acceptance is terminal and hash-bound to all policy-editable files and explicit
artifacts, plus baseline-present inputs/user work; a feedback pass returns to working. There are no fresh-builder cycles,
stall quotas or arbitrary default time/token/attempt limits. Explicit user resource
ceilings remain task-owned obligations with intent/receipt evidence.

The worker uses the model selected in its root session. Evaluators inherit that
model unless a verified `validator_model` override is published; `builder_model`
is removed. The exact edit-path policy permits root editing and boolean Bash access
uses `ask` when enabled. Approval is not a shell sandbox or a resource hard limit.
It does not stage or commit work.

The generated directory is an internal boundary. The visible agent name remains
the task-derived `<name>`, without a required prefix.

### Updating or removing a Goal Agent

To revise the same task, inspect the existing agent through `publish_goal_agent`,
then update it with the returned `expected_sha256` and complete definition.
Restart OpenCode and select the same agent in a fresh conversation; old validation
does not validate the revision. Creation still refuses an existing name. To remove
an agent, delete its file and restart OpenCode.

### Continuing and recovering a run

Native `session.metadata.cuddly_winner_goal` preserves the original authority and
baseline, pending actions, continuation, evaluations, feedback, validation and
findings across compaction and reload. Compaction summaries and the best-effort
Goal UI cannot grant authority or acceptance.

Cancellation, permission denial, genuine blockers and unknown action outcomes
persist as paused. After interruption or restart, use `goal_run(operation="inspect")`,
inspect receipts and evaluator activity. When paused, reconcile outcomes before
a fresh user-authorized `goal_run(operation="resume", reconciled=true)`. A status question
does not resume work. Restart never automatically replays an uncertain submission.
Native Question confirmation uses the explicit `Resume Goal` header/option; `Keep paused`
does not authorize resumption. Original baseline evidence is available on demand through
`goal_run(operation="inspect", include_baseline=true)`.
Inspection may persist a pause when interrupted activity is discovered; it starts
no task action and clears no pause. Partial implementation alone needs no republication.

Old Goal definitions without the `persistent-worker-v1` marker fail closed. Explicitly
republish them, restart and use a fresh conversation; historical stops and resource
budgets remain evidence, not allowances to reset. There is no migration or compatibility
runtime. Invalid inputs and evaluator report errors are correctable without replacing
the worker or inventing a domain-attempt quota.

## Installation

```sh
bash scripts/deploy-opencode-agents.sh install
```

The installer copies `plugins/goal/state.ts`, `plugins/goal/evidence.ts` and `plugins/goal/evaluation.ts` as
individual nested helpers alongside the two server plugins. They are imports,
not auto-loaded plugins. Status and removal track each helper separately and
preserve modified helpers and unrelated neighboring files.

Use `status` to inspect the managed profile and `remove` to remove only
byte-identical copies or links to this repository. Removal preserves modified
files. Install replaces managed entries without backups by default; use `--backup`
to preserve replaced entries under `backups/`. Runtime packages retain clean staging
and integrity checks. Browser settings, saved login sessions, and unrelated
configuration are preserved. It retires known old profile assets only when ownership is proven,
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
