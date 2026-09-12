# Architecture

## Boundary

Native and unmanaged OpenCode agents bypass the managed-identity branch of the
immutability and KPI plugins. Only a shipped managed identity or a
registry-recognized generated identity enters that identity-scoped enforcement.
Installed shared rules and globally loaded plugin hooks still run where their
own contracts apply, including prompt and session hygiene. This boundary does
not promise byte-for-byte unchanged native prompts or sessions.

```text
Plan / Build / unknown / unregistered local agent
  -> no managed-identity routing or permission envelope
  -> shared global rules and applicable plugin hooks may still run

Shipped or registry-recognized managed agent
  -> managed ancestry resolution
  -> identity-specific mutation and Bash rules
  -> OpenCode native permission handling
```

There is no command sandbox, virtual machine, supervisor, completion reducer,
protected evidence store, or custom run-state service.

## Managed Components

The installed profile contains these exact source groups:

| Group | Count | Sources |
| --- | ---: | --- |
| Agents | 4 | `agents/ask.md`, `agents/grounder.md`, `agents/prometheus.md`, `agents/reviewer.md` |
| Plugins | 3 | `plugins/immutability.ts`, `plugins/autonomous-kpis.ts`, `plugins/announce-hygiene.ts` |
| Tools | 4 | `tools/session_fetch.ts`, `tools/scaffold_gitignore.ts`, `tools/spike.ts`, `tools/validate_scaffold.ts` |

The tools split into one session-fetch tool and three Prometheus governance
tools: `scaffold_gitignore`, `spike`, and `validate_scaffold`.

## Identity and Immutability

`plugins/immutability.ts` recognizes the four shipped names `ask`, `grounder`,
`prometheus`, and `reviewer`. Generated handling has separate registration and
policy gates. A valid non-reserved name present in a parseable registry
`agents[]` is registered for immutability even before full validation. It
receives edit and Bash policy only after the schema-v1 registry passes
registry-wide structural validation and that name's package passes full
schema-v1 validation. If either validation fails, the registered identity stays
managed and mutation and Bash fail closed; it does not become unmanaged. Package
files for unselected entries are not loaded by that validation call.

Reserved native and shipped names never register as generated identities. The
validator rejects their entries, native identities keep native handling, and
shipped identities keep their shipped policy. A registry cannot hijack either
class. `plugins/autonomous-kpis.ts` activates a generated run-KPI policy only
after full package validation.

The plugin resolves parent sessions recursively. When it finds a managed parent,
the child inherits that parent's identity even if the child names another agent.
If no managed identity appears in a fully resolved ancestry, the plugin returns
without inspecting the call. A cycle or failed, missing, mismatched, or malformed
session lookup makes ancestry unresolved; mutation and Bash fail closed instead
of falling back to a descendant identity, and the KPI plugin stays inactive.

The generated policy is cached by agent name for the life of the plugin. This is
one reason publication hands off only after OpenCode restarts in a fresh session.

### Mutation Rules

The plugin intercepts `write`, `edit`, `patch`, and `apply_patch`. It resolves
each exposed target against the active session directory, rejects a lexical
escape, and rejects any existing symlink component between the project root and
the target.

Ask, Grounder, and Reviewer cannot mutate. Prometheus can mutate only paths
matching these publication patterns:

```text
.opencode/agents/**
.opencode/tasks/**
.opencode/generated-agents.json
.spike/**
```

A generated agent can mutate only a path that exactly equals one entry in
`permissions.edit_paths`. These entries are not globs and do not imply access to
children. A generated agent cannot mutate any published package path, including
another generated agent's package.

The following control-plane paths remain immutable to generated agents even if a
manifest lists them:

```text
tools/spike.ts
tools/validate_scaffold.ts
tools/scaffold_gitignore.ts
plugins/immutability.ts
plugins/autonomous-kpis.ts
skills/cuddly-winner-feedback/record-feedback.mjs
```

### Bash and Governance Tools

Ask, Grounder, Reviewer, and Prometheus cannot call `bash`. A generated agent
with `permissions.bash: false` cannot call it. A generated agent with
`permissions.bash: true` reaches OpenCode's native permission decision.

Only Prometheus can invoke `spike`, `scaffold_gitignore`, or
`validate_scaffold`. These tools perform their own bounded operations after the
plugin admits the call.

The plugin guards OpenCode tool calls, not filesystem effects produced by a
native process. Bash and spike commands can reach any host resource available to
the OpenCode process.

## Prometheus Publication Flow

Prometheus reads local evidence, delegates research to Grounder when useful, and
uses an approved measured spike only for a command-dependent planning
assumption. It chooses conservative, reversible defaults for unspecified
implementation mechanics and escalates only a decision that changes the
outcome, acceptance, material scope, policy, trust boundary, safety posture, or
an irreversible choice.

Publication proceeds in this order:

1. Choose `direct`, `ralph`, or `optimization` from evidence. Use `direct` by default.
2. Define exact final checks from the target project's declared toolchain.
3. Write `.opencode/tasks/<id>.md` with the full durable task brief.
4. Invoke `scaffold_gitignore` when the governance tool is installed.
5. Write `.opencode/tasks/<id>.json` using the schema in this document.
6. Write `.opencode/agents/<id>.md` as a primary agent that reads the brief and manifest.
7. Add the registry entry and invoke `validate_scaffold` with `agent_name` set to
   the selected task id when installed.

Prometheus then stops before implementation. Its final response names the agent,
brief, and manifest and instructs the user to quit and restart OpenCode, start a
new conversation, and select the generated agent.

The shipped Prometheus prompt contains the exact registry and manifest schema,
including the reserved-name and strategy rules. A copied installed profile does
not need access to this repository's docs to publish the package.

The agent definition's frontmatter must not grant more access than the manifest.
The static package validator checks that the file exists as a regular file, but
does not parse or compare its frontmatter. The publication prompt and runtime
immutability policy supply those separate safeguards.

If an own-agent Prometheus session becomes idle and
`.opencode/generated-agents.json` does not exist, the plugin sends that session
one asynchronous continuation prompt. It does not send the reminder to a child
that merely inherits Prometheus's identity, and it does not send a second
reminder in the same session.

## Canonical Task Package Schema

This section is the single canonical field contract. `docs/NEXT-ITERATION.md`
defines workflow and links here rather than repeating the schema.

### Package Paths

For task id `<id>`, a package uses exactly these locations:

```text
.opencode/agents/<id>.md
.opencode/tasks/<id>.md
.opencode/tasks/<id>.json
.opencode/generated-agents.json
```

`<id>` must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`.

### Validation Primitives

A JSON record is an object that is not `null` or an array.

The validator's canonical worktree-relative string check requires a non-empty
string that:

- contains no backslash;
- is not an absolute POSIX or Windows path;
- has no drive-letter prefix such as `C:`;
- has no slash-delimited segment that is empty, `.` or `..`.

A validated path list is a non-empty `string[]`. Every item must pass that
canonical check, and exact duplicate strings are rejected.

The implementation currently applies this path-list primitive to several fields
whose meaning is a command, evidence statement, or stop statement. In exact
terms, `verification.commands`, `verification.success_evidence`,
`verification.failure_conditions`, `escalation_triggers`, Ralph progress
evidence and run stops, and optimization stops all receive the same check. The
check does not prove that an item is an existing path, an executable command, or
a meaningful statement.

### Registry

The registry has this shape:

```json
{
  "schema_version": 1,
  "agents": [
    {
      "name": "fix-widget",
      "manifest": ".opencode/tasks/fix-widget.json"
    }
  ]
}
```

The registry must be a JSON record with `schema_version` exactly `1` and
`agents` as an array. Every entry must be a record. `name` must be a lowercase
hyphenated task id, `manifest` must pass the canonical relative-string check,
and names must be unique. Native names `build`, `plan`, `general`, `explore`,
`compaction`, `title`, and `summary`, plus shipped names `ask`, `grounder`,
`prometheus`, and `reviewer`, are reserved and rejected as generated identities.

For the named entry, the registry name must equal the manifest's `agent_name`,
and the registry path must equal `.opencode/tasks/<manifest.task_id>.json`. Its
manifest must be a complete schema-v1 manifest, and that manifest, agent
definition, and task brief must exist as regular files rather than symlinks.
Errors in the registry envelope or any entry's shape, reserved name, or duplicate
name fail every named result. The validator does not load an unselected entry's
manifest or package artifacts.

`validateTaskPackage(root, agentName)` performs registry-wide structural
validation, then fully validates the named schema-v1 package. The installed
`validate_scaffold` tool exposes the same optional `agent_name`. With no name,
validation selects a package only when the registry contains exactly one record
entry; a registry with multiple entries requires `agent_name`. Prometheus passes
the selected task id.

The validator does not reject additional keys on the registry record or its
entries. Such keys have no defined runtime meaning.

### Manifest Top Level

Every top-level key below is required except `run_kpis`. Unknown top-level keys
are rejected.

| Field | Exact contract |
| --- | --- |
| `schema_version` | The number `1`. |
| `task_id` | Lowercase hyphenated slug matching the package id pattern. |
| `agent_name` | Exactly equal to `task_id`. |
| `agent_definition` | Exactly `.opencode/agents/<task_id>.md` and canonical. |
| `task_brief` | Exactly `.opencode/tasks/<task_id>.md` and canonical. |
| `strategy` | Exactly `direct`, `ralph`, or `optimization`. |
| `permissions` | Record defined below. |
| `implementation_scope` | Validated path list. |
| `durable_context` | Validated path list. |
| `verification` | Record defined below. |
| `limits` | Record defined below. |
| `escalation_triggers` | Validated path list. |
| `strategy_config` | Strategy-specific record defined below. |
| `run_kpis` | Optional record defined below. |

### Permissions

`permissions` allows exactly these keys. Both are required.

| Field | Exact contract |
| --- | --- |
| `edit_paths` | Validated path list. Every exact item must also occur in `implementation_scope`. |
| `bash` | Boolean. |

Unknown permission keys are rejected. Runtime mutation checks use exact string
membership in `edit_paths`; they do not expand patterns.

### Verification

`verification` allows exactly these keys. All are required.

| Field | Exact contract |
| --- | --- |
| `commands` | Validated path list. |
| `success_evidence` | Validated path list. |
| `freshness` | String containing at least one non-whitespace character. |
| `failure_conditions` | Validated path list. |
| `independent_review` | `null` or a string containing at least one non-whitespace character. |

Unknown verification keys are rejected. The validator records the strings but
does not run commands or perform review.

### Limits

`limits` must be a record with `stop_conditions` as a non-empty array of
non-empty strings. This array does not receive canonical-path or duplicate
validation. The validator does not inspect or reject other keys inside
`limits`.

### Direct Strategy Config

`direct` allows exactly one `strategy_config` key:

| Field | Exact contract |
| --- | --- |
| `work_selection` | String containing at least one non-whitespace character. |

### Ralph Strategy Config

`ralph` allows exactly these keys, and all are required:

| Field | Exact contract |
| --- | --- |
| `work_selection` | Non-whitespace string. |
| `pass_budget` | Positive integer. |
| `state_paths` | Validated path list. |
| `progress_evidence_before` | Validated path list. |
| `progress_evidence_after` | Validated path list. |
| `pass_failure_treatment` | Non-whitespace string. |
| `run_stop_conditions` | Validated path list. |
| `later_pass_starter` | Non-whitespace string. |

### Optimization Strategy Config

`optimization` allows exactly these keys, and all are required:

| Field | Exact contract |
| --- | --- |
| `work_selection` | Non-whitespace string. |
| `objective` | Non-whitespace string. |
| `direction` | Exactly `minimize` or `maximize`. |
| `evaluator` | Non-whitespace canonical worktree-relative string. |
| `score_extraction` | Exactly `first float on stdout` or `last float on stdout`. |
| `noise_policy` | Non-whitespace string. |
| `mutable_targets` | Validated path list with no `*`, `?`, `[` or `]`. |
| `immutable_targets` | Validated path list with no `*`, `?`, `[` or `]`. |
| `experiment_budget` | Positive integer. |
| `keep_revert_rule` | Non-whitespace string. |
| `stop_conditions` | Validated path list. |

No exact item may occur in both target lists. The validator checks evaluator
path syntax but does not check that the evaluator exists or execute it.

### Optional Run KPI Config

When `run_kpis` is present, it must be a record with `enabled` as a boolean. If
`enabled` is `false`, no target is required and the runtime plugin remains inert.
If `enabled` is `true`, these values are required:

| Field | Exact contract |
| --- | --- |
| `unattended_runtime.target_seconds` | Positive finite number. |
| `token_burn.target_tokens_per_active_minute` | Positive finite number. |
| `token_burn.hard_budget_tokens` | Positive finite number. |

The validator does not inspect or reject other keys inside `run_kpis`,
`unattended_runtime`, or `token_burn`.

### Static Validation Boundary

`tools/validate_scaffold.ts` rejects unknown manifest, permission, verification,
and strategy-config keys, as described above. It rejects invalid identity and
path relationships, reserved generated names, malformed or duplicate registry
entries, an incomplete named manifest, and missing or non-regular named package
artifacts. These are registry-wide structural checks followed by full schema-v1
validation of the named package.

It does not execute project commands, parse the task brief, parse agent
frontmatter, compare frontmatter permissions with the manifest, check evaluator
existence, validate package files for unselected registry entries, assess
evidence freshness, or decide whether the task can succeed.

## Generated Agent Execution

The generated agent reads its brief and manifest from the worktree. The brief is
the semantic contract; the manifest is the machine-checked identity, permission,
strategy, and evidence envelope.

For `direct`, the agent applies the declared work-selection rule to bounded
in-scope items. For `ralph`, each pass must collect its declared before and after
evidence and honor pass and run stops. For `optimization`, each experiment uses
the evaluator and keep-or-revert rule without changing immutable targets.

The checked-in `examples/ml-loop` package makes that optimization boundary
concrete. Editable training code writes a fixed-schema candidate artifact. The
immutable evaluator derives the score from that artifact and separate held-out
data, immutable SHA-256 checks guard the evaluator boundary, and the regression
check confirms that a forged score log is ignored.

Completion remains agent-led. A task is complete only when its brief's outcome
and acceptance criteria are met and all declared final evidence is fresh. Static
package validation alone is not completion.

## Optional Run KPI Runtime

`plugins/autonomous-kpis.ts` resolves the root session and reads the generated
root agent's registry manifest. An enabled policy applies to that root and all
descendants.

For each completed assistant message, the plugin sums input, output, reasoning,
cache-read, and cache-write tokens. It merges overlapping assistant activity
intervals before computing active duration and tokens per active minute. Message
updates replace the same message id, and removals delete its contribution.

Before a generated response, the plugin computes remaining hard-budget tokens.
It rejects the request when none remain; otherwise it limits `maxOutputTokens` to
the smaller existing cap and remaining budget. A system addition reports targets
and current observations and tells the agent to continue only useful in-scope
work.

The duration and token-rate targets are guidance. The plugin does not sleep,
create work, approve a tool, decide completion, or persist cross-session state.

## Optional Generated Task Loop

`scripts/task-loop.mjs` is not deployed. It runs a registered generated agent as
a black box, once per pass, through a fresh
`opencode run --agent <id> --dir <project>` process with no message.

The optional `--state-cmd` executes through `/bin/sh -c` before and after a pass
and must print a JSON object. Numeric keys are diffed, with a missing numeric
value treated as zero. A pass counts as idle only when the delta is an object
with at least one numeric key and every delta is zero.

The wrapper records `pass`, `started_at`, `duration_s`, `exit_code`, `before`,
`after`, and `delta` as one append-only JSONL record. It can stop for exhausted
passes, a configured idle streak, or the first non-zero result when
`--stop-on-failure` is set. It checks elapsed wall time after a completed pass
and before starting the next one. It does not predict whether a future pass will
overrun the budget. It never stages, commits, or accepts changes.

## Workflow Tools

### Spike

`tools/spike.ts` runs a native bounded process, not a sandbox. It accepts an exact
command, safe spike id, and optional timeout. The active project root comes from
OpenCode context.

Before spawning, it verifies `.spike/<id>/QUESTION.md` contains a question and
kill criterion. It runs from `.spike/<id>`, applies finite timeout and output
bounds, uses a reduced environment, terminates the process group when needed,
redacts common secret shapes, and writes an atomic result under
`.spike/<id>/runs/`. Every result records `sandboxed: false`.

### Session Fetch

`tools/session_fetch.ts` establishes an approved interactive browser session for
a configured site and then offers private read-only HTTP retrieval through an
opaque handle. Site profiles live in `session-fetch-sites.json` under the managed
OpenCode configuration root.

The tool accepts only configured HTTPS origins and `GET` or `HEAD`. It removes
private session state on close or idle expiry. Opening the visible browser needs
explicit approval.

### Static Package Validation

`tools/validate_scaffold.ts` implements the canonical schema and package checks
in this document. It performs registry-wide structural validation and full
schema-v1 validation of the named package. It accepts an optional `agent_name`,
which is required to select one package from a multi-entry registry, and runs no
project command.

### Git Exclusion

In a Git worktree, `tools/scaffold_gitignore.ts` manages exactly this root block:

```gitignore
# BEGIN OpenCode generated task artifacts
/.opencode/generated-agents.json
/.opencode/tasks/
/.spike/
# END OpenCode generated task artifacts
```

This block is the exact `MANAGED_BLOCK` assembled by the source. The tool accepts
no path arguments, preserves unrelated bytes and existing permissions, rejects a
symlink target and malformed or duplicate markers, and writes atomically. It
reports matching artifacts that Git already tracks without changing the index.
Outside a Git worktree it skips without creating `.gitignore`.

The block covers only paths that hold generated output alone. It deliberately
leaves `.opencode/agents/` visible to Git, because that directory also holds
user-owned project agents that Prometheus must preserve, and one directory rule
cannot tell a generated definition from a hand-written one.

## Local Model History Hygiene

`plugins/announce-hygiene.ts` addresses a measured local Qwen failure where an
assistant promises an action and ends the turn before calling a tool. It applies
only when the recorded provider id starts with `ollama`.

The message transform removes an earlier completed assistant turn only when the
turn came from that provider prefix, ended with `stop`, contains no tool part,
and matches the narrow announcement shape. It always preserves the final
message. The system transform adds an intent-and-action rule for a current local
provider. Removed message ids are recorded best-effort in
`~/.local/share/opencode/announce-hygiene.jsonl`.

The provider prefix is a naming convention. A local endpoint with another name
is missed, while a remote endpoint whose id starts with `ollama` is covered
wrongly. The latter can remove its prior text turns, so provider naming must
preserve this assumption.

OpenCode loads every exported plugin function as a factory. The hygiene plugin
therefore exports only its factory and exposes test predicates through an inert
`__selftest` property. The KPI parser also guards against being called with the
plugin-factory input shape.

## Deployment

`scripts/deploy-opencode-agents.sh` supports `install`, `status`, and `remove`.
It resolves one configuration root from `--config-dir`,
`OPENCODE_DEPLOY_CONFIG_DIR`, or `opencode debug paths`, in that order.

Agent files, the three governance tools, skills, and rules use the selected copy
or symlink mode. All three plugins and `session_fetch.ts` always install as
copies. The installer deploys SDK version `1.17.15` and Playwright version
`1.58.2`, which `session_fetch` still uses; browser download is disabled during
package installation. It also bootstraps the Obscura headless browser engine
through `scripts/opencode-browser-engine.mjs`, which downloads the pinned engine
release, verifies it against a checksum, and installs it under
`cuddly-winner-browser/` in the configuration root. It populates
a clean sibling staging tree, compares it with the live runtime, backs up any
noncurrent live tree intact, and moves the staged tree into place before using
`scripts/opencode-runtime-integrity.mjs` to recursively hash the whole installed
`node_modules` dependency tree and store its SHA-256 plus entry, file, and symlink
counts in `node_modules/.cuddly-winner-runtime-integrity.json`.

The integrity helper includes relative paths, executable mode, byte length, and
file bytes in the tree hash. A symlink contributes its relative path and link
target and increments the recorded symlink count. The helper rejects a symlinked
runtime root and unsupported entries. The state has schema and owner markers,
its own checksum, and mode `0600`. `status` recomputes the tree and fails for
missing, malformed, wrongly permissioned, modified, missing, or unsafe state or
content. The live profile preflight invokes the same read-only `status`
operation, so matching package versions cannot mask changed direct or transitive
runtime code.

Every `agents/*.md`, `skills/*`, and `rules/*.md` source is discovered at run
time. The current agent glob contains exactly the four files listed in Managed
Components. Plugin and tool source arrays are fixed to the exact files in that
table.

The installer writes each rule to `<config_dir>/rules/` and uses
`scripts/opencode-instructions.mjs` to add or remove its absolute path in the
`instructions` array of `<config_dir>/opencode.json`. It changes no other config
key. A separate helper owns one namespaced browser MCP entry, `cuddly-winner-browser`,
which runs the headless Obscura engine binary and carries a `HEADLESS` environment
marker. The same helper prunes the retired `cuddly-winner-notebooklm` and
`cuddly-winner-research-browser` names by name, and the exact retired `notebooklm`
shape in legacy `config.json`; other shapes survive.
`scripts/opencode-browser-engine.mjs` bootstraps the engine: it downloads the
pinned Obscura release, verifies it against a checksum, and installs it under
`<config_dir>/cuddly-winner-browser/`. It is standalone, so another project can
install, locate, or remove the same engine under its own root.

`scripts/ci.sh` installs the CLI version named by `.opencode-cli-version` beneath
its temporary profile and selects that exact binary through both `PATH` and
`OPENCODE_E2E_BIN`.

Plugins and workflow tools use the OpenCode session directory as the project
root, falling back to the worktree only when no directory is available.

Collision backups go beneath `<config_dir>/backups/`. Status distinguishes
current copies, modified or stale copies, current links, foreign links, and
missing entries. Remove deletes only current repository links and byte-identical
copies. The managed-agent state file records source, mode, and SHA-256 so a later
install removes an absent source only when ownership still matches. Modified and
unrelated entries remain untouched.

Retired agent files are removed only when the managed-agent state proves their
recorded source and hash or link target. The three fixed retired artifact paths
use exact known legacy hashes or exact managed links as their ownership proof.
Any conflict survives install and removal. `status` continues across agents,
plugins, tools, skills, rules, retired paths, instruction wiring, MCP state,
feedback state, and runtime packages, then returns one nonzero result if any
managed surface drifted.

### Python Runtime

This repository's Python checks use one pyenv virtual environment named by
`.python-version` and provisioned by `scripts/ensure-venv.sh`. There is no system
Python fallback or alternate environment manager. These local test requirements
are not deployed into target projects.

## Skills Architecture

Every directory under `skills/` is deployed to
`<config_dir>/skills/<skill_name>/`. OpenCode discovers each `SKILL.md` at
startup. Skill text does not grant permissions; the immutability plugin and
OpenCode permission engine remain authoritative. `docs/SKILLS.md` owns the skill
inventory and package contract.

### Feedback Locator

The installer manages one owner-only text file at
`<config_dir>/feedback/cuddly-winner-feedback-root`. It contains the canonical
`<clone>/feedback` path. The recorder reads bounded standard input and writes
owner-only inbox files atomically without network access.

Install backs up a conflicting locator, status classifies it without reading
reports, and removal deletes only an exact current locator. Feedback and backups
remain user-owned.

## Mutation Testing

`evals/mutation/run_mutation.py` is an opt-in runner. It requires a passing
unmutated baseline before changing selected source files and classifying mutants.
Callers provide source files and a test command. An optional
`opencode-mutation.json` supplies validated defaults that explicit CLI values may
override.

## Session Auditing

`tests/audit_run.py` reads selected OpenCode SQLite telemetry. It reports observed
agent switches, descendant agents, root-session Bash observations, package-file
presence, attributed Reviewer output, and enabled run-KPI measurements. Reviewer
approval requires assistant text parts joined through their message records to a
selected or descendant session whose agent is `reviewer`; the combined output's
last non-empty line must equal `APPROVE`. Arbitrary root or user text does not
qualify. The report is investigative, not proof of identity enforcement, package
validity, or fresh final verification.
