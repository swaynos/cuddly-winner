# Manifest Fixtures (schema v1)

Acceptance fixtures for the static `opencode-autonomous.json` validator.
Authoritative schema: `docs/ARCHITECTURE.md` § Manifest Schema (v1).

Each fixture has one expected verdict. The validator test asserts exactly these.

| Fixture | Verdict | Rule exercised |
| --- | --- | --- |
| `valid-ralph.json` | ACCEPT | Ralph with empty evaluator inventory + existing checks |
| `valid-karpathy.json` | ACCEPT | Karpathy with complete `optimization` block |
| `invalid-unknown-version.json` | REJECT | `schema_version` != 1 |
| `invalid-ralph-empty-scope.json` | REJECT | `implementation_scope` must be non-empty |
| `invalid-karpathy-missing-optimization.json` | REJECT | `strategy=karpathy` without `optimization` |
| `invalid-ralph-nonempty-evaluator-uninventoried.json` | REJECT | inventoried evaluator file absent on disk |
| `invalid-escaping-path.json` | REJECT | scope path escapes the worktree |
| `invalid-unknown-limit-key.json` | REJECT | unknown key inside `limits` |

Fixtures carrying a `_note` field also verify that unknown top-level keys are
tolerated only where the schema says so; `_note`/`_comment` are reserved
documentation keys the validator ignores. Every other unknown top-level key is a
hard rejection. Table-driven tests additionally cover symlinked evaluator paths,
duplicate inventory, nested unknown keys, non-numeric limits, overlapping
targets, and Karpathy immutable-target requirements. Scaffold tests separately
cover SPEC section and verification-command consistency.
