# OpenCode Staff Engineer Skill Layer

## Problem
The repository already defines an OpenCode agent suite for planning, execution, grounding, review, and iterative improvement, but it lacks a reusable skill layer that captures senior-engineering process discipline across sessions. Users of this agent suite need OpenCode-compatible skills that make verification, debugging, TDD, subagent delegation, and future skill authoring explicit, discoverable, and testable without depending on Claude-Code-only configuration.

## Goals
- Add an initial OpenCode-compatible skill library under `.opencode/skills/`.
- Encode the highest-value learned workflows as reusable skills: project agent scaffolding, verification before completion, systematic debugging, test-driven development, subagent-driven development, and writing skills.
- Support a core/global distribution model where this repo provides stable foundation agents and skills while target projects can maintain local `.opencode/agents/` and `.opencode/skills/` packs.
- Use `project-agent-scaffolding` to let `plan` or another planner recommend project-local agent/skill packs, including an optional project-local curator/bootstrap agent, without adding another default global primary agent.
- Keep each skill concise, trigger-focused, and compatible with OpenCode's `SKILL.md` frontmatter rules.
- Document how skills complement the existing `@ask`, `@prometheus`, `@autonomous`, `@karpathy`, `@grounder`, and `@reviewer` agents.
- Extend repository verification so missing or malformed skill definitions fail deterministically.

## Non-goals
- Do not add Claude-Code-only hooks, Claude-only skill frontmatter, or Claude plugin packaging.
- Do not add new default global primary agents for project curation.
- Do not change existing agent behavior except where documentation references the new skills.
- Do not add visual companion/browser whiteboarding infrastructure.
- Do not add automatic git commits, pull request creation, or release automation.
- Do not implement persistent memory, inter-agent messaging, cost tracking, or nightly regression pressure tests in this change.

## Constraints
- Skills must use OpenCode's supported skill frontmatter only: `name`, `description`, and optional `license`, `compatibility`, `metadata`.
- Each skill must live at `.opencode/skills/<skill-name>/SKILL.md`, and each `name` must exactly match its containing directory.
- Skill names must match `^[a-z0-9]+(-[a-z0-9]+)*$` and be no longer than 64 characters.
- Each skill description must be 1–1024 characters and describe when to use the skill, not summarize the full workflow.
- Each `SKILL.md` body must be concise enough to fit within 500 non-empty, non-frontmatter lines.
- All verification must run without requiring model API keys.
- The deploy script may add opt-in skill installation, but must preserve existing default agent-only behavior.
- Project-specific agents must be created only as project-local `.opencode/` files unless the user explicitly requests promotion to this core repo.
- Cleanup of project-local definitions must be approval-gated; archive by default and delete only with explicit confirmation.

## Grounding
- `README.md` documents the current suite as an OpenCode multi-agent workflow and lists `@ask`, `@prometheus`, `@autonomous`, `@karpathy`, `@grounder`, and `@reviewer` as the existing agents. - `README.md:1-15`
- The repository currently documents `@prometheus` as the spec writer and `@autonomous` as the spec executor with reviewer gating. - `README.md:76-91`
- The current deploy script installs agents from `agents/`, and optionally plugins and tools, but does not install skills. - `scripts/deploy-opencode-agents.sh:459-470`
- The current validator asserts expected agents, permissions, deploy behavior, and plugin loading, but has no expected skills list. - `tests/verify_opencode.py:51-60`
- OpenCode documents skills as `.opencode/skills/<name>/SKILL.md`, `~/.config/opencode/skills/<name>/SKILL.md`, and Claude/Agents-compatible `skills/<name>/SKILL.md` locations. - `https://opencode.ai/docs/skills/`
- OpenCode documents skill frontmatter as `name` and `description` required, with optional `license`, `compatibility`, and `metadata`; unknown frontmatter fields are ignored. - `https://opencode.ai/docs/skills/`
- OpenCode's published config schema includes `skills.paths` and `skills.urls`, and includes `skill` as a permission key. - `https://opencode.ai/config.json`
- The supplied staff-engineer article extract argues that agents are the team roster and skills are the employee handbook that encode reusable discipline. - `/Users/jpswaynos/Downloads/message.txt:84-89`
- The supplied staff-engineer article extract identifies verification-before-completion, systematic debugging, TDD, subagent-driven development, and writing-skills as core process modules. - `/Users/jpswaynos/Downloads/message.txt:75-82`, `/Users/jpswaynos/Downloads/message.txt:987-1004`, `/Users/jpswaynos/Downloads/message.txt:1173-1185`, `/Users/jpswaynos/Downloads/message.txt:1329-1356`, `/Users/jpswaynos/Downloads/message.txt:1859-1888`
- The supplied skills article extract frames skills as reusable instructions for standards, workflows, formatting, and repeatable outputs. - `/Users/jpswaynos/Downloads/message (1).txt:13-18`

## Acceptance Criteria
1. `.opencode/skills/verification-before-completion/SKILL.md` exists with `name: verification-before-completion`, a non-empty `description`, and instructions requiring fresh command evidence before any completion claim.
2. `.opencode/skills/systematic-debugging/SKILL.md` exists with `name: systematic-debugging`, a non-empty `description`, and instructions requiring root-cause investigation before fixes.
3. `.opencode/skills/test-driven-development/SKILL.md` exists with `name: test-driven-development`, a non-empty `description`, and instructions requiring a failing test before production code changes when the task is testable.
4. `.opencode/skills/subagent-driven-development/SKILL.md` exists with `name: subagent-driven-development`, a non-empty `description`, and instructions for dispatching focused subagents with explicit task context and independent review.
5. `.opencode/skills/writing-skills/SKILL.md` exists with `name: writing-skills`, a non-empty `description`, and instructions requiring pressure scenarios or concrete validation before considering a new or edited skill complete.
6. `.opencode/skills/project-agent-scaffolding/SKILL.md` exists with `name: project-agent-scaffolding`, a non-empty `description`, and instructions for deriving project-local agents and skills from repository requirements, risks, and recurring workflows.
7. `project-agent-scaffolding` instructs planners to avoid adding global agents by default and to prefer project-local `.opencode/agent(s)/` and `.opencode/skill(s)/` files.
8. `project-agent-scaffolding` instructs planners to suggest an optional project-local curator/bootstrap agent only after inventorying the repo, explaining why an existing skill or global agent is insufficient, and obtaining user approval.
9. `project-agent-scaffolding` requires approval before creating, updating, archiving, or deleting project-local agent/skill files.
10. `project-agent-scaffolding` requires routing guidance such as `.opencode/AGENTS.md` or `.opencode/agents/README.md` so users know when to invoke each local agent.
11. Every added `SKILL.md` uses only OpenCode-supported frontmatter keys: `name`, `description`, `license`, `compatibility`, and `metadata`.
12. Every added skill directory name exactly matches the `name` value in its `SKILL.md` frontmatter.
13. Every added skill description is written as trigger guidance beginning with `Use when` or `Use ONLY when`, and no description exceeds 1024 characters.
14. No added `SKILL.md` contains Claude-Code-only frontmatter keys including `allowed-tools`, `disable-model-invocation`, `user-invocable`, `context`, `agent`, `hooks`, `paths`, `model`, `effort`, `argument-hint`, or `arguments`.
15. `README.md` contains an `Agent Skills` section that lists all six new skills and explains that skills are reusable process guidance while agents are orchestration roles.
16. `README.md` documents the core + project pack model and explains that project-specific curation should be suggested by the `project-agent-scaffolding` skill instead of adding a default global `@project-curator` agent.
17. `README.md` documents that OpenCode must be restarted after adding or changing agents, skills, plugins, or config files.
18. `tests/verify_opencode.py` includes deterministic validation for the six expected skill files, their directory/name match, their supported frontmatter keys, and their trigger-style descriptions.
19. `tests/verify_opencode.py` does not require `project-curator.md` in the default expected core agents — only the minimal default set.
20. `scripts/deploy-opencode-agents.sh` supports `--with-skills` and installs skill directories into the resolved OpenCode skills directory without changing default agent-only installs.
21. `python3 tests/verify_opencode.py --skip-llm` exits 0 after the implementation is complete.

## Verification
```bash
test -f .opencode/skills/verification-before-completion/SKILL.md
test -f .opencode/skills/systematic-debugging/SKILL.md
test -f .opencode/skills/test-driven-development/SKILL.md
test -f .opencode/skills/subagent-driven-development/SKILL.md
test -f .opencode/skills/writing-skills/SKILL.md
test -f .opencode/skills/project-agent-scaffolding/SKILL.md
grep -q '^name: verification-before-completion$' .opencode/skills/verification-before-completion/SKILL.md
grep -q '^name: systematic-debugging$' .opencode/skills/systematic-debugging/SKILL.md
grep -q '^name: test-driven-development$' .opencode/skills/test-driven-development/SKILL.md
grep -q '^name: subagent-driven-development$' .opencode/skills/subagent-driven-development/SKILL.md
grep -q '^name: writing-skills$' .opencode/skills/writing-skills/SKILL.md
grep -q '^name: project-agent-scaffolding$' .opencode/skills/project-agent-scaffolding/SKILL.md
grep -q 'fresh.*evidence\|evidence.*fresh\|[Ff]resh.*[Ee]vidence' .opencode/skills/verification-before-completion/SKILL.md
grep -q 'root cause' .opencode/skills/systematic-debugging/SKILL.md
grep -q 'failing test' .opencode/skills/test-driven-development/SKILL.md
grep -q 'subagent' .opencode/skills/subagent-driven-development/SKILL.md
grep -q 'pressure scenario\|validation' .opencode/skills/writing-skills/SKILL.md
grep -q 'project-local' .opencode/skills/project-agent-scaffolding/SKILL.md
grep -q 'AGENTS.md\|agents/README.md' .opencode/skills/project-agent-scaffolding/SKILL.md
! grep -q '"project-curator.md"' tests/verify_opencode.py
grep -q 'Agent Skills' README.md
grep -q 'project-agent-scaffolding' README.md
grep -q 'verification-before-completion' README.md
grep -q 'systematic-debugging' README.md
grep -q 'test-driven-development' README.md
grep -q 'subagent-driven-development' README.md
grep -q 'writing-skills' README.md
grep -q 'restart' README.md
grep -q 'EXPECTED_SKILL_FILES' tests/verify_opencode.py
grep -q 'verification-before-completion' tests/verify_opencode.py
grep -q 'systematic-debugging' tests/verify_opencode.py
grep -q 'test-driven-development' tests/verify_opencode.py
grep -q 'subagent-driven-development' tests/verify_opencode.py
grep -q 'writing-skills' tests/verify_opencode.py
grep -q 'project-agent-scaffolding' tests/verify_opencode.py
grep -q -- '--with-skills' scripts/deploy-opencode-agents.sh
python3 tests/verify_opencode.py --skip-llm
```

## Implementation Checklist
- [ ] Create `.opencode/skills/verification-before-completion/SKILL.md` with OpenCode-valid frontmatter and concise evidence-before-claims instructions.
- [ ] Create `.opencode/skills/systematic-debugging/SKILL.md` with OpenCode-valid frontmatter and a root-cause-first debugging workflow.
- [ ] Create `.opencode/skills/test-driven-development/SKILL.md` with OpenCode-valid frontmatter and red-green-refactor discipline for testable production changes.
- [ ] Create `.opencode/skills/subagent-driven-development/SKILL.md` with OpenCode-valid frontmatter and guidance for focused delegation, escalation, and independent review.
- [ ] Create `.opencode/skills/writing-skills/SKILL.md` with OpenCode-valid frontmatter and validation requirements for new or revised skills.
- [ ] Create `.opencode/skills/project-agent-scaffolding/SKILL.md` with OpenCode-valid frontmatter and guidance for deriving project-local agent/skill packs.
- [ ] Remove `agents/project-curator.md` if present; remove `project-curator` from `EXPECTED_AGENT_FILES`, `EXPECTED_RULES`, and `EXPECTED_MODES` in `tests/verify_opencode.py`.
- [ ] Add an `Agent Skills` section to `README.md` listing the six skills and explaining how skills differ from agents.
- [ ] Add a project agent scaffolding workflow section to `README.md` documenting the core + project pack model, approval gates, cleanup rules, and routing docs.
- [ ] Add restart guidance to `README.md` for agent, skill, plugin, and config changes.
- [ ] Extend `tests/verify_opencode.py` with `EXPECTED_SKILL_FILES` and validation for expected skill paths.
- [ ] Extend `tests/verify_opencode.py` to parse skill frontmatter and fail on unsupported keys, missing `name`, missing `description`, directory/name mismatch, invalid names, or non-trigger-style descriptions.
- [ ] Extend `scripts/deploy-opencode-agents.sh` with opt-in `--with-skills` deployment and validator coverage.
- [ ] Run every command in `## Verification` and fix failures until all commands exit 0.

## Change Log
- 2026-05-22: Replaced completed `@ask` implementation notes with a new spec for adding an OpenCode-compatible senior-engineering skill layer based on supplied agent-team and skill-system learnings.
- 2026-05-22: Refined project curation into a skill-first workflow so planners can suggest project-local agents and optional local curator bootstrap without adding another default global primary agent.
- 2026-05-29: Fixed `plugins/immutability.ts` agent-identity bug. Root cause: `tool.execute.before` input does not carry an `agent` field; the plugin defaulted to `"unknown"` for all callers. Fix: added `chat.params` hook to cache `sessionID→agent`; `tool.execute.before` reads from that cache (with `client.session.messages()` fallback). Added `check_prometheus_identity` to `tests/verify_opencode.py` (section I) that runs @prometheus against a `prometheus_only` fixture (must succeed) and @build against the same fixture (must be blocked), with AWS Bedrock auto-detection so it runs without an `OPENAI_API_KEY`. All 42 checks pass.
