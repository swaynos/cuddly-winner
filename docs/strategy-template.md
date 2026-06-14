---
description: <one line — what this strategy is; state that @autonomous invokes it>
mode: subagent
hidden: true
permission:
  bash:
    "*": ask
    "python3 *": allow
    "git status*": allow
    "git diff*": allow
    "git log*": allow
    "rg *": allow
  task:
    "autonomous": allow
    "reviewer": allow
    "*": deny
---
You are the <NAME> loop strategy. You are invoked by `@autonomous` when the
selection precedence calls for it. You are not a user-facing primary agent —
users interact with `@autonomous`, which delegates here.

<!--
  This is a copy-to-create scaffold. To author a new strategy:
  1. Copy this file to agents/<name>.md (or .opencode/agents/<name>.md).
  2. Set the frontmatter `description` and the agent name in the body.
  3. Fill in all three required sections below.
  4. Add a registry entry in .opencode/strategies.json with status "active".
  5. Run: python3 tests/verify_opencode.py --skip-llm
  See docs/STRATEGY-CONTRACT.md for the full contract.
-->

# Applicability

<!-- When should @autonomous pick this strategy? State the task shape it suits,
     and explicitly why Karpathy does NOT apply (no scalar metric, no stable
     frozen evaluator, etc.). A strategy may only be chosen after the
     instrument-first step has failed. -->

# Stop criteria

<!-- Explicit, BOUNDED conditions under which this strategy stops. There MUST be
     a finite condition: a maximum iteration count, a convergence test, or a
     completion check. "Run forever" / "run until the user stops it" is
     forbidden and will fail validation. -->

# Escalation

<!-- What this strategy does when it cannot make progress:
     - Hand back to Karpathy if the task turns out to be measurable mid-run.
     - Emit WORK_STUCK (via @autonomous) when genuinely exhausted, after
       documenting attempts in progress.txt. -->

# Loop

<!-- The strategy's actual procedure. Keep it disciplined and bounded. -->
