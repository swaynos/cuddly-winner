# Requirements

## Product Goal

This project is a lightweight, optional extension to OpenCode. It adds specialist
roles and an explicit planning-to-implementation workflow without replacing
native Plan or Build or adding a second command-security or orchestration
platform.

## Sources of Truth

These documents divide the durable contract without duplicating it:

- `docs/REQUIREMENTS.md` defines product behavior and policy.
- `docs/ARCHITECTURE.md` defines runtime enforcement and the canonical generated
  task-package schema.
- `docs/NEXT-ITERATION.md` defines the current publication and handoff workflow
  and links to the canonical schema.
- `docs/SKILLS.md` defines the packaged skill inventory and skill behavior.

## Current Contract

The managed profile ships exactly four agents: `ask`, `grounder`, `prometheus`,
and `reviewer`. A non-reserved project-local name listed in the generated-agent
registry enters the immutability boundary, but it receives its generated policy
only when the schema-v1 registry passes registry-wide structural validation and
that agent's named package passes full schema-v1 validation. Failed validation
blocks mutation and Bash for that registry-named identity instead of treating it
as unmanaged. Reserved native and shipped names are rejected as generated
entries and cannot replace those identities. Package files for unselected
entries are outside the named validation call.

Prometheus publishes one task package through these paths, where `<id>` is a
lowercase hyphenated task id:

```text
.opencode/agents/<id>.md
.opencode/tasks/<id>.md
.opencode/tasks/<id>.json
.opencode/generated-agents.json
```

The only manifest schema is version 1. The only strategies are `direct`,
`ralph`, and `optimization`. After publication, the user must quit and restart
OpenCode, start a new conversation, and select the generated agent. The handoff
must name that agent, its brief, and its manifest. Restarting without starting a
new conversation does not provide the required fresh context.

## Rejected Contracts

The fixed `Autonomous`, `Karpathy`, and `Implementation Validator` roles are not
shipped. Packages based on `SPEC.md`, `opencode-autonomous.json`, or
`.prometheus/evaluator/`, manifests marked schema v3, and the `karpathy` strategy
are rejected.

## No Legacy Support

This project supports one current value for each versioned contract it owns.
Older or unknown scaffold and feedback-report versions are rejected, never
migrated, aliased, or upgraded in place. Prometheus republishes an outdated task
package in the current shape.

The manifest schema, manifest strategy vocabulary, registry schema, and feedback
report schema version independently. A change to one does not imply a change to
the others. Accepting a second version or strategy requires an explicit policy
change here.

## Runtime Compatibility

The repository supports Node.js `>=22.22.2 <25`. CI uses Node.js `24.15.0`.
Deployment uses the active `node` and `npm` on the user's `PATH` and currently
installs `@opencode-ai/plugin` version `1.17.15` and Playwright version `1.58.2`.
The managed profile includes a pinned Playwright browser service and matching
browser build. Playwright is the only supported browser backend, suitable for
headless work and approved headed login.
Installation records owner-only integrity state for the full runtime dependency
content trees. Status and live repository-profile preflight use that recorded
state and fail on missing or invalid state or modified, missing, or unsafe
runtime content; matching `package.json` versions alone are insufficient.

## Native Compatibility

Built-in Plan and Build, future built-ins, unknown identities, unregistered
project-local identities, and third-party agents remain outside this project's
managed-identity enforcement boundary. The generated-agent workflow must not
alias or reroute them, apply a generated manifest to them, or require a
specialist or task package for their work. Installation does add shared global
rules and plugin hooks; those hooks may enforce cross-cutting governance or
prompt and session hygiene where their own contracts apply. Native compatibility
therefore means that Plan and Build remain usable, not that every installed
prompt, tool list, or session byte remains unchanged.

A registry entry that tries to use a reserved native name remains invalid and
does not move that native identity into generated-agent enforcement. A reserved
shipped name keeps its shipped policy and cannot receive registry policy.

The project must not install its repository `AGENTS.md` globally. Ordinary
planning remains available through Plan, and ordinary implementation remains
available through Build. The generated-agent workflow starts only when the user
explicitly selects Prometheus.

## Managed Agents

A delegated session inherits the topmost managed identity in its ancestry. This
prevents delegation from widening a managed agent's edit or Bash boundary.

The current agent controls a root session. An explicit switch from Prometheus or
a registered generated agent to Plan or Build restores native write and Bash
access. Switching back reapplies that agent's policy. Ask, Grounder, and
Reviewer are read-only for their selected turn.

A child inherits its current managed parent's boundary, regardless of the
child's selected name. This prevents a managed parent from delegating to Build
to widen access. A cycle or failed, missing, mismatched, or malformed parent
lookup denies mutation and Bash; root authorization does not depend on message
history. Run KPI policy follows the current root agent. Usage remains available
when that same generated agent is selected again.

### Ask

Ask answers focused questions from session context and, when needed, cited
Grounder research. It is read-only, cannot execute Bash or governance tools, and
does not start planning or implementation workflows.

### Grounder

Grounder gathers cited local and external facts. It does not mutate files,
execute commands, delegate, or make product decisions. External claims identify
their URL. Private repository content and secrets must not be sent to third-party
services.

After the browser migration, Grounder follows `docs/RESOURCE-SELECTION.md` by
using headless Playwright for rendered research. Headed Playwright is allowed
only for a required human login after naming the target and receiving explicit
user approval.

### Reviewer

Reviewer is read-only and advisory. It maps supplied changes and verification
evidence to a rubric and ends with `APPROVE` or `REQUEST_CHANGES`. Its verdict
does not determine completion by itself, and it does not execute verification
commands.

### Prometheus

Prometheus is the explicit planning entry point. It reads repository evidence,
uses Grounder when research needs delegation, compares credible approaches, and
publishes a task-specific generated agent when the work is planning-ready. It
asks the human only when an unresolved answer would change the requested
outcome, acceptance criteria, material scope, policy, trust boundary, safety
posture, or an irreversible choice.

An empty workspace is not a planning blocker. When implementation mechanics are
open, Prometheus chooses conservative, reversible, and testable defaults. It
does not ask the user to choose formats, thresholds, geometry, seeds, quotas, or
other mechanics that a bounded implementation plan can decide.

Prometheus denies direct Bash. Its mutation tools are restricted to
`.opencode/agents/**`, `.opencode/tasks/**`,
`.opencode/generated-agents.json`, and `.spike/**`. The approval-gated `spike`
tool is its only command facility. The `scaffold_gitignore` tool may separately
manage its exact block in the project `.gitignore`.

Prometheus must establish each load-bearing empirical prerequisite used as a
completion gate. It uses existing evidence or a contracted spike. If the
evidence removes a core requested outcome, Prometheus redesigns the plan or
reports a concrete blocker. It must label an allowed degraded branch as
optional in the acceptance criteria.

Before publication, Prometheus inspects existing project-local agent and task
files, chooses a lowercase hyphenated task id, and preserves unrelated local
definitions. It asks before replacing a user-owned or materially different
agent definition.

For every planning-ready run, Prometheus publishes the four task-package paths,
invokes `scaffold_gitignore` and `validate_scaffold` when installed, and stops
before implementation. Static validation does not execute project commands and
does not prove that final verification passes.

The shipped Prometheus prompt contains the exact schema and is self-contained;
an installed profile does not need this repository's docs. Prometheus passes the
selected task id through `validate_scaffold.agent_name`. The argument is optional
only when the registry has one entry.

If a top-level Prometheus session becomes idle while
`.opencode/generated-agents.json` is absent, the immutability plugin sends one
continuation prompt to that same session. The prompt asks it to publish if the
task is ready or state one focused blocker. The reminder fires at most once per
session and never fires for a descendant that only inherits Prometheus's
boundary.

## Generated Task Package

`docs/ARCHITECTURE.md` is the canonical field-level contract for the schema-v1
registry and manifest. A complete package contains:

- one primary OpenCode agent definition at `.opencode/agents/<id>.md`;
- one durable task brief at `.opencode/tasks/<id>.md`;
- one task manifest at `.opencode/tasks/<id>.json`;
- one matching entry in `.opencode/generated-agents.json`.

The definition must read the matching brief and manifest before work. Its
frontmatter permissions must not exceed the manifest. The brief must contain the
outcome, acceptance criteria, durable context, selected strategy procedure,
limits, escalation route, exact final checks, required fresh evidence, and rules
for incomplete results.

A generated `task_id` or registry name must not reuse a native OpenCode identity
or one of the four shipped agent identities.

The package must be sufficient for a new session with no access to the planning
transcript. Generated agents cannot rewrite any published task-package file.

## Strategy Selection

Prometheus selects the smallest strategy supported by the task evidence.

### Direct

`direct` is the default for ordinary features, defects, and technical debt. Its
work-selection rule identifies the next bounded in-scope item. The generated
agent continues until the requested outcome and final evidence are complete or
a declared stop or escalation condition applies.

### Ralph

`ralph` is for incremental work where every pass has independent before-and-after
progress evidence. The package names the pass budget, durable state paths,
progress evidence on both sides of each pass, failure treatment, run-wide stop
conditions, and the launcher for later passes. A useful pass is not final
delivery.

### Optimization

`optimization` is for a scalar objective with a direction, evaluator, extraction
rule, noise policy, mutable and immutable targets, experiment budget,
keep-or-revert rule, and stop conditions. One experiment changes one bounded
lever. The generated agent records the hypothesis, measurement, and decision.

In the checked-in `examples/ml-loop` package, editable code produces only a
candidate artifact. The evaluator owns the score and derives it from that
artifact plus separate held-out data. Verification checks published immutable
hashes and proves that a forged score log cannot supply the accepted score.

## Generated Agent Execution

A generated agent implements only the published task. It uses exact
manifest-listed edit paths and the declared Bash capability. It may delegate,
but descendants retain its boundary. It cannot invoke the Prometheus-only
governance tools.

After each bounded change or focused check, the generated agent inspects the
whole task again and selects the next incomplete in-scope item. A passing focused
or phase-local check is not completion evidence while required work remains.
Missing branches, disabled required stages, placeholder tests, ignored verifier
flags, and missing outputs keep the task incomplete.

A successful result requires every requested outcome and acceptance criterion,
plus fresh evidence from every final check declared by the task. A declared
escalation condition, failed core prerequisite, exhausted safe path, or required
scope expansion produces an incomplete or blocked result instead. The agent must
state the failed step and the next action needed to proceed.

Independent judgment is task-specific. Prometheus may require human review, the
shipped advisory Reviewer, or a generated project-local read-only reviewer. No
fixed validation handoff is part of the runtime.

## Permission Model

OpenCode permissions remain the command-security boundary. Normal `ask`
permissions prompt the user. `opencode --auto` approves requests that would
otherwise ask, while explicit `deny` remains enforced.

The immutability plugin intercepts OpenCode `write`, `edit`, `patch`,
`apply_patch`, and `bash` tool calls for managed identities. It is not a
filesystem sandbox. A native command can affect any host resource available to
the OpenCode process. Documentation and prompts must not describe command output
as confined, protected, or tamper-resistant.

For a generated agent, `permissions.bash: false` creates an explicit plugin
deny. A true value allows the call to continue to OpenCode's own permission
decision. The plugin checks mutation targets against the manifest's exact
`edit_paths`; it does not interpret them as globs. Delegation cannot widen either
rule.

Prometheus and generated task packages do not provision a target project's
runtime or dependency manager. Prometheus first looks for the target project's
version pin, lockfile, or documented setup and records commands that use that
toolchain. Without such a signal, it records the bare command. The session's
ambient environment determines what the command resolves to.

## Optional Run KPIs

A schema-v1 manifest may omit `run_kpis`. Omission or `enabled: false` leaves the
KPI plugin inert. Prometheus enables the policy only after an explicit user
request and records positive values for unattended runtime, target tokens per
active minute, and the hard token budget. There are no defaults.

For an enabled policy, `plugins/autonomous-kpis.ts` tracks completed assistant
messages for the generated root session and its descendants. Token totals include
input, output, reasoning, cache-read, and cache-write tokens. Active time is the
union of completed assistant-message intervals, so overlapping child activity is
not counted twice.

The plugin adds compact guidance with the duration target, observed token use,
and observed active token rate. Before each response, it caps `maxOutputTokens`
to the remaining hard budget and rejects new work once no budget remains.
Duration and token-rate targets are observations, not delivery gates. The agent
must not sleep, pad work, widen scope, skip checks, or continue after valid
completion to improve a KPI.

The KPI plugin does not approve tools, create durable run state, prompt idle
sessions, or extend a completed task.

## Optional Generated Task Loop

`scripts/task-loop.mjs` is an optional developer script for a registered
generated agent. The installer does not deploy it, and no managed agent, plugin,
or tool depends on it.

For each configured pass, the script starts a fresh
`opencode run --agent <id> --dir <project>` session and sends no message. The
published package is the sole task input. An optional project-supplied
`--state-cmd` prints JSON counters before and after each pass; the script records
the per-key numeric delta without assigning domain meaning to it.

The script appends one JSONL evidence record per pass. By default it records a
failed pass and continues. It stops when the pass budget is exhausted, after the
configured number of measured zero-delta passes, or after a non-zero exit when
`--stop-on-failure` is set. For an optional wall budget, it measures elapsed time
after a completed pass and stops before starting the next once the budget has
been reached. It does not predict whether that next pass would overrun.

Each pass is independent. Continuity comes only from the target worktree and its
durable state. The JSONL log is evidence, not a run-state machine, protected
store, checkpoint service, or accepted final outcome.

## Workflow Tools

### Spike

`spike` runs one approved command natively from `.spike/<id>`. Prometheus must
first write `.spike/<id>/QUESTION.md` with the question and kill criterion. The
tool applies a finite timeout and output bound, uses a reduced environment,
redacts common secret shapes, and records `sandboxed: false`. It is not a
security boundary.

### Static Package Validation

`validate_scaffold` performs registry-wide structural validation of the current
schema-v1 registry, then fully validates one named schema-v1 task package. Its
optional `agent_name` selects that package and is required when more than one
entry exists. It executes no project command and does not load package files for
unselected entries. Its exact checks and limits are defined in
`docs/ARCHITECTURE.md`.

Both generated-policy plugins require the same validation before recognizing a
generated policy or enabling run KPIs. A non-reserved identity named in the
registry remains inside the immutability gate when malformed entries, duplicate
names, or an incomplete named package make validation fail, so mutation and Bash
are denied. Native or shipped reserved entries fail validation and never hijack
the reserved identity.

### Git Exclusion

`scaffold_gitignore` accepts no paths and manages only the exact block defined in
`docs/ARCHITECTURE.md`. Outside a Git worktree it skips without creating
`.gitignore` or initializing Git. It reports tracked matching artifacts but does
not change the Git index.

### Session Fetch

This subsection and the two browser subsections below describe the current
managed browser stack.

`session_fetch` supports an explicit interactive browser bootstrap, completion,
private read-only request, and close lifecycle for a configured site. A profile
defines allowed HTTPS origins and login completion outside project repositories.
The tool returns an opaque handle, accepts only `GET` and `HEAD`, and requires
explicit approval before opening headed Playwright for login. Retrieval runs
headlessly after login.

### Browser Credentials

Browser login state is stored outside project repositories with owner-only
permissions. Each record is limited to its approved HTTPS origins and contains
Playwright storage state plus any explicitly supported session-storage data.
The runtime loads values directly into a browser context; it never places them
in model context, logs, screenshots, or tool results.

Browser state is separate by site or account. The system must not use a personal
browser profile, silently share state between sites, or follow a login redirect
to an unapproved origin. Status may report names, origins, and capture times, but
not credential values. Removal affects only the selected state record.

### Browser Actions and Login

Playwright is the only browser backend. Headless Playwright performs access
checks, browsing, form entry, uploads, generation, downloads, and verification.
Headed Playwright is allowed only for a person to complete a required login.

1. Prefer local evidence, direct retrieval, or a public API when it can complete
   the task.
2. Open the target in headless Playwright and establish whether the requested
   action needs login. A login link alone is not proof.
3. If login is required, explain which site will open and obtain approval.
4. Open a dedicated headed Playwright context. Let the user log in, save the
   approved state privately, and close the headed browser.
5. Open a new headless context with the saved state and confirm access.
6. Complete and verify the task headlessly.

Interactive-element discovery must omit hidden fallback controls, include visible
rich-text controls, and report semantic disabled state. Fill operations must
read back the visible value. Click and form-submit operations must reject native,
ARIA, visually disabled, or inert targets instead of reporting a successful
dispatch. Browser status may report runtime version, headless mode, page health,
the current page address, and whether approved state was hydrated, but never the
state values or record names.

Each page wait must end before the MCP transport deadline. A wait timeout leaves
the browser context usable for inspection or another bounded poll. Explicit
navigation recreates a page when the prior page was closed and distinguishes
HTTP access denial from successful access without attempting to bypass it.

For image generation, the agent must verify the intended prompt after image mode
is selected and verify the submitted prompt in the original conversation. It
must detect a new output image associated with that submission, not an image
already present on the page.

The agent must never automatically replay a generation or other non-idempotent
action after a disconnect. It must persist intent before submission, preserve
the page address, mark an interrupted result unknown, and inspect the original
page in a new headless context before deciding whether a retry is safe.

If login is required but no GUI is available, report that login is blocked. Do
the same when the headed login fails or its state cannot be reused headlessly.
Do not complete the task in the login window, and do not claim the requested
action succeeded merely because login succeeded.

The login helper uses a dedicated temporary or managed Playwright profile. It
must reject unsafe state paths before launch, record an approved-origin state
baseline after the login page loads, and require a state change plus every
supplied completion predicate before saving. It uses a bounded login deadline,
stops the browser before cleaning temporary files, and reports launch or
early-exit errors promptly. On Linux, headed login requires `DISPLAY` or
`WAYLAND_DISPLAY`. Normal headless work does not require a graphical session.

Downloads and generated files are complete only after the expected page action,
local file placement, and file validation all pass. A page preview alone is not
a delivered file. The headless service can save a visible image or canvas
without returning its source URL to the model. It retrieves image bytes through
the active browser context, can reject a prior source fingerprint as stale, and
applies the same collision, size, content-type, signature, and hash checks used
for downloads. It rejects excessive pixel dimensions before rasterizing media.

## Deployment

Default installation deploys this exact managed profile:

| Group | Count | Sources |
| --- | ---: | --- |
| Agents | 4 | `agents/ask.md`, `agents/grounder.md`, `agents/prometheus.md`, `agents/reviewer.md` |
| Plugins | 3 | `plugins/immutability.ts`, `plugins/autonomous-kpis.ts`, `plugins/announce-hygiene.ts` |
| Tools | 4 | `tools/session_fetch.ts`, `tools/scaffold_gitignore.ts`, `tools/spike.ts`, `tools/validate_scaffold.ts` |

The three governance tools are `scaffold_gitignore`, `spike`, and
`validate_scaffold`. `session_fetch` is installed as a separate workflow tool.
Plugins and `session_fetch` always install as copies. Agent files, governance
tools, packaged skills, and rule files use the selected `copy` or `symlink`
mode.

The installer currently deploys every directory under `skills/`, every Markdown
file under `rules/`, and the pinned SDK packages. It also manages rule instruction
wiring and the feedback locator. It builds the runtime in a clean staging tree,
backs up a noncurrent live tree intact before replacement, then records a
recursive hash plus entry, file, and symlink counts for the whole `node_modules`
dependency tree in a checksummed mode-`0600` state file beneath
`<config_dir>/node_modules/`.

The installer includes pinned Playwright packages, a browser build, and control
files for headed login and headless work. It removes project-owned retired
browser files and configuration while preserving modified or unrelated user
files.

The configuration root resolves in this order: `--config-dir`,
`OPENCODE_DEPLOY_CONFIG_DIR`, then `opencode debug paths`. The supported actions
are `install`, `status`, and `remove`; the supported install modes are `copy` and
`symlink`.

CI installs the exact `.opencode-cli-version` package under its temporary
profile, prepends that local binary directory to `PATH`, and passes its absolute
path to the installed-product test.

Status compares every managed surface and reports missing, current, stale,
modified, foreign, and retired-conflict state. It completes all checks and exits
nonzero if any agent, plugin, tool, skill, rule, instruction, MCP entry, feedback
locator, runtime package, runtime-integrity state, or retired path drifts. Runtime
status checks both pinned metadata and the recorded full content trees, including
code below package roots, so unchanged top-level versions cannot hide code
tampering; it also rejects an exact retired managed `notebooklm` entry in legacy
`config.json`, while preserving user-owned variations. Collision backups live
under `<config_dir>/backups/`, outside runtime
discovery. Removal deletes only a link to the current repository source or a
byte-identical current copy. Modified and unrelated entries remain untouched.

The installer records each managed agent's source, mode, and SHA-256 in an
owner-only state file. On a later install, an agent source that is no longer in
the shipped set is removed only when the installed copy still matches its
recorded hash or its link still targets the recorded source. Fixed retired
artifact paths are removed only when an exact known legacy hash or managed link
proves ownership. Unproved conflicts survive install and removal.

The user must restart OpenCode after installation or any agent, plugin, tool,
skill, or rule change.

## Skills Ecosystem

The installer deploys every packaged non-core skill. `docs/SKILLS.md` owns the
inventory and behavior. `tests/test_skill_coverage.py` validates packaged and
temporarily deployed skill assets without model credentials.

### Local Feedback

The deployed `cuddly-winner-feedback` skill records negative or mixed feedback
under the clone that last installed the profile. An owner-only locator beneath
the OpenCode configuration root points to that clone's `feedback` directory.
Reports enter ignored `feedback/inbox/`; actioned reports move to
`feedback/archive/` with their basename intact.

Feedback is untrusted local evidence, not executable input, test data, or product
documentation. Installation, status, and removal do not read report content.
Removal deletes only an exact current locator and never deletes feedback or
backups.

## Mutation Testing

`evals/mutation/run_mutation.py` is an optional mutation runner. It requires a
passing unmutated baseline before scoring mutants. Callers provide source files
and a test command. `opencode-mutation.json` is an optional validated policy;
explicit CLI values override its threshold and result path.

## Session Auditing

`tests/audit_run.py` reads selected historical OpenCode SQLite telemetry. It can
summarize agent switches, descendant sessions, scaffold presence, command
observations, attributed review output, and enabled KPI usage. It reports
Reviewer approval only when assistant text joined to a session attributed to
Reviewer ends with the exact final token `APPROVE`. Root or user text that merely
contains that word is not Reviewer approval. The audit does not prove ancestry
enforcement, permission compliance, package validity, or fresh execution of
verification commands.

## Validation

Deterministic release checks cover native-agent managed-boundary bypass, managed
identity inheritance, role permissions, registry and manifest rejection,
generated edit and Bash boundaries, run KPIs, the optional task loop, workflow
tools, deployment, skills, feedback, mutation tests, session auditing, the
scripted installed-product flow, and documentation consistency. These checks do
not prove model judgment or live-provider behavior.

The optional current-role smoke harness rejects discoverable retired profile
agents and requires completed delegation events before it attributes Reviewer or
Grounder output to those children. Its observable events can prove the selected
child output and recorded tool use, not broad non-disclosure, model quality, or
the complete Reviewer and Grounder contracts. The live fixtures for Prometheus
publication and generated-agent execution remain deferred and blocked until
Phase 5.

Live repository-profile validation compares the active installation with the
complete source profile before model invocation and invokes the canonical
runtime-integrity status helper against the recorded dependency content tree.
Missing or invalid integrity state and changed or missing runtime code are drift,
even when package versions match. Drift fails closed and requires installation
followed by an OpenCode restart. Behavioral evidence remains
platform-specific; a missing live run leaves that platform unproven without
invalidating deterministic evidence from another platform.
