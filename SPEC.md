# OpenCode Staff Engineer Skill Layer

## Problem
The repository defines an OpenCode agent suite for planning, execution, grounding, review, and iterative improvement, but lacked a reusable skill layer capturing senior-engineering process discipline across sessions, and was missing a data-scientist subagent capable of NotebookLM-backed evidence synthesis. Users needed OpenCode-compatible skills and a grounding upgrade that make verification, debugging, TDD, subagent delegation, skill authoring, and project scaffolding explicit, discoverable, and testable — without depending on Claude-Code-only configuration.

## Goals
- Add an OpenCode-compatible skill library under `.opencode/skills/`.
- Encode the highest-value learned workflows as reusable skills: project agent scaffolding, verification before completion, systematic debugging, test-driven development, subagent-driven development, and writing skills.
- Add a `@data-scientist` subagent that queries a project-specified NotebookLM notebook via the NotebookLM MCP and supersedes `@grounder` when valid notebook context is available.
- Add `playwright-image-generation` and `local-word-document` skills for browser-automation data collection and offline document creation workflows.
- Support a core/global distribution model where this repo provides stable foundation agents and skills while target projects can maintain local `.opencode/agents/` and `.opencode/skills/` packs.
- Use `project-agent-scaffolding` to let `plan` or another planner recommend project-local agent/skill packs, including an optional project-local curator/bootstrap agent, without adding another default global primary agent.
- Keep each skill concise, trigger-focused, and compatible with OpenCode's `SKILL.md` frontmatter rules.
- Document how skills and `@data-scientist` complement the existing `@ask`, `@prometheus`, `@autonomous`, `@karpathy`, `@grounder`, and `@reviewer` agents.
- Extend repository verification so missing or malformed skill definitions and agent rules fail deterministically.

## Non-goals
- Do not add Claude-Code-only hooks, Claude-only skill frontmatter, or Claude plugin packaging.
- Do not add new default global primary agents for project curation.
- Do not change existing agent behavior except where documentation references the new skills or data-scientist routing.
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
- `README.md` documents the current suite as an OpenCode multi-agent workflow and lists `@ask`, `@prometheus`, `@autonomous`, `@karpathy`, `@data-scientist`, `@grounder`, and `@reviewer` as the existing agents. - `README.md:1-15`
- The repository documents `@prometheus` as the spec writer and `@autonomous` as the spec executor with reviewer gating. - `README.md:76-91`
- The deploy script installs agents from `agents/`, and optionally plugins and skills with `--with-plugins` and `--with-skills`. - `scripts/deploy-opencode-agents.sh:23-27`
- The validator asserts expected agents, skills, permissions, deploy behavior, and plugin loading across 42 automated checks. - `tests/verify_opencode.py:70-93`
- `@data-scientist` is the NotebookLM-grounded subagent declared in `agents/data-scientist.md`; it supersedes `@grounder` when NotebookLM context is authenticated and a relevant notebook is identified. - `agents/data-scientist.md:1-5`
- `playwright-image-generation` encodes safe browser automation for web AI image generation/editing, including auth profiles, stall detection, refusal handling, and dataset protection. - `.opencode/skills/playwright-image-generation/SKILL.md`
- `local-word-document` encodes the markdown-first → pandoc → verify workflow for offline `.docx` production. - `.opencode/skills/local-word-document/SKILL.md`
- Three plugins are now distributed: `immutability.ts` (file-level write rules), `opencode-autonomous-gate` (enforces `@autonomous` promise contract), and `opencode-autonomous-loop` (loop runner). - `plugins/`
- OpenCode documents skills as `.opencode/skills/<name>/SKILL.md`, `~/.config/opencode/skills/<name>/SKILL.md`, and Claude/Agents-compatible `skills/<name>/SKILL.md` locations. - `https://opencode.ai/docs/skills/`
- OpenCode documents skill frontmatter as `name` and `description` required, with optional `license`, `compatibility`, and `metadata`; unknown frontmatter fields are ignored. - `https://opencode.ai/docs/skills/`
- The supplied staff-engineer article extract argues that agents are the team roster and skills are the employee handbook that encode reusable discipline. - `/Users/jpswaynos/Downloads/message.txt:84-89`

## Acceptance Criteria

### Skills (AC 1–6)
1. `.opencode/skills/verification-before-completion/SKILL.md` exists with `name: verification-before-completion`, a non-empty `description`, and instructions requiring fresh command evidence before any completion claim.
2. `.opencode/skills/systematic-debugging/SKILL.md` exists with `name: systematic-debugging`, a non-empty `description`, and instructions requiring root-cause investigation before fixes.
3. `.opencode/skills/test-driven-development/SKILL.md` exists with `name: test-driven-development`, a non-empty `description`, and instructions requiring a failing test before production code changes when the task is testable.
4. `.opencode/skills/subagent-driven-development/SKILL.md` exists with `name: subagent-driven-development`, a non-empty `description`, and instructions for dispatching focused subagents with explicit task context and independent review.
5. `.opencode/skills/writing-skills/SKILL.md` exists with `name: writing-skills`, a non-empty `description`, and instructions requiring pressure scenarios or concrete validation before considering a new or edited skill complete.
6. `.opencode/skills/project-agent-scaffolding/SKILL.md` exists with `name: project-agent-scaffolding`, a non-empty `description`, and instructions for deriving project-local agents and skills from repository requirements, risks, and recurring workflows.

### Project-agent-scaffolding behaviour (AC 7–10)
7. `project-agent-scaffolding` instructs planners to avoid adding global agents by default and to prefer project-local `.opencode/agent(s)/` and `.opencode/skill(s)/` files.
8. `project-agent-scaffolding` instructs planners to suggest an optional project-local curator/bootstrap agent only after inventorying the repo, explaining why an existing skill or global agent is insufficient, and obtaining user approval.
9. `project-agent-scaffolding` requires approval before creating, updating, archiving, or deleting project-local agent/skill files.
10. `project-agent-scaffolding` requires routing guidance such as `.opencode/AGENTS.md` or `.opencode/agents/README.md` so users know when to invoke each local agent.

### Skill quality (AC 11–14)
11. Every added `SKILL.md` uses only OpenCode-supported frontmatter keys: `name`, `description`, `license`, `compatibility`, and `metadata`.
12. Every added skill directory name exactly matches the `name` value in its `SKILL.md` frontmatter.
13. Every added skill description is written as trigger guidance beginning with `Use when` or `Use ONLY when`, and no description exceeds 1024 characters.
14. No added `SKILL.md` contains Claude-Code-only frontmatter keys including `allowed-tools`, `disable-model-invocation`, `user-invocable`, `context`, `agent`, `hooks`, `paths`, `model`, `effort`, `argument-hint`, or `arguments`.

### Documentation (AC 15–17)
15. `README.md` contains an `Agent Skills` section that lists all skills and explains that skills are reusable process guidance while agents are orchestration roles.
16. `README.md` documents the core + project pack model and explains that project-specific curation should be suggested by the `project-agent-scaffolding` skill instead of adding a default global `@project-curator` agent.
17. `README.md` documents that OpenCode must be restarted after adding or changing agents, skills, plugins, or config files.

### Validator (AC 18–19)
18. `tests/verify_opencode.py` includes deterministic validation for the expected skill files, their directory/name match, their supported frontmatter keys, and their trigger-style descriptions.
19. `tests/verify_opencode.py` does not require `project-curator.md` in the default expected core agents — only the minimal default set.

### Deploy (AC 20)
20. `scripts/deploy-opencode-agents.sh` supports `--with-skills` and installs skill directories into the resolved OpenCode skills directory without changing default agent-only installs.

### Verification gate (AC 21)
21. `python3 tests/verify_opencode.py --skip-llm` exits 0 after the implementation is complete.

### Data-scientist agent (AC 22–24)
22. `agents/data-scientist.md` exists with `mode: subagent`, `hidden: true`, and permission rules that allow NotebookLM MCP tools while denying write tools.
23. `@ask`, `@prometheus`, and `@autonomous` route to `@data-scientist` when the project context identifies a valid NotebookLM notebook and the MCP connection is authenticated; they fall back to `@grounder` otherwise.
24. `README.md` documents `@data-scientist` in the agent table and in the Grounding/RAG workflow section.

### Additional skills (AC 25–26)
25. `.opencode/skills/playwright-image-generation/SKILL.md` exists with valid frontmatter, a `Use when` trigger description, and instructions covering auth profiles, stall detection, refusal handling, and dataset artifact protection.
26. `.opencode/skills/local-word-document/SKILL.md` exists with valid frontmatter, a `Use when` trigger description, and a markdown-first → pandoc → verify workflow.

### Plugins (AC 27)
27. `tests/verify_opencode.py` `EXPECTED_PLUGIN_FILES` includes `immutability.ts`, `opencode-autonomous-gate`, and `opencode-autonomous-loop`; all three are present on disk.

### Immutability plugin hardening (AC 28–30)
28. The immutability plugin resolves agent identity via a `chat.params` session cache (not `input.agent`) so that identity is correct for all callers, not just the first LLM turn.
29. The immutability plugin applies a C1 fail-closed policy: unknown identity only blocks files explicitly covered by `prometheus_only` or an agent's `write_allowlist`; uncovered files are allowed.
30. The immutability plugin walks the `parentID` chain so task-delegated (child) sessions inherit the originating agent identity.

## Verification
```bash
# Core skills
test -f .opencode/skills/verification-before-completion/SKILL.md
test -f .opencode/skills/systematic-debugging/SKILL.md
test -f .opencode/skills/test-driven-development/SKILL.md
test -f .opencode/skills/subagent-driven-development/SKILL.md
test -f .opencode/skills/writing-skills/SKILL.md
test -f .opencode/skills/project-agent-scaffolding/SKILL.md
# Additional skills
test -f .opencode/skills/playwright-image-generation/SKILL.md
test -f .opencode/skills/local-word-document/SKILL.md
# Data-scientist agent
test -f agents/data-scientist.md
grep -q 'mode: subagent' agents/data-scientist.md
grep -q 'hidden: true' agents/data-scientist.md
# Skill frontmatter names
grep -q '^name: verification-before-completion$' .opencode/skills/verification-before-completion/SKILL.md
grep -q '^name: systematic-debugging$' .opencode/skills/systematic-debugging/SKILL.md
grep -q '^name: test-driven-development$' .opencode/skills/test-driven-development/SKILL.md
grep -q '^name: subagent-driven-development$' .opencode/skills/subagent-driven-development/SKILL.md
grep -q '^name: writing-skills$' .opencode/skills/writing-skills/SKILL.md
grep -q '^name: project-agent-scaffolding$' .opencode/skills/project-agent-scaffolding/SKILL.md
grep -q '^name: playwright-image-generation$' .opencode/skills/playwright-image-generation/SKILL.md
grep -q '^name: local-word-document$' .opencode/skills/local-word-document/SKILL.md
# Skill content assertions
grep -q 'fresh.*evidence\|evidence.*fresh\|[Ff]resh.*[Ee]vidence' .opencode/skills/verification-before-completion/SKILL.md
grep -q 'root cause' .opencode/skills/systematic-debugging/SKILL.md
grep -q 'failing test' .opencode/skills/test-driven-development/SKILL.md
grep -q 'subagent' .opencode/skills/subagent-driven-development/SKILL.md
grep -q 'pressure scenario\|validation' .opencode/skills/writing-skills/SKILL.md
grep -q 'project-local' .opencode/skills/project-agent-scaffolding/SKILL.md
grep -q 'AGENTS.md\|agents/README.md' .opencode/skills/project-agent-scaffolding/SKILL.md
# Plugins
test -f plugins/immutability.ts
test -d plugins/opencode-autonomous-gate
test -d plugins/opencode-autonomous-loop
# Validator
! grep -q '"project-curator.md"' tests/verify_opencode.py
grep -q 'EXPECTED_SKILL_FILES' tests/verify_opencode.py
grep -q 'data-scientist' tests/verify_opencode.py
grep -q 'opencode-autonomous-gate' tests/verify_opencode.py
# README
grep -q 'Agent Skills' README.md
grep -q 'data-scientist' README.md
grep -q 'project-agent-scaffolding' README.md
grep -q 'verification-before-completion' README.md
grep -q 'systematic-debugging' README.md
grep -q 'test-driven-development' README.md
grep -q 'subagent-driven-development' README.md
grep -q 'writing-skills' README.md
grep -q 'restart' README.md
grep -q -- '--with-skills' scripts/deploy-opencode-agents.sh
# Full validator
python3 tests/verify_opencode.py --skip-llm
```

## Implementation Checklist
- [x] Create `.opencode/skills/verification-before-completion/SKILL.md` with OpenCode-valid frontmatter and concise evidence-before-claims instructions.
- [x] Create `.opencode/skills/systematic-debugging/SKILL.md` with OpenCode-valid frontmatter and a root-cause-first debugging workflow.
- [x] Create `.opencode/skills/test-driven-development/SKILL.md` with OpenCode-valid frontmatter and red-green-refactor discipline for testable production changes.
- [x] Create `.opencode/skills/subagent-driven-development/SKILL.md` with OpenCode-valid frontmatter and guidance for focused delegation, escalation, and independent review.
- [x] Create `.opencode/skills/writing-skills/SKILL.md` with OpenCode-valid frontmatter and validation requirements for new or revised skills.
- [x] Create `.opencode/skills/project-agent-scaffolding/SKILL.md` with OpenCode-valid frontmatter and guidance for deriving project-local agent/skill packs.
- [x] Create `.opencode/skills/playwright-image-generation/SKILL.md` with OpenCode-valid frontmatter, stall/refusal/auth/dataset instructions.
- [x] Create `.opencode/skills/local-word-document/SKILL.md` with OpenCode-valid frontmatter and markdown-first → pandoc → verify workflow.
- [x] Create `agents/data-scientist.md` as a hidden subagent with NotebookLM MCP permissions and read-only project file access.
- [x] Update `@ask`, `@prometheus`, and `@autonomous` to route to `@data-scientist` when valid NotebookLM context is present.
- [x] Remove `agents/project-curator.md` if present; remove `project-curator` from `EXPECTED_AGENT_FILES`, `EXPECTED_RULES`, and `EXPECTED_MODES` in `tests/verify_opencode.py`.
- [x] Add an `Agent Skills` section to `README.md` listing the skills and explaining how skills differ from agents.
- [x] Add a project agent scaffolding workflow section to `README.md` documenting the core + project pack model, approval gates, cleanup rules, and routing docs.
- [x] Add restart guidance to `README.md` for agent, skill, plugin, and config changes.
- [x] Document `@data-scientist` in the `README.md` agent table and Grounding/RAG section.
- [x] Extend `tests/verify_opencode.py` with `EXPECTED_SKILL_FILES` and validation for expected skill paths (including `playwright-image-generation`).
- [x] Extend `tests/verify_opencode.py` to parse skill frontmatter and fail on unsupported keys, missing `name`, missing `description`, directory/name mismatch, invalid names, or non-trigger-style descriptions.
- [x] Add `data-scientist.md` to `EXPECTED_AGENT_FILES` in `tests/verify_opencode.py`.
- [x] Add `opencode-autonomous-gate` and `opencode-autonomous-loop` to `EXPECTED_PLUGIN_FILES` in `tests/verify_opencode.py`.
- [x] Extend `scripts/deploy-opencode-agents.sh` with opt-in `--with-skills` deployment and validator coverage.
- [x] Fix immutability plugin: use `chat.params` hook to cache session→agent identity; remove `?? "unknown"` fallback.
- [x] Fix immutability plugin: C1 fail-closed policy — unknown identity only blocks explicitly named files, not uncovered files.
- [x] Fix immutability plugin: walk `parentID` chain so child/subagent sessions inherit originating agent identity.
- [x] Run every command in `## Verification` and fix failures until all commands exit 0.

## Change Log
- 2026-05-22: Replaced completed `@ask` implementation notes with a new spec for adding an OpenCode-compatible senior-engineering skill layer based on supplied agent-team and skill-system learnings.
- 2026-05-22: Refined project curation into a skill-first workflow so planners can suggest project-local agents and optional local curator bootstrap without adding another default global primary agent. All 21 original acceptance criteria verified; `tests/verify_opencode.py --skip-llm` exits 0 (38 checks at that point).
- 2026-05-22: Added `tests/test_skill_coverage.py` (deploy mode, negative fixture, and line-limit coverage) and `tests/test_skill_pressure.py` (LLM gating pressure tests; skip without API key).
- 2026-05-27: Added `@data-scientist` subagent (hidden, read-only, NotebookLM MCP) and updated `@ask`, `@prometheus`, and `@autonomous` to prefer it over `@grounder` when valid notebook context exists. Added `agents/data-scientist.md` to `EXPECTED_AGENT_FILES`; validator updated to 7 agents.
- 2026-05-29: Added `playwright-image-generation` skill and `opencode-autonomous-gate` / `opencode-autonomous-loop` plugin packages. `EXPECTED_SKILL_FILES` and `EXPECTED_PLUGIN_FILES` updated in validator. Fixed immutability plugin agent-identity bugs: (1) SDK path key wrong in fallback (`path: { sessionID }` → `path: { id }`); (2) fail-closed C1 policy — unknown identity blocks only explicitly named files, not uncovered files; (3) `parentID` chain walk for child/subagent session identity inheritance. Added Section I (`check_prometheus_identity`) to validator. 42 checks now pass.
- 2026-06-02: Added `local-word-document` skill. Validator and deploy script unchanged (skill passes existing frontmatter checks automatically).
- 2026-06-12: Reconciled SPEC.md in place: checked all Implementation Checklist items, extended Acceptance Criteria and Grounding to cover `@data-scientist`, 8 skills, 3 plugins, and immutability hardening; updated Verification block to reflect current 42-check validator and full skill/plugin/agent set.
