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

Adding a conformant strategy agent plus a registry entry is sufficient —
no edit to `@autonomous` is required.

---

## Reference implementation

`agents/karpathy.md` is the reference implementation of this contract. Read it
alongside this document when authoring a new strategy.
