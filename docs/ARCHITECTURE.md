# Architecture

## Scope

Cuddly Winner is an optional OpenCode profile. Native Plan and Build remain the
default path for ordinary work. The profile adds a small planning path without a
command sandbox, virtual machine, workflow loop, completion supervisor, or
protected evidence store.

## Managed Profile

The installer deploys three agents, one plugin, one tool, one shared rule, and
the existing five-file Playwright browser runtime.

| Component | Purpose |
| --- | --- |
| Ask | Read-only short answers and narrow evidence gathering. |
| Grounder | Hidden, read-only evidence researcher. |
| Prometheus | Planning-only publisher for Direct agents. |
| `plugins/immutability.ts` | Enforces managed mutation and Bash boundaries. |
| `tools/publish_direct_agent.ts` | Creates one no-clobber Direct agent. |
| `rules/resource-selection.md` | Browser and source-selection policy. |

The browser runtime remains Playwright-only. Task work uses configured
`headless` or Linux `virtual-display` mode. A separate headed window exists only
for a person to log in. Browser state stays outside the repository.

## Direct Agents

Prometheus publishes exactly one self-contained file:

```text
.opencode/agents/generated/<task-derived-name>.md
```

The nested directory is an internal boundary, not a visible agent-name prefix.
The file's frontmatter supplies the plain task-derived OpenCode name. It contains
the requested outcome, criteria, durable context, instructions, verification,
stop conditions, escalation triggers, and one embedded schema-v1 policy block.

The policy contains only:

```json
{
  "schema_version": 1,
  "name": "task-derived-name",
  "edit_paths": ["src/exact-file.ts"],
  "bash": true
}
```

The publisher rejects unsafe names and paths, symlinked agent directories,
policy-marker injection, and any existing project-local agent name. It scans
nested local agent definitions by file name and frontmatter name. It writes
through a temporary regular file and hard link, so it never replaces an existing
generated agent.

`ImmutabilityGuard` reads this file only for the selected Direct identity. It
allows exact `edit_paths`, applies the boolean Bash decision, blocks generated
definition rewrites and trusted profile sources, and carries the same boundary to
descendants. All managed ancestor restrictions combine, so a child cannot loosen
a read-only, Prometheus, or Direct-policy boundary. Only the selected root
Prometheus session may publish. Native and unrelated project-local agents remain
outside the Direct policy. Browser screenshot, download, and media-save tools use
the same path checks as edit tools. Profile sources under `agents/`, `plugins/`,
`tools/`, `rules/`, and `scripts/` are trusted control paths and cannot appear in
a Direct policy.

Classic generated packages are not migrated or accepted. When the old registry,
agent, brief, and manifest layout identifies the selected agent, the guard denies
mutation and Bash and tells the user to republish it as a Direct agent.

### Decision Record

The previous registry, JSON manifest, Markdown brief, strategy vocabulary, task
loop, KPI policy, and Reviewer created multiple files for one bounded task. The
profile now uses one file because one task needs one durable instruction and one
small machine-enforced policy. Revisit this decision only when a concrete task
cannot carry its required context and exact policy in one file. Do not restore a
second format or compatibility layer without changing this document and
`REQUIREMENTS.md`.

## Installation And Retirement

`scripts/deploy-opencode-agents.sh` supports copy and symlink modes. Plugins and
browser runtime files always install as copies. `install`, `status`, and `remove`
operate under one configuration root.

The installer records managed agents and safely retires removed assets. It deletes
only an exact known copy or a link to the repository source. Modified, unrelated,
and user-owned files survive and make `status` report drift. It preserves browser
settings, saved sessions, and feedback data. Retired user configuration is never
treated as profile-owned merely because its path matches an old feature. It rejects
symlinked retirement parents rather than following them outside the configuration
root.
Retired MCP entries are removed only when their full historical configuration
matches. A modified retired rule file keeps its instruction registration so an
upgrade does not silently disable user-owned behavior.

Restart OpenCode after installing or changing agents, plugins, tools, rules, or
browser runtime files. OpenCode loads these at startup.
