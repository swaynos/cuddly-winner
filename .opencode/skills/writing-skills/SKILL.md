---
name: writing-skills
description: Use when creating, revising, testing, or deciding whether to keep an OpenCode or Claude-compatible skill.
compatibility: opencode
---

# Writing Skills

Treat process documentation like code: it is not done until it changes behavior
under a realistic pressure scenario or concrete validation.

## Before Writing

- Identify the failure mode the skill prevents.
- Define when the skill should trigger.
- Decide whether it is rigid discipline or flexible guidance.
- Prefer a skill only when the guidance is reusable.

## Skill Shape

- Put trigger conditions in `description`; do not summarize the whole workflow.
- Keep `SKILL.md` concise and move bulky reference material to supporting files.
- Use OpenCode frontmatter only when targeting OpenCode: `name`, `description`,
  optional `license`, `compatibility`, `metadata`.
- Name must match the containing directory.

## Validation

Before calling a new or edited skill complete:
- run a pressure scenario, dry run, or deterministic validator
- check whether an agent could rationalize around the instructions
- close specific loopholes discovered during testing
- verify the skill appears in the expected location

Do not batch untested skills. Finish and validate one before moving to the next.
