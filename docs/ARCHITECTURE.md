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

## Local Model History Hygiene

`plugins/announce-hygiene.ts` addresses one measured failure in local Qwen
models: the model writes a sentence promising an action and ends the turn
without emitting the tool call. OpenCode replays assistant text back into the
conversation, so each occurrence becomes an in-context example of a turn ending
that way and the model copies itself. The rate compounds within a session.

Replaying one recorded turn against `ollama-heavy/qwen36-35b-coding`:

| History | Failures | |
| --- | --- | --- |
| intact | 13/74 (17.6%) | |
| seeded turns removed | 0/74 (0.0%) | p = 0.000069 |
| intact, plus a system prompt rule | 2/50 (4.0%) | p = 0.019 |

Removing the seeded turns is the complete fix. The prompt rule alone only
lowers the rate, which still leaves a long session likely to seed itself, so
the plugin applies both. `experimental.chat.messages.transform` drops seeded
turns from the history sent to the model; `experimental.chat.system.transform`
appends the rule.

Two removal rules keep it safe to apply blind. A turn holding any tool part is
never a candidate, so removal cannot orphan a tool result. The final entry is
always kept, because it is the turn being continued from rather than history
behind it. Each removal appends one line to
`~/.local/share/opencode/announce-hygiene.jsonl`, so the plugin cannot be
silently dead: an empty audit file alongside sessions that still stall means it
is not applying.

### Provider Scope Is A Naming Convention

The scope test is `providerID.startsWith("ollama")`. That is all it is. It
matches the provider ids configured in `config.json`, so it depends on those
ids being named consistently rather than on anything intrinsic to the endpoint.

Nothing better is available in the hook that matters.
`experimental.chat.messages.transform` receives `input: {}`: no model, no
session, no config. The only provider signal is the `providerID` stamped on
each message, judged per turn, which is the right granularity anyway because a
local turn is what contaminates the history whoever is later asked to continue
from it. The system-prompt hook does receive the current `Model` and could use
a stronger signal, but the message-removal half cannot.

It fails in two directions and they are not equally bad. A local provider named
something else, `qwen-box` say, is simply not covered and the plugin does
nothing. A remote provider named `ollama-something` would be covered wrongly
and would have turns deleted from its history; since the action is removing
messages, that is the worse error.

The prefix is kept deliberately, so a new local endpoint needs no code change.
Two stricter designs were considered and rejected for now: an explicit
allowlist of provider ids, and deriving the set at plugin init by asking the
`client` for provider config and keeping those whose `baseURL` resolves
locally. The latter is the only option where "local" means local. Adopt one of
them as soon as any provider that is not a local Ollama endpoint is given a
name beginning `ollama`.

OpenCode calls every exported function in a plugin file as a plugin factory,
passing `{ directory, worktree, client }`. An exported helper that assumes its
own argument type therefore throws during load and takes the whole file with
it. This plugin exports only its factory and reaches its predicates through an
inert `__selftest` property. The defensive guard at the top of `parseRunKpis`
in `autonomous-kpis.ts` exists for the same reason.

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

### Session Fetch

`tools/session_fetch.ts` establishes a configured site's interactive browser
session, then provides private read-only HTTP retrieval through an opaque
session handle. Site profiles live in `session-fetch-sites.json` beneath the
managed OpenCode configuration root and are maintained by
`scripts/opencode-session-fetch-sites.mjs`. The tool requires an explicit
interactive-approval argument before it opens a visible browser, accepts only
configured HTTPS origins and `GET` or `HEAD`, and removes private session state
on close or idle expiry. The tool promises authenticated session continuity.

### Static Scaffold Validation

`tools/validate_scaffold.ts` parses schema-v3 `opencode-autonomous.json`, checks
canonical worktree-relative paths and evaluator inventory, verifies required
SPEC sections, and requires SPEC and manifest verification command lists to
match exactly. It performs no command execution.

The schema fails closed on unknown versions, fields, enum values, malformed
limits, escaping paths, missing evaluator files, and incomplete Karpathy
configuration. Only the current schema version is accepted. There is no
migration path or compatibility alias for an older version; a mismatch requires
Prometheus to republish (see `docs/REQUIREMENTS.md` § No Legacy Support).

#### Manifest Schema (v3)

Both strategies require:

| Field | Contract |
| --- | --- |
| `schema_version` | Integer `3`. |
| `strategy` | `"direct"` or `"karpathy"`. |
| `invariants` | String array. |
| `implementation_scope` | Non-empty canonical worktree-relative path array. |
| `escalation_triggers` | String array. |
| `evaluator_inventory` | Canonical files under `.prometheus/evaluator/`; may be empty for Direct. |
| `verification` | Exact non-empty `commands` array plus a human-readable `baseline` string. |
| `limits` | Optional positive numeric bounds. |
| `run_kpis` | Optional disabled-by-default unattended-runtime and token-burn policy. |

Karpathy additionally requires `optimization` with objective, minimize/maximize
direction, finite baseline, score extraction, noise runs and threshold, mutable
and immutable targets, experiment and pivot limits, and target/exhaustion stop
criteria. Every evaluator inventory path must also be immutable. Direct rejects
an optimization block.

`run_kpis` is optional. When `enabled` is `true`, it requires
`unattended_runtime.target_seconds` plus
`token_burn.target_tokens_per_active_minute` and
`token_burn.hard_budget_tokens`, all positive finite numbers. When `enabled` is
`false`, it declares no targets. The validator rejects unknown nested keys and
every retired schema version.

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
2. Identify whether outcomes are measurable and select Direct or Karpathy.
3. Define acceptance criteria, implementation scope, escalation triggers, and exact final verification.
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
For Direct it implements right-sized items, uses native Bash for focused checks,
and runs exact final verification before completion. For Karpathy it delegates
proposal and analysis to the read-only strategist, applies one change, runs the
measurement through native Bash, and makes a bounded KEEP/REVERT decision.
Missing scripts, tests, documentation, and other described deliverables are
implementation targets. Autonomous applies the scaffold's bounded defaults for
unspecified mechanics and returns to Prometheus only for an outcome-changing
requirement gap.

The manifest may declare optional limits, but enforcement is agent-led inside
the OpenCode session. Autonomous stops when declared verification passes or a
required step proves impossible to complete with any tool or permission
available in this session. A successful stop additionally requires all requested
outcomes, acceptance criteria, invariants, required outputs, and checklist items
to be complete and every exact final command to pass freshly. Autonomous does
not stage, commit, stash, reset, switch branches, or initialize Git; the pending
worktree is the human-owned aggregate review artifact. Reviewer output is advisory.

When an enabled `run_kpis` block is present, the deployed KPI plugin records
completed assistant-message usage for the Autonomous root and its descendants.
It deduplicates message updates, unions overlapping assistant activity intervals,
adds compact enabled-only guidance, and caps each new response to the remaining
hard token budget. It does not auto-approve tools, create progress state, prompt
idle sessions, or extend a completed task. Missing or disabled `run_kpis` leaves
the plugin inert.

After each bounded step or focused check, Autonomous inspects the complete scope
again and advances to the next incomplete in-scope item without a progress
handoff. A passing focused, fixture, synthetic, phase-local, or batch check is a
phase gate, not completion evidence while required work remains. Intermediate
metadata and leads cannot replace a required full result. Declared escalation
conditions, failed core prerequisites, and structural blockers remain valid halt
paths.

Before validator handoff, Autonomous checks every acceptance criterion,
invariant, required output, and checklist item against the implementation and
fresh verification. Missing branches, disabled required stages, placeholder
tests, ignored verification flags, and missing outputs keep the candidate
incomplete. Missing ordinary in-scope work requires continuation. A failed
measured prerequisite that removes a core requested outcome is a failed
execution requiring renewed Prometheus planning; an explicitly optional branch
may instead be reported as skipped.

For tool-dependent work, Autonomous first compares the scaffold's preferred
operation with the operations and parameters actually exposed in the current
session. Missing optional output, export, or convenience APIs require a safe
in-scope fallback, not a blocked handoff. It records the unavailable operation
and fallback when they affect reproducibility. Only exhaustion of all safe paths
available to its current identity and permissions creates a structural blocker.

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

When exhausted safe paths would otherwise cause a terminal negative handoff,
Autonomous takes one creative pass at a safe, reversible alternative within the
unchanged requested outcome, acceptance criteria, and permissions. Missing
scaffolds, ordinary user approval, and planning decisions do not enter this
recovery step. On a confirmed block, Autonomous reports the failed step, a
concise blocker code, and the exact next human action, and records it with
`cuddly-winner-feedback` when that skill is available.

The optional `scripts/autonomous-loop.mjs` wrapper provides an external loop
over Autonomous for open-ended, incremental workloads. It spawns one fresh
Autonomous session per pass with no message, so the scaffold drives the work. It
optionally reads project-supplied JSON counters before and after each pass and
records a per-pass JSONL evidence log. It is a developer script, not part of the
managed profile: the installer never deploys it, it runs outside any OpenCode
session, and it changes no agent prompt or permission. Autonomous keeps its
one-invocation completion contract inside each pass, and the wrapper adds no
cross-session resume. See docs/REQUIREMENTS.md § External Loop Wrapper.

## Permission Semantics

Agent frontmatter sets `bash: ask` for Autonomous. Prometheus denies direct Bash
and uses approval-gated `spike` for contracted command-dependent research.
Normal OpenCode sessions ask the user before each allowed command. `opencode
--auto` converts those asks to approvals. Explicit denies, including all command
access for read-only roles, remain denied.

## Deployment

The installer deploys one complete managed profile: agents, plugins
(`immutability.ts`, `autonomous-kpis.ts`, `announce-hygiene.ts`), the four
workflow tools and pinned SDK dependency, non-core skills, and global rule
files.

Install sources are fixed repository paths. A single configuration root is
resolved from the CLI, one environment variable, or OpenCode's debug output;
`agents/`, `plugins/`, `tools/`, `skills/`, and `rules/` are derived beneath
it. One entry synchronizer handles files and directories in copy or symlink
mode, including idempotence, collision backups, status, and safe removal. The
plugins and session-fetch tool always install as copies, even in symlink mode,
so their local state resolves from the selected configuration root.

For each current managed source, status compares content or the resolved link
target and reports `current copy`, `stale or modified copy`, `current link`,
`foreign link`, or `missing`. Equivalent relative links count as current. Status
does not change files and returns a managed-entry summary with install-and-restart
guidance when drift exists. Retired-agent, MCP, rule-instruction, and feedback-
locator diagnostics retain their separate ownership-specific labels.

Collision backups are written beneath `<config_dir>/backups/` with their managed
relative path, not beside the live entry. This prevents a backed-up skill package
from remaining discoverable. Status identifies legacy `<skill>.bak.*`
directories beside current managed skills; install moves those directories into
the central backup tree without deleting their contents.

The installer also synchronizes one namespaced MCP entry through a narrow JSON
helper: a headless isolated research browser (`@playwright/mcp`, Node). It backs
up before mutation, changes only its own keys, preserves unrelated entries, and
prunes retired managed entries left by earlier installs.
`scripts/opencode-browser-credentials.mjs` manages separate opt-in ChatGPT and
Gemini profiles outside project repositories.

The installer installs the pinned Playwright library with browser download
disabled. It does not launch a browser.

### Python Runtime

This project runs exactly one Python virtual environment, named by
`.python-version` and provisioned by `scripts/ensure-venv.sh` (creating it if
absent). Test execution uses that virtualenv. If pyenv is absent, resolution
fails outright — there is no silent fallback to system Python, a different
environment manager, or an attempt to install pyenv itself.

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

The installer records each managed agent's source, mode, and SHA-256 in an
owner-only state file beneath `<config_dir>/agents/`. On a later install it
reconciles that inventory against the current agent sources, removing a retired
agent only when its copy still matches the recorded hash or its symlink still
targets the recorded source. Status reports retained retired agents. Modified
and unrelated entries remain untouched. A bootstrap inventory covers exact
copies of agents retired before state tracking began.

Remove always processes current managed groups. It accepts only a current
repository symlink or byte-identical current copy and preserves everything else.

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
agent switches, non-attributable root-session Bash observations, recursive
descendant agents, current scaffold-file presence, completion/review tokens, and
enabled run-KPI activity duration, token totals, and token rate. It is an investigative
reporting aid, not proof of ancestry enforcement, tool-boundary compliance,
scaffold validity, or fresh verification-command execution.

Before live managed-agent scenarios invoke a model, `tests/verify_opencode.py`
compares the complete active managed profile and effective agent metadata with
this clone. Default repository-profile validation fails closed on drift. The
explicit active-profile diagnostic mode labels its results separately and never
claims that repository sources were validated. Feedback-derived live scenarios
copy the active config to a temporary root, resolve a sentinel agent from that
custom directory to prove it is loaded, and redirect the feedback locator before
invoking a model.
