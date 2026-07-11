# Optional OpenCode Agent Extensions

This project adds specialist agents and opt-in autonomous workflows to OpenCode.
It does **not** replace, wrap, redirect, restrict, or otherwise alter OpenCode's
built-in Plan and Build modes. Native Plan and Build remain the default workflow
and must work exactly as provided by OpenCode.

The optional extensions are useful when a task needs more structure than a
normal Plan/Build session: evidence-backed planning, durable autonomous
execution, advisory review, grounded research, or Karpathy-style optimization
against a frozen scalar evaluator.

## Native Plan And Build

Use OpenCode's built-in Plan and Build normally. They do not require:

- `SPEC.md`
- `opencode-immutable.json`
- the trusted `run` tool
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
# Add the Autonomous supervisor and trusted runner.
bash scripts/deploy-opencode-agents.sh install --with-autonomous

# Also install non-core skills.
bash scripts/deploy-opencode-agents.sh install --with-skills
```

Use `status` to inspect destinations. OpenCode loads agents and plugins at
startup, so restart it after changing an installation profile.

## Optional Agents

- **Prometheus** creates a rigorous `SPEC.md` and runs contracted spikes.
- **Autonomous** executes a canonical SPEC under the optional supervisor.
- **Karpathy** advises bounded scalar-metric optimization.
- **Reviewer** provides read-only advisory review.
- **Grounder** gathers read-only repository and external evidence.
- **Ask** answers focused questions without starting an implementation workflow.

These agents are selected explicitly. They are not aliases for Plan or Build.

## Managed-Agent Immutability

Immutability currently uses fixed role defaults only:

- Prometheus may mutate only `SPEC.md` and `.spike/**`.
- Autonomous may edit normal project files but not trusted control-plane state.
- Ask, Karpathy, Reviewer, and Grounder are read-only.
- Descendants inherit the originating managed agent's restrictions.
- Native Plan, native Build, unknown agents, and third-party agents are bypassed.

### Reserved Project Override

`opencode-immutable.json` is an **unused placeholder** for a future project-level
override format. The current plugin does not read or enforce it. Do not rely on
that file to protect project files today.

The example documents the intended future shape: explicit readonly paths and
agent-specific refinements. A future implementation may narrow permissions for
the agents introduced by this project. It will not restrict native Plan or Build
under the current compatibility contract.

## Optional Autonomous Profile

The Autonomous profile adds the trusted runner and durable supervisor. Its
evidence, state, and budgets apply only to explicitly invoked Autonomous runs.
Native Build continues using its normal Bash and mutation tools.

On supported Linux systems, trusted commands require Bubblewrap. Other operating
systems can still use native Plan/Build and the non-runner specialist agents.

## Optional Karpathy Profile

Karpathy requires `program.md`, root `opencode-karpathy.json`, and a frozen
evaluator. Karpathy is a read-only strategist; Autonomous remains the editor.

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
