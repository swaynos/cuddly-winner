# Loop Strategy Contract

This document defines the contract every **loop-strategy subagent** must satisfy
to be added to the autonomous strategy toolkit. `@autonomous` owns looping and
delegates to a strategy subagent when the selection precedence calls for it.

A strategy is a *bounded* way to drive a task to completion. It is never an
open-ended process. Long-horizon continuity (resuming across sessions, surviving
restarts) is the job of the supervisor plugins (`opencode-autonomous-gate`,
`opencode-autonomous-loop`), **not** the strategy.

---

## Karpathy-first invariant

Karpathy is the mandatory default. A non-Karpathy ("exotic") strategy may be
selected **only after the instrument-first step fails** — that is, only when the
task cannot be given a scalar metric and a stable frozen evaluator. An exotic
strategy must never override Karpathy on a task that is measurable or can be made
measurable. Reaching for an exotic strategy is an admission that the task
resisted a deterministic check, and the reason must be recorded in `progress.txt`.

---

## 1. Frontmatter

Every strategy subagent is an OpenCode agent file at `agents/<name>.md` (core) or
`.opencode/agents/<name>.md` (project-local). Required frontmatter:

```yaml
---
description: <one line — what this strategy is and that @autonomous invokes it>
mode: subagent
hidden: true
permission:
  task:
    "autonomous": allow
    "reviewer": allow
    "*": deny
---
```

- `mode: subagent` — strategies are never user-facing primary agents.
- `hidden: true` — users interact with `@autonomous`, not the strategy directly.
- `task` must allow `autonomous` and `reviewer` and deny `*`. A strategy may
  delegate implementation back to `@autonomous` and may call `@reviewer`; it may
  not summon arbitrary agents.

`bash` permissions are strategy-specific but should follow least privilege.

---

## 2. Required body sections

Every strategy body MUST contain these three sections (headings may vary in
wording but the intent must be unambiguous and detectable):

### Applicability
When `@autonomous` should pick this strategy. State the task shape this strategy
suits and — explicitly — why Karpathy does not apply (no scalar metric, no stable
evaluator, etc.).

### Stop criteria
Explicit, **bounded** conditions under which the strategy stops. There must be a
finite condition — a maximum number of iterations, a convergence test, a
completion check, or equivalent. "Run until the user stops it" or "run forever"
is forbidden.

### Escalation
What the strategy does when it cannot make progress:
- **Hand back to Karpathy** if, mid-run, the task turns out to be measurable
  (a scalar metric and frozen evaluator become available or constructible).
- **Emit `WORK_STUCK`** (via `@autonomous`) when genuinely exhausted, after
  documenting the attempts in `progress.txt`.

---

## 3. Forbidden: open-ended strategies

A strategy that lacks bounded stop criteria, or that describes itself as
unbounded / "runs forever" / "solves any problem", violates this contract and
will fail validation. Boundedness is a feature, not a limitation: it is what
keeps the autonomous system honest and prevents the silent-abandonment and
redefined-success failure modes the project engineered out.

---

## 4. Registry entry

Each strategy must be listed in the strategy registry (`.opencode/strategies.json`)
with `name`, `agent`, `applicability`, and `status` (`active` / `reference` /
`planned`). See `docs/strategy-template.md` for a copy-to-create scaffold.

Adding a conformant strategy agent plus a registry entry is sufficient for
single-agent strategies. **Coordinator-class strategies additionally require a
`task: <name>: allow` entry in `@autonomous`'s permission map** (see section 5
below).

---

## 5. Coordinator-class strategies

A **coordinator-class strategy** is one where the brain (the coordinator) is the
**sole builder** and the arms are **read-only perception agents** — personas that
feel the SPEC and the implementation through different lenses and report what they
sense. The Octopus strategy is the reference implementation.

### How it differs from single-agent strategies

- The coordinator strategy agent *may* dispatch persona arm sub-agents via the
  `task` tool (by delegating to `@autonomous` with a read-only perception brief).
  The coordinator must allow `autonomous` in its `task` map.
- **Arms are read-only.** They perceive and report sensed risks, gaps, and
  smells. They never build, never edit files, and never touch the project.
- **The coordinator is the sole builder.** All implementation and all project
  mutation is the coordinator's responsibility. Arms perceive; the brain builds.
- Personas are derived dynamically from the SPEC each run — not a fixed list.

### Two sensing phases

A coordinator strategy wraps a single build with two perception phases:

1. **Pre-build:** arms feel the SPEC to surface risks and gaps; the brain
   integrates their sensations into a sharper plan before building.
2. **Post-build:** arms feel the actual implementation to surface what the code
   reveals; the brain revises until perceptions are clean or the rounds budget
   is exhausted.

### Coordinator frontmatter

Arms are read-only — no sandbox, no `external_directory`, no `edit`/`write`
grants required:

```yaml
---
description: <one line — coordinator strategy>
mode: subagent
hidden: true
permission:
  bash:
    "*": ask
    <read/observe allows: rg, cat, ls, git status/diff/log>
  task:
    "autonomous": allow
    "reviewer": allow
    "*": deny
---
```

### Required body sections

In addition to the standard Applicability / Stop criteria / Escalation sections,
a coordinator strategy must document:

- **Persona derivation** — how the brain derives 2–8 task-specific arms from
  the SPEC (not a fixed list); one arm per perspective/question.
- **Perception brief** — the read-only brief each arm receives; explicitly
  forbids editing.
- **Perception findings contract** — arms return structured perceptions
  (lens, phase, sensed risks/gaps, severity, recommendation); never artifacts.
- **Sensing phases** — pre-build (feel the SPEC) and post-build (feel the
  implementation), with a bounded rounds budget.

### Adding a coordinator strategy to `@autonomous`

Unlike single-agent strategies, a coordinator strategy requires `@autonomous` to
be able to invoke it. Add `"<strategy-name>": allow` to `@autonomous`'s `task`
permission map and to `EXPECTED_RULES` in `tests/verify_opencode.py`.

---

## Reference implementation

`agents/karpathy.md` is the reference implementation of the single-agent contract.
`agents/octopus.md` is the reference implementation of the coordinator-class
contract. Read the relevant one alongside this document when authoring a new
strategy.
