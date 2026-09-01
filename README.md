# OpenCode Specialist Workflows

This project adds optional specialist agents and lightweight workflow tools to
OpenCode. It does **not** replace, wrap, redirect, restrict, or require
OpenCode's built-in Plan and Build modes.

Use the extension when work benefits from stronger triage, an explicit
implementation scaffold, bounded iterative execution, or scalar-metric
optimization. Continue using native Plan and Build for ordinary work.

## Documentation

The durable source of truth for this project lives in `docs/`:

- [ARCHITECTURE.md](docs/ARCHITECTURE.md): System architecture, identity inheritance, workflow tools, manifest schemas, and skill packaging.
- [REQUIREMENTS.md](docs/REQUIREMENTS.md): Product goals, permission models, agent profiles, and validation rules.
- [SKILLS.md](docs/SKILLS.md): Skill contracts, catalog, and shared package rules.
- [RESOURCE-SELECTION.md](docs/RESOURCE-SELECTION.md): Non-disruptive research and browser credential policy.
- [TEST-PLAN.md](docs/TEST-PLAN.md): Evidence classes, test cases, and platform matrix.
- [USE-CASES.md](docs/USE-CASES.md): Concrete use cases for native compatibility, identity, triage, execution, skills, and auditing.
- [TESTING-METHODOLOGY.md](docs/TESTING-METHODOLOGY.md): Runtime investigation, SQLite log schema, verdict definitions, and harness conventions.
- [CONTRIBUTING.md](CONTRIBUTING.md): Process for adding or changing a packaged skill.

## Design Boundary

This project defines agent roles, edit-tool boundaries, and small workflow
helpers. It does not provide a command sandbox, virtual machine, protected
runner, custom completion engine, or autonomous supervisor.

It supports only the current scaffold schema version. An out-of-date scaffold is
republished by Prometheus, not migrated (see `docs/REQUIREMENTS.md` § No Legacy
Support).

Command security belongs to OpenCode's native permission model:

- Prometheus denies direct Bash and uses the approval-gated `spike` tool for contracted command-dependent research.
- Autonomous uses native Bash with `ask` permission.
- `opencode --auto` automatically approves `ask` requests.
- Explicit `deny` permissions remain denied in auto mode.
- Bash results are engineering evidence, not tamper-resistant proof.

## Installation

The default installation deploys the complete managed profile: seven agent
definitions, the managed-agent immutability plugin, four workflow tools and
their pinned SDK, and all packaged non-core skills:

```bash
bash scripts/deploy-opencode-agents.sh install
```

- `spike`, an approval-gated native command helper for contracted investigations
- `validate_scaffold`, a static SPEC and manifest validator
- `scaffold_gitignore`, the constrained generated-artifact exclusion helper
- `session_fetch`, an approved interactive session bridge for configured owned
  sites. The tool promises authenticated session continuity.

See [SKILLS.md](docs/SKILLS.md) for the catalog and
[CONTRIBUTING.md](CONTRIBUTING.md) for the process to add or change a skill.

Use `status` to inspect all managed entries and `remove` to remove current
byte-identical copies or repository symlinks while preserving modifications. Use
`--mode symlink` for a live development install. Override the OpenCode root with
`--config-dir` or `OPENCODE_DEPLOY_CONFIG_DIR`; all destination directories
derive from that one root. OpenCode loads agents, tools, and plugins at startup,
so restart it after changes.

## Local Feedback

The deployed `cuddly-winner-feedback` skill records negative or mixed feedback
from any project into the installing clone's local `feedback/inbox/` directory.
This tree is Git-ignored because reports can contain private paths, session IDs,
or excerpts. It never uploads, stages, commits, or force-adds feedback.

After deployment, restart OpenCode. The skill stores a private locator beneath
the selected OpenCode configuration root so copied and symlinked packages both
find the intended clone. If the clone moves or the recorder reports a stale
locator, reinstall from that clone. `status` reports locator state and `remove`
removes only an exact current locator. Neither command reads or deletes feedback.
Ignore rules do not prevent an explicit `git add -f`; never force-add feedback.
See [SKILLS.md](docs/SKILLS.md#cuddly-winner-feedback).

## Optional Agents

- **Prometheus** owns technical triage, planning readiness, measured spikes, and
  publication of `SPEC.md` plus `opencode-autonomous.json`.
- **Autonomous** owns implementation and final verification against the
  published scaffold.
- **Karpathy** advises one-change-at-a-time scalar optimization; Prometheus
  recommends it when outcomes are measurable, and Autonomous remains the editor
  and measurement runner.
- **Reviewer** provides read-only rubric-based review.
- **Grounder** gathers cited local and external evidence.
- **Ask** answers focused questions without starting a workflow.

These agents are entered explicitly. They are not aliases for Plan or Build.

## Prometheus Workflow

Prometheus runs a deliberation loop before asking the human anything. It
receives a request at any level of context — from a thin idea to a formal
requirements document — and investigates using whatever tools are available in
the session: bash commands, web search, connected MCPs, and Grounder research.
When a question can be answered through available tools or evidence, Prometheus
resolves it internally. When context is too thin to constrain a decision,
creative liberty is implied and Prometheus proceeds without asking. It escalates
to the human only when it has genuinely exhausted available research paths and
the answer is required to proceed.

When Prometheus identifies that outcomes are measurable — a clear metric,
direction, and evaluator exist — it recommends Karpathy mode in the scaffold.
Autonomous follows that recommendation.

Publication is structurally validated, not an execution attestation.
Prometheus defines exact final verification commands; Autonomous runs them.
Once planning-ready, Prometheus publishes `SPEC.md` and
`opencode-autonomous.json` before its final response. It does not wait for a
separate user request to write the scaffold.

## Autonomous Workflow

Autonomous reads the frozen planning scaffold, implements right-sized items,
and runs exact final verification through native Bash. Normal sessions ask
before each Bash invocation; users who intentionally choose `opencode --auto`
get uninterrupted approval.

After each bounded step or focused check, Autonomous rechecks every acceptance
criterion, invariant, required output, and checklist item and continues with the
next incomplete in-scope item. A passing focused, fixture, synthetic,
phase-local, or batch check is a phase gate, not completion evidence while
required work remains. It stops successfully only after all requested outcomes
are complete and every exact final verification command passes freshly.

Autonomous never stages or commits. Pending worktree changes remain the
human-owned aggregate review artifact across repeated Prometheus and Autonomous
runs. Its final handoff gives goals and validated outcomes plus a brief change
summary; detailed PR Contract evidence and the fresh Implementation Validator
report against `SPEC.md` remain in the delegated task result.

Direct is the default strategy for ordinary feature and defect work. Karpathy is
used only for explicit scalar optimization with a metric, evaluator, mutable and
immutable targets, limits, noise policy, and stop criteria. Both strategies are
bounded by the published manifest and agent instructions; there is no separate
host coordinator or durable workflow state machine.

Schema-v3 manifests may also opt into `run_kpis` for useful unattended duration
and token burn. The block is absent by default. An enabled block requires an
explicit active-duration target, token-rate target, and hard token budget; it
never supplies package defaults. The KPI plugin observes completed-message usage
for Autonomous and its descendants, favors concise useful work, and stops a new
turn at the hard budget. It never pads work, bypasses approval, or delays valid
completion to reach a duration target.

## Managed-Agent Immutability

The plugin applies fixed edit-tool boundaries only to the seven managed agents:

- Prometheus may edit only `SPEC.md`, `opencode-autonomous.json`,
  `.prometheus/evaluator/**`, and `.spike/**`.
- Autonomous may edit ordinary project files but not the published scaffold or
  this extension's trusted plugin/tool sources.
- Ask, Karpathy, Reviewer, Grounder, and Implementation Validator are read-only.
- Descendants inherit the originating managed identity.
- Native Plan, native Build, unknown agents, and third-party agents bypass the
  plugin.

Native commands are outside file-edit interception. User approval and explicit
agent instructions govern their effects.

## Validation

Never use system Python in this repository:

```bash
PYTHON="$(bash scripts/ensure-venv.sh)"
"$PYTHON" tests/verify_opencode.py --skip-llm
node --test tests/plugins/*.test.mjs tests/integration/*.test.mjs
"$PYTHON" -m unittest discover -s evals/mutation/tests -p 'test_*.py'
"$PYTHON" tests/test_skill_coverage.py --skip-llm
"$PYTHON" -m unittest discover -s tests -p 'test_audit_run.py'
"$PYTHON" evals/seed_build/test_planning.py --dry-run
"$PYTHON" evals/seed_build/test_build.py --dry-run
"$PYTHON" tests/audit_run.py --help
```

Skill coverage validates packaged skills and a temporary deployed copy without
model credentials. The separate pressure suite remains optional live-model
evidence. The audit command validates its CLI only; auditing a recorded session
also requires `--project` and an OpenCode database.
