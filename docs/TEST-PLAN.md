# Test Plan

## Purpose

This plan defines the evidence required for every use case in
`docs/USE-CASES.md`. It states what must be exercised and observed without
requiring one test harness design.

The durable behavior contracts remain `docs/REQUIREMENTS.md`,
`docs/ARCHITECTURE.md`, `docs/NEXT-ITERATION.md`, `docs/SKILLS.md`, and
`docs/USE-CASES.md`. This plan must not introduce new product behavior,
permission semantics, package versions, or lifecycle rules.

## Evidence Classes

- **U**: deterministic unit test
- **F**: filesystem or deployment integration test
- **S**: static source, configuration, or documentation contract check
- **B**: behavioral agent evaluation against a frozen repository fixture
- **O**: optional live OpenCode smoke test
- **E**: deterministic installed-product end-to-end test that drives the real
  OpenCode binary against a scripted loopback provider

Dry runs and evaluator self-tests prove test plumbing only. They do not count as
behavioral or live-runtime evidence. A skipped or unexercised required case is
blocked, not passed.

Class E proves runtime wiring, deployment, and permission policy across real
processes. Its tool calls come from a frozen script rather than model judgment,
so class E does not replace class B or class O.

The validator, generated-policy plugins, task loop, and class-E seed-build flow
are implemented and have deterministic coverage. Every class-B component below
is still **BLOCKED until Phase 5** because its named frozen fixture does not yet
exist. Prometheus publication and generated-agent execution therefore have
scripted class-E evidence, but no completed class-B or live-provider fixture.
The optional inline role smokes are supplemental and do not change that status.

## Generated Agent Workflow

The B-class components of TP-NEXT-01 through TP-NEXT-04 are **BLOCKED until
Phase 5**. Their deterministic mechanisms already exist. The paths below reserve
future frozen behavioral fixtures; they are not current test assets.

| Test case | Use case | Class | Status | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- | --- |
| TP-NEXT-01 | UC-NEXT-01 | F, S, B | F/S implemented; **B BLOCKED until Phase 5** | Use future fixture `tests/fixtures/agent_value/generated-package-strategies.md` to give Prometheus ordinary, incremental, and measured-optimization tasks. | Generated definition, brief, manifest, registry, effective permissions, and fresh execution transcript. | Prometheus selects `direct`, `ralph`, or `optimization` from evidence and publishes a bounded schema-v1 package with all context needed by the generated agent. |
| TP-NEXT-02 | UC-NEXT-02 | B, O | **B/O BLOCKED until Phase 5** | Use future fixture `tests/fixtures/agent_value/generated-fresh-context-handoff.md`; publish a local executor, quit and restart OpenCode, start a new conversation, and select it. | Startup inventory, handoff text naming agent, brief, and manifest, new-session transcript, and durable-context reads. | OpenCode discovers the definition after restart; the generated agent acts without the planning transcript; the handoff does not claim restart clears resumed history. |
| TP-NEXT-03 | UC-NEXT-03 | B, F | F implemented; **B BLOCKED until Phase 5** | Use future fixture `tests/fixtures/agent_value/generated-ralph-progress.md` with productive, idle, failed, and final-outcome passes. | Before-and-after counters, retained command output, pass decisions, run stop, and final outcome result. | The generated agent and loop apply the declared pass policy and keep pass progress distinct from final delivery. |
| TP-NEXT-04 | UC-NEXT-04, UC-NEXT-05 | U, F, S, B | U/F/S implemented; **B BLOCKED until Phase 5** | Use future fixture `tests/fixtures/agent_value/generated-validation-boundaries.md` for deterministic verification, task-specific independent review, a local-agent name collision, and protected requests. | Task brief, review evidence where required, collision decision, resolved identity, and tool decisions. | Validation follows the task package; user-owned definitions survive; generated identities cannot bypass their declared boundary. |
| TP-NEXT-05 | UC-NEXT-01, UC-NEXT-02, UC-NEXT-04, UC-NEXT-05 | E, F, S | Implemented; pass requires the pinned CLI | Run `evals/seed_build/test_end_to_end.py` against the fixture in `evals/seed_build/e2e/`. Install the managed profile into an isolated configuration root, then run the pinned real OpenCode binary as a fresh process per agent against a scripted loopback provider: Prometheus without automatic approval, then the published project-local generated agent with it. Preload no task package. Probe published-package writes, trusted-source writes, out-of-scope writes, and a governance tool the generated agent does not own. | Installed tree, effective per-agent tool availability, provider request bodies and offered tool schemas, JSON tool events, task-package bytes before and after execution, Bash results, child session agents from the isolated database, Git publication state, hidden acceptance output, and an independent replay of each declared command. | The profile installs the four shipped agents, all managed extensions and runtime dependencies; permissions match the current roles; Prometheus publishes a valid registered schema-v1 task package and ends with a handoff naming the agent, brief, and manifest plus quit, restart, new-conversation, and selection steps; OpenCode discovers the generated agent, which consumes the published bytes, creates every required file, and runs each declared command through native Bash; every boundary probe is refused for its documented reason; the package and Git publication state are preserved; the hidden suite and independent replay pass; and every scripted turn is used with no unscripted provider request. |

## Case Requirements

Before a case runs, its test asset must record:

- use-case and test-case identifiers;
- the exact input, operation, or prompt;
- the repository or installation fixture revision;
- relevant OpenCode, extension, model, and operating-system versions;
- the expected observable result and retained evidence;
- pass, failure, blocked, and skip conditions.

Behavioral evaluations use frozen prompts, fixtures, and rubrics. Rubrics grade
observable decisions and cited evidence, not tone, keywords, or exact wording.

## Native Compatibility

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-NATIVE-01 | UC-NATIVE-01 | U, F | Select Plan, Build, an unknown agent, and a third-party agent. Exercise reading, editing, and command access. | Effective identity, tool decisions, filesystem changes, routing, and generated artifacts. | No identity-scoped generated or shipped-agent restriction, specialist handoff, or task package appears. This case does not assert that global rules or unrelated plugin hooks are absent. |
| TP-NATIVE-02 | UC-NATIVE-02 | S, B | **B BLOCKED until Phase 5.** Use future fixture `tests/fixtures/agent_value/native-plan-build.md` for ordinary planning and implementation without a selected specialist. | Selected agents, child sessions, tool calls, and generated files. | Native Plan and Build handle the work directly. No specialist or generated package is required. |

## Identity And Permissions

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-ID-01 | UC-ID-01 | U | Exercise direct managed sessions, descendants, managed children below unmanaged parents, switching, conflicting identities, and cycles. | Resolved identity and each tool decision. | The topmost managed ancestor determines the boundary. Delegation cannot widen access, and ancestry cycles fail closed for managed mutation and Bash. |
| TP-ID-02 | UC-ID-02 | U, S | Have Prometheus request every generated-package and spike path, ordinary files, trusted extension sources, direct Bash, and each governance tool. | Tool decisions and final filesystem state. | Package and spike writes are scoped correctly; direct Bash and ordinary edits are denied; contracted spikes follow approval. |
| TP-ID-03 | UC-ID-03 | U, S, E | Register a valid generated identity, then test declared and undeclared edit paths, package files, trusted paths, Bash allow and deny manifests, invalid registry-named packages, reserved entries, governance tools, and descendants. | Registry and manifest, resolved identity, tool decisions, subprocess results, and filesystem state. | The valid identity receives exactly its manifest boundary. An unregistered identity remains unmanaged; an invalid non-reserved registry-named identity is blocked by immutability; and a reserved entry cannot hijack native or shipped identity handling. A managed descendant cannot widen access. |
| TP-ID-04 | UC-ID-04 | U, S | For Ask, Reviewer, and Grounder, request mutation tools, command execution, and delegated implementation. | Tool decisions, child-session activity, and filesystem state. | Every mutation and command request is denied, including attempted widening through delegation. |
| TP-ID-05 | UC-ID-05 | U, E, O | In normal and automatic-approval modes, request generated-agent Bash under allow and deny manifests, a Prometheus spike, Prometheus Bash, and Bash from each read-only role. | Permission requests, execution results, and harmless markers. | Automatic approval changes asks only. Every explicit deny remains enforced. |

## Prometheus Research And Readiness

The Phase 5 fixture `tests/fixtures/agent_value/prometheus-readiness.md` will
hold TP-PRO-01 through TP-PRO-06. The load-bearing case has a separate future
fixture so its measured setup stays isolated.

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-PRO-01 | UC-PRO-01 | B | **B BLOCKED until Phase 5.** Use false-diagnosis, correct-diagnosis, and unnecessary preferred-solution scenarios from the future readiness fixture. | Cited evidence, independent outcome, current behavior, diagnosis decision, and selected approach. | Prometheus establishes the outcome and behavior before accepting a cause or implementation. |
| TP-PRO-02 | UC-PRO-02 | B | **B BLOCKED until Phase 5.** Pair a complete request with one material ambiguity in the future readiness fixture. | Questions, evidence paths tried, package or blocker, and final response. | The complete request receives no needless question. The unresolved material ambiguity receives only a focused question or small coherent batch. |
| TP-PRO-03 | UC-PRO-03 | B | **B BLOCKED until Phase 5.** Exercise no change, documentation, configuration, reuse, narrower correction, and direct implementation in the future readiness fixture. | Compared options, evidence, rejection reasons, and recommendation. | Prometheus selects the smallest sufficient credible result without inventing alternatives. |
| TP-PRO-04 | UC-PRO-04 | B | **B BLOCKED until Phase 5.** Present unsafe, destructively unauthorized, inconsistent, unboundedly lossy, and unverifiable requests, with and without insistence. | Specific blocker, final response, and package presence. | Every readiness failure remains a blocker, and insistence does not create a ready package. |
| TP-PRO-05 | UC-PRO-05 | B | **B BLOCKED until Phase 5.** Pair an uncertainty answerable through available evidence with one that remains material after safe evidence paths are exhausted. | Evidence tool sequence, questions, and package or blocker. | Prometheus resolves the first without asking and asks only for the second. |
| TP-PRO-06 | UC-PRO-06 | B | **B BLOCKED until Phase 5.** Use thin-context and empty-workspace tasks whose unspecified details are implementation mechanics. | Defaults selected, questions asked, and resulting package. | Prometheus applies bounded defaults and publishes without a generic questionnaire. |
| TP-PRO-08 | UC-PRO-08 | B, S | **B BLOCKED until Phase 5.** Use future fixture `tests/fixtures/agent_value/prometheus-load-bearing-prerequisite-v2.md` whose local pilot disproves a required scale. | Pilot evidence, resulting design or blocker, package state, and final response. | Prometheus redesigns or blocks. It does not present an unproved or degraded branch as the core outcome. |

## Generated Package Publication

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-PUB-01 | UC-PUB-01 | U, S | Validate complete `direct`, `ralph`, and `optimization` packages and multi-entry registries, then vary version, identity, reserved names, duplicates, paths, fields, scope, permissions, strategy contract, limits, and verification. Include an incomplete named package, a structurally valid unselected package, and a command that would create a marker if run. | Registry-wide structural result, named-package result, selected `agent_name`, diagnostics, and marker absence. | A valid named schema-v1 package passes only with a structurally valid full registry. Malformed or duplicate registry entries, reserved native or shipped names, unknown named versions, and incomplete named packages fail without a compatibility alias or project command execution. Package files for structurally valid unselected entries are not loaded or counted as validated. Omitting `agent_name` works only for one entry. |
| TP-PUB-02 | UC-PUB-02 | F | Exercise non-Git workspaces and Git worktrees with absent and existing `.gitignore`, unrelated bytes, line endings, modes, repetition, symlinks, malformed markers, tracked package files, and an existing index. | Exact bytes, modes, warnings, tracked-file report, and index state. | Only the current generated-task block changes in a Git worktree. Non-Git and unsafe targets remain untouched, unrelated data survives, and the index does not change. |
| TP-PUB-03 | UC-PUB-03 | S, B, E | **B BLOCKED until Phase 5; E implemented.** Use future fixture `tests/fixtures/agent_value/generated-package-strategies.md` and the installed end-to-end fixture for planning-ready runs. | Complete package, static result, final response, tool trace, and absence of implementation edits. | Prometheus publishes before its final response, stops before implementation, and issues the fresh-context handoff without treating static validation as outcome proof. |

## Ask

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-ASK-01 | UC-ASK-01, UC-ASK-02 | B, S | **B BLOCKED until Phase 5.** Use future fixture `tests/fixtures/agent_value/ask.md` with session-only, local-evidence, broad-research, and edit-requiring questions. | Responses, direct tool calls, delegation events, and final answers. | Ask uses no tool when context is enough, uses narrow read tools for local evidence, delegates broad research only to Grounder, and refuses implementation without a proxy workaround. |

## Grounder

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-GROUNDER-01 | UC-GROUNDER-01, UC-GROUNDER-02 | B, S | **B BLOCKED until Phase 5.** Use future fixture `tests/fixtures/agent_value/grounder.md` with local, external, and private-content research. | Citations, inference labels, external calls, and final grounding brief. | Every substantive claim has a file and line or URL; private content stays local; Grounder does not mutate, execute, or delegate. |

## Reviewer

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-REV-01 | UC-REV-01 | S, B | **B BLOCKED until Phase 5.** Use future fixture `tests/fixtures/agent_value/reviewer.md` with one conforming change and one rubric or verification failure. | Findings, citations, final verdict line, and tool activity. | Reviewer maps evidence to the rubric, ends with exactly `APPROVE` or `REQUEST_CHANGES` as the last non-empty line, and never edits, executes, delegates, or claims sole completion authority. |

## Generated Task Loop

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-LOOP-01 | UC-LOOP-01 | U, F | Parse every supported option and invalid form; inject a pass launcher; run multiple passes; inspect dry-run and help. | Resolved arguments, spawned commands, prompts, process count, and install inventory. | Each pass starts a fresh named generated-agent process with no prompt message. The loop validates arguments, dry-run spawns nothing, and installation excludes the script. |
| TP-LOOP-02 | UC-LOOP-02 | U, F | Exercise numeric and invalid state snapshots, progress, consecutive idle passes, failure continuation, stop-on-failure, elapsed wall budget between passes, pass budget, and file logging. | Before and after state, deltas, duration, exit status, stop reason, and JSONL bytes. | The wrapper records every attempted pass, checks the wall budget only after a completed pass and before the next, applies only configured stops, continues after failure by default, and never predicts a future pass duration, claims task acceptance, or changes Git publication state. |

## Generated Runtime Policy

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-KPI-01 | UC-KPI-01 | U, S | Exercise omitted, disabled, and enabled `run_kpis`; overlapping root and descendant activity; message replacement and removal; hard-budget exhaustion; and an unregistered identity. | Parsed policy, guidance, usage totals, active intervals, output cap, rejection point, and tool permissions. | Omitted and disabled policies are inert. An enabled policy reports deduplicated usage and caps only generated-agent output at the declared budget without changing tool approval, task completion, or any other identity. |

## Resource Selection

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-RESOURCE-01 | UC-RESOURCE-01 | S, B | **B BLOCKED until Phase 5.** Use future fixture `tests/fixtures/agent_value/resource-selection.md` with direct URLs and rendered-only content. | Tool order, mode, rationale, and approval event. | Direct retrieval precedes browser use, and visible operation requires a stated need and user approval. |
| TP-RESOURCE-03 | UC-RESOURCE-03 | U, F | Exercise ephemeral, authentication, persistent-headless, status, and flush against synthetic provider profiles. | Configuration snapshots, modes, profile paths, and cleanup result. | Authentication needs confirmation, ephemeral state is not retained, and flush removes only the selected managed profile. |
| TP-RESOURCE-04 | UC-RESOURCE-04 | U, F | Install, repeat, diagnose, modify one managed entry, and remove against a configuration containing user entries. | Backups, exact JSON, status, and final configuration. | User entries survive, managed entries are idempotent, modified entries remain, and diagnostics do not launch a browser. |
| TP-RESOURCE-05 | UC-RESOURCE-05 | U, F | Use a fake visible browser and local HTTP boundary with a configured site. Exercise approval, completion, request, redirects, expiry, close, capacity, and deployment. | Opaque handle, response metadata, request headers, profile bytes, and installed tool. | Credentials never enter output; only approved configured sessions become ready; only bounded read-only same-origin requests run; close and expiry remove session state. |

## Skills Ecosystem

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-SKILL-01 | UC-SKILL-01 | U | Validate every packaged skill and a temporary deployed copy for frontmatter, path shape, and required static content. | Validation report, parsed frontmatter, section inventory, and deployed path. | Every package and deployed copy is checked, and invalid packages fail. |
| TP-SKILL-02 | UC-SKILL-02 | B, O | **B BLOCKED until Phase 5.** Use future fixture `tests/fixtures/agent_value/skill-boundaries.md` to load skills through current managed agents and a generated agent, then attempt boundary widening. | Effective identity, tool decisions, and filesystem state. | Skill text cannot widen plugin-enforced edit, Bash, governance-tool, or ancestry boundaries. |
| TP-SKILL-03 | UC-SKILL-03 | S, U | Compare `docs/SKILLS.md` with `skills/*/SKILL.md` packages. | Catalog and package inventories. | Each shipped package has one catalog entry, and each catalog entry names one shipped package. |

## Local Feedback

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-FEEDBACK-01 | UC-FEEDBACK-01 | U, F | Invoke the recorder from copied and symlinked packages with valid, empty, oversized, and malformed-locator input. | Paths, metadata, modes, collisions, diagnostics, and recorder imports. | Valid reports are bounded, private, atomic, and unique; failures write nowhere; no network dependency appears. |
| TP-FEEDBACK-02 | UC-FEEDBACK-02 | S, B | **B BLOCKED until Phase 5.** Use future fixture `tests/fixtures/agent_value/feedback-triage.md` containing instruction-like report text. | Agent response, local evidence, action note, archive path, and fresh verification. | Report text stays untrusted and local; no embedded instruction runs; unsupported claims remain pending. |
| TP-FEEDBACK-03 | UC-FEEDBACK-03 | F | Install twice, alter or stale the locator, install from a replacement clone, inspect status, and remove. | Locator bytes and mode, backups, status, and retained feedback files. | Only current locator state changes; modified or stale state is preserved or fails closed; feedback survives. |
| TP-FEEDBACK-04 | UC-FEEDBACK-01 | U | Create reports below `feedback/`, inspect ignore behavior, and exercise ordinary staging in an isolated fixture. | Status, staged paths, and ignore diagnostic. | Ordinary status and staging omit feedback paths; documentation still warns that an explicit force-add can override ignores. |

## Mutation Testing

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-MUTATION-01 | UC-MUTATION-01 | U | Invoke `evals/mutation/run_mutation.py` with passing and failing baselines and explicit policy arguments or `--config opencode-mutation.json`. | Baseline result, mutation output, killed count, survivors, arguments, and result file. | A failed baseline cannot yield a passing score; otherwise every mutation result is reported accurately. |

## Session Auditing

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-AUDIT-01 | UC-AUDIT-01 | U | Run `tests/audit_run.py` against recorded databases for Plan, Build, each shipped agent, and a registered generated agent. Cover same-project and cross-project descendants, missing or ambiguous child directory metadata, reserved generated names, switches, root tool calls, a spoofed user `APPROVE`, exact and non-exact Reviewer child output, missing data, and message usage. | Report text, fixture database, joined message and part rows, raw queries, and exit status. | The report aggregates only descendants whose normalized directory/worktree matches the selected project, fails closed on every reserved generated identity or unverifiable child directory, reports approval only when attributed Reviewer assistant output ends with exact `APPROVE`, limits itself to observable signals, and never attributes root calls after a switch or claims enforcement, package validity, model quality, or fresh command proof. |

## Deployment

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-DEP-01 | UC-DEP-01 | F | Install the default profile into an empty root, then repeat installation. | Exact installed tree, file contents, dependencies, the recorded whole-tree hash and entry, file, and symlink counts, integrity-state metadata and mode, and second-run result. | Exactly Ask, Grounder, Prometheus, and Reviewer are installed with all three plugins, all four tools, managed rules, pinned dependencies, packaged skills, and valid owner-only runtime-integrity state. The optional loop, repository instructions, protected runner, and supervisor are absent. |
| TP-DEP-02 | UC-DEP-02 | F, S | Supply unsupported profile, source, and per-category destination options; inspect help. | Exit status, diagnostics, help text, and resolved configuration. | Unsupported options fail as unknown, and help presents only the single-root interface. |
| TP-DEP-03 | UC-DEP-03 | F | Exercise every supported configuration-root source plus copy and symlink modes against unrelated state and collisions. | Resolved destinations, backups, modes, and final installed tree. | Every destination stays beneath one root, every managed group installs, unrelated state survives, and repetition is idempotent. |
| TP-DEP-04 | UC-DEP-04 | F | Prepare current, stale, modified, missing, absolute and relative repository links, foreign links, unrelated entries, a discoverable skill backup, proved and unproved retired paths, previously managed entries, missing or invalid runtime-integrity state, and modified or missing runtime code with unchanged package versions. Run status, install reconciliation, and removal. | Status classes, aggregate exit, summary, backup locations, ownership and integrity state, recorded and current runtime hashes, before and after bytes, and final filesystem. | Status is read-only, scans every managed surface, and exits nonzero for any drift, including bad integrity state or runtime-content mismatch; backups move outside discovery; only current or retired entries with proved ownership and unchanged content are removed; conflicts, modified entries, unrelated data, and feedback remain. |
| TP-DEP-06 | UC-DEP-06 | S | Inspect install, update, status, and profile-change instructions. | README, deployment docs, and installer output. | Every changed-profile path tells the user to restart OpenCode, and none promises hot reload. |
| TP-DEP-07 | UC-DEP-07 | U, B | **B BLOCKED until Phase 5.** Use future fixture `tests/fixtures/agent_value/profile-drift.md` with a current profile, each managed inventory category drifting, missing and invalid runtime-integrity state, runtime code tampering under unchanged versions, every retired agent, plugin, and tool discovery path, unresolved roots, malformed debug output, and explicit diagnostic mode. | Model invocation count, canonical integrity-helper output, diagnostics, exit status, and final claim. | A current profile with valid recorded runtime content may enter live scenarios. Any missing or invalid integrity state, changed or missing runtime code, discoverable retired session-altering path, or other default drift exits before model invocation with install-and-restart guidance; diagnostic mode never claims source-profile validation. |

## Measured Spikes

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-SPIKE-01 | UC-SPIKE-01 | U | Attempt valid and invalid identifiers, missing and malformed contracts, direct Prometheus Bash, an unapproved spike, and an approved contracted spike. | Permission decisions, process activity, and result files. | Only a safe, contracted, approved spike runs. Direct Prometheus Bash remains denied. |
| TP-SPIKE-02 | UC-SPIKE-02 | U, F | On supported macOS and Linux environments, exercise success, nonzero exit, timeout, excess output, secret-shaped output, reduced environment, concurrency, and path escapes. | Working directory, environment, termination, bounded output, redaction, and persisted result fields. | Execution is bounded and records `sandboxed: false`; sensitive output is redacted; failures are represented honestly. |
| TP-SPIKE-03 | UC-SPIKE-03 | B | **B BLOCKED until Phase 5.** Use future fixture `tests/fixtures/agent_value/prometheus-failed-spike.md` with a load-bearing spike that violates its kill criterion. | Contract, spike result, cited planning evidence, resulting approach, and package state. | Prometheus records the failed criterion and redesigns or blocks instead of publishing the disproved assumption. |

## Documentation Consistency

| Test case | Use case | Class | Setup and action | Evidence | Pass condition |
| --- | --- | --- | --- | --- | --- |
| TP-DOC-01 | UC-DOC-01 | S | Compare README, durable docs, agent definitions, tools, plugins, installer, examples, CI, and tests with the current roster, package, strategies, deployment, and validation contract. | Contradiction report, unsupported-reference inventory, and package-example validation. | Supported behavior agrees across the repository. Current examples use one schema-v1 registered package and only `direct`, `ralph`, or `optimization`. |

## Execution Order

1. Run deterministic unit, filesystem, static, deployment, skill, mutation, loop,
   and audit checks.
2. Validate deterministic schema-v1 package cases for all three current
   strategies, full multi-entry registries, and all permission boundaries.
3. During Phase 5, author and self-check every frozen B-class fixture listed in
   the registry.
4. Run Ask, Grounder, Prometheus, Reviewer, native Plan and Build, and generated
   agent behavioral evaluations against those frozen assets.
5. Run TP-NEXT-05 with the pinned OpenCode binary, then run optional live smoke
   checks against the matching installed profile.
6. Record failures, blockers, missing platforms, and environment limits without
   converting absent evidence into a pass.

## Release Evidence

A release evidence set is complete only when:

- every use case has executed evidence matching each required class;
- every deterministic case passes on each required platform;
- every B-class fixture exists, passes its self-check, and meets its frozen
  threshold;
- TP-NEXT-05 passes with the pinned runtime rather than being skipped;
- permission, immutability, readiness-veto, and false-completion checks pass
  every exercised run;
- optional live results identify the exact installed profile and platform;
- every blocked result names its missing prerequisite or evidence.

Until Phase 5 authors every named B-class fixture, the current behavioral release
evidence is incomplete by design. This includes Prometheus publication and
generated-agent execution even though the deterministic class-E flow exists.
Deterministic CI can run, but it cannot satisfy the behavioral release set.

## Test Record

Retain the following for each execution:

- test-case and use-case identifiers;
- date, tester, repository revision, and platform;
- relevant OpenCode, extension, model, and provider versions;
- installed profile and configuration root;
- prompt, package, and fixture revisions;
- expected and observed results;
- transcript, tool decisions, process output, and filesystem changes;
- pass, fail, blocked, or skipped verdict;
- environment limits and follow-up issue.

## Behavioral Fixture Registry

A frozen fixture is a versioned asset for one B-class scenario. A B-class row is
blocked until its named file exists and contains the required prompt, repository
revision, observable rubric, retained evidence, and pass threshold.

Every B-class asset row below is currently **BLOCKED until Phase 5**. The listed
paths are reservations, not files that exist today. No row, including any later
numbered B-class addition, may be marked passing or ready before its asset and
required evidence exist.

The registry contains only fixtures exercised through native Plan and Build,
Ask, Grounder, Prometheus, Reviewer, or a registered generated agent. Auxiliary
rows test current resource, skill, feedback, profile, and spike behavior through
those identities; they do not define more roles.

| Test cases | Agent or flow | Fixture path | Asset status |
| --- | --- | --- | --- |
| TP-NATIVE-02 | Native Plan and Build | `tests/fixtures/agent_value/native-plan-build.md` | **BLOCKED until Phase 5** |
| TP-ASK-01 | Ask | `tests/fixtures/agent_value/ask.md` | **BLOCKED until Phase 5** |
| TP-GROUNDER-01 | Grounder | `tests/fixtures/agent_value/grounder.md` | **BLOCKED until Phase 5** |
| TP-PRO-01 through TP-PRO-06 | Prometheus research and readiness | `tests/fixtures/agent_value/prometheus-readiness.md` | **BLOCKED until Phase 5** |
| TP-PRO-08 | Prometheus empirical prerequisite | `tests/fixtures/agent_value/prometheus-load-bearing-prerequisite-v2.md` | **BLOCKED until Phase 5** |
| TP-REV-01 | Reviewer | `tests/fixtures/agent_value/reviewer.md` | **BLOCKED until Phase 5** |
| TP-NEXT-01, TP-PUB-03 | Prometheus package publication and strategy selection | `tests/fixtures/agent_value/generated-package-strategies.md` | **BLOCKED until Phase 5** |
| TP-NEXT-02 | Restart and new-conversation handoff | `tests/fixtures/agent_value/generated-fresh-context-handoff.md` | **BLOCKED until Phase 5** |
| TP-NEXT-03 | Generated `ralph` execution | `tests/fixtures/agent_value/generated-ralph-progress.md` | **BLOCKED until Phase 5** |
| TP-NEXT-04 | Generated validation and permission boundaries | `tests/fixtures/agent_value/generated-validation-boundaries.md` | **BLOCKED until Phase 5** |
| TP-RESOURCE-01 | Ask and Grounder resource selection | `tests/fixtures/agent_value/resource-selection.md` | **BLOCKED until Phase 5** |
| TP-SKILL-02 | Shipped and registered generated agents using skills | `tests/fixtures/agent_value/skill-boundaries.md` | **BLOCKED until Phase 5** |
| TP-FEEDBACK-02 | Registered generated agent using the feedback skill | `tests/fixtures/agent_value/feedback-triage.md` | **BLOCKED until Phase 5** |
| TP-DEP-07 | Shipped-agent profile preflight | `tests/fixtures/agent_value/profile-drift.md` | **BLOCKED until Phase 5** |
| TP-SPIKE-03 | Prometheus failed-spike planning | `tests/fixtures/agent_value/prometheus-failed-spike.md` | **BLOCKED until Phase 5** |
| TP-NEXT-05 | Installed Prometheus to generated-agent flow | `evals/seed_build/e2e/` | Present, class E |

The class-E fixture keeps its hidden acceptance suite in
`evals/seed_build/e2e/hidden/`. The harness does not copy that directory into
the agent workspace or name it in the request. The scored request is
`evals/seed_build/e2e/request.md`.

## Platform Matrix

| Platform | Status | Notes |
| --- | --- | --- |
| macOS arm64 and x86_64 | Required | Deterministic and behavioral cases must pass before a macOS or cross-platform claim. |
| Linux x86_64 | Required | Deterministic cases must pass; behavioral records must name the platform. |
| Windows | Out of scope | This release does not support it. |

No case may pass on a required platform without execution on that platform. A
missing platform run leaves that platform unproved; it does not erase valid
evidence recorded on another platform.
