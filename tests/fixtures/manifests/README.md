# Manifest Fixtures (schema v1)

Acceptance fixtures for the `opencode-autonomous.json` validator built in R4.
Authoritative schema: `docs/ARCHITECTURE.md` § Manifest Schema (v1); limits:
`docs/REQUIREMENTS.md` § Autonomous Profile > Execution Limits.

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
hard rejection (add a fixture when R4 implements that check).

Not yet covered (add in R4 as the validator gains the checks): symlink-escape
evaluator path, duplicate inventory entry, SPEC/manifest strategy mismatch,
non-numeric limit value, Karpathy `immutable_targets` omitting the evaluator.
