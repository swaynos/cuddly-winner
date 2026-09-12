# OpenCode Generated-Agent Workflows

This project adds optional specialist agents, task-specific generated agents,
plugins, workflow tools, skills, and shared rules to OpenCode. The
generated-agent workflow does **not** replace, wrap, redirect, restrict, or
require OpenCode's built-in Plan and Build modes. Installation does add global
shared rules and plugin hooks, so cross-cutting governance and prompt or session
hygiene can still affect native sessions.

Use native Plan and Build for ordinary work. Select Prometheus when a task needs
a durable brief, explicit permissions, and a fresh generated-agent execution
session.

## Documentation

The durable source of truth lives in `docs/`:

- [ARCHITECTURE.md](docs/ARCHITECTURE.md): System architecture, identity boundaries, plugins, tools, and deployment.
- [REQUIREMENTS.md](docs/REQUIREMENTS.md): Product goals, permissions, agent roles, and validation rules.
- [NEXT-ITERATION.md](docs/NEXT-ITERATION.md): Generated task-agent packages and fresh-context execution.
- [SKILLS.md](docs/SKILLS.md): Skill contracts, catalog, and shared package rules.
- [RESOURCE-SELECTION.md](docs/RESOURCE-SELECTION.md): Research source and browser credential policy.
- [TEST-PLAN.md](docs/TEST-PLAN.md): Evidence classes, test cases, and platform coverage.
- [USE-CASES.md](docs/USE-CASES.md): Native compatibility, planning, execution, review, and auditing examples.
- [TESTING-METHODOLOGY.md](docs/TESTING-METHODOLOGY.md): Runtime evidence, verdicts, and harness conventions.
- [CONTRIBUTING.md](CONTRIBUTING.md): Process for adding or changing a packaged skill.

## Runtime Boundary

The managed profile ships four agents: Ask, Grounder, Prometheus, and Reviewer.
Prometheus creates task-specific project agents when requested. Generated agents
are project-local output, not fixed agents installed by this repository.

The project defines agent roles, edit-tool boundaries, and small workflow
helpers. It does not provide a command sandbox, virtual machine, protected
runner, custom completion engine, or completion supervisor. Native subprocess
effects remain outside edit-tool path interception.

Only schema version 1 task packages are valid. Prometheus must republish a
package that the current validator rejects.

## Installation

The installer deploys the complete managed profile from the current source
directories:

- four agent definitions from `agents/`;
- three plugins from `plugins/`;
- four tools from `tools/`;
- nine packaged skill directories from `skills/`;
- two shared rule files from `rules/`.

It also installs the pinned OpenCode plugin SDK and Playwright runtime, bootstraps
the pinned headless Obscura browser engine and registers the `cuddly-winner-browser`
MCP that runs it, registers the shared rule files in OpenCode's instructions, and
installs the local feedback locator.

```bash
bash scripts/deploy-opencode-agents.sh install
```

OpenCode loads agents, plugins, and tools at startup. Quit and restart OpenCode
after installation or any managed-profile change.

Use `status` to inspect every managed surface. It reports current copies, current
repository links, stale or modified copies, foreign links, missing entries,
retired conflicts, discoverable skill backups, rule registration, MCP
configuration, runtime packages, and feedback locator state. It aggregates all
drift instead of stopping at the first fault and exits nonzero when any managed
surface drifts. Use `--mode symlink` for live development installs. Plugins and
`session_fetch` remain copied so their runtime state resolves from the selected
configuration root.

Backups live under `<config_dir>/backups/`, outside OpenCode's discovery
directories. `remove` deletes only byte-identical managed copies or links to the
current repository and preserves modified or unrelated entries. Retired files
are deleted only when a recorded source and hash, a known legacy hash, or an
exact managed link proves ownership. A conflict at a retired path survives
install and removal and makes `status` nonzero. Set the root with `--config-dir`
or `OPENCODE_DEPLOY_CONFIG_DIR` when OpenCode's debug output is not the desired
target.

## Shipped Agents

- **Ask** answers focused questions from session context, gathers only the
  smallest needed evidence, and may delegate broad research to Grounder. It is
  read-only and points ordinary implementation requests to built-in Build.
- **Grounder** gathers cited local and external evidence for another agent. It
  is read-only and does not make product decisions.
- **Prometheus** resolves material planning uncertainty, may run approved
  contracted spikes, and publishes a registered generated-agent task package.
  It stops before implementation.
- **Reviewer** checks the current task brief and manifest or a supplied rubric
  and diff. It is read-only, returns an advisory verdict, and does not own final
  verification.

These agents are selected explicitly. They do not alias or reroute native Plan
or Build. Global shared rules and plugin hooks remain active independently of
that routing boundary.

## Generated-Agent Workflow

For a planning-ready task, Prometheus publishes these project-local files:

```text
.opencode/agents/<task-id>.md
.opencode/tasks/<task-id>.md
.opencode/tasks/<task-id>.json
.opencode/generated-agents.json
```

The Markdown task brief records the outcome, acceptance criteria, durable
context, strategy, limits, escalation route, exact checks, and required fresh
evidence. The JSON manifest uses schema version 1 and defines implementation
scope, edit paths, Bash access, strategy settings, and final verification. The
registry maps the generated agent name to that manifest.

The shipped Prometheus prompt embeds the exact schema, so a copied installed
profile does not need this repository's docs to publish a package. Prometheus
validates the selected task id, then names the generated agent, brief, and
manifest in its handoff. The user quits and restarts OpenCode, starts a new
conversation, and selects that generated agent. The fresh session reads the
brief and manifest, implements the task, and runs final verification within the
manifest permissions. The generated agent cannot rewrite its published package
or the profile's trusted control files.

Reviewer may assess the resulting diff and evidence, but its verdict remains
advisory. The generated agent still owns implementation and fresh final
verification.

## Shipped Plugins

- **Immutability guard** (`plugins/immutability.ts`) keeps Ask, Grounder, and
  Reviewer read-only; limits Prometheus writes to task-package and spike paths;
  recognizes a generated agent only after registry-wide structural validation
  and full schema-v1 validation of that agent's named package; and applies the
  declared edit and Bash permissions to it and its descendants.
- **Generated-agent KPI guard** reads an optional enabled `run_kpis` policy from
  a named package that passes the same checks. It tracks completed
  assistant usage for the generated-agent session tree, injects compact status
  guidance, caps a response to the remaining token budget, and blocks new work
  after budget exhaustion. It does not approve tools or keep a completed task
  running. Malformed or duplicate registry entries, an incomplete named
  manifest, and names reserved for native or shipped agents cannot activate
  either generated policy. Package files for unselected entries are not loaded
  by that check.
- **Announce hygiene** (`plugins/announce-hygiene.ts`) applies only to provider
  IDs beginning with `ollama`. It removes prior assistant turns that promised an
  action but made no tool call, preserves turns containing tool parts, adds a
  same-turn action rule, and writes a best-effort audit record.

## Shipped Tools

- `spike` runs an approval-gated command from a contracted `.spike/<id>`
  directory. It enforces a timeout and output bound, records redacted results,
  and reports `sandboxed: false`.
- `validate_scaffold` performs registry-wide structural checks and full
  schema-v1 validation of the named package without running project commands.
  Its optional `agent_name` selects a package and is required when the registry
  has more than one entry. Prometheus passes its selected task id.
- `scaffold_gitignore` manages one root-anchored block for the generated-agent
  registry, task files, and spike records. It preserves unrelated content and
  permissions, refuses unsafe targets, and reports managed artifacts that Git
  already tracks without changing the index.
- `session_fetch` opens an explicitly approved interactive login for a configured
  HTTPS site, then makes private `GET` or `HEAD` requests through an opaque
  session handle. It restricts origins and redirects, bounds response size, and
  removes session state on close or idle expiry.

## Local Feedback

The deployed `cuddly-winner-feedback` skill records negative or mixed feedback
from any project in the installing clone's local `feedback/inbox/` directory.
This ignored tree can contain private paths, session IDs, or excerpts. The skill
never uploads, stages, commits, or force-adds feedback.

If the clone moves or the recorder reports a stale locator, reinstall from that
clone. `status` reports locator state, and `remove` removes only an exact current
locator. Neither command reads or deletes feedback.

## Validation

Never use system Python in this repository. Provision the pyenv virtual
environment before running Python checks:

```bash
PYTHON="$(bash scripts/ensure-venv.sh)"
"$PYTHON" tests/verify_opencode.py --skip-llm
node --test tests/plugins/*.test.mjs tests/integration/*.test.mjs
"$PYTHON" tests/test_skill_coverage.py --skip-llm
```

The deterministic OpenCode suite checks the shipped roster, generated-agent
publication contract, permissions, installer output, and pinned tool runtime.
The seed-build canonical input contains only the seed and generated-agent
package, never oracle or reference implementation code. A build result requires
an exact completed Bash tool event for every manifest verification command
before the harness independently replays those commands. Dry-run reports and
events are explicitly marked `DRY-RUN (STUB)` and prove plumbing only.
These deterministic harness results do not prove model judgment or live-provider
behavior.

The checked-in `examples/ml-loop` optimization package gives score ownership to
the evaluator: it computes the score from the candidate artifact and held-out
data, checks published immutable hashes, and ignores a forged score log.

Optional live smoke checks require the current installed profile, reject
discoverable retired profile agents, and require completed task-delegation
events before attributing Reviewer or Grounder output to those children. These
smokes do not replace the Phase 5 frozen behavioral fixtures. The live fixtures
for Prometheus publication and generated-agent execution remain deferred and
blocked until Phase 5.
