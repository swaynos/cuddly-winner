# Architecture

## Boundary

Native OpenCode Plan and Build sit outside this project's control plane. Their
requests flow directly through OpenCode with their original permissions and
tools. The plugin returns before inspecting their commands or mutation paths.

Only explicitly invoked managed agents enter this project's enforcement boundary:

```text
Native Plan / Build / third-party agents -> OpenCode unchanged

Prometheus / Autonomous / Karpathy / Reviewer / Grounder / Ask
    -> managed identity resolution
    -> fixed role defaults
    -> optional Autonomous runner and supervisor when selected
```

## Identity Enforcement

The immutability hook first resolves session ancestry. If the resulting identity
is not one of the six managed agents, processing stops immediately. No project
marker is required and no policy file is parsed.

Managed descendants inherit their originating managed identity. This prevents a
restricted agent from escaping its default through delegation while avoiding
restrictions on unrelated agents.

Prometheus is confined to planning artifacts. Autonomous can edit source but not
trusted control-plane code or runtime evidence. Ask, Karpathy, Reviewer, and
Grounder are read-only.

## Policy Placeholder

`opencode-immutable.json` is retained solely as documentation of a possible
future project override. It has no execution path in the current plugin. This is
intentional: a placeholder must not create a false security claim.

Future overrides may add explicit project paths or narrow managed roles, but
native Plan and Build remain outside the boundary unless the durable compatibility
contract is explicitly changed.

## Optional Autonomous Flow

When the user explicitly invokes Autonomous, the optional supervisor fingerprints
`SPEC.md`, tracks durable state, and evaluates exact runner artifacts. The runner
provides bounded, redacted, atomic evidence for that profile. Checklist marks are
not completion state and the SPEC is not rewritten during execution.

The supervisor initializes only for a top-level `autonomous` identity. Idle or
error events from native Plan/Build sessions are ignored. The trusted runner is
not a replacement for Build's Bash tool.

## Optional Karpathy Flow

Karpathy reads a scalar objective, frozen evaluator, and configuration, then
returns bounded one-change recommendations. Autonomous performs edits. This
preserves the original metric-driven optimization capability without imposing it
on normal software-development tasks.

## Deployment

Default installation copies managed agent definitions and the identity-scoped
immutability hook into OpenCode's global configuration. It deliberately omits
repository `AGENTS.md`, the supervisor, runner, and non-core skills.

`--with-autonomous` adds the supervisor and runner. `--with-skills` adds optional
skills. The installer removes obsolete managed symlinks and reports every target.
