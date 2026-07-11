---
name: test-driven-development
description: Use when making a testable production behavior change, bug fix, parser change, API change, or workflow rule change.
compatibility: opencode
---

# Test-Driven Development

If behavior is testable, watch a failing test fail for the right reason before
writing production code.

## Cycle

1. Red: write one minimal failing test for the required behavior.
2. Verify red: run the focused test and confirm it fails for the expected reason.
3. Green: write the smallest production change that passes.
4. Verify green: rerun the focused test, then the relevant broader suite.
5. Refactor: improve structure only after tests are green.

## Discipline

- Do not test mocks instead of behavior.
- Do not add test-only APIs to production objects.
- Mock the slow or external boundary, not the behavior under test.
- If a test cannot be written, state why and choose the closest executable
  verification.

## Existing Code Exception

When changing legacy code without useful seams, first add characterization tests
or a focused reproduction. Then make the smallest safe change.
