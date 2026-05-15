# Project Memory

This directory persists research findings, decisions, and learnings across agent sessions.
`@grounder` reads files here before external research, and can append new entries.

## Format

Each file should be a dated markdown entry:

```
2024-12-15-api-behavior.md
2024-12-10-build-system-notes.md
```

Entry structure:

```markdown
---
date: 2024-12-15
topic: API behavior
researcher: @grounder
---

## Finding
<What was researched and what was learned>

## References
- `src/api.ts:42` — endpoint definition
- https://docs.example.com/v3/users — external API docs

## Risks / Unknowns
- <anything uncertain>

## Recommendation
<advice for future implementation, if applicable>
```

## Notes

- Keep entries concise and factual.
- Do not edit old entries; append new ones if understanding changes.
- Only `@grounder` should write here (add `edit: deny` to other agents' permissions).
