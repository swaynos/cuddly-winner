# Optional OpenCode Agent Extensions

This project adds specialist agents and opt-in autonomous workflows to OpenCode.
It does **not** replace, wrap, redirect, restrict, or otherwise alter OpenCode's
built-in Plan and Build modes. Native Plan and Build remain the default workflow
and must work exactly as provided by OpenCode.

The optional extensions are useful when a task needs more structure than a
normal Plan/Build session: evidence-backed planning, durable autonomous
execution, advisory review, grounded research, or Karpathy-style optimization
against a frozen scalar evaluator.

Durable requirements and architecture live in `docs/`; root `SPEC.md` is a
transient per-change implementation brief, not canonical documentation.

## Inspiration

This project is informed by how successful professional software delivery
actually begins. A feature request, defect report, or bug rarely starts with
implementation: it starts with triage, a focused spike, and often a discussion
with product owners or the people affected by the problem.

Meaningful user discourse is therefore a normal part of establishing context,
scope, and success criteria. The goal is not for agents to agree automatically
with every request, but to surface material uncertainty, test assumptions, and
ask focused questions when the answers could change the work.

Native OpenCode Plan and Build already cover the basic workflow and remain
unchanged. The optional agents add structure only when it is explicitly needed:
evidence-backed context setting, user interviews, research, and measured spikes
before committing to an autonomous implementation path.

## Native Plan And Build

Use OpenCode's built-in Plan and Build normally. They do not require:

- `SPEC.md`
- the protected `run` tool
- the Autonomous supervisor
- Prometheus or any other custom agent

The immutability plugin explicitly bypasses `plan`, `build`, unknown agents, and
third-party agents. Installing this project must not change their prompts,
permissions, Bash access, mutation tools, or completion behavior.

## Install Specialist Agents

```bash
bash scripts/deploy-opencode-agents.sh install
```

The default copy-mode installation adds the six optional specialist agents and
managed-agent immutability defaults. It does not install this repository's
`AGENTS.md` globally and does not install the Autonomous supervisor or runner.

Optional profiles:

```bash
# Add the Autonomous supervisor and protected runner.
bash scripts/deploy-opencode-agents.sh install --with-autonomous

# Also install non-core skills.
bash scripts/deploy-opencode-agents.sh install --with-skills
```

Use `status` to inspect destinations. OpenCode loads agents and plugins at
startup, so restart it after changing an installation profile.

## Optional Agents

- **Prometheus** triages requests and publishes a validated Autonomous scaffold.
- **Autonomous** executes a canonical SPEC under the optional supervisor.
- **Karpathy** advises bounded scalar-metric optimization.
- **Reviewer** provides read-only advisory review.
- **Grounder** gathers read-only repository and external evidence.
- **Ask** answers focused questions without starting an implementation workflow.

These agents are selected explicitly. They are not aliases for Plan or Build.

## Managed-Agent Immutability

Immutability currently uses fixed role defaults only:

- Prometheus may mutate only its scaffold artifacts (`SPEC.md`,
  `opencode-autonomous.json`, `.prometheus/evaluator/**`, `.spike/**`) and is the
  only agent permitted to invoke the `scaffold_gitignore` tool.
- Autonomous may edit normal project files but not protected run-coordinator state.
- Ask, Karpathy, Reviewer, and Grounder are read-only.
- Descendants inherit the originating managed agent's restrictions.
- Native Plan, native Build, unknown agents, and third-party agents are
  bypassed.

## Optional Autonomous Profile

The Autonomous profile adds a thin run coordinator implemented by the supervisor
plugin, plus a separate protected runner for sandboxed command execution. Its
evidence, state, and limits apply only to explicitly invoked Autonomous runs.
Native Build continues using its normal Bash and mutation tools.

On supported Linux systems, protected commands require Bubblewrap. Other
operating systems can still use native Plan/Build and the non-runner specialist
agents.

Autonomous runs one of two strategies, both driven by the same coordinator:

- **Ralph** is the default: general iterative implementation for feature and
  defect work, verified by existing project checks or a generated evaluator. A
  simple task can finish in a single iteration.
- **Karpathy** is used only for explicit scalar-metric optimization against a
  frozen evaluator, and only when Prometheus publishes a complete Karpathy
  scaffold.

The Prometheus and Autonomous agents are installed under every profile, but
publication and execution require `--with-autonomous`. Without it, both agents
report that the profile is required rather than degrading silently; native
Plan/Build are unaffected.

## Optional Karpathy Strategy

Karpathy is an Autonomous strategy, not a separate install profile. It requires
the complete frozen optimization scaffold published by Prometheus. The Karpathy
agent is a read-only strategist that proposes one bounded change at a time;
Autonomous remains the sole editor.

## Validation

Never use system Python in this repository:

```bash
PYTHON="$(bash scripts/ensure-venv.sh)"
"$PYTHON" tests/verify_opencode.py --skip-llm
node --test tests/plugins/*.test.mjs tests/integration/*.test.mjs
"$PYTHON" -m unittest discover -s evals/mutation/tests -p 'test_*.py'
"$PYTHON" evals/seed_build/test_planning.py --dry-run
"$PYTHON" evals/seed_build/test_build.py --dry-run
bash scripts/ci.sh
```

Dry-run evaluator checks validate plumbing only and are not release evidence.
