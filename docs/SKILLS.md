# Skills

This document is the durable behavioral specification for packaged skills.
`skills/<name>/SKILL.md` implements the specification as runtime guidance.
`CONTRIBUTING.md` defines the process for adding or changing a package.

## Common Contract

Each packaged skill lives at `skills/<name>/SKILL.md`. Its frontmatter must use
the directory name as `name`, include a `description` beginning with `Use when`,
and contain a non-empty Markdown body. Use only OpenCode-supported frontmatter:
`name`, `description`, and optional `license`, `compatibility`, and `metadata`.

The description states the trigger. The body gives concise, reusable guidance;
put detailed provider or format material in files below the skill directory.
Skills guide model behavior only. They cannot grant tools, expand an agent's
permissions, or override managed-agent identity boundaries. The immutability
plugin and OpenCode permissions enforce those boundaries.

The default installer deploys every directory below `skills/` to
`<config_dir>/skills/`. OpenCode discovers `SKILL.md` packages when it starts;
restart OpenCode after installing or changing a skill.

## Catalog

### `local-word-document`

- **Trigger:** Creating a local `.docx` file from notes, planning data, or
  structured content.
- **Required behavior:** Draft and review Markdown before conversion; retain it
  as the editable source; convert it to Word; verify that the result is a real
  Word file.
- **Must not:** Write raw `.docx` data, delete the Markdown source, invent
  missing content, or convert before review.
- **Evidence:** Reviewed Markdown and successful output-format inspection.

### `playwright-image-generation`

- **Trigger:** Browser-based AI image generation or editing, especially where
  authenticated profiles, generated-image capture, or dataset artifacts matter.
- **Required behavior:** Protect browser profile state; keep it separate from
  run state; verify saved image signatures and hashes; classify failures; and
  freeze valuable outputs with manifests and checksums.
- **Must not:** Substitute a blank or temporary profile, trust a filename or
  response body as image evidence, count element changes as generation success,
  wait indefinitely for a stalled provider, or delete raw runs before release.
- **Evidence:** Verified image bytes, run records, and a frozen dataset release
  when outputs are retained.
- **Credential modes:** Default to ephemeral headless state. Persistent provider
  profiles require explicit opt-in and one approved interactive setup; never use
  personal browser profiles or an automatic headed fallback.

### `project-agent-scaffolding`

- **Trigger:** Designing project-local OpenCode agents or skills from a
  repository's recurring risks and workflows.
- **Required behavior:** Inventory the repository first; prefer reusable skills
  or existing global agents where sufficient; propose local definitions before
  editing; keep permissions narrow; and require approval before deletion.
- **Must not:** Add global roles by default, create local definitions before a
  proposal is approved, or modify global configuration without an explicit
  request.
- **Evidence:** Inventory, scoped proposal, approval where required, and local
  paths under `.opencode/`.

### `subagent-driven-development`

- **Trigger:** Executing an implementation plan with independent work that can
  be delegated, reviewed, or run in parallel.
- **Required behavior:** Give each delegation a narrow brief, success evidence,
  and escalation rules; independently verify returned work; and re-dispatch only
  with a clearer changed brief.
- **Must not:** Delegate an unfocused whole session, ignore a blocked result, or
  accept an agent report without reviewing its evidence.
- **Evidence:** Task brief, reported status, and independent diff or command
  review.

### `systematic-debugging`

- **Trigger:** A failing test, runtime error, flaky behavior, regression, or
  unexplained system behavior.
- **Required behavior:** Reproduce and trace the failure, state an
  evidence-backed root-cause hypothesis, test one variable at a time, then fix
  the source and add a practical regression guard.
- **Must not:** Apply random symptom patches. Reassess the design after three
  failed fix attempts.
- **Evidence:** Reproduction, hypothesis, focused verification, and regression
  test or documented closest executable check.

### `test-driven-development`

- **Trigger:** A testable production behavior change, bug fix, parser change,
  API change, or workflow-rule change.
- **Required behavior:** Follow red, verify red, green, verify green, then
  refactor. Use characterization tests or a focused reproduction for legacy code
  without useful seams.
- **Must not:** Test mocks instead of behavior, add production APIs only for
  tests, or write production code before observing the intended failing test.
- **Evidence:** Focused failing and passing test runs, followed by the relevant
  broader suite.

### `verification-before-completion`

- **Trigger:** Claiming implementation, tests, builds, reviews, cleanup, or any
  other work is complete or ready to ship.
- **Required behavior:** Identify and run fresh proof, read its full result and
  exit code, and make only claims the evidence supports.
- **Must not:** Use success language based on expectation, appearance, an earlier
  command, or an agent report alone.
- **Evidence:** Exact command or inspection, result, and exit code where one
  exists.

### `writing-skills`

- **Trigger:** Creating, revising, testing, or deciding whether to keep an
  OpenCode- or Claude-compatible skill.
- **Required behavior:** Identify the failure mode and trigger, choose reusable
  guidance, keep the package concise, validate a realistic pressure scenario or
  deterministic check, and close discovered loopholes.
- **Must not:** Mark an untested skill complete or batch unvalidated skill work.
- **Evidence:** Validation result, discovered gaps, and the final package path.
