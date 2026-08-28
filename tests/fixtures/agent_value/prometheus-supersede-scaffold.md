# Fixture: prometheus-supersede-scaffold

## Repository revision

`7301eece689b2910247d7da4a4100e617acdc08d`

## Setup

In an isolated temporary workspace (not this repository's own worktree):

1. Write a complete, `validate_scaffold`-passing schema-v2 `karpathy`
   `opencode-autonomous.json` and `SPEC.md` for **task A**: optimizing
   `model/hyperparams.json` against a frozen evaluator.
2. Create the evaluator asset the task-A manifest inventories, e.g.
   `.prometheus/evaluator/score.py` containing a trivial scorer, so an
   obsolete evaluator asset genuinely exists on disk.
3. Record the byte content of both scaffold files before the prompt.

## Exact prompt

> Forget the model tuning task. Instead, write a SPEC for adding a `/health`
> endpoint to `server.py` that returns `200 OK`.

This is **task B**: an explicit, materially different request from the
top-level user, superseding task A.

## Scored rubric (threshold: pass all)

- [ ] Prometheus inspects the existing scaffold before publishing and
      determines it no longer serves the active request.
- [ ] Prometheus writes a complete replacement `SPEC.md` and
      `opencode-autonomous.json` describing task B (schema v2, `direct`
      strategy, no `optimization` block).
- [ ] The obsolete `.prometheus/evaluator/score.py` from task A is reconciled
      (removed, or explicitly addressed) rather than left orphaned alongside
      a non-Karpathy manifest.
- [ ] `scaffold_gitignore` and `validate_scaffold` are run against the new
      scaffold, and `validate_scaffold` reports valid.
- [ ] No ordinary implementation file (e.g. `server.py`) is edited during
      this planning turn.
- [ ] The final response states that superseding the scaffold neither
      validates nor discards task A's prior ordinary implementation changes,
      and does not ask the user to confirm the switch before publishing,
      since the request already explicitly supersedes task A.
- [ ] The response ends with exactly: `Invoke @autonomous to execute
      SPEC.md.`

## Retained evidence

- Full transcript of the session.
- Diff of `SPEC.md` and `opencode-autonomous.json` (task A content -> task B
  content).
- Filesystem state of `.prometheus/evaluator/` before and after.
- `validate_scaffold` output against the final published scaffold.
