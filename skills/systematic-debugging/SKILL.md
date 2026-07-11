---
name: systematic-debugging
description: Use when diagnosing a failing test, runtime error, flaky behavior, regression, or unexplained system behavior.
compatibility: opencode
---

# Systematic Debugging

Find root cause before fixes. Random patches destroy evidence and create new bugs.

## Phase 1: Investigate

- Read error messages and stack traces completely.
- Reproduce the failure consistently when possible.
- Check recent changes with focused diffs and logs.
- Map the failing path across component boundaries.

## Phase 2: Trace

Ask where the bad state first appears. Trace upstream until you can explain:
- what value is wrong
- where it became wrong
- why the system allowed it

## Phase 3: Hypothesize

State one hypothesis:

`I think <root cause> because <evidence>.`

Test the smallest change or observation that can prove or disprove it. Change one
variable at a time.

## Phase 4: Fix and Fortify

- Fix the source, not only the symptom.
- Add a regression test or guard when practical.
- Consider defense in depth for high-risk failure classes.

## Stop Rule

After three failed fix attempts, stop patching. Reassess architecture, coupling,
or missing evidence before trying another fix.
