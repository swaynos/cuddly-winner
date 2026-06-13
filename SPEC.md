# Autonomous Strategy Toolkit — Karpathy-First Refactor

## Problem
`@karpathy` is an exposed primary agent that users invoke directly for metric
loops. The project's direction is to collapse looping ownership into `@autonomous`:
it selects and invokes the appropriate loop strategy subagent based on context,
with the Karpathy strategy mandatory whenever a task is (or can be made)
measurable. Exotic strategies are a documented last resort. `@prometheus` must
record the strategy decision in `AGENTS.md` so it survives across sessions and is
readable by every agent. Previously, a premature-exit defect caused `@autonomous`
to abandon its checklist mid-run; that bug has been fixed.

## Goals
- `@autonomous` owns looping. It reads the strategy directive from `AGENTS.md`,
  follows a clear selection precedence, and invokes the right strategy subagent.
- Karpathy is the **mandatory default** when a task has (or can be given) a
  scalar metric and a stable frozen evaluator. This is a hard rule, not a
  preference.
- When a task is not naturally measurable, the agent first attempts to instrument
  it (add a scalar metric + frozen evaluator) before reaching for an exotic
  strategy.
- Exotic strategies (Ralph Wiggum, future) are named hidden subagents, invoked
  only when instrumentation genuinely cannot be done, with the reason recorded.
- `@prometheus` records an `## Autonomous Strategy` section in `AGENTS.md` on
  every intake, defaulting to `karpathy` and applying the hard rule.
- `@karpathy` is demoted to a hidden subagent while preserving all its loop
  logic, `program.md`/`karpathy.json` handling, and the `examples/ml-loop` example.

## Non-goals
- Do not build any new exotic strategy subagents in this change.
- Do not run any strategy trial or comparison experiment.
- Do not add automatic git commits, pull request creation, or release automation.
- Do not change `@karpathy`'s loop logic, only its mode and framing.

## Constraints
- `@prometheus` is the only agent permitted to write `AGENTS.md`; its
  `edit`/`write` allowlists and the immutability `write_allowlist.prometheus`
  include `AGENTS.md`; no other agent gains write access.
- All existing sections of `AGENTS.md` must be preserved verbatim; only the
  `## Autonomous Strategy` section is added or updated.
- `@karpathy` frontmatter becomes `mode: subagent` and `hidden: true`; loop
  logic is untouched.
- `@autonomous` task map gains `"karpathy": allow`.
- Shell commands follow `docs/CONVENTIONS.md` (POSIX / explicit `bash -c` /
  `python3`; no zsh/bash-only syntax).
- All new or changed plugin behavior is covered by `node --test tests/plugins/*.test.mjs`.
- All agent/permission changes are covered by `python3 tests/verify_opencode.py --skip-llm`.

## Grounding
- `@karpathy` is currently `mode: primary`; users invoke it directly. - `agents/karpathy.md:1-3`
- `@autonomous` task map does not include `karpathy`; it cannot invoke it. - `agents/autonomous.md:22-26`
- `@prometheus` `edit`/`write` allowlists do not include `AGENTS.md`; it cannot record the strategy directive there. - `agents/prometheus.md:14-27`
- `AGENTS.md` is the project's persistent operating contract. - `AGENTS.md:1-24`
- The premature-exit defect (silent checklist abandonment between turns) was fixed in a prior detour: `hasUncheckedItems` + `maybePostContinuationNudge` in `plugins/opencode-autonomous-loop/index.js`, 48/48 plugin tests passing. - `plugins/opencode-autonomous-loop/index.js`, `tests/plugins/autonomous-loop.test.mjs`
- Karpathy's value is forcing nondeterminism into a deterministic check (baseline → noise floor → keep if > 2× noise). This is the design principle, not just one option. - `AGENTS.md: ## Autonomous Strategy`
- `examples/ml-loop` is a real runnable Karpathy target (frozen `prepare.py`, mutable `train.py`, scalar accuracy metric). - `examples/ml-loop/README.md`

## Acceptance Criteria

### Premature-exit fix (AC 1–5) — LANDED 2026-06-12
1. When `@autonomous` ends a turn with no promise token while a spec is present
   and `progress.txt` has unchecked `[ ]` items, the loop plugin posts a
   continuation corrective instructing it to resume.
2. The corrective does NOT fire when a promise token is present.
3. The corrective does NOT fire when all items are checked or `progress.txt` has
   no checkboxes.
4. The nudge fires at most once per unchanged turn text per session.
5. The fix does not relax any existing promise precondition.

> Status: implemented. `node --test tests/plugins/*.test.mjs` → 48/48 pass.

### Strategy directive in AGENTS.md (AC 6–10)
6. `agents/prometheus.md` instructs `@prometheus` to write an `## Autonomous Strategy`
   section into the project's `AGENTS.md` on every intake, recording the strategy
   (`karpathy` by default) and a one-line rationale.
7. `agents/prometheus.md` documents Karpathy as mandatory when a scalar metric +
   frozen evaluator exist or can be constructed, instrument-first before going
   exotic, and the selection precedence: user > SPEC > AGENTS.md > context default.
8. `agents/prometheus.md` permission block includes `AGENTS.md` in both `edit`
   and `write` allowlists, removing nothing from the existing list.
9. The project `AGENTS.md` contains an `## Autonomous Strategy` section with
   `strategy: karpathy` and a rationale; all pre-existing sections are preserved.
10. `agents/autonomous.md` includes a strategy section instructing it to read the
    directive, apply the hard Karpathy rule, instrument before going exotic, and
    invoke exotic strategies as named subagents only when instrumentation fails.

### Karpathy demotion (AC 11–15)
11. `agents/karpathy.md` frontmatter sets `mode: subagent` and `hidden: true`.
12. `agents/autonomous.md` permission `task` map includes `"karpathy": allow`.
13. `agents/karpathy.md` body states it is a strategy invoked by `@autonomous`,
    not a user-facing primary agent; loop logic is unchanged.
14. `program.md`, `.opencode/karpathy.json`, `.opencode/immutable.json`, and
    `examples/ml-loop/` are preserved; the ml-loop baseline runs without errors.
15. `tests/verify_opencode.py` reflects `@karpathy` as `subagent` (hidden) and
    `@autonomous` having `task: karpathy: allow`; no assertion that `@karpathy`
    is `primary` remains.

### Documentation (AC 16–18)
16. `README.md` documents `@autonomous` as the single looping owner with strategy
    selection precedence, and `@karpathy` as a hidden strategy subagent.
17. `README.md` states the Karpathy-first principle: deterministic check is the
    goal; exotic strategies are last resort; names Ralph Wiggum as the first
    exotic option and describes when it applies.
18. `README.md` reflects that `@prometheus` records the strategy directive in
    `AGENTS.md` and that `examples/ml-loop` is invoked via `@autonomous`.

### Immutability allowlist (AC 19)
19. `examples/immutable.json.example` `prometheus_only` and
    `write_allowlist.prometheus` both include `AGENTS.md`; no other agent
    allowlist gains `AGENTS.md`.

### Regression (AC 20–21)
20. `node --test tests/plugins/*.test.mjs` exits 0.
21. `python3 tests/verify_opencode.py --skip-llm` exits 0.

## Verification
```bash
# --- Premature-exit fix (already landed) ---
grep -q 'hasUncheckedItems' plugins/opencode-autonomous-loop/index.js
grep -q 'maybePostContinuationNudge' plugins/opencode-autonomous-loop/index.js
node --test tests/plugins/autonomous-loop.test.mjs

# --- Karpathy demotion ---
grep -q 'mode: subagent' agents/karpathy.md
grep -q 'hidden: true' agents/karpathy.md
python3 -c "import sys,re; t=open('agents/autonomous.md').read(); sys.exit(0 if re.search(r'\"karpathy\"\s*:\s*allow', t) else 1)"
test -d examples/ml-loop
sh -c 'cd examples/ml-loop && python3 train.py >/dev/null 2>&1 && test -f logs/latest_score.txt'

# --- Strategy directive ---
grep -q '## Autonomous Strategy' AGENTS.md
grep -q 'strategy: karpathy' AGENTS.md
grep -q '## Git commits' AGENTS.md
grep -q '## Workaround dumps' AGENTS.md
grep -q '## Agent routing' AGENTS.md
grep -q 'Autonomous Strategy' agents/prometheus.md
python3 -c "import sys; t=open('agents/prometheus.md').read(); sys.exit(0 if t.count('AGENTS.md')>=2 else 1)"
grep -q 'Autonomous Strategy' agents/autonomous.md
grep -qi 'instrument' agents/autonomous.md

# --- Immutability allowlist ---
grep -q 'AGENTS.md' examples/immutable.json.example

# --- Documentation ---
grep -qi 'Ralph Wiggum' README.md
grep -qi 'Karpathy' README.md
grep -qi 'strategy' README.md
grep -qi 'deterministic' README.md

# --- Regression suites ---
node --test tests/plugins/*.test.mjs
python3 tests/verify_opencode.py --skip-llm
```

## Implementation Checklist
- [x] Fix premature-exit defect: `hasUncheckedItems` + `maybePostContinuationNudge` in `opencode-autonomous-loop`; 11 new tests; 48/48 pass. (AC 1–5)
- [x] Add `"karpathy": allow` to `agents/autonomous.md` `task` permission map. (AC 12)
- [x] Add strategy directive section to `agents/autonomous.md`: read `AGENTS.md`, hard Karpathy rule, instrument-first, exotic as last-resort subagent. (AC 10)
- [x] Reinforce "do not stop with unchecked items" in `agents/autonomous.md` loop discipline. (AC 1–5 reinforcement)
- [x] Demote `agents/karpathy.md`: `mode: subagent`, `hidden: true`, reword opening; preserve loop logic. (AC 11, 13)
- [x] Update `agents/prometheus.md`: add `AGENTS.md` to `edit`/`write` allowlists; add intake instructions for strategy directive with Karpathy-first logic and selection precedence; update handoff to `@autonomous` only. (AC 6, 7, 8)
- [x] Add `## Autonomous Strategy` section to project `AGENTS.md` (`strategy: karpathy`, rationale). (AC 9)
- [x] Update `examples/immutable.json.example`: add `AGENTS.md` to `prometheus_only` and `write_allowlist.prometheus`. (AC 19)
- [x] Update `README.md`: agent table, Prometheus intake workflow, looping strategy section with Karpathy-first principle + exotic strategies table, ml-loop example pointing at `@autonomous`. (AC 16, 17, 18)
- [x] Update `examples/ml-loop/README.md`: invoke via `@autonomous` instead of `@karpathy`. (AC 18)
- [x] Update `tests/verify_opencode.py`: `@karpathy` mode → `subagent`; add `task: karpathy: allow` to `autonomous` rules; add `AGENTS.md` to `prometheus` `edit`/`write` rules. (AC 15, 20, 21)
- [ ] Run every command in `## Verification` and confirm all exit 0.

## Change Log
- 2026-06-12: New SPEC (replaces completed skill-layer SPEC). Scope: make `@autonomous` the single looping owner with a Karpathy-first hard rule, record strategy in `AGENTS.md` via `@prometheus`, demote `@karpathy` to a hidden strategy subagent. The premature-exit fix and the trial scaffold were discussed during planning; the fix was completed as a detour (AC 1–5 landed), and the trial was dropped in favour of the hard Karpathy rule (forcing nondeterminism into a deterministic check is the answer, not an experiment to discover). NotebookLM was unauthenticated with no relevant notebook during planning.
- 2026-06-12: All structural edits completed (agents, permissions, AGENTS.md, immutability example, README, validator). Verification run pending.
