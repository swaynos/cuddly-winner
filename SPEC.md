# @builder Subagent — Delegated Implementation Worker

## Problem

`@autonomous` currently implements every checklist item directly in its own
context. For large specs this causes two problems:

1. **Context bloat.** The agent's window fills with line-by-line implementation
   detail for every function, class, and test it writes. Planning and verification
   reasoning competes with output noise.
2. **No safe parallelism.** Independent checklist items that touch disjoint files
   must be executed sequentially by the same agent, even when there is no logical
   dependency between them.

A natural fix is for `@autonomous` to hand off discrete, self-contained
implementation units ("build a function that does A, B, C") to a lightweight
worker subagent, wait for the result, verify it, and continue. When multiple
independent units are identified up front, they can be delegated concurrently.

## Goals

- Add a `@builder` hidden subagent that accepts a focused brief from `@autonomous`
  and implements exactly one self-contained unit (a function, a class, a test
  module, a config file, etc.).
- Allow `@autonomous` to delegate to `@builder` for any discrete implementation
  step where: (a) the scope is well-defined, (b) the unit can be described in a
  short brief, and (c) the verification command is known in advance.
- Allow `@autonomous` to fan out **multiple** `@builder` delegations in parallel
  when the units are confirmed to be disjoint (non-overlapping file sets with no
  shared state).
- Keep all contract obligations — evidence block, reviewer APPROVE, strategy
  selection, promise semantics — owned entirely by `@autonomous`. `@builder` does
  not emit promises or call `@reviewer`.
- Ensure every delegated build is verified by `@autonomous` before its checklist
  item is marked `[x]`.

## Non-goals

- `@builder` is not a replacement for `@autonomous`. It cannot read `SPEC.md`,
  select a strategy, update `progress.txt`, call `@reviewer`, or emit promises.
- `@builder` is not a strategy subagent. It is not registered in
  `.opencode/strategies.json` and does not satisfy the strategy contract.
- Parallel delegation is not allowed for units with overlapping file sets or
  shared state. `@autonomous` must declare the file set before delegating.
- `@builder` does not replace the existing `@karpathy` → `@autonomous` delegation
  pattern (where `@karpathy` owns strategy and delegates implementation back).
  That relationship is unchanged.
- No changes to plugin enforcement scope — the gate and loop plugins remain
  scoped to `@autonomous`.

## Constraints

- `@builder` must be `mode: subagent`, `hidden: true`.
- `@builder` permissions: `edit: allow`, `write: allow`, `bash: ask` with specific
  allow-patterns for test runners and search tools. No `task` delegation.
- `@autonomous` must add `"builder": allow` to its `task` permission map.
- `EXPECTED_RULES` in `tests/verify_opencode.py` must be updated to assert the new
  `task: builder: allow` rule in `@autonomous` and `@builder`'s own permission set.
- `EXPECTED_AGENT_FILES` must add `builder.md`.
- `docs/STRATEGY-CONTRACT.md` is unchanged — `@builder` is not a strategy.
- The loop plugin's `STRATEGY_AGENTS` constant must add `"builder"` so delegation
  events are recorded in run history.
- `python3 tests/verify_opencode.py --skip-llm` must pass all checks except the
  known pre-existing `plugin_load` failure.
- `node --test tests/plugins/*.test.mjs` must pass with no regressions.

## Grounding

- `agents/autonomous.md`: current `task` permission map allows `data-scientist`,
  `grounder`, `reviewer`, `karpathy`, `ralph-wiggum`, `octopus`; denies `*`. Adding
  `builder` is a one-line frontmatter change plus a `EXPECTED_RULES` update.
- `tests/verify_opencode.py` `EXPECTED_AGENT_FILES` currently lists 10 agents;
  `EXPECTED_RULES["autonomous"]` has 23 rules. Both need updating.
- `plugins/opencode-autonomous-loop/index.js` `STRATEGY_AGENTS` set tracks
  delegations for audit; `builder` must be added.
- `@karpathy` delegates non-trivial implementation back to `@autonomous` via task
  (`agents/karpathy.md:167`). `@builder` follows the same outbound-delegation
  shape, but in reverse: `@autonomous` → `@builder`.

## Approaches Considered

### Approach 1 — Delegate to built-in OpenCode `build` agent
`@autonomous` adds `task: build: allow` and delegates implementation units to
OpenCode's built-in `build` primary agent.

**Status:** Rejected

**Kill-reason:** Built-in `build` is a generic primary agent with no contract
discipline: no evidence block, no promise semantics, no spec awareness. Work done
under `build` is invisible to the gate and loop plugins (scoped to `autonomous`),
breaks the audit trail in `tests/audit_run.py`, and can sidestep immutability
identity resolution. The exact failure class this repo exists to prevent —
"work happened in `build` outside the contract" — is what the `gmail-scanner`
post-mortem already diagnosed.

### Approach 2 — Repo-owned `@builder` hidden subagent (chosen)
Add a repo-owned `agents/builder.md` (`mode: subagent`, `hidden: true`) with
a focused permission set and a strict brief contract. `@autonomous` delegates
discrete units to it via the existing task tool. All contract obligations remain
with `@autonomous`.

**Status:** Chosen

**Rationale:** The worker is ours: auditable, permission-scoped, deployable with
the rest of the suite, and invisible to users (hidden). The delegation pattern
is identical to the existing `@karpathy` → `@autonomous` direction, just reversed.
The loop plugin can track `@builder` sessions as subagent delegation events.
Immutability identity resolution works via the existing parent-session walk.

### Approach 3 — `@autonomous` delegates to a fresh `@autonomous` child
`@autonomous` delegates implementation back to another `@autonomous` instance
via task. Full guardrails apply to the worker.

**Status:** Rejected

**Kill-reason:** `@autonomous` carries the full spec contract (strategy selection,
`progress.txt`, promise ceremony, reviewer). Spawning it as a lightweight worker
for a function or small module is disproportionately heavy, and nesting two
contract-bearing agents in a parent-child relationship creates ambiguous ownership
of `progress.txt` and promise emission in the child.

## Acceptance Criteria

1. `agents/builder.md` exists with `mode: subagent`, `hidden: true`,
   `edit: allow`, `write: allow`, and a `task` block that denies `*`.
2. `agents/builder.md` body defines: (a) the brief format it accepts from
   `@autonomous`, (b) that it implements exactly one self-contained unit and
   returns a structured result summary, (c) that it never emits promise tokens,
   calls `@reviewer`, or updates `progress.txt`.
3. `agents/autonomous.md` frontmatter `task` map includes `"builder": allow`.
4. `agents/autonomous.md` body documents: (a) when to delegate to `@builder`
   (discrete, well-scoped unit with a known verification command), (b) the
   parallel delegation rule (disjoint file sets only, file set declared up front),
   (c) that `@autonomous` must verify every delegated build (run the verification
   command, inspect the diff) before marking the checklist item `[x]`.
5. `tests/verify_opencode.py` `EXPECTED_AGENT_FILES` includes `builder.md`.
6. `tests/verify_opencode.py` `EXPECTED_RULES["autonomous"]` includes
   `{"permission": "task", "action": "allow", "pattern": "builder"}`.
7. `tests/verify_opencode.py` `EXPECTED_RULES` includes a `"builder"` entry
   asserting the correct permission posture.
8. `tests/verify_opencode.py` `EXPECTED_MODES` includes `"builder": "subagent"`.
9. `plugins/opencode-autonomous-loop/index.js` `STRATEGY_AGENTS` set includes
   `"builder"` so delegation events are recorded in run history.
10. `python3 tests/verify_opencode.py --skip-llm` passes all checks except the
    known pre-existing `plugin_load` failure.
11. `node --test tests/plugins/*.test.mjs` passes with no regressions.

## Verification

```bash
python3 tests/verify_opencode.py --skip-llm
node --test tests/plugins/*.test.mjs
rg -n "builder" agents/autonomous.md
rg -n "builder" agents/builder.md
rg -n '"builder"' tests/verify_opencode.py
rg -n "builder" plugins/opencode-autonomous-loop/index.js
```

## Implementation Checklist

- [x] Write `agents/builder.md`: `mode: subagent`, `hidden: true`, focused
      permissions (`edit: allow`, `write: allow`, bash allow-patterns for test
      runners and search, `task: "*": deny`); body defines brief format, single-unit
      contract, no promise/reviewer/progress.txt responsibility.
- [x] Add `"builder": allow` to `agents/autonomous.md` frontmatter `task` map.
- [x] Add delegation guidance to `agents/autonomous.md` body: when to use
      `@builder`, the disjoint-file-set rule for parallel delegation, and the
      mandatory post-delegation verification step.
- [x] Add `"builder.md"` to `EXPECTED_AGENT_FILES` in `tests/verify_opencode.py`.
- [x] Add `{"permission": "task", "action": "allow", "pattern": "builder"}` to
      `EXPECTED_RULES["autonomous"]` in `tests/verify_opencode.py`.
- [x] Add `"builder"` entry to `EXPECTED_RULES` in `tests/verify_opencode.py`
      asserting its permission posture.
- [x] Add `"builder": "subagent"` to `EXPECTED_MODES` in `tests/verify_opencode.py`.
- [x] Add `"builder"` to `STRATEGY_AGENTS` in
      `plugins/opencode-autonomous-loop/index.js`.
- [x] Run both verification commands; confirm only `plugin_load` fails.

## Autonomous Strategy

strategy: direct
rationale: This is a one-shot spec-driven implementation task — add an agent file,
update frontmatter and permissions, extend the validator and loop plugin. There is
no scalar metric to optimize and no iterative experimentation required.

## Change Log

- 2026-06-16: Initial spec. Adds `@builder` as a repo-owned hidden implementation
  worker subagent, delegated to by `@autonomous` for discrete self-contained units
  with optional parallel fan-out for disjoint file sets.
- 2026-06-17: Implemented `@builder`, autonomous delegation rules, validator
  contract checks, loop-plugin delegation tracking, runtime-audit docs, and
  durable docs updates.
