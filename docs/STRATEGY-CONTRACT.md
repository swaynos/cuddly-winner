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

A **coordinator-class strategy** splits into two agents: a **brain** (the sole
builder) and read-only **perception arms** (persona lenses). The Octopus strategy
is the reference implementation: `agents/octopus.md` is the brain,
`agents/octopus-arm.md` is the arm.

### Brain vs. arm — separated permissions

The brain and arm have deliberately different permission postures. Do not fold
them into one agent.

| | Brain (`@octopus`) | Arm (`@octopus-arm`) |
|---|---|---|
| Builds / mutates | Yes — sole builder (`edit`/`write` allowed) | No — `edit`/`write` denied |
| Delegates | Dispatches arms via `task` | No `task` delegation |
| Reads project | Yes | Yes (read-only bash: rg/cat/ls/git) |
| Role | Derives personas, integrates perceptions, builds | Feels one lens, returns one perception |

The brain dispatches arms via the arm agent directly (`task: <arm>: allow`) —
**never through `@autonomous`**. Routing perception arms through the builder
causes recursion and defeats read-only enforcement.

### Two sensing phases

1. **Pre-build:** arms feel the SPEC to surface risks and gaps; the brain
   integrates their perceptions into a sharper plan before building.
2. **Post-build:** arms feel the actual implementation; the brain revises until
   perceptions are clean or the rounds budget is exhausted.

### Restraint (anti-inflation)

Coordinator strategies risk "committee review inflation" — many generic
reviewers burning tokens. Required guardrails:

- An **admission test**: the brain must confirm the task warrants the strategy
  (Karpathy inapplicable; ≥3 distinct non-overlapping risk lenses; meaningful
  cost of failure) before running.
- **Default to 3 arms**, escalating toward the cap (8) only when the SPEC
  justifies more distinct lenses.
- A **bounded rounds budget** (3 build→feel→revise rounds).
- Every arm must **pay rent**: a perception is only accepted with evidence (or
  an explicit "SPEC-only inference" marker), a confidence level, an
  actionability verdict, and a dedup key.

### Perception findings contract (arm output)

Arms return a structured perception — never an artifact, never a diff:

    ARM <persona> PERCEPTION
    Lens: <perspective + the question it asks>
    Phase: SPEC | IMPLEMENTATION
    Sensed: <risk/gap/smell/missing case, or "nothing found" + scope checked>
    Severity: BLOCKING | CONCERN | NIT
    Evidence: <file:line / test / spec clause / log, or "SPEC-only inference">
    Confidence: LOW | MEDIUM | HIGH
    Actionability: FIX_NOW | DOCUMENT | IGNORE
    DedupKey: <stable key so repeated concerns are suppressed across rounds>
    Recommendation: <what the brain should do; the arm never applies it>

### Adding a coordinator strategy to `@autonomous`

A coordinator brain requires `@autonomous` to be able to invoke it: add
`"<brain-name>": allow` to `@autonomous`'s `task` map and to `EXPECTED_RULES`
in `tests/verify_opencode.py`. The brain in turn must allow its arm
(`task: <arm-name>: allow`).

---

## Reference implementation

`agents/karpathy.md` is the reference implementation of the single-agent contract.
`agents/octopus.md` (brain) and `agents/octopus-arm.md` (arm) together are the
reference implementation of the coordinator-class contract. Read the relevant
one alongside this document when authoring a new strategy.
