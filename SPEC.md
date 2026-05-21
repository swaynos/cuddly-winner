# Ask Agent for Quick Contextual Questions

## Status
Completed on 2026-05-21.

## Final Behavior
- `@ask` is a **primary** foundational agent for quick Q&A.
- It prioritizes **session context first** and avoids default file/code exploration.
- It is concise by default (soft target: short answers unless user asks for depth).
- It cannot edit files or run bash.
- It may delegate to `@grounder` only when missing facts require evidence.
- For local-state questions (for example, "have I installed this project?") it uses
  session evidence first, then `@grounder`, and never guesses.

## Implemented Artifacts
- `agents/ask.md` (new)
- `README.md` updated with `@ask` listing, layout entry, and usage guidance
- `tests/verify_opencode.py` updated with expected file, mode, and permissions

## Verification Snapshot
The following checks passed during implementation:

```bash
test -f agents/ask.md
grep -q '^mode: primary$' agents/ask.md
grep -q 'edit: deny' agents/ask.md
grep -q 'bash: deny' agents/ask.md
grep -q '"grounder": allow' agents/ask.md
grep -q '@ask' README.md
grep -q 'ask.md' README.md
grep -q '"ask.md"' tests/verify_opencode.py
grep -q '"ask"' tests/verify_opencode.py
./scripts/deploy-opencode-agents.sh status | grep -q 'ask.md'
python3 tests/verify_opencode.py --skip-llm
```

## Notes
- Sandbox verification succeeded with all checks passing.
- Environment warnings about Python `hashlib` (`blake2*`) were observed but did
  not fail the validator run.
