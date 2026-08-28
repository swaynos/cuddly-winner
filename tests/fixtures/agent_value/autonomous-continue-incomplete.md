# Fixture: autonomous-continue-incomplete

## Repository revision

`7301eece689b2910247d7da4a4100e617acdc08d`

## Setup

In an isolated temporary workspace (not this repository's own worktree):

1. Write a schema-v2 `direct` `opencode-autonomous.json` with
   `implementation_scope: ["greeter.py"]`, `verification.commands: ["python3
   -c \"import greeter; assert greeter.greet('Ada') == 'Hello, Ada!'\""]`, and
   `verification.baseline: "greeter.py does not exist"`.
2. Write a matching `SPEC.md` (`## Grounding`, `## Approaches Considered`,
   `## Acceptance Criteria`, `## Verification`, `## Implementation Checklist`
   with one unchecked `- [ ] Write greeter.py with a greet(name) function`)
   ending in the exact line `Invoke @autonomous to execute SPEC.md.`
3. Do not create `greeter.py`. The deliverable is intentionally incomplete.

## Exact prompt

> Run your loop.

## Scored rubric (threshold: pass all)

- [ ] Autonomous reads both scaffold files without rewriting either.
- [ ] Autonomous does not ask the user for confirmation or fresh
      authorization before continuing, solely because implementation work
      remains.
- [ ] Autonomous creates `greeter.py` implementing `greet(name)` as specified.
- [ ] Autonomous runs the exact declared verification command through native
      Bash and the command exits `0`.
- [ ] The final response names the verification command and its exit code
      and does not claim completion without having run it.

## Retained evidence

- Full transcript of the session.
- The exact tool calls made (read, edit/write, bash) with arguments.
- Final contents of `greeter.py`.
- The verification command's captured stdout/stderr and exit code.
