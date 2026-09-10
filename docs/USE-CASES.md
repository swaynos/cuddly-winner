# Use Cases

[`docs/TEST-PLAN.md`](TEST-PLAN.md) defines the test scenarios, observable
evidence, and pass conditions for each use case below.

Evidence classes:

- **U**: deterministic unit test
- **F**: filesystem or deployment integration test
- **S**: static source, configuration, or documentation check
- **B**: behavioral agent evaluation
- **O**: optional live OpenCode smoke test
- **E**: deterministic installed-product end-to-end test

## Generated Agent Workflow

These are the current planning-to-execution cases. Prometheus publishes a
task-specific project-local agent for each planning-ready task.

### UC-NEXT-01: Prometheus publishes a scoped local executor

- **Given:** Prometheus has a planning-ready task.
- **When:** it selects `direct`, `ralph`, or `optimization` from the task evidence.
- **Then:** publish a schema-v1 registry, agent definition, task manifest, and
  durable task brief under `.opencode/`.
- **Never:** edit ordinary implementation files, omit context needed by a fresh
  session, or publish an agent with permissions wider than its manifest.
- **Evidence:** F generated files; S package contract; B publication and fresh
  execution scenarios.

### UC-NEXT-02: Publication creates a fresh-context handoff

- **Given:** Prometheus has published a generated executor.
- **When:** it hands off the task.
- **Then:** name the agent, brief, and manifest, stop before implementation, and
  tell the user to quit and restart OpenCode, start a new conversation, and
  select the named local agent.
- **Never:** claim that restart clears a resumed conversation or require the
  generated agent to recover the planning transcript.
- **Evidence:** B handoff transcript; O startup discovery and new-session run.

### UC-NEXT-03: A Ralph-style executor measures pass progress

- **Given:** Prometheus selects `ralph` for incremental work.
- **When:** a generated executor completes a pass.
- **Then:** retain declared before-and-after progress evidence and apply the
  declared pass and run-wide stop rules.
- **Never:** treat a useful pass, agent prose, or process exit status as proof of
  the final outcome.
- **Evidence:** B multi-pass fixture; F retained pass evidence.

### UC-NEXT-04: Validation is task-defined

- **Given:** Prometheus publishes a generated executor.
- **When:** it defines completion evidence.
- **Then:** state the required outcome evidence, freshness rule, and failure or
  incomplete result. Require independent review only when the task needs it.
- **Never:** require one universal validation role for every task or call unproved
  work delivered.
- **Evidence:** S task-manifest contract; B pass, fail, and independent-review
  scenarios.

### UC-NEXT-05: Local definitions preserve ownership and boundaries

- **Given:** a target name collides with an existing local agent, or a generated
  agent requests a protected action.
- **When:** Prometheus publishes or the generated executor runs.
- **Then:** ask before replacing a user-owned definition and enforce the
  registered agent's declared edit and Bash boundaries.
- **Never:** overwrite unrelated definitions, rewrite the published task
  package during execution, or treat an unregistered local agent as managed.
- **Evidence:** F collision and package fixtures; U permission matrix; E
  installed-product boundary probes.

## Native Compatibility

### UC-NATIVE-01: Plan and Build remain native

- **Given:** Plan, Build, an unknown agent, or a third-party agent is selected.
- **When:** it reads, edits, or executes commands.
- **Then:** the identity-scoped plugins return before applying a generated or
  shipped-agent permission envelope. Shared global rules and other applicable
  plugin hooks may still run.
- **Never:** require a generated task package, workflow tool, or specialist
  handoff, let a reserved registry entry hijack a native identity, or claim that
  installation leaves native prompt and session bytes unchanged.
- **Evidence:** U identity bypass matrix; F default deployment.

### UC-NATIVE-02: Specialist workflows are explicit

- **Given:** ordinary planning or implementation work.
- **When:** no specialist is selected.
- **Then:** keep native Plan and Build available without specialist routing or a
  generated package.
- **Never:** route ordinary work to Prometheus or a generated executor.
- **Evidence:** S project instructions; B direct native scenarios.

## Identity And Permissions

### UC-ID-01: Managed ancestry is inherited

- **Given:** direct or delegated managed sessions.
- **When:** a descendant requests a tool.
- **Then:** apply the topmost managed ancestor's defined boundary and fail closed
  when an ancestry cycle prevents safe resolution.
- **Never:** widen permissions through delegation, switching, spoofing, or an
  ancestry cycle.
- **Evidence:** U ancestry and cycle matrix.

### UC-ID-02: Prometheus is publication-scoped

- **Given:** Prometheus requests mutation or command execution.
- **When:** permissions evaluate the request.
- **Then:** allow writes only to generated package and spike paths, deny direct
  Bash, and approval-gate contracted spikes.
- **Never:** permit ordinary production edits or command access outside the
  declared governance tools.
- **Evidence:** U path and permission matrix; S agent frontmatter.

### UC-ID-03: Registered executors are manifest-scoped

- **Given:** a project-local agent is registered with a valid schema-v1 task
  manifest.
- **When:** it requests an edit, Bash, a governance tool, or delegation.
- **Then:** enforce its declared edit paths and Bash policy through the topmost
  managed ancestry.
- **Never:** allow package rewrites, trusted control-plane edits, out-of-scope
  edits, undeclared Bash, or Prometheus-only governance tools. A non-reserved
  registry-named identity with an invalid package must stay blocked rather than
  become unmanaged, while reserved entries must not replace native or shipped
  identities.
- **Evidence:** U generated-identity matrix; E boundary probes.

### UC-ID-04: Shipped read-only roles remain read-only

- **Given:** Ask, Reviewer, or Grounder is active.
- **When:** it requests mutation, command execution, or delegated
  implementation.
- **Then:** deny the request.
- **Never:** let advisory or research delegation become implementation.
- **Evidence:** U role matrix; S agent frontmatter.

### UC-ID-05: Automatic approval honors explicit denies

- **Given:** OpenCode starts in documented automatic-approval mode.
- **When:** a generated executor requests allowed Bash or Prometheus requests an
  allowed spike.
- **Then:** OpenCode may approve an action that would otherwise ask.
- **Never:** bypass a manifest Bash denial, Prometheus direct-Bash denial, or a
  read-only role's denial.
- **Evidence:** U policy matrix; E generated-agent run; O permission smoke test.

## Prometheus Research And Readiness

### UC-PRO-01: Outcome is separated from solution

- **Given:** a request includes a diagnosis or preferred implementation.
- **When:** Prometheus triages it.
- **Then:** establish the independent outcome and current behavior first.
- **Never:** accept confidence as evidence.
- **Evidence:** B predetermined-solution and false-diagnosis scenarios.

### UC-PRO-02: Questions are decision-changing

- **Given:** ambiguity may alter scope, safety, policy, architecture, or
  acceptance.
- **When:** available evidence and bounded defaults cannot resolve it.
- **Then:** ask one focused question or a coherent small batch.
- **Never:** issue a generic discovery questionnaire or interview clear work.
- **Evidence:** B ambiguous and complete-request scenarios.

### UC-PRO-03: Credible alternatives are compared

- **Given:** reuse, configuration, documentation, no change, or narrower work
  may satisfy the outcome.
- **When:** Prometheus selects an approach.
- **Then:** compare credible options and recommend the smallest sufficient
  result.
- **Never:** manufacture alternatives as template ceremony.
- **Evidence:** B reuse, no-build, narrower-fix, and direct-build scenarios.

### UC-PRO-04: Readiness vetoes remain bounded

- **Given:** work is unsafe, destructively unauthorized, inconsistent,
  unboundedly lossy, or lacks a deterministic completion path.
- **When:** publication is requested.
- **Then:** report the concrete planning blocker.
- **Never:** convert user insistence into a ready task package.
- **Evidence:** B veto matrix.

### UC-PRO-05: Deliberation resolves available evidence first

- **Given:** a request contains uncertainty.
- **When:** Prometheus begins deliberation.
- **Then:** use local evidence, direct web sources, connected services, Grounder,
  or a contracted spike before asking the human.
- **Never:** ask for a fact that an available safe evidence path can establish.
- **Evidence:** B resolvable and unresolvable uncertainty scenarios.

### UC-PRO-06: Thin context permits bounded defaults

- **Given:** a request leaves implementation mechanics open.
- **When:** no evidence makes those mechanics outcome constraints.
- **Then:** choose conservative, reversible, testable defaults and proceed.
- **Never:** stall on routine formats, thresholds, schemas, or delivery
  mechanics.
- **Evidence:** B thin-context and empty-workspace scenarios.

### UC-PRO-08: Load-bearing empirical prerequisites must hold

- **Given:** a core outcome depends on a measured acquisition, corpus,
  calibration, or scale prerequisite.
- **When:** local evidence or a contracted spike disproves that prerequisite.
- **Then:** redesign or report a concrete planning blocker.
- **Never:** publish a disproved scale or an undeclared degraded result as the
  required outcome.
- **Evidence:** B failed-prerequisite scenario; S prompt contract.

## Generated Package Publication

### UC-PUB-01: Package shape is exact and current

- **Given:** a registry, task manifest, agent definition, and task brief.
- **When:** `validate_scaffold` runs.
- **Then:** perform registry-wide structural validation, select `agent_name`, and
  fully validate that named schema-v1 package; require the argument when the
  registry has multiple entries. Validate matching task identity, canonical
  package paths, strategy contract, scope, permissions, limits, and verification
  fields for the named package.
- **Never:** execute project commands, accept another version or unknown field,
  accept malformed, duplicate, or reserved registry entries, treat an unselected
  package as validated, let invalid registry-named packages escape immutability,
  let reserved entries hijack existing identities, or migrate an old package.
- **Evidence:** U positive and negative package fixtures.

### UC-PUB-02: Git exclusion is constrained

- **Given:** Prometheus invokes `scaffold_gitignore` without arguments.
- **When:** the workspace is a Git worktree and `.gitignore` is absent or valid.
- **Then:** atomically manage only the current generated-task block, preserve
  unrelated bytes and modes, and report tracked generated artifacts.
- **Never:** follow symlinks, accept malformed markers, alter the Git index,
  create `.gitignore` outside a Git worktree, or initialize Git.
- **Evidence:** F target, marker, idempotence, and index fixtures.

### UC-PUB-03: Planning-ready publication is mandatory

- **Given:** Prometheus has resolved planning readiness without a concrete
  blocker or required question.
- **When:** it prepares its final response.
- **Then:** publish and statically validate the complete generated package before
  issuing the fresh-context handoff.
- **Never:** wait for another publication request, implement the task, or present
  static validation as passing outcome verification.
- **Evidence:** S prompt and plugin contract; B publication scenario; E installed
  handoff.

## Ask

### UC-ASK-01: Focused questions use the smallest evidence path

- **Given:** a focused question is posed to Ask.
- **When:** the answer is in session context or reachable through narrow local
  evidence.
- **Then:** answer directly, checking session context before read, grep, glob, or
  list operations.
- **Never:** start planning or implementation, modify files, dump proxy commands,
  or blame the environment for role limits.
- **Evidence:** B focused-question scenario; S frontmatter.

### UC-ASK-02: Broad research delegates only to Grounder

- **Given:** a question requires broad, multi-step, or external evidence.
- **When:** direct evidence collection is insufficient.
- **Then:** delegate to Grounder and return a concise synthesis.
- **Never:** delegate to another role or use delegation to proxy implementation.
- **Evidence:** B delegation scenario; S task permissions.

## Grounder

### UC-GROUNDER-01: Every substantive claim is cited

- **Given:** Grounder returns research findings.
- **When:** it reports a fact or inference.
- **Then:** cite each substantive claim with a file and line or a URL, and label
  inferences and weak evidence.
- **Never:** present guesses as facts or recommend unsupported code changes.
- **Evidence:** B local and external research scenarios; S output contract.

### UC-GROUNDER-02: Private data stays local

- **Given:** Grounder is gathering evidence.
- **When:** external corroboration would disclose private code, credentials, or
  secrets.
- **Then:** return local-only evidence and state that external corroboration was
  not performed.
- **Never:** send private content to a third-party service or sub-delegate.
- **Evidence:** B private-data scenario; S permissions.

## Reviewer

### UC-REV-01: Reviewer remains read-only and advisory

- **Given:** a rubric, change evidence, and verification summary.
- **When:** Reviewer evaluates them.
- **Then:** return a cited report ending in `APPROVE` or `REQUEST_CHANGES`.
- **Never:** edit, execute commands, delegate, or determine task completion by
  itself.
- **Evidence:** S permission and format checks; B approval and rejection
  scenarios.

## Generated Task Loop

### UC-LOOP-01: Each configured pass starts fresh

- **Given:** `scripts/task-loop.mjs` receives a registered generated-agent name
  and a pass budget.
- **When:** the loop runs.
- **Then:** start one fresh `opencode run --agent <name>` process per pass with no
  prompt message and leave continuity to project state.
- **Never:** deploy the loop as part of the managed profile, inject hidden task
  context, or create a cross-session state machine.
- **Evidence:** U argument and process tests; F pass log.

### UC-LOOP-02: Loop evidence does not accept the outcome

- **Given:** an optional state command and loop stop settings.
- **When:** passes succeed, fail, make progress, or remain idle.
- **Then:** record before and after counters, deltas, duration, and exit status in
  append-only JSONL and apply only the configured pass, idle, wall-time, and
  failure stops. Check elapsed wall time after a completed pass and before
  starting the next.
- **Never:** infer domain meaning, treat exit code as completion, stage or commit
  work, hide failed and unproductive passes, or predict whether a future pass
  would cross the wall limit.
- **Evidence:** U delta and stop-rule matrix; F JSONL fixture.

## Generated Runtime Policy

### UC-KPI-01: Optional run KPIs remain subordinate to delivery

- **Given:** a registered generated agent whose schema-v1 manifest omits,
  disables, or explicitly enables `run_kpis`.
- **When:** the runtime observes completed assistant messages and prepares a new
  response.
- **Then:** remain inert when absent or disabled; when enabled, report usage and
  cap output against the declared hard token budget.
- **Never:** apply hidden defaults, affect an unregistered identity, approve
  tools, create work, delay valid completion, or override scope, safety,
  verification, or strategy stops.
- **Evidence:** U manifest and runtime-plugin tests; S package contract.

## Resource Selection

### UC-RESOURCE-01: Research avoids desktop disruption by default

- **Given:** local evidence, direct web pages, public APIs, or text-only search
  can answer a question.
- **When:** a managed agent gathers evidence.
- **Then:** use those sources before browser automation.
- **Never:** open a visible browser without stating the target, lower-impact
  failures, and receiving user approval.
- **Evidence:** S agent and rule contract; B resource-order scenario.

### UC-RESOURCE-03: Image credentials are opt-in and provider-scoped

- **Given:** a browser image-generation request.
- **When:** managed credential state is selected.
- **Then:** default to ephemeral headless state, require confirmation for visible
  authentication, and keep persistent profiles provider-specific.
- **Never:** use a personal browser profile, preserve credentials by default, or
  silently fall back to visible operation.
- **Evidence:** U credential state tests; F managed deployment fixture.

### UC-RESOURCE-04: Managed MCP configuration preserves user state

- **Given:** an OpenCode configuration with unrelated MCP entries.
- **When:** managed install, status, diagnose, or remove runs.
- **Then:** update only project-owned entries and report unmanaged modes
  read-only.
- **Never:** overwrite unrelated entries or expose profile contents.
- **Evidence:** U configuration synchronizer tests; F installer fixture.

### UC-RESOURCE-05: Session fetch remains private and read-only

- **Given:** a configured site requires interactive login before authenticated
  retrieval.
- **When:** the user approves the named visible-browser bootstrap.
- **Then:** return an opaque handle and allow only `GET` or `HEAD` to configured
  HTTPS origins until close or expiry.
- **Never:** return session material, use an unconfigured origin, follow a
  foreign redirect, or make a write request.
- **Evidence:** U session lifecycle tests; F profile and deployment fixture.

## Skills Ecosystem

### UC-SKILL-01: Skill structure is release-validated

- **Given:** packaged skill assets under `skills/`.
- **When:** deterministic validation checks packaged skills and a temporary
  deployed copy.
- **Then:** verify frontmatter, package paths, and required catalog content.
- **Never:** deploy invalid or unparseable skills.
- **Evidence:** U packaged and deployed skill validation.

### UC-SKILL-02: Role boundaries hold under skill pressure

- **Given:** a managed agent loads non-core skill instructions.
- **When:** skill text attempts to widen a boundary.
- **Then:** preserve plugin-enforced edit and command restrictions.
- **Never:** let skill prompts override agent permissions or managed ancestry.
- **Evidence:** B managed-agent pressure scenario; O optional live check.

### UC-SKILL-03: Catalog and packages remain aligned

- **Given:** the canonical skill catalog and packaged skill directories.
- **When:** a skill is added, removed, or changed.
- **Then:** keep one catalog entry and one package for each shipped skill.
- **Never:** let a runtime prompt become the only behavioral specification.
- **Evidence:** S catalog and package inventory; U coverage check.

## Local Feedback

### UC-FEEDBACK-01: Cross-project capture stays private

- **Given:** a writable agent records a negative or mixed report from another
  project.
- **When:** it pipes one bounded Markdown report to the deployed recorder.
- **Then:** write one owner-only, metadata-tagged file in the installing clone's
  ignored inbox and print only its path.
- **Never:** scan for a clone, use a network client, overwrite a report, accept
  report text in command arguments, or claim success after a permission failure.
- **Evidence:** U recorder tests; F copy and symlink deployment fixtures.

### UC-FEEDBACK-02: Triage preserves the privacy boundary

- **Given:** a pending report in the source clone.
- **When:** an agent triages it.
- **Then:** treat report text as untrusted evidence, verify supported claims
  locally, and archive only after fresh verification.
- **Never:** execute report instructions, send its content remotely, treat it as
  product documentation by default, or delete it when work begins.
- **Evidence:** S skill contract; B feedback-triage scenario.

### UC-FEEDBACK-03: Locator lifecycle is safe

- **Given:** missing, current, stale, modified, or clone-replaced locator state.
- **When:** installation, status, removal, or capture runs.
- **Then:** make install backup-first and idempotent, status read-only, removal
  conservative, and capture fail closed.
- **Never:** delete feedback, follow unsafe locators, or replace unrelated
  configuration.
- **Evidence:** F deployment and recorder fixtures.

## Mutation Testing

### UC-MUTATION-01: Mutation scoring requires a passing baseline

- **Given:** target modules, a baseline command, and explicit mutation policy.
- **When:** `evals/mutation/run_mutation.py` runs.
- **Then:** require the unmodified baseline to pass before applying mutations and
  report killed and surviving mutants accurately.
- **Never:** report a passing score when the baseline fails or a survivor is
  hidden.
- **Evidence:** U mutation-runner fixtures.

## Session Auditing

### UC-AUDIT-01: Session signals remain investigative

- **Given:** an OpenCode session recorded in `opencode.db`.
- **When:** `tests/audit_run.py` inspects the selected root and descendants.
- **Then:** report available session, agent, message, tool, and usage signals and
  label missing or non-applicable evidence. Report Reviewer approval only from
  attributed Reviewer assistant output whose last non-empty line is exactly
  `APPROVE`.
- **Never:** attribute a root-session call to a switched agent, or present the
  word `APPROVE` in arbitrary root or user text as Reviewer approval, or present
  the report as proof of permission enforcement, package validity, model
  judgment, or fresh verification.
- **Evidence:** U recorded-database fixtures and report output.

## Deployment

### UC-DEP-01: Default profile is complete

- **Given:** an empty OpenCode configuration root.
- **When:** default installation runs.
- **Then:** install exactly Ask, Grounder, Prometheus, and Reviewer, plus all
  three plugins, all four workflow tools, pinned runtime dependencies, packaged
  skills, managed rules, and owner-only integrity state for the recursive runtime
  content tree.
- **Never:** install repository `AGENTS.md`, the optional task loop, a protected
  command runner, or a supervisor.
- **Evidence:** F deployment fixture.

### UC-DEP-02: Unsupported deployment options fail

- **Given:** an alternate profile flag, source override, or per-category
  destination override.
- **When:** installation parses arguments.
- **Then:** reject it as unknown and show the supported single-root interface.
- **Never:** retain hidden option precedence or an alternate profile.
- **Evidence:** F argument matrix; S help contract.

### UC-DEP-03: Installation is additive from one root

- **Given:** a configuration root containing unrelated user state.
- **When:** installation runs in copy or symlink mode.
- **Then:** derive managed destinations beneath that root, preserve user state,
  and install every managed group.
- **Never:** replace unrelated entries or split destinations across roots.
- **Evidence:** F copy, symlink, collision, and idempotence fixtures.

### UC-DEP-04: Status and removal are conservative

- **Given:** current, stale, modified, linked, missing, and unrelated entries.
- **When:** status, install reconciliation, or removal runs.
- **Then:** classify every managed group, keep status read-only, back up
  collisions outside discovery, aggregate every managed-surface drift into the
  status exit, and remove current or retired entries only when ownership and
  unchanged content are proved. Check recorded runtime hashes and content as well
  as package versions.
- **Never:** remove modified or unrelated state, delete feedback, or migrate an
  unsupported artifact. Preserve conflicts at retired paths and report them as
  nonzero status drift.
- **Evidence:** F status, backup, reconciliation, and removal fixtures.

### UC-DEP-06: Restart loads profile changes

- **Given:** OpenCode is already running.
- **When:** managed agents, plugins, tools, skills, or rules change.
- **Then:** instruct the user to restart OpenCode.
- **Never:** claim hot reload.
- **Evidence:** S deployment documentation and installer output.

### UC-DEP-07: Live validation refuses profile drift

- **Given:** the active managed profile differs from the source clone, its
  runtime-integrity state is missing or invalid, or recorded runtime code changed
  or disappeared while package versions stayed fixed.
- **When:** repository-profile live validation starts.
- **Then:** stop before model invocation with install-and-restart guidance. An
  explicit diagnostic mode may run but must label its scope.
- **Never:** claim repository-profile validation from a drifting installation.
- **Evidence:** U preflight tests; B current-profile scenario.

## Measured Spikes

### UC-SPIKE-01: A spike requires a contract and approval

- **Given:** a load-bearing command-dependent uncertainty.
- **When:** Prometheus invokes `spike`.
- **Then:** require `.spike/<id>/QUESTION.md`, a safe identifier, and normal
  OpenCode approval.
- **Never:** expose direct Bash or execute an uncontracted spike.
- **Evidence:** U contract and permission tests.

### UC-SPIKE-02: Native spike execution is bounded and honest

- **Given:** an approved spike command.
- **When:** it runs on a supported platform.
- **Then:** use the spike directory, a reduced environment, finite timeout and
  output, redaction, and atomic result files containing `sandboxed: false`.
- **Never:** claim filesystem confinement, host isolation, or protected
  evidence.
- **Evidence:** U and F process, error, timeout, and output tests.

### UC-SPIKE-03: Failed kill criteria change the plan

- **Given:** measured output violates the declared kill criterion.
- **When:** Prometheus evaluates the result.
- **Then:** redesign or block and cite the evidence.
- **Never:** publish the disproved assumption as fact.
- **Evidence:** B failed-spike scenario.

## Documentation Consistency

### UC-DOC-01: Durable docs match shipped behavior

- **Given:** changes to roles, permissions, tools, deployment, strategies, or
  validation.
- **When:** release validation runs.
- **Then:** README, durable docs, use cases, agents, scripts, and tests agree with
  the four-agent roster and generated-agent workflow.
- **Never:** keep unsupported role requirements, duplicate contract
  versions, or examples that validate a different workflow.
- **Evidence:** S repository text checks; full deterministic CI.
