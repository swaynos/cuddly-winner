# Contributing

Read `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, and `docs/SKILLS.md`
before changing this distribution. The skill catalog defines the behavior a new
package must implement.

## Adding A Skill

1. Confirm the guidance solves a recurring failure mode rather than a one-off
   task. Record the user-facing trigger and why an existing skill or agent is
   insufficient.
2. Add a catalog entry to `docs/SKILLS.md` before writing the runtime prompt.
   Define its trigger, required behavior, prohibited shortcuts, and evidence.
3. Create `skills/<name>/SKILL.md`. The directory name and frontmatter `name`
   must match. Use a lowercase, hyphen-separated name and a `description` that
   begins with `Use when` and states when the skill applies.
4. Keep the body concise and reusable. Put provider-specific or bulky reference
   material under `skills/<name>/references/` and link to it from `SKILL.md`.
   Do not put permission grants, role changes, or claims of enforcement in the
   skill: only OpenCode and the immutability plugin enforce permissions.
5. Add deterministic validation for package structure and any essential static
   safety requirements. Add or extend a pressure test when the behavior needs a
   model-compliance check. Do not describe optional pressure-test results as a
   replacement for deterministic validation or managed-agent boundary tests.
6. Run the focused checks below. The installer automatically deploys each
   `skills/*` directory, so no installer source change is needed for a normal
   new package. Install into a temporary config root to confirm deployment.

## Skill Template

```markdown
---
name: example-skill
description: Use when the task requires example reusable guidance.
compatibility: opencode
---

# Example Skill

State the trigger, required workflow, evidence, and prohibited shortcuts.
```

## Validation

Run Python only through the project virtualenv:

```bash
PYTHON="$(bash scripts/ensure-venv.sh)"
"$PYTHON" tests/test_skill_coverage.py --skip-llm
"$PYTHON" tests/verify_opencode.py --skip-llm
```

Run the full repository suite before submitting cross-cutting changes:

```bash
bash scripts/ci.sh
```

For an installation check, use a temporary OpenCode configuration root with the
supported installer interface. Then restart OpenCode: it loads skills at startup
and does not hot-reload them.

```bash
bash scripts/deploy-opencode-agents.sh install --config-dir /tmp/opencode-skills
```

When changing an existing skill, update its catalog entry, runtime prompt,
relevant tests, and references together. Keep the catalog and packaged skill
directories in one-to-one correspondence.
