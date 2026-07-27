# Architecture

## Boundary

Native OpenCode agents bypass this extension. Only explicitly selected managed
agents enter the identity-scoped plugin:

```text
Plan / Build / unknown agents -> OpenCode unchanged

Managed agent
  -> ancestry-based identity resolution
  -> fixed edit-tool boundary
  -> managed workflow tools
  -> OpenCode native permissions for commands
```

There is deliberately no command sandbox, Linux-only runtime, virtual machine,
supervisor, completion reducer, or protected evidence subsystem.

## Identity And Immutability

The immutability plugin resolves the topmost managed ancestor. If no managed
identity is found, it returns before inspecting tools or paths.

Prometheus can edit only the four scaffold path families. Autonomous can edit
ordinary files but cannot edit the published scaffold or this extension's tool
and plugin sources. Ask, Karpathy, Reviewer, and Grounder are read-only.

The plugin intercepts OpenCode mutation tools. It is not a filesystem sandbox.
Native subprocess effects are outside path interception. Prometheus and Autonomous
both use `bash: ask`, so each command requires user approval and auto mode may
approve it. Explicit command denies for read-only roles remain enforced.

The immutability plugin is part of the managed profile and does not affect
native OpenCode agents.

## Workflow Tools

### Spike

`tools/spike.ts` is a native bounded process helper, not a security boundary. It
accepts an exact command, spike identifier, and optional timeout. The project
root comes from OpenCode context; callers cannot choose another root.

Before spawning, it verifies `.spike/<id>/QUESTION.md` contains a question and
kill criterion. It uses `.spike/<id>` as the process working directory, a reduced
environment, finite timeout, bounded output, process-group termination, common
secret redaction, and atomic result persistence under `.spike/<id>/runs/`.

Every result includes `sandboxed: false`. The command may read or mutate any
resource available to the OpenCode process. OpenCode approval is the trust
decision, and `--auto` intentionally approves it.

### Static Scaffold Validation

`tools/validate_scaffold.ts` parses schema-v1 `opencode-autonomous.json`, checks
canonical worktree-relative paths and evaluator inventory, verifies required
SPEC sections, and requires SPEC and manifest verification command lists to
match exactly. It performs no command execution.

The schema fails closed on unknown versions, fields, enum values, malformed
limits, escaping paths, missing evaluator files, and incomplete Karpathy
configuration. There is no pre-1.0 migration path; mismatches require
Prometheus to republish.

#### Manifest Schema (v1)

Both strategies require:

| Field | Contract |
| --- | --- |
| `schema_version` | Integer `1`. |
| `strategy` | `"ralph"` or `"karpathy"`. |
| `invariants` | String array. |
| `implementation_scope` | Non-empty canonical worktree-relative path array. |
| `escalation_triggers` | String array. |
| `evaluator_inventory` | Canonical files under `.prometheus/evaluator/`; may be empty for Ralph. |
| `verification` | Exact non-empty `commands` array plus a human-readable `baseline` string. |
| `limits` | Optional positive numeric bounds using only documented keys. |

Karpathy additionally requires `optimization` with objective, minimize/maximize
direction, finite baseline, score extraction, noise runs and threshold, mutable
and immutable targets, experiment and pivot limits, and target/exhaustion stop
criteria. Every evaluator inventory path must also be immutable. Ralph rejects
an optimization block.

### Git Exclusion

`tools/scaffold_gitignore.ts` manages exactly this root block:

```gitignore
# BEGIN OpenCode Autonomous artifacts
/SPEC.md
/opencode-autonomous.json
/.prometheus/evaluator/
/.spike/
# END OpenCode Autonomous artifacts
```

It accepts no paths, preserves unrelated content and permissions, rejects
symlinks and malformed markers, writes atomically, and reports tracked generated
artifacts without changing the Git index.

## Prometheus Flow

Prometheus runs a deliberation loop before asking the human anything. It uses
whatever tools are available in the session — bash, web search, connected MCPs,
Grounder research, measured spikes — to resolve uncertainties internally. It
escalates to the human only when available research paths are exhausted and the
answer is required to proceed. When context is too thin to constrain a decision,
creative liberty is implied. Unspecified implementation mechanics receive
conservative, reversible, and testable defaults in the scaffold; they are not
planning blockers unless they change outcome, acceptance, material scope,
policy, trust, safety, or an irreversible tradeoff.

When Prometheus identifies that outcomes are measurable — a clear metric,
direction, and evaluator exist — it recommends Karpathy mode in the scaffold.

Publication order is:

1. Run the deliberation loop: investigate, resolve, apply creative liberty, or escalate with a focused question.
2. Identify whether outcomes are measurable and select Ralph or Karpathy.
3. Define acceptance criteria, implementation scope, escalation triggers, limits, and exact final verification.
4. Create optional evaluator and spike assets.
5. Write `opencode-autonomous.json` and `SPEC.md` before the final Prometheus response.
6. Invoke governance tools (`scaffold_gitignore`, `validate_scaffold`) when installed.
7. Hand off to Autonomous without waiting for a separate user request to publish.

Static publication means “complete enough to implement without inventing
requirements,” not “all commands have already passed.”
Prometheus may end without publishing only for a concrete planning blocker or a
focused, decision-changing question.

When a Prometheus session becomes idle without both root scaffold files, the
immutability plugin sends one continuation prompt to that same session. The
continuation restates the publication gate while preserving the agent's ability
to report a concrete blocker or focused question. It is limited to one prompt
per session to prevent a self-triggering idle loop.

## Autonomous Flow

Autonomous reads the unchanged scaffold and chooses only the declared strategy.
For Ralph it implements right-sized items, uses native Bash for focused checks,
and runs exact final verification before completion. For Karpathy it delegates
proposal and analysis to the read-only strategist, applies one change, runs the
measurement through native Bash, and makes a bounded KEEP/REVERT decision.
Missing scripts, tests, documentation, and other described deliverables are
implementation targets. Autonomous applies the scaffold's bounded defaults for
unspecified mechanics and returns to Prometheus only for an outcome-changing
requirement gap.

The manifest provides limits and stop conditions, but enforcement is agent-led
inside the OpenCode session. Reviewer output is advisory. Final status reports
include commands, observed results, remaining blockers, and any unverified work.

## Permission Semantics

Agent frontmatter sets `bash: ask` for both Prometheus and Autonomous. Normal
OpenCode sessions ask the user before each command. `opencode --auto` converts
those asks to approvals. Explicit denies, including all command access for
read-only roles, remain denied.

## Deployment

The installer deploys one complete managed profile: agents, `immutability.ts`,
the three workflow tools and pinned SDK dependency, and non-core skills.
`--with-workflow-tools` and `--with-skills` remain accepted compatibility
no-ops.

Install sources are fixed repository paths. A single configuration root is
resolved from the CLI, one environment variable, or OpenCode's debug output;
`agents/`, `plugins/`, `tools/`, and `skills/` are derived beneath it. One entry
synchronizer handles files and directories in copy or symlink mode, including
idempotence, collision backups, status, and safe removal.

Status and remove always process all current managed groups. Remove accepts
only a current repository symlink or byte-identical current copy and preserves
everything else. Retired control-plane artifacts are outside this installer and
must be removed manually if they remain from an older version.

Installation is platform-neutral. It never checks for or installs Bubblewrap,
Lima, Docker, a VM image, or a supervisor.

## Skills Architecture

Non-core skills are packaged under `skills/` and deployed by default:

- `local-word-document`: Manipulate and format document files.
- `playwright-image-generation`: Visual evaluation and DOM screenshot generation.
- `project-agent-scaffolding`: Project layout and agent configuration generation.
- `subagent-driven-development`: Subagent delegation patterns and isolation.
- `systematic-debugging`: Root-cause diagnosis protocols.
- `test-driven-development`: Red-green-refactor loop patterns.
- `verification-before-completion`: Evidence-gathering protocols before completion claims.
- `writing-skills`: Custom skill packaging and frontmatter formatting.

Skills reside under `<config_dir>/skills/<skill_name>/SKILL.md`. OpenCode automatically discovers and loads skill packages at session startup. The immutability plugin, rather than skill text, enforces role edit-tool boundaries and command permissions.

## Mutation Testing Framework

`evals/mutation/run_mutation.py` is a standalone, opt-in Python mutation runner.
Callers provide source files and a test command explicitly on its CLI. They may
provide the result path and threshold directly or through `--config
opencode-mutation.json`; explicit CLI values override policy values. The runner
requires the unmutated baseline test command to pass before it mutates selected
source files and classifies mutants.

## Session Auditing System

`tests/audit_run.py` inspects selected historical session telemetry in OpenCode's
SQLite database (`~/.local/share/opencode/opencode.db`). It reports observed
agent switches, non-attributable root-session Bash observations, direct child-session agents, current
scaffold-file presence, and completion/review tokens. It is an investigative
reporting aid, not proof of ancestry enforcement, tool-boundary compliance,
scaffold validity, or fresh verification-command execution.
