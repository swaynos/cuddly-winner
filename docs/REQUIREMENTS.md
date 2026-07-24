# Requirements

## Product Goal

This project is a lightweight, optional extension to OpenCode. It adds specialist
roles and explicit planning-to-implementation workflows without replacing native
Plan or Build and without implementing a second command-security or orchestration
platform.

`docs/REQUIREMENTS.md` and `docs/ARCHITECTURE.md` are the durable source of
truth. `SPEC.md` and `opencode-autonomous.json` are transient task scaffolds.

## Native Compatibility

Built-in Plan and Build, future built-ins, unknown identities, and third-party
agents remain outside this project's enforcement boundary. Installation must not alter
their prompts, routing, tools, Bash access, permissions, or completion behavior.
They never require a SPEC, specialist agent, plugin, or workflow tool.

The project must not install its repository `AGENTS.md` globally and must not
direct ordinary planning to Prometheus or ordinary implementation to Autonomous.

## Managed Agents

The managed identities are `ask`, `prometheus`, `autonomous`, `karpathy`,
`reviewer`, and `grounder`. They are selected explicitly. Delegated sessions
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
calculator request, it publishes a Ralph scaffold for a zero-dependency static
browser calculator rather than asking the user to choose a platform or basic
operations.

Prometheus may edit only `SPEC.md`, `opencode-autonomous.json`,
`.prometheus/evaluator/**`, and `.spike/**`. It has `bash: ask` permission for
research during deliberation; commands require user approval or are auto-approved
with `--auto`. Governance tools (`spike`, `validate_scaffold`,
`scaffold_gitignore`) remain available when installed.

### Autonomous

Autonomous owns implementation and final verification. It reads the published
scaffold, executes bounded right-sized work, makes reversible implementation
decisions within scope, and returns only outcome-changing product or policy
ambiguity to Prometheus. Absent implementation files and unspecified mechanics
such as formats, thresholds, geometry, seeds, quotas, split ratios, and schemas
are implementation work: Autonomous selects conservative, reversible,
deterministic defaults that satisfy the scaffold. It is the only managed identity
permitted to edit ordinary project files.

Autonomous uses native Bash with `ask` permission. OpenCode auto mode may approve
those requests automatically. Autonomous must report exact commands and results,
must not treat prose or checklist edits as verification, and must not commit
unless the user explicitly requests it.

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
URL or notebook source, and private repository contents or secrets must not be
sent to third-party services.

## Permission Model

OpenCode permissions are the command-security boundary. Normal `ask` permissions
prompt the user. `opencode --auto` automatically approves requests that would
otherwise ask, while explicit `deny` remains enforced.

The immutability plugin governs OpenCode edit/write/patch tools, not arbitrary
filesystem effects caused by native commands. Prometheus's `spike` command and
Autonomous Bash can technically access host resources available to OpenCode.
Documentation and agent prompts must state this honestly and must never describe
their results as sandboxed, protected, or tamper-resistant.

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
- one schema-v1 `opencode-autonomous.json` declaring strategy, invariants,
  implementation scope, escalation triggers, evaluator inventory, exact
  verification commands, and optional limits;
- an optimization block for Karpathy work;
- optional evaluator and spike assets.

`validate_scaffold` performs static shape, path, inventory, section, and command
consistency checks. It executes no project command and does not certify that
verification passes. When governance tools are installed, Prometheus invokes
`scaffold_gitignore` and `validate_scaffold` before completing handoff. A
planning-ready Prometheus run must write `SPEC.md` and
`opencode-autonomous.json` before its final response; only a concrete planning
blocker or a focused, decision-changing question may end the run without a
scaffold. If a Prometheus session becomes idle without both files, the plugin
sends one continuation prompt to the same session that restates this gate. The
continuation does not override a concrete blocker or focused question and is
limited to once per session to prevent a feedback loop.

## Autonomous Profile

Ralph is the default for ordinary feature, defect, and technical-debt work.
Autonomous works one right-sized item at a time, verifies relevant increments,
runs all final commands before claiming completion, and stops on success,
declared limits, repeated lack of progress, or a concrete blocker.

Karpathy applies only to explicit scalar optimization with a complete metric,
direction, evaluator, baseline protocol, noise policy, mutable and immutable
targets, experiment limits, and stop criteria. Karpathy proposes; Autonomous
edits and measures. One experiment changes one lever. Autonomous records each
hypothesis, command, score, decision, and relevant reviewer advice in its report.

The workflow is agent-led. There is no custom supervisor, durable run-state
machine, protected evidence store, automatic checkpoint service, or cross-session
resume guarantee. The worktree and current OpenCode session are the durable
engineering context. Git commits remain user-controlled.

## Deployment

Default installation copies all six agents and the immutability plugin.
`--with-workflow-tools` additionally installs `spike`, `validate_scaffold`, and
`scaffold_gitignore` plus the pinned OpenCode tool SDK. `--with-skills` installs
non-core skills. Installation is additive: omitted optional flags leave
previously installed optional entries unchanged.

The installer accepts one configuration root from `--config-dir`,
`OPENCODE_DEPLOY_CONFIG_DIR`, or `opencode debug paths`, in that order. Agent,
plugin, tool, and skill destinations are fixed subdirectories of that root.
Copy and symlink modes are supported. Status and removal inspect every current
managed entry regardless of optional install flags. Removal deletes only links
to current repository sources or current byte-identical copies; modified and
unrelated entries are preserved.

The retired `--with-autonomous`, `--with-tools`, per-category path overrides,
source overrides, and local deployment environment file are unsupported. The
installer performs no automatic migration of retired runner or supervisor
artifacts.

## Governance Tools

The optional governance tools — `spike` (contracted investigation helper),
`validate_scaffold` (static scaffold checker), and `scaffold_gitignore`
(generated-artifact exclusion helper) — and the managed-agent immutability
plugin are deferred pending validation of core agent behavior. They remain
available for installation with `--with-workflow-tools` and described in
`docs/ARCHITECTURE.md` for reference, but are not required for the core
Prometheus → Autonomous workflow.

## Skills Ecosystem

When `--with-skills` is specified, the installer deploys eight non-core skills: `local-word-document`, `playwright-image-generation`, `project-agent-scaffolding`, `subagent-driven-development`, `systematic-debugging`, `test-driven-development`, `verification-before-completion`, and `writing-skills`.

Each skill must provide valid YAML frontmatter and markdown body guidelines.
`tests/test_skill_coverage.py` validates packaged and temporarily deployed skill
assets without model credentials. Managed-agent integration tests prove the
immutability plugin remains the enforcement boundary for roles and permissions.
`tests/test_skill_pressure.py` is optional direct-model evidence and does not
replace those deterministic checks.

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
approval-gated Bash, Ralph/Karpathy prompt contracts, deterministic skill and
audit checks, mutation-runner behavior, additive deployment and
safe removal, and documentation consistency, following the evidence requirements
defined in `docs/TEST-PLAN.md` and `docs/TESTING-METHODOLOGY.md`. No release check may require Bubblewrap, Lima, a
protected runner, or a custom supervisor.
