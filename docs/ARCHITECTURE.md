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
and plugin sources. Ask, Karpathy, Reviewer, Grounder, and Implementation-Validator are read-only.

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

In a Git worktree, `tools/scaffold_gitignore.ts` manages exactly this root block:

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
artifacts without changing the Git index. Outside a Git worktree it does not
create `.gitignore` and reports that exclusion was skipped.

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
6. Invoke governance tools (`scaffold_gitignore`, `validate_scaffold`) when installed; scaffold exclusion is a no-op outside a Git worktree.
7. Hand off to Autonomous without waiting for a separate user request to publish.

Static publication means “complete enough to implement without inventing
requirements,” not “all commands have already passed.”
Prometheus may end without publishing only for a concrete planning blocker or a
focused, decision-changing question.

When a root, top-level Prometheus session becomes idle without both root
scaffold files, the immutability plugin sends one continuation prompt to that
same session. The continuation restates the publication gate while preserving
the agent's ability to report a concrete blocker or focused question. It is
limited to one prompt per session to prevent a self-triggering idle loop. A
managed descendant that merely inherits Prometheus's edit restrictions (for
example a Grounder child spawned before publication) is not itself Prometheus
and never receives this reminder.

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
inside the OpenCode session. Autonomous does not stage, commit, stash, reset,
switch branches, or initialize Git; the pending worktree is the human-owned
aggregate review artifact. Reviewer output is advisory.

Before validator handoff, Autonomous checks every acceptance criterion,
invariant, required output, and checklist item against the implementation and
fresh verification. Missing branches, disabled required stages, placeholder
tests, ignored verification flags, and missing outputs keep the candidate
incomplete. Missing ordinary in-scope work requires continuation. A failed
measured prerequisite that removes a core requested outcome is a failed
execution requiring renewed Prometheus planning; an explicitly optional branch
may instead be reported as skipped.

Before its final handoff, Autonomous prepares a detailed PR Contract covering
intent, implementation record, proof of function (terminal output showing exit
code 0), risk assessment, review focus, and every SPEC checklist item. It gives
that packet to `@implementation-validator` and retains the full severity-grouped
report in the delegated task result. The parent handoff lists goals and validated
outcomes, fresh command exit codes, validator verdict and unresolved gaps, then a
brief change summary with worktree state, risks, review focus, and one next human
action. It may make one bounded correction for a critical or major gap. It does
not emit `<promise>COMPLETE</promise>`.

After a complete candidate passes readiness and final verification, Autonomous
delegates to Implementation Validator. If the task tool cannot delegate then,
Autonomous stops with a concise blocked handoff. It reports command observations
as evidence, not validation, and does not claim success or label any requested
goal validated.

## Permission Semantics

Agent frontmatter sets `bash: ask` for Autonomous. Prometheus denies direct Bash
and uses approval-gated `spike` for contracted command-dependent research.
Normal OpenCode sessions ask the user before each allowed command. `opencode
--auto` converts those asks to approvals. Explicit denies, including all command
access for read-only roles, remain denied.

## Deployment

The installer deploys one complete managed profile: agents, `immutability.ts`,
the three workflow tools and pinned SDK dependency, non-core skills, and
global rule files.

Install sources are fixed repository paths. A single configuration root is
resolved from the CLI, one environment variable, or OpenCode's debug output;
`agents/`, `plugins/`, `tools/`, `skills/`, and `rules/` are derived beneath
it. One entry synchronizer handles files and directories in copy or symlink
mode, including idempotence, collision backups, status, and safe removal.

The installer also synchronizes two namespaced MCP entries through a narrow JSON
helper. One provides a headless isolated research browser (`@playwright/mcp`,
Node). The other provides authenticated access to a personal NotebookLM
account through `notebooklm-py`'s MCP server (Python). The helper backs up
before mutation, changes only its own keys, and preserves unrelated entries.
`scripts/opencode-browser-credentials.mjs` manages separate opt-in ChatGPT and
Gemini profiles outside project repositories.

### NotebookLM Runtime

This project runs exactly one Python virtual environment, named by
`.python-version` and provisioned by `scripts/ensure-venv.sh`. Test execution
and the deployed NotebookLM MCP server share that same virtualenv; there is no
separate runtime for either. On `install`, the installer runs
`ensure-venv.sh` (creating the virtualenv if absent), installs a pinned
`notebooklm-py[mcp]` into it, and writes the resolved absolute
`notebooklm-mcp` console-script path into the managed MCP entry. `status` and
`remove` resolve that same path directly from `.python-version` and `pyenv
root`, without creating a missing virtualenv just to inspect or remove a
config entry. If pyenv is absent, resolution fails outright — there is no
silent fallback to system Python, a different environment manager, or an
attempt to install pyenv itself.

The server never authenticates and exposes no auth tool: `notebooklm-py` logs
in only through its out-of-band CLI (`notebooklm login`), run once by the user
outside any agent session, and the MCP server binds whatever credentials that
login already wrote to `~/.notebooklm/`. An unauthenticated server answers
`server_info` truthfully and fails closed on every other call; nothing in this
project's tooling can trigger login, re-auth, or credential cleanup on the
user's behalf.

Every file under `rules/` deploys, name preserved, to `<config_dir>/rules/`
through the same synchronizer used for agents and skills. That alone does not
make OpenCode load the file: OpenCode only auto-loads `<config_dir>/AGENTS.md`
by fixed name, plus whatever paths are listed in the `instructions` array of
`<config_dir>/opencode.json`. `scripts/opencode-instructions.mjs` closes that
gap — a small Node helper, called by the installer after the file sync, that
adds one absolute-path entry per deployed rule file to `instructions`, and
removes it on `remove`. It edits only that one array: it parses the existing
`opencode.json`, backs it up first, refuses to touch a file that fails to
parse, and leaves every other key untouched. If `instructions` ends up empty
on removal, the key is dropped rather than left as an empty array.

Adding a rule therefore takes two steps that both happen automatically on
install: drop a file in `rules/`, and the file sync plus the instructions
helper each pick it up on their own. Nothing here compiles or concatenates
rule files — each stays a separate file, separately deployed, separately
wired.

One tradeoff: this makes the installer write into `opencode.json`, which is
also where models, providers, and every other OpenCode setting live. A bug in
the helper risks that whole file, not just the rules feature. The helper is
scoped tightly (one array, nothing else) and tested against a throwaway
config before being pointed at a real one, but this is a larger blast radius
than the rest of the installer, which only ever adds or removes whole files.

Workflow tools and the immutability plugin treat the OpenCode session directory
as the active project root. They use worktree only when no session directory is
available, preventing a stale root worktree from redirecting scaffold artifacts
or path enforcement to `/`.

Status and remove always process all current managed groups. Remove accepts
only a current repository symlink or byte-identical current copy and preserves
everything else. Retired control-plane artifacts are outside this installer and
must be removed manually if they remain from an older version.

Installation is platform-neutral. It never checks for or installs Bubblewrap,
Lima, Docker, a VM image, or a supervisor.

## Skills Architecture

Non-core skills are packaged under `skills/` and deployed by default. The
installer synchronizes every packaged skill directory into
`<config_dir>/skills/`; it does not require an inventory in installer code.

Skills reside under `<config_dir>/skills/<skill_name>/SKILL.md`. OpenCode
automatically discovers and loads skill packages at session startup. The
immutability plugin, rather than skill text, enforces role edit-tool boundaries
and command permissions. `docs/SKILLS.md` owns the inventory, package contract,
and behavior for each skill; `CONTRIBUTING.md` owns the authoring process.

### Local Feedback Locator

The installer also manages one owner-only text locator at
`<config_dir>/feedback/cuddly-winner-feedback-root`. It contains the canonical
`<clone>/feedback` path and lets the deployed recorder resolve its target from
the lexical package path in both copy and symlink installs. The recorder reads a
bounded report from standard input, creates owner-only inbox files atomically,
and has no network behavior. It fails on missing, malformed, or stale locators;
it does not scan the machine for another clone.

Install replaces a conflicting locator only after backup and is idempotent for
the same clone. Status classifies missing, current, stale, or modified locators
without reading reports. Removal deletes only an exact current locator. The
locator is deployment state, not a feedback store: the ignored clone-local
`feedback/` tree and all backups remain user-owned.

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
