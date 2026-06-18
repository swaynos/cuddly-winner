# Cuddly Winner Documentation

`docs/` is the durable source of truth for the project. `SPEC.md` is the
current implementation brief and can change frequently; do not rely on it as the
long-term requirements record.

If the implementation were deleted, the documents in this directory should be
complete enough for a maintainer to rebuild the project behavior, structure,
contracts, validation, and operating model.

## Reading Order

1. `REQUIREMENTS.md` — stable requirements and non-negotiable invariants.
2. `ARCHITECTURE.md` — repository structure and system components.
3. `AGENT-ARCHITECTURE.md` — agent taxonomy, ethos, roster, and delegation rules.
4. `WORKFLOWS.md` — user and agent workflows from planning through verification.
5. `STRATEGY-CONTRACT.md` — contract for loop-strategy subagents.
6. `PLUGINS.md` — plugin responsibilities, enforcement, state, and limitations.
7. `VALIDATION.md` — static and runtime validation expectations.
8. `CONVENTIONS.md` — shell and script portability rules.
9. `strategy-template.md` — scaffold for adding new loop strategies.
10. `testing-methodology.md` — detailed runtime behavior audit procedure.

## Documentation Update Rule

Any change that alters agent behavior, permissions, workflows, plugin semantics,
validation rules, deployment behavior, strategy selection, or project invariants
must update the relevant document in this directory in the same change.

The root `AGENTS.md` enforces this expectation for agents working in the repo.
