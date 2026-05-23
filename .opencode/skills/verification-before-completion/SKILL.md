---
name: verification-before-completion
description: Use when claiming implementation, tests, builds, reviews, cleanup, or any other work is complete or ready to ship.
compatibility: opencode
---

# Verification Before Completion

Fresh evidence comes before completion claims.

## Gate

Before saying work is complete, ready, passing, fixed, verified, or safe:

1. Identify the command or inspection that proves the claim.
2. Run or perform it now, not from memory.
3. Read the full result and exit code.
4. State the claim only if the evidence supports it.

## Evidence Rules

- Tests pass: cite the exact test command and exit code 0.
- Build succeeds: cite the exact build command and exit code 0.
- Bug fixed: cite reproduction or regression verification.
- Review complete: cite diff/files inspected and verdict.
- Agent work complete: verify the actual diff, not the agent report.

## Red Flags

Do not use success language based on:
- "should work"
- "looks good"
- "probably fixed"
- "agent said success"
- an earlier command before later edits

If evidence is missing, report the real status and the next verification step.
