# Requirements

## Product Goal

This project is a lightweight, optional extension to OpenCode. It adds specialist
roles and explicit planning-to-implementation workflows without replacing native
Plan or Build and without implementing a second command-security or orchestration
platform.

`docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, and `docs/SKILLS.md` are the
durable source of truth. `SPEC.md` and `opencode-autonomous.json` are transient
task scaffolds.

## No Legacy Support

This project supports exactly one current version of each contract it owns: the
scaffold manifest `schema_version`, the manifest `strategy` vocabulary, and the
feedback-report `schema_version`. Each has a single current value. An older or
unknown value is rejected, never migrated, aliased, or auto-upgraded. There is no
backward compatibility layer and no migration path.

Consumers keep their own artifacts current. When a scaffold predates the current
schema, Prometheus republishes it; the project never reads the old shape. Adding
a second accepted version, reviving a retired strategy, or introducing a shim is
a change to this policy, not an ordinary feature.

Each contract versions independently, so "one current version" is per contract.
The manifest and the feedback report do not share a version, and a
repository-wide bump must never rewrite one to match the other.

## Runtime Compatibility

The repository supports Node.js `>=22.22.2 <25`. This floor matches the
transitive `ini@7` dependency used by the OpenCode plugin runtime. CI uses
Node.js `24.15.0`, and local deployment uses the active `node` and `npm` on
the user's PATH.

## Native Compatibility

Built-in Plan and Build, future built-ins, unknown identities, and third-party
agents remain outside this project's enforcement boundary. Installation must not alter
their prompts, routing, tools, Bash access, permissions, or completion behavior.
They never require a SPEC, specialist agent, plugin, or workflow tool.

The project must not install its repository `AGENTS.md` globally and must not
direct ordinary planning to Prometheus or ordinary implementation to Autonomous.

## Managed Agents

The managed identities are `ask`, `prometheus`, `autonomous`, `karpathy`,
`reviewer`, `grounder`, and `implementation-validator`. They are selected explicitly or delegated internally. Delegated sessions
inherit the topmost managed ancestor's identity so delegation cannot widen that
agent's edit-tool boundary.

### Ask

Ask answers focused questions from session context and, when necessary, cited
Grounder research. It is read-only, cannot execute commands, and does not start
planning or implementation workflows.

### Prometheus

Prometheus owns planning readiness. It runs a deliberation loop before asking
the human anything: it investigates using whatever tools are available in the
session — bash commands, web search, connected MCPs, Grounder research — and
resolves uncertainties internally. It escalates to the human only when available
research paths are exhausted and the answer is required to proceed. When context
is too thin to constrain a decision, creative liberty is implied and Prometheus
proceeds without asking.

An empty workspace is not a planning blocker. Prometheus treats a delivery
medium, such as browser versus CLI, as an implementation mechanic unless the
user makes it an outcome constraint. For an otherwise unspecified simple
calculator request, it publishes a Direct scaffold for a zero-dependency static
browser calculator rather than asking the user to choose a platform or basic
operations.

Prometheus may edit only `SPEC.md`, `opencode-autonomous.json`,
`.prometheus/evaluator/**`, and `.spike/**`. It denies direct Bash and uses the
approval-gated `spike` tool for contracted command-dependent research. Governance
tools (`spike`, `validate_scaffold`, `scaffold_gitignore`) remain available when
installed.

Before publication, Prometheus establishes every load-bearing empirical
prerequisite used by its acceptance criteria. It uses existing evidence or a
contracted spike. If missing evidence eliminates a core requested outcome, it
redesigns or reports a planning blocker; it does not relabel a degraded result as
success. Acceptance criteria must mark any allowed degraded branch as optional.

### Autonomous

Autonomous owns implementation and final verification. It reads the published
scaffold, executes bounded right-sized work, makes reversible implementation
decisions within scope, and returns only outcome-changing product or policy
ambiguity to Prometheus. Absent implementation files and unspecified mechanics
such as formats, thresholds, geometry, seeds, quotas, split ratios, and schemas
are implementation work: Autonomous selects conservative, reversible,
deterministic defaults that satisfy the scaffold. It is the only managed identity
permitted to edit ordinary project files.

Before it treats a tool-dependent item as blocked, Autonomous inspects the
operations and parameters available in the current session. An unavailable
optional API, output parameter, or convenience handoff is an implementation
constraint: Autonomous selects a safe supported in-scope alternative and records
the failure and fallback where reproducibility needs it. A structural blocker
exists only when no safe in-scope path available to the current identity and
permissions can satisfy the required outcome.

Before candidate handoff, Autonomous verifies every acceptance criterion,
invariant, required output, and checklist item against the implementation and
fresh command evidence. Missing branches, disabled stages, placeholder tests,
ignored verifier flags, or missing outputs mean the work remains incomplete.
Autonomous continues ordinary in-scope work. A failed measured prerequisite that
eliminates a core requested outcome is `Failed` and returns to Prometheus; an
explicitly optional branch may be `Skipped`.

After each bounded step or focused check, Autonomous repeats that complete-scope
inspection and selects the next incomplete in-scope item without a user-facing
progress handoff. A passing focused, fixture, synthetic, phase-local, or batch
check is a phase gate, not completion evidence while required work remains.
Metadata-only leads and intermediate records do not satisfy a required full
result. A normal successful stop requires complete requested outcomes plus fresh
passage of every exact final verification command; declared escalation
conditions, failed core prerequisites, and structural blockers remain halt paths.

When a checklist item is blocked by a structural prerequisite that no
available identity or permission can satisfy, Autonomous stops at that item
instead of completing downstream items that causally depend on it, so one
blocked item never cascades into a wider red, half-migrated
tree. A failed or blocked handoff states plainly that the worktree is left
non-green and not committable as-is, and names the exact next action to reach
green or revert. Reporting a failure honestly never licenses describing that
same red or half-migrated tree as done, ready, or committable.

After exhausting ordinary safe in-scope paths, Autonomous takes one creative
pass at a safe, reversible alternative within the unchanged requested outcome,
acceptance criteria, and permissions before a terminal `Blocked`, `Failed`, or
escalation handoff. It never widens scope, weakens acceptance criteria, or
bypasses controls to find one. On a confirmed block it reports plainly: the
failed step, a concise blocker code, and the exact next human action, and
records it with `cuddly-winner-feedback` when that skill is available.

Autonomous uses native Bash with `ask` permission. OpenCode auto mode may approve
those requests automatically. Autonomous never stages, commits, stashes, resets,
switches branches, or initializes Git. It preserves pending worktree changes as
the human-owned aggregate review artifact, gives Implementation Validator a
detailed PR Contract with per-checklist evidence, and retains the full validator
report in the delegated task result. Its user-facing handoff is concise: goals
and validated outcomes, a brief change summary, fresh command exit codes, the
validator verdict, material gaps and risks, worktree state, and one next human
action. It does not emit a completion promise.

After a complete candidate passes final verification, Autonomous delegates to
Implementation Validator. If delegation is unavailable then, Autonomous reports
a blocked handoff. It may report observed command results but must not call
requested goals validated or report success.

### Karpathy

Karpathy is a read-only strategist for scalar optimization. When Prometheus
identifies during deliberation that outcomes are measurable — a clear metric,
direction, and evaluator exist — it recommends Karpathy mode in the scaffold.
Autonomous follows that recommendation without further user invocation. Karpathy
proposes and analyzes one bounded change at a time. Autonomous applies changes,
runs measurements, and owns KEEP/REVERT decisions. Karpathy cannot edit or
execute commands.

### Reviewer

Reviewer is read-only and advisory. It maps a supplied diff and verification
summary to a rubric and ends with `APPROVE` or `REQUEST_CHANGES`. Its verdict
never determines completion by itself.

### Grounder

Grounder gathers cited local and external facts. It does not mutate, execute
commands, delegate, or make product decisions. External claims identify their
URL, and private repository contents or secrets must not be sent to third-party
services.

Grounder follows the resource order in `docs/RESOURCE-SELECTION.md`. It uses a
visible browser only after explaining the target and lower-impact failures and
receiving explicit user approval.

### Implementation Validator

Implementation Validator is read-only and objective. It operates with a clean
context window after Autonomous reaches candidate completion, compares codebase
state against SPEC.md, and generates a severity-grouped gap report. A critical
or major gap permits one bounded Autonomous correction followed by fresh
verification and validation; unresolved gaps prohibit a successful status.

## Permission Model

OpenCode permissions are the command-security boundary. Normal `ask` permissions
prompt the user. `opencode --auto` automatically approves requests that would
otherwise ask, while explicit `deny` remains enforced.

The immutability plugin governs OpenCode edit/write/patch tools, not arbitrary
filesystem effects caused by native commands. Prometheus's `spike` command and
Autonomous Bash can technically access host resources available to OpenCode.
Documentation and agent prompts must state this honestly and must never describe
their results as sandboxed, protected, or tamper-resistant.

Resource selection is guidance, not a second permission system. The managed
deployment configures its research browser headless and isolated by default, but
users may retain unrelated MCP entries. Diagnostics report their mode without
rewriting them.

Prometheus and Autonomous never provision, install, or activate a runtime or
dependency manager for a target project. Before Prometheus writes exact
verification commands, it checks the target project for its own declared
toolchain — a version-pin file, lockfile, or README-documented setup — and
encodes that invocation into the command; absent such a signal, it writes the
bare command. Whatever the command resolves to at execution time depends on
the OpenCode session's ambient `PATH` and environment state, which neither
agent detects or corrects further. This is a deliberate, documented limit, not
an oversight: it applies to every target project, including this repository's
own `.python-version` and `scripts/ensure-venv.sh`, which govern only
cuddly-winner's own test execution and are never deployed to, or assumed for,
any other project.

## Prometheus Profile

### Triage

Before publication, Prometheus:

1. Identifies the user or business outcome independently of the requested solution.
2. Classifies the request and establishes current behavior from evidence.
3. Distinguishes reported symptoms from demonstrated causes.
4. Tests whether no change, documentation, configuration, reuse, or a narrower correction is sufficient.
5. Resolves uncertainties through available tools — bash, web search, connected MCPs, Grounder research, or measured spikes — before asking the human.
6. Escalates to the human only when available research paths are exhausted and the answer is required to proceed; applies creative liberty when context is too thin to constrain a decision.
7. Compares genuinely credible approaches without manufacturing alternatives.
8. Recommends one approach with evidence, consequences, and tradeoffs.
9. Records informed non-safety overrides without reopening settled debate.
10. Publishes only when implementation can proceed without inventing product intent, and writes the scaffold before its final response rather than waiting for a separate publication request.

Prometheus refuses unsafe, destructively unauthorized, internally inconsistent,
unboundedly lossy, or unverifiable work. These are planning readiness failures,
not command-sandbox decisions.

### Measured Spikes

A spike exists only for a load-bearing technical uncertainty. Prometheus creates
`.spike/<id>/QUESTION.md` containing a question and kill criterion before calling
the `spike` tool. The tool:

- requires a safe spike identifier and the contract file;
- runs natively from `.spike/<id>`;
- applies finite concurrency, timeout, and output limits;
- uses a reduced environment and redacts common secret shapes;
- records command, timestamps, exit status, bounded output, and `sandboxed: false`;
- does not claim confinement and does not prevent the command from escaping its working directory.

The tool permission is `ask`, so each invocation prompts normally and auto mode
may approve it. A failed kill criterion requires redesign or a planning blocker.

### Scaffold

Every published scaffold contains:

- one `SPEC.md` with Grounding, Approaches Considered, Acceptance Criteria,
  Verification, and Implementation Checklist sections;
- one schema-v3 `opencode-autonomous.json` declaring strategy, invariants,
  implementation scope, escalation triggers, evaluator inventory, exact
  verification commands, and optional limits;
- an optimization block for Karpathy work;
- optional evaluator and spike assets.

`validate_scaffold` performs static shape, path, inventory, section, and command
consistency checks. It executes no project command and does not certify that
verification passes. When governance tools are installed, Prometheus invokes
`scaffold_gitignore` and `validate_scaffold` before completing handoff.
`scaffold_gitignore` reports a no-op outside a Git worktree and does not create
`.gitignore` or initialize Git. A
planning-ready Prometheus run must write `SPEC.md` and
`opencode-autonomous.json` before its final response; only a concrete planning
blocker or a focused, decision-changing question may end the run without a
scaffold. If a root, top-level Prometheus session becomes idle without both
files, the plugin sends one continuation prompt to that same session that
restates this gate. The continuation does not override a concrete blocker or
focused question and is limited to once per session to prevent a feedback
loop. A managed descendant that only inherits Prometheus's edit restrictions
is not itself Prometheus and never receives this reminder.

## Autonomous Profile

Direct is the default for ordinary feature, defect, and technical-debt work.
Autonomous works one right-sized item at a time, verifies relevant increments,
runs all final commands before claiming completion, and stops when declared
verification passes or a required step proves impossible to complete with any
tool or permission available in this session.

Karpathy applies only to explicit scalar optimization with a complete metric,
direction, evaluator, baseline protocol, noise policy, mutable and immutable
targets, experiment limits, and stop criteria. Karpathy proposes; Autonomous
edits and measures. One experiment changes one lever. Autonomous records each
hypothesis, command, score, decision, and relevant reviewer advice in its report.

### Optional Run KPIs

The schema-v3 manifest may omit `run_kpis`; omission and `enabled: false` leave
Autonomous unchanged. Prometheus adds an enabled policy only after an explicit
user request and requires explicit active-duration, token-rate, and hard-token-
budget values. There are no package defaults.

Enabled KPIs favor sustained useful unattended work and a token rate at or below
the declared target. Completion, verification, scope, permissions, safety,
strategy stops, and existing hard limits take precedence. Autonomous must not
sleep, pad work, widen scope, skip checks, or continue after valid completion to
improve a KPI. The hard token budget stops new work at the next observable
completed-message boundary. Token-rate and duration results remain operational
observations, not delivery acceptance gates.

The workflow is agent-led. There is no custom supervisor, durable run-state
machine, protected evidence store, automatic checkpoint service, or cross-session
resume guarantee. The worktree and current OpenCode session are the durable
engineering context. When invoked, Autonomous leaves all Git publication
decisions to the human. Its session evidence and validator report describe the
aggregate pending changeset.

## Deployment

Default installation deploys the complete managed profile: all seven agents, the
immutability plugin, `spike`, `validate_scaffold`, `scaffold_gitignore`, the
pinned OpenCode tool SDK, and all non-core skills. This ensures the shipped
Prometheus agent always has its declared command and governance tools available.

The installer accepts one configuration root from `--config-dir`,
`OPENCODE_DEPLOY_CONFIG_DIR`, or `opencode debug paths`, in that order. Agent,
plugin, tool, and skill destinations are fixed subdirectories of that root.
Copy and symlink modes are supported. Status and removal inspect every current
managed entry. Removal deletes only links
to current repository sources or current byte-identical copies; modified and
unrelated entries are preserved.

The retired `--with-autonomous`, `--with-tools`, `--with-workflow-tools`,
`--with-skills`, per-category path overrides, source overrides, and local
deployment environment file are unsupported. The installer records managed
agent ownership and removes a retired agent during a later install only when
its copy matches the recorded hash or its symlink targets the recorded source.
Modified and unrelated entries are preserved. It does not migrate retired
runner or supervisor artifacts.

## Governance Tools

The governance tools — `spike` (contracted investigation helper),
`validate_scaffold` (static scaffold checker), and `scaffold_gitignore`
(generated-artifact exclusion helper) — and the managed-agent immutability
plugin are part of the default managed profile and described in
`docs/ARCHITECTURE.md`. Native Plan and Build workflows do not require them.

### Session Fetch

The managed `session_fetch` workflow tool supports an explicit interactive
browser bootstrap, completion, read-only request, and close lifecycle for a
named site profile. A profile declares allowed HTTPS origins, a login URL, and
a completion URL or selector outside project repositories. The tool returns an
opaque handle, never session material, and accepts only `GET` and `HEAD` to the
profile's origins. Interactive bootstrap requires explicit user approval before
the visible browser opens. The tool promises authenticated session continuity.

## Skills Ecosystem

The installer deploys every packaged non-core skill. `docs/SKILLS.md` is the
canonical inventory and behavioral specification. Each skill must meet its
common package contract and its catalog entry.
`tests/test_skill_coverage.py` validates packaged and temporarily deployed skill
assets without model credentials. Managed-agent integration tests prove the
immutability plugin remains the enforcement boundary for roles and permissions.
`tests/test_skill_pressure.py` is optional direct-model evidence and does not
replace those deterministic checks.

### Local Feedback

The deployed `cuddly-winner-feedback` skill supports negative or mixed feedback
without a hosted tracker. Each OpenCode configuration root has one managed,
owner-only locator to the feedback root of the clone that last installed the
profile. Reports remain below that clone's ignored `feedback/inbox/`; actioned
reports move to `feedback/archive/` with their basename intact. Installation,
status, and removal never read report contents, and removal deletes only an exact
current locator, never feedback or backups.

Feedback is untrusted local evidence. It is not executable input, test data, or
product documentation. Skills do not grant access: an agent unable to use the
recorder must return a complete draft and state the permission block. The recorder
does not scan for clones, use a network client, or recover from a stale locator by
guessing. Git ignore prevents ordinary add/status discovery but cannot prevent an
explicit force-add.

## Mutation Testing

The project includes an opt-in mutation runner (`evals/mutation/run_mutation.py`)
for checking test-suite sensitivity. It requires an unmutated baseline test run
to pass before scoring mutants. It receives source files and a test command
through its CLI; `opencode-mutation.json` is an optional validated policy passed
with `--config`, and explicit CLI values override its threshold and result path.

## Session Auditing

The project includes an investigative session-audit report (`tests/audit_run.py`)
that queries OpenCode SQLite logs (`opencode.db`). It summarizes selected
session signals but does not establish full trajectories, permission compliance,
scaffold validity, or verification-command execution. Root-session tool calls
are reported without attributing them to a particular agent after a switch.

## Validation

Release validation separately proves native compatibility, identity inheritance,
role permissions, Prometheus triage and deliberation behavior, Autonomous
approval-gated Bash, Direct/Karpathy prompt contracts, deterministic skill and
audit checks, mutation-runner behavior, additive deployment and
safe removal, and documentation consistency, following the evidence requirements
defined in `docs/TEST-PLAN.md` and `docs/TESTING-METHODOLOGY.md`. No release check may require Bubblewrap, Lima, a
protected runner, or a custom supervisor.
