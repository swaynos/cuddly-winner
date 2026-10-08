# Requirements

## Product Goal

Provide a lightweight optional OpenCode profile for evidence-backed planning and
one bounded, goal-oriented work handoff. It works seamlessly with default
OpenCode Plan and Build, never changes their native behavior, and keeps any new
behaviors scoped strictly to their intended surfaces without claiming command sandboxing.

## Current Contract

The managed profile ships exactly `ask`, `grounder`, and `prometheus`.
Grounder is hidden and read-only. Ask is read-only and can delegate research to
Grounder. Prometheus is planning-only: it can invoke `publish_goal_agent`, but
cannot edit project files or use Bash.
It interviews the user after inspecting the conversation and project evidence,
asks only decision-changing questions, and establishes observable acceptance
criteria and independent verification before publication.

Prometheus publishes one local Goal Agent under
`.opencode/agents/generated/<name>.md`. `<name>` is task-derived, lowercase,
hyphenated, and cannot collide with a native or managed identity. The Goal Agent
file must contain the schema-v1 embedded policy described in `ARCHITECTURE.md`.
Its policy grants only exact worktree-relative edit paths and a boolean Bash
capability.

Inspect existing definitions before publication. Same-task revisions should keep
the name and path stable. The publisher supports explicit inspect/update operations;
updates require a complete validated definition and the inspected byte SHA-256.
Stale, concurrent, colliding, malformed or symlinked updates fail safely. Default
creation remains no-clobber. Restart OpenCode and use a fresh conversation after
revision; prior success cannot validate a changed definition.

Goal Agents coordinate the published task in a fresh OpenCode session. Each
goal_cycle runs a build iteration AND a separate independent validation iteration,
each in a new child session. Failed validation
feeds findings to the next fresh builder. Only criterion-by-criterion validation
with tool evidence establishes completion. A premature coordinator stop resumes
automatically; cancellation, denied permissions, unknown API outcomes, and genuine
blockers remain incomplete and require explicit user input before resuming.
Unresolved independent findings persist across cycles and are supplied to fresh
validators without the builder conversation. A previous failure becoming passed
requires an explicit evidence-backed `resolution`; unrelated passing tests do
not resolve it. Required unavailable historical evidence remains a blocker.
Cycle records are bound to the exact definition fingerprint. Changed or unbound
records cannot authorize continuation or descendant mutation in the old session.
Outcome and side-effect constraints must distinguish executable implementation,
offline verification and live execution. Completion reports must distinguish
these evidence classes and actual goal achievement.

Goal execution displays bounded, event-derived parent activity while child phases
run, including cycle, phase, public milestone, waiting, failure, completion and
cancellation. Child-reported progress is not validation evidence. Preserve native
session behavior, user TUI settings and modified assets during installation/removal.
An unsupported blocker with no attempted inspection, or a malformed completed
validator report, is repairable failed validation. Missing coordinator-only tools
in a child is intentional, not a dependency failure. Ordinary rejected-input tool
errors must not be mistaken for user permission rejection.
Bookkeeping and unavailable-tool calls do not establish blocker evidence. Failed
inspection attempts can establish evidence of an unavailable external dependency.
Both builder and validator child sessions explicitly receive read, glob, grep, and
list inspection permissions. The validator cannot use edit tools or delegate; when
Bash is enabled, it receives an approval-gated verification channel and must not
modify product code through shell commands. Approval is not a command allowlist;
this is not a shell sandbox.
Optional verified `builder_model` and `validator_model` values in
`options.goal` choose separate execution models. When a value is omitted, that
child inherits the model currently selected in the Goal Agent session (normally
the user's configured default).
Goal Agents cannot rewrite their generated definition or trusted profile sources. Their
descendants inherit the Goal-Agent boundary and cannot loosen any managed ancestor's
restriction. Only the selected root Prometheus or Build session may publish a Goal Agent.
A malformed Goal-Agent policy fails closed. Browser tools that save screenshots,
downloads, or media locally obey the same exact edit-path policy as edit tools.

## Goal Progress Visibility

While `goal_cycle` runs, the terminal TUI must show a persistent, bounded Goal-only
activity panel identifying cycle, builder/independent validator, current actual
tool activity and concise child-reported milestones. It must remain visible in
narrow terminals with the sidebar hidden and during approval waits. Progress
reports are not evidence or success; show failed validation/retry, independent
completion, interruption and cancellation honestly. Preserve native Build/Plan
prompts, session isolation, cancellation and unknown-action safeguards.

The installer manages the separate TUI module and registration without replacing
user themes, keybindings, plugin options, JSONC comments or disable preferences.
Verification must observe terminal-rendered updates before the child finishes,
not just completed output or metadata values. Restart OpenCode after deployment.

## No Legacy Support

The old generated-agent registry, manifest, brief, task-loop, Ralph,
optimization, KPI, Reviewer, spike, skill, feedback, session-fetch, and announce
hygiene systems are removed. They have no alias, migration, or alternate runtime
path. A recognized old package fails closed until Prometheus republishes it as a
Goal Agent.
This retirement does not prohibit the current single-file Goal Agent runtime or
user-requested automation in other projects. Older Goal Agent definitions without
goal metadata do not silently acquire autonomous continuation; explicitly revise
a valid single-file definition through the publisher, then restart in a fresh session.

## Native Compatibility

Build, Plan, unknown identities, and unrelated local agents remain completely native
and usable without a Goal Agent definition. The only addition to native Build is access to
publish_goal_agent, so a Build session can publish a Goal Agent without
switching to Prometheus. The profile works seamlessly with default Plan and Build
and does not alter their behavior. The immutability plugin applies only to
Ask, Grounder, Prometheus, Goal Agents, and a detected legacy package, while allowing
root Build sessions to publish Goal Agents if chosen. It intercepts OpenCode
edit and Bash tool calls, not host filesystem effects produced by a command.

## Browser Runtime

`rules/resource-selection.md` owns workflow precedence and shared safeguards.
Managed runtime procedures live in the on-demand `docs/RESOURCE-SELECTION.md`,
deployed beside the rule without inclusion in always-loaded instructions.

## Installation Safety

The installer must deploy the current profile without overwriting user changes.
It may retire old managed assets only when an exact hash or repository-link target
proves ownership, except that install and remove forcibly delete a file or symlink
at the retired `tools/publish_direct_agent.ts` path. `status` reports that retired
file if it still exists. An unexpected directory at that path remains untouched.
Conflicting other old paths remain untouched and make status drift.
Customized retired MCP entries and the instructions for preserved retired rules
also remain untouched. Browser settings and saved sessions are user data and are
never reset.
