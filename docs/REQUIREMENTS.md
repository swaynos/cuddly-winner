# Requirements

## Product Goal

Provide a lightweight optional OpenCode profile for evidence-backed planning and
one bounded, goal-driven implementation handoff. It must not replace native Plan
or Build or claim command sandboxing.

## Current Contract

The managed profile ships exactly `ask`, `grounder`, and `prometheus`.
Grounder is hidden and read-only. Ask is read-only and can delegate research to
Grounder. Prometheus is planning-only: it can invoke `publish_direct_agent`, but
cannot edit project files or use Bash.
It interviews the user after inspecting the conversation and project evidence,
asks only decision-changing questions, and establishes observable acceptance
criteria and independent verification before publication.

Prometheus publishes one local Direct agent under
`.opencode/agents/generated/<name>.md`. `<name>` is task-derived, lowercase,
hyphenated, and cannot collide with a native or managed identity. The Direct
file must contain the schema-v1 embedded policy described in `ARCHITECTURE.md`.
Its policy grants only exact worktree-relative edit paths and a boolean Bash
capability.

Direct agents coordinate the published task in a fresh OpenCode session. Each
goal_cycle runs a build iteration AND a separate independent validation iteration,
each in a new child session with the selected execution model. Failed validation
feeds findings to the next fresh builder. Only criterion-by-criterion validation
with tool evidence establishes completion. A premature coordinator stop resumes
automatically; cancellation, denied permissions, unknown API outcomes, and genuine
blockers remain incomplete and require explicit user input before resuming.
The validator cannot use edit tools or delegate; it must not modify product code
through shell commands. This is not a shell sandbox.
An optional verified provider/model ID in the generated frontmatter pins execution;
otherwise both children use the selected coordinator model.
Direct agents cannot rewrite their generated definition or trusted profile sources. Their
descendants inherit the Direct boundary and cannot loosen any managed ancestor's
restriction. Only the selected root Prometheus session may publish a Direct agent.
A malformed Direct policy fails closed. Browser tools that save screenshots,
downloads, or media locally obey the same exact edit-path policy as edit tools.

## No Legacy Support

The old generated-agent registry, manifest, brief, task-loop, Ralph,
optimization, KPI, Reviewer, spike, skill, feedback, session-fetch, and announce
hygiene systems are removed. They have no alias, migration, or alternate runtime
path. A recognized old package fails closed until Prometheus republishes it as a
Direct agent.
This retirement does not prohibit the current single-file Direct goal runtime or
user-requested automation in other projects. Older Direct definitions without
goal metadata do not silently acquire autonomous continuation; publish a new name.

## Native Compatibility

Build, Plan, unknown identities, and unrelated local agents remain usable without
a Direct package. The immutability plugin applies only to Ask, Grounder,
Prometheus, Direct agents, and a detected legacy package. It intercepts OpenCode
edit and Bash tool calls, not host filesystem effects produced by a command.

## Browser Runtime

Playwright is the only supported browser backend. Task actions run in configured
headless or virtual-display mode; a separate headed window serves human login
only. Saved authentication state remains private, origin-scoped, and outside the
repository. A page result is not a delivered file: downloads and generated files
require local-byte validation. An existing page image is not success for a new
generated result. Never automatically replay an action whose outcome is unknown.

## Installation Safety

The installer must deploy the current profile without overwriting user changes.
It may retire old managed assets only when an exact hash or repository-link target
proves ownership. Conflicting old paths remain untouched and make status drift.
Customized retired MCP entries and the instructions for preserved retired rules
also remain untouched. Browser settings and saved sessions are user data and are
never reset.
