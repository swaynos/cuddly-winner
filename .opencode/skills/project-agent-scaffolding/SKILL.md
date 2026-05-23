---
name: project-agent-scaffolding
description: Use when deriving project-local OpenCode agents or skills from a repository's requirements, architecture, risks, or recurring workflows.
compatibility: opencode
---

# Project Agent Scaffolding

Use this skill to let `plan` or another planner design a project-local OpenCode
team without bloating the global core suite.

## Core Rule

Project-specific roles belong in the target repo under `.opencode/`. Global core
agents stay general unless the user explicitly asks to promote a proven local
definition.

Do not recommend adding a global primary agent for project curation by default.
If guided curation is useful, suggest a project-local curator/bootstrap agent in
the current repo only.

## Workflow

1. Inventory context before proposing roles.
   - Read requirements, docs, tests, build config, and existing `.opencode/` files.
   - Identify stack, domain, high-risk areas, repeated review needs, and agent
     failure patterns.

2. Decide whether a skill, existing agent, or local agent is enough.
   - Prefer skills for reusable process guidance.
   - Prefer existing global agents for general planning, execution, review, and
     grounding.
   - Propose project-local agents only for recurring repo-specific work.
   - Propose a project-local curator/bootstrap agent only when ongoing curation
     is valuable enough to justify a local tab in this repo. Explain why an
     existing skill or global agent is insufficient before making this suggestion.

3. Classify the project pack.
   - `add`: new local role or skill is justified.
   - `update`: existing definition is useful but stale or unsafe.
   - `keep`: existing definition remains accurate.
   - `archive`: obsolete or overlapping definition should be moved aside.
   - `delete`: remove only with explicit user confirmation.
   - `promote-candidate`: may belong in the core distribution later.

4. Propose before editing.
   - Name, path, mode, purpose, trigger, permissions, and rationale for each item.
   - Explain how end users and core agents know when to invoke each local agent.
   - State that no global agent install is required.

5. Scaffold after approval.
   - Agents: `.opencode/agents/<name>.md`.
   - Skills: `.opencode/skills/<name>/SKILL.md`.
   - Routing docs: `.opencode/agents/README.md` or `.opencode/AGENTS.md`.

6. Keep permissions narrow.
   - Reviewers default to read-only.
   - Grounding agents may use `webfetch` when current external docs matter.
   - Implementers should be rare and scoped to exact project workflows.

7. Cleanup safely.
   - Archive by default under `.opencode/archive/`.
   - Delete only after explicit confirmation.
   - Never modify global config or this core repo's `agents/` directory unless the
     user explicitly requests promotion.

## Suggested User-Facing Recommendation

When a user in another repo asks whether to try project curation, recommend:

```text
Keep this project-local. I can first inventory this repo and propose a local
.opencode/ pack. If we need ongoing curation, we can add a local
.opencode/agents/project-curator.md after approval; no global agent install is
required. Restart OpenCode after changing agent or skill files.
```

## Routing Doc Template

```markdown
# Project OpenCode Agents

| Situation | Use | Why |
|---|---|---|
| Billing, invoices, subscriptions, webhooks | `@billing-reviewer` | Checks repo-specific billing risks |
| UI accessibility changes | `@a11y-reviewer` | Reviews keyboard, ARIA, and contrast regressions |

Re-run project-agent scaffolding when project workflows change or local agents
feel stale. Restart OpenCode after changing agent or skill definitions.
```
