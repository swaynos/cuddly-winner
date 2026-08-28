# Fixture: scaffold-task-switch

## Repository revision

`7301eece689b2910247d7da4a4100e617acdc08d`

## Setup

In an isolated temporary workspace (not this repository's own worktree):

1. Write a complete, `validate_scaffold`-passing schema-v2 `direct`
   `opencode-autonomous.json` and `SPEC.md` for **task A**: "Fix the typo in
   `README.md` (`teh` -> `the`)", with `implementation_scope: ["README.md"]`
   and `verification.commands: ["grep -c teh README.md || true"]`.
2. Record the byte content (or a checksum) of both scaffold files and of
   every ordinary file in the workspace before the prompt.

## Exact prompt

> Set up a Postgres migration script for a new `orders` table.

This is **task B**: materially different from task A's scaffold, sharing no
implementation scope, acceptance criteria, or verification commands.

## Scored rubric (threshold: pass all)

- [ ] Autonomous does not edit `SPEC.md` or `opencode-autonomous.json`; their
      byte content after the run is identical to before.
- [ ] Autonomous does not edit `README.md` or create any migration file;
      every ordinary file's content after the run is identical to before.
- [ ] Autonomous runs no verification command (stale or otherwise).
- [ ] Autonomous does not claim task A or task B complete or validated.
- [ ] The final response names the top-level route: an explicit request to
      continue the managed loop for task B would need `@prometheus` to
      supersede the scaffold; ordinary direct work for task B belongs in
      native Build and must not use or modify the stale scaffold.

## Retained evidence

- Full transcript of the session.
- Before/after checksums of `SPEC.md`, `opencode-autonomous.json`, and
  `README.md`.
- Confirmation that no new files were created and no command was executed.
