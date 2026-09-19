# Agent Rules

## Environment

This repository uses Node.js `>=22.22.2 <25`. The browser runtime depends on
Node and npm. If a future check requires Python, first run:

```sh
PYTHON="$(bash scripts/ensure-venv.sh)"
```

Use that returned interpreter rather than system Python.

## Git Commits

Agents do not stage, commit, stash, reset, switch branches, or initialize Git.
Only an explicit user request authorizes a final commit after review.

## Product Contract

The durable source of truth is `docs/`. Update the relevant documentation in the
same change whenever agent behavior, permissions, installation, browser behavior,
or the Direct workflow changes.

The profile supports one Direct-agent format only:

```text
.opencode/agents/generated/<task-derived-name>.md
```

It embeds schema version 1 policy with exact edit paths and boolean Bash access.
Do not add a registry, manifest, task brief, migration, alias, strategy
vocabulary, KPI policy, or compatibility path. A legacy package must be
republished as a Direct agent.

Ask and Grounder are read-only. Prometheus publishes Direct agents but does not
implement tasks, edit files, or run Bash. Native Plan and Build must remain
available without a specialist handoff.

## Browser Boundary

Preserve the existing five-file Playwright browser runtime unless the user
explicitly requests browser behavior changes. Follow `docs/RESOURCE-SELECTION.md`
and `rules/resource-selection.md`. Task work uses headless or virtual-display
mode; a visible browser is for approved human login only.

## Verification

Run focused tests before broader checks. Before claiming completion, verify the
changed behavior, the installer inventory, and durable documentation. Restart
OpenCode after changing installed agents, plugins, tools, rules, or browser files.

## Design Principles

Follow the "SOLID" principles of object-oriented programming, but also applied to introduced components such as Agents, Skills, etc.

This means:
- They should be modular and reusable
- They should be easy to test
- They should be easy to maintain
- They should be easy to extend

Additions to this project should represent the simplest implementation that solves the problem at hand. Follow the principles of "KISS", or "keep it simple, stupid".
