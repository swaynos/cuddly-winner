# Manifest Fixtures (schema v3)

Acceptance fixtures for the static `opencode-autonomous.json` validator.
Authoritative schema: `docs/ARCHITECTURE.md` § Manifest Schema (v3).

Each fixture has one expected verdict. The validator test asserts exactly these.

| Fixture | Verdict | Rule exercised |
| --- | --- | --- |
| `valid-direct.json` | ACCEPT | Direct with empty evaluator inventory + existing checks |
| `valid-karpathy.json` | ACCEPT | Karpathy with complete `optimization` block |
| `invalid-legacy-schema-v1.json` | REJECT | `schema_version` = 1 (retired) |
| `invalid-legacy-ralph.json` | REJECT | `strategy` = `ralph` (retired) |
| `invalid-unknown-version.json` | REJECT | `schema_version` = 4 (unknown future version) |
| `invalid-direct-empty-scope.json` | REJECT | `implementation_scope` must be non-empty |
| `invalid-karpathy-missing-optimization.json` | REJECT | `strategy=karpathy` without `optimization` |
| `invalid-direct-nonempty-evaluator-uninventoried.json` | REJECT | inventoried evaluator file absent on disk |
| `invalid-escaping-path.json` | REJECT | scope path escapes the worktree |
| `invalid-unknown-limit-key.json` | REJECT | unknown key inside `limits` |

Two standalone tests (not table-driven, since they mutate a loaded fixture
rather than load a dedicated file) cover the remaining schema-v3 rules:
`direct` strategy rejects an `optimization` block, and Karpathy's existing
complete-optimization requirements are unchanged by the v3 cutover.

Fixtures carrying a `_note` field also verify that unknown top-level keys are
tolerated only where the schema says so; `_note`/`_comment` are reserved
documentation keys the validator ignores. Every other unknown top-level key is a
hard rejection. Table-driven tests additionally cover symlinked evaluator paths,
duplicate inventory, nested unknown keys, non-numeric limits, overlapping
targets, and Karpathy immutable-target requirements. Scaffold tests separately
cover SPEC section and verification-command consistency.
