# Use Cases

[`docs/TEST-PLAN.md`](TEST-PLAN.md) defines the test scenarios, observable evidence, and pass
conditions for each use case below.

Evidence classes:

- **U**: unit test
- **F**: filesystem/deployment integration test
- **S**: static source/configuration check
- **B**: behavioral agent evaluation
- **O**: optional live OpenCode smoke test

## Native Compatibility

### UC-NATIVE-01: Plan and Build remain native

- **Given:** Plan, Build, an unknown agent, or a third-party agent is selected.
- **When:** it reads, edits, or executes commands.
- **Then:** the plugin returns before applying managed-agent rules.
- **Never:** require a SPEC, workflow tool, or specialist handoff.
- **Evidence:** U identity bypass matrix; F default deployment.

### UC-NATIVE-02: Specialist workflows are explicit

- **Given:** ordinary planning or implementation work.
- **When:** no specialist is selected.
- **Then:** use native OpenCode behavior.
- **Never:** route automatically to Prometheus or Autonomous.
- **Evidence:** S agent/project instructions; B direct native scenarios.

## Identity And Permissions

### UC-ID-01: Managed ancestry is inherited

- **Given:** direct or delegated managed sessions.
- **When:** a descendant requests a tool.
- **Then:** apply the topmost managed ancestor's fixed boundary.
- **Never:** widen permissions through delegation or identity spoofing.
- **Evidence:** U ancestry and cycle matrix.

### UC-ID-02: Prometheus is scaffold-scoped

- **Given:** Prometheus requests mutation or command execution.
- **When:** permissions evaluate it.
- **Then:** permit scaffold edits and `bash: ask` for research commands; set governance tools to ask when installed.
- **Never:** permit ordinary production file edits.
- **Evidence:** U permission/path matrix; S frontmatter check.

### UC-ID-03: Autonomous owns implementation

- **Given:** a published scaffold.
- **When:** Autonomous implements it.
- **Then:** permit ordinary edits and set native Bash to ask.
- **Never:** permit edit-tool changes to the scaffold or extension sources.
- **Evidence:** U path matrix; S frontmatter check.

### UC-ID-04: Read-only roles remain read-only

- **Given:** Ask, Karpathy, Reviewer, or Grounder.
- **When:** it requests mutation or command execution.
- **Then:** deny the request.
- **Never:** let advisory delegation become implementation.
- **Evidence:** U role matrix.

### UC-ID-05: Auto mode approves asks, not denies

- **Given:** OpenCode starts with `--auto`.
- **When:** Autonomous requests Bash or Prometheus requests a spike.
- **Then:** OpenCode may approve without prompting.
- **Never:** bypass explicit denies for read-only roles.
- **Evidence:** S permission contract against OpenCode documentation; O smoke test.

## Prometheus Triage

### UC-PRO-01: Outcome is separated from solution

- **Given:** a request includes a diagnosis or preferred implementation.
- **When:** Prometheus triages it.
- **Then:** establish the independent outcome and current behavior first.
- **Never:** accept confidence as evidence.
- **Evidence:** B predetermined-solution and false-diagnosis scenarios.

### UC-PRO-02: Questions are decision-changing

- **Given:** ambiguity may alter scope, safety, policy, architecture, or acceptance.
- **When:** Prometheus cannot resolve it from evidence.
- **Then:** ask one focused question or a coherent small batch.
- **Never:** issue generic discovery questionnaires or interview clear work.
- **Evidence:** B ambiguous and clear request scenarios.

### UC-PRO-03: Credible alternatives are compared

- **Given:** reuse, configuration, documentation, no change, or narrower work may satisfy the outcome.
- **When:** approaches are selected.
- **Then:** compare credible options and recommend the smallest sufficient result.
- **Never:** manufacture alternatives as template ceremony.
- **Evidence:** B reuse/no-build and sound-request scenarios.

### UC-PRO-04: Readiness vetoes remain bounded

- **Given:** work is unsafe, destructively unauthorized, inconsistent, unboundedly lossy, or lacks a deterministic completion path.
- **When:** publication is requested.
- **Then:** report a planning blocker.
- **Never:** convert user insistence into a valid scaffold.
- **Evidence:** B veto matrix.

### UC-PRO-05: Self-resolution through deliberation

- **Given:** a request containing uncertainties or ambiguities.
- **When:** Prometheus begins deliberation.
- **Then:** investigate using available tools — bash, web search, connected MCPs, Grounder — and resolve uncertainties internally before asking the human.
- **Never:** ask the human a question that available tools could have answered.
- **Evidence:** B deliberation scenario with resolvable and unresolvable uncertainties.

### UC-PRO-06: Creative liberty with thin context

- **Given:** a request too thin to constrain key decisions (e.g. "create a world class recipe").
- **When:** Prometheus finds no evidence to narrow the decision.
- **Then:** apply creative liberty and proceed without asking.
- **Never:** stall or issue a generic discovery questionnaire when context is intentionally open-ended.
- **Evidence:** B thin-context scenario.

### UC-PRO-07: Prometheus recommends Karpathy for measurable outcomes

- **Given:** Prometheus identifies a clear metric, direction, and evaluator during deliberation.
- **When:** it selects a strategy.
- **Then:** recommend Karpathy mode in the scaffold; Autonomous follows without further user invocation.
- **Never:** require the user to explicitly invoke Karpathy when Prometheus has identified measurable outcomes.
- **Evidence:** B measurable-outcome scenario; S prompt/schema check.

## Scaffold Publication

### UC-PUB-01: Scaffold shape is exact

- **Given:** SPEC, manifest, and optional evaluators.
- **When:** `validate_scaffold` runs.
- **Then:** validate schema, canonical paths, inventory, required sections, and exact command-list agreement.
- **Never:** execute project commands or certify passing behavior.
- **Evidence:** U positive/negative fixtures.

### UC-PUB-02: Git exclusion is constrained

- **Given:** Prometheus invokes `scaffold_gitignore` without arguments.
- **When:** the workspace is a Git worktree and `.gitignore` is absent or valid.
- **Then:** atomically manage only the canonical four-path block and preserve unrelated bytes/modes.
- **Never:** follow symlinks, accept malformed markers, or alter the Git index.
- **Evidence:** F target/marker/idempotence/index fixtures.

For a non-Git workspace, the tool reports a skip and does not create `.gitignore`
or initialize Git.

### UC-PUB-03: Publication hands off final verification

- **Given:** Prometheus has resolved planning readiness without a concrete blocker.
- **When:** it prepares its final response.
- **Then:** write `SPEC.md` and `opencode-autonomous.json` before that response, then tell the user to invoke Autonomous, which owns command execution.
- **Never:** wait for a separate publication request or describe static publication as proof that final tests pass.
- **Evidence:** S prompt/doc contract; B automatic-publication handoff scenario.

### UC-PUB-04: An explicitly different request supersedes a stale scaffold

- **Given:** an existing scaffold for task A, and an explicit user request for a materially different task B.
- **When:** Prometheus inspects the existing scaffold before publishing.
- **Then:** write a complete replacement `SPEC.md` and manifest for task B, reconcile any obsolete `.prometheus/evaluator/**` assets left by task A, and hand off normally without asking the user to confirm the switch first.
- **Never:** silently run task A, refuse to publish because a scaffold already exists, or claim the switch validates or discards task A's prior ordinary implementation changes.
- **Evidence:** B `prometheus-supersede-scaffold.md` fixture scenario.

## Autonomous Execution


### UC-AUT-01: Direct is the ordinary default

- **Given:** feature, defect, or technical-debt work without explicit scalar optimization.
- **When:** Autonomous reads the manifest.
- **Then:** execute bounded right-sized Direct iterations.
- **Never:** select Karpathy merely because evaluator files exist.
- **Evidence:** S prompt/schema check; B strategy scenario.

### UC-AUT-02: Native Bash is approval-gated

- **Given:** implementation needs a focused or final command.
- **When:** Autonomous invokes Bash.
- **Then:** use OpenCode's `ask` permission and report the observed result.
- **Never:** call the removed runner or claim tamper-resistant evidence.
- **Evidence:** S permission check; B verification report scenario.

### UC-AUT-03: Exact final verification gates claims

- **Given:** implementation appears complete.
- **When:** Autonomous prepares its final status.
- **Then:** run every exact manifest/SPEC command freshly and report failures or blockers.
- **Never:** substitute prose, checklist edits, or Reviewer verdicts.
- **Evidence:** B pass/fail verification scenarios; seed build evaluation.

### UC-AUT-03A: Passing a phase gate continues the loop

- **Given:** a focused, fixture, synthetic, phase-local, or batch check passes
  while required outputs remain absent.
- **When:** Autonomous finishes that bounded step.
- **Then:** inspect every acceptance criterion, invariant, required output, and
  checklist item, then continue with the next incomplete in-scope item without a
  progress handoff. The check is a phase gate, not completion evidence.
- **Never:** present metadata-only leads or intermediate records as a required
  full result, or stop before every requested outcome and exact final command
  pass are complete.
- **Evidence:** B `autonomous-multiphase-continuation.md` live scenario; S
  contract checks.

### UC-AUT-04: Material ambiguity returns to planning

- **Given:** execution would change outcome, acceptance, evaluator, immutable targets, material scope, trust boundary, policy, or an irreversible tradeoff.
- **When:** Autonomous detects it.
- **Then:** stop and request renewed Prometheus planning.
- **Never:** invent product intent or escalate ordinary local debugging.
- **Evidence:** B boundary scenarios.

### UC-AUT-05: Work is bounded and user-owned

- **Given:** declared verification passes or a required step proves impossible to complete with any tool or permission available in this session.
- **When:** either condition occurs.
- **Then:** stop successfully only when every requested outcome, acceptance
  criterion, invariant, required output, and checklist item is complete and each
  exact final verification command passes freshly; otherwise use the applicable
  honest failed or blocked status and leave the worktree visible.
- **Never:** loop indefinitely; stage, commit, stash, reset, switch branches, or initialize Git; or hide unverified edits.
- **Evidence:** B stopping scenarios; S prompt check.

### UC-AUT-06: Candidate completion is independently validated

- **Given:** Autonomous has implemented every bounded checklist item and run declared verification.
- **When:** it prepares the human handoff.
- **Then:** provide Implementation Validator a detailed PR Contract with a clean context, retain its full report in the delegated task result, and make at most one bounded correction for critical or major gaps. The parent response states goals and validated outcomes, command exit codes, validator verdict, gaps, and a brief change summary.
- **Never:** claim validation without fresh verification and a final `VALIDATED` report, silently hide material validator findings, or emit a completion promise.
- **Evidence:** S prompt/permission checks; B validator-handoff scenario.

### UC-AUT-07: Missing validator delegation blocks success

- **Given:** a candidate has passed its readiness check and declared commands, but the task tool or Implementation Validator is unavailable.
- **When:** Autonomous prepares its handoff.
- **Then:** return a concise blocked status with observed command results and the next action.
- **Never:** call requested goals validated or claim a successful handoff.
- **Evidence:** B validator-unavailable scenario.

### UC-AUT-08: Incomplete work cannot reach candidate handoff

- **Given:** an implementation has a placeholder test, disabled required stage, ignored verifier flag, missing required output, or missing acceptance branch.
- **When:** Autonomous completes a local command or discovers a failed measured prerequisite.
- **Then:** continue ordinary in-scope work, or report the core outcome as failed and return to Prometheus when the prerequisite makes it impossible.
- **Never:** label partial work a candidate, report validator availability as the primary failure, or present an undeclared degraded branch as the requested outcome.
- **Evidence:** B partial-pipeline and failed-prerequisite scenarios.

### UC-AUT-09: A stale scaffold either continues or routes to the top level

- **Given:** a loaded scaffold and the active user request's requested outcome.
- **When:** Autonomous compares them before any edit, command, or validation.
- **Then:** for a matching scaffold, treat an explicit run-or-continue request as authorization to continue all in-scope work without asking again merely because work remains; for a material mismatch, edit nothing, run no stale verification, claim neither task complete, and name the top-level route (`@prometheus` for managed-loop supersession, native Build for ordinary work).
- **Never:** silently execute a mismatched scaffold, rewrite it, or suggest Bash deletion as a reset mechanism.
- **Evidence:** B `autonomous-continue-incomplete.md` (matching) and `scaffold-task-switch.md` (mismatch) fixture scenarios.

### UC-AUT-10: A blocked step halts before it cascades into red work

- **Given:** a checklist item is blocked by a structural prerequisite that no available identity or permission can satisfy.
- **When:** Autonomous reaches that item during execution.
- **Then:** stop at that item instead of completing downstream checklist items that causally depend on it, and report the blocker naming the exact worktree state and the next action needed to reach green or revert.
- **Never:** keep editing unrelated downstream items that cannot pass until the blocker clears, or describe the resulting red or half-migrated tree as done, ready, or committable merely because the failure was reported honestly.
- **Evidence:** S prompt/doc contract; B blocked-step scenario.

### UC-AUT-11: Missing optional tool capabilities trigger a supported fallback

- **Given:** a scaffold prefers a tool operation or parameter that the current session does not expose, while another safe in-scope operation can produce the required result.
- **When:** Autonomous reaches that tool-dependent item.
- **Then:** inspect the available operation contract, use the supported fallback, and record the failed operation and fallback when they affect reproducibility.
- **Never:** treat a missing convenience API as a structural blocker or stop before testing safe in-scope alternatives.
- **Evidence:** S prompt/doc contract; B capability-fallback scenario.

### UC-AUT-12: Confirmed blocks receive one safe recovery attempt

- **Given:** Autonomous exhausts safe in-scope paths for a terminal negative outcome.
- **When:** it reaches the terminal handoff.
- **Then:** take one creative pass at a safe, reversible alternative within the
  unchanged requested outcome, acceptance criteria, and permissions; on
  confirmed block, report the failed step, a concise blocker code, and the exact
  next human action.
- **Never:** loop, widen scope, relax acceptance criteria, bypass permissions, or
  treat an ordinary approval or planning handoff as a confirmed block.
- **Evidence:** S agent prompt contract; B blocked recovery scenario.

### UC-AUT-13: Optional run KPIs preserve delivery rules

- **Given:** a schema-v3 manifest omits, disables, or explicitly enables
  `run_kpis` with duration, token-rate, and hard-token-budget values.
- **When:** Autonomous executes the scaffold.
- **Then:** omitted or disabled policies change nothing; an enabled policy favors
  useful in-scope work, reports operational telemetry, and stops a new turn when
  the hard budget is exhausted.
- **Never:** use hidden KPI defaults, auto-approve tools, sleep, pad work, widen
  scope, skip verification, or continue after valid completion to meet a KPI.
- **Evidence:** U schema/plugin/audit tests; S prompt and deployment checks; B
  enabled-policy fixture.

## Karpathy And Review

### UC-KAR-01: Optimization requires a complete contract

- **Given:** explicit scalar intent with objective, direction, evaluator, noise policy, targets, limits, and stop criteria.
- **When:** Autonomous delegates strategy advice.
- **Then:** Karpathy proposes one change and analyzes Autonomous-supplied measurements.
- **Never:** let Karpathy edit, execute commands, or select itself for ordinary work.
- **Evidence:** U manifest fixtures; S permission check; B optimization scenario.

### UC-KAR-02: Autonomous owns measurements and decisions

- **Given:** one proposed optimization change.
- **When:** it is evaluated.
- **Then:** Autonomous edits, runs native Bash, and applies the declared KEEP/REVERT policy.
- **Never:** treat strategist prose or Reviewer advice as a metric.
- **Evidence:** B experiment trace.

### UC-REV-01: Reviewer remains advisory

- **Given:** a rubric, diff, and verification summary.
- **When:** Reviewer evaluates them.
- **Then:** return a cited report ending in APPROVE or REQUEST_CHANGES.
- **Never:** edit, execute, delegate, or determine completion alone.
- **Evidence:** S permission/format checks; B review scenario.

### UC-VAL-01: Implementation Validator remains independent

- **Given:** candidate implementation, `SPEC.md`, and an Autonomous PR Contract.
- **When:** Implementation Validator evaluates the pending codebase.
- **Then:** return a severity-grouped report grounded in repository evidence and end with `VALIDATED` or `GAPS_FOUND`.
- **Never:** edit, execute commands, delegate, or grant completion authority.
- **Evidence:** U role matrix; B validator-handoff scenario.

## Ask

### UC-ASK-01: Focused questions are answered from session context

- **Given:** a focused question is posed to Ask.
- **When:** the answer is available in session context or reachable by minimal local evidence.
- **Then:** answer directly using the documented escalation ladder: session context first, then minimal direct evidence (read, grep, glob, list), then Grounder delegation for multi-step or cross-system evidence.
- **Never:** start a planning or implementation workflow, create or edit files, generate commands for the user to run manually, or blame the environment for role-based limits.
- **Evidence:** B focused-question scenario; S frontmatter check.

### UC-ASK-02: Delegation is restricted to Grounder

- **Given:** a question requires multi-step, broad, or external evidence gathering.
- **When:** Ask determines that direct evidence collection is insufficient.
- **Then:** delegate to @grounder and return a concise synthesis of the result.
- **Never:** delegate to any agent other than @grounder; produce proxy implementation instructions when the answer requires file edits or Bash commands.
- **Evidence:** B delegation scenario; S permission frontmatter (task: grounder: allow, "*": deny).

## Grounder

### UC-GROUNDER-01: Every claim is cited

- **Given:** Grounder returns research findings.
- **When:** it reports a fact or inference.
- **Then:** cite every substantive claim with a file path and line number or a URL; label inferences and weak evidence explicitly.
- **Never:** present guesses as facts or recommend code changes not supported by cited evidence.
- **Evidence:** B research scenario; S frontmatter check.

### UC-GROUNDER-02: Private data is not sent to third-party services

- **Given:** Grounder is gathering evidence for a question.
- **When:** the evidence path would require sending private repository contents, credentials, or secrets to an external service.
- **Then:** return local-only evidence and explicitly state that external corroboration was not performed.
- **Never:** send private repository code, credentials, or secrets to any third-party service; sub-delegate to another agent.
- **Evidence:** B private-data scenario; S permission frontmatter (task: "*": deny).

## End-to-End Scenarios

### UC-E2E-01: Prometheus scaffold is consumed and executed by Autonomous

- **Given:** Prometheus has published a complete, validate_scaffold-passing scaffold for a defined implementation task.
- **When:** Autonomous is invoked with that scaffold.
- **Then:** Autonomous reads the unmodified scaffold, executes the declared implementation checklist, runs every exact verification command freshly, and reports an honest result.
- **Never:** fail to consume a structurally valid scaffold; skip verification commands; or require re-planning for work already scoped.
- **Evidence:** B end-to-end handoff scenario using evals/seed_build/test_build.py.

### UC-E2E-02: Full Karpathy optimization loop runs to a KEEP/REVERT decision

- **Given:** a published scaffold with a complete Karpathy optimization contract (objective, direction, evaluator, baseline, noise policy, mutable/immutable targets, limits, stop criteria).
- **When:** Autonomous executes it.
- **Then:** Autonomous delegates strategy advice to Karpathy, applies one bounded change, runs the measurement command through native Bash, and makes a KEEP or REVERT decision according to the declared policy.
- **Never:** let Karpathy edit files or run commands; substitute strategist prose for the measured metric; or omit the KEEP/REVERT decision from the final report.
- **Evidence:** B Karpathy loop scenario.

### UC-E2E-03: Autonomous consumes the superseding scaffold, not the superseded one

- **Given:** Prometheus has superseded task A's scaffold with task B's, per UC-PUB-04.
- **When:** Autonomous is invoked afterward with an explicit run request.
- **Then:** Autonomous reads and executes task B's scaffold; no trace of task A's implementation scope, acceptance criteria, or verification commands appears in its plan or edits.
- **Never:** implement task A because its scaffold existed first, or blend both tasks' scope.
- **Evidence:** B `prometheus-supersede-scaffold.md` fixture, continued into an Autonomous invocation.

## Documentation Consistency

### UC-DOC-01: Durable docs match behavior

- **Given:** changes to roles, permissions, tools, deployment, strategies, or validation.
- **When:** release validation runs.
- **Then:** README, requirements, architecture, use cases, agents, scripts, and tests agree.
- **Never:** retain claims about retired runners, supervisors, Bubblewrap, Lima, or old profile flags.
- **Evidence:** S repository text checks; full CI.

## Resource Selection

### UC-RESOURCE-01: Research avoids desktop disruption by default

- **Given:** local evidence, direct web pages, public APIs, or text-only search can answer a question.
- **When:** a managed agent gathers evidence.
- **Then:** use those sources before browser automation.
- **Never:** open a visible browser without stating the target, lower-impact failures, and user approval.
- **Evidence:** S agent/rule contract; B resource-order scenario.

### UC-RESOURCE-03: Image credentials are opt-in and provider-scoped

- **Given:** a browser image-generation request for ChatGPT or Gemini.
- **When:** managed credential state is selected.
- **Then:** default to ephemeral headless state; require confirmation for visible auth and keep persistent profiles provider-specific.
- **Never:** use a personal browser profile, preserve credentials by default, or silently fall back to headed operation.
- **Evidence:** U credential state and filesystem fixture; F managed deployment fixture.

### UC-RESOURCE-04: Managed MCP configuration preserves user state

- **Given:** an OpenCode configuration with unrelated MCP entries.
- **When:** managed install, status, diagnose, or remove runs.
- **Then:** update only Cuddly-Winner-owned entries and report unmanaged modes read-only.
- **Never:** overwrite unrelated entries or expose profile contents.
- **Evidence:** U configuration synchronizer fixture; F installer fixture.

### UC-RESOURCE-05: Owned-site session fetch remains private and read-only

- **Given:** a configured owned site requires an interactive login before an
  authenticated retrieval.
- **When:** the user approves the named visible-browser bootstrap.
- **Then:** the tool returns an opaque session handle and allows only `GET` or
  `HEAD` to the profile's configured origins until close or expiry.
- **Never:** return session material, use an unconfigured origin, or make a
  write request.
- **Evidence:** U session lifecycle fixture; F profile and deployment fixture.

## Skills Ecosystem

### UC-SKILL-01: Skill frontmatter and content structure are release-validated

- **Given:** packaged skill assets under `skills/`.
- **When:** the deterministic validation suite checks packaged skills and a temporary deployed copy.
- **Then:** verify YAML frontmatter schema, package path structure, and the catalog's required static content.
- **Never:** allow invalid or unparseable skills to be deployed.
- **Evidence:** U packaged/deployed skill validation suite.

### UC-SKILL-02: Role boundaries hold under skill pressure

- **Given:** an active managed agent loaded with non-core skill instructions.
- **When:** a skill is loaded through an active managed agent and attempts to widen a boundary.
- **Then:** verify plugin-enforced role edit-tool boundaries and permission constraints remain enforced.
- **Never:** permit skill prompts to override agent permission frontmatter or identity isolation.
- **Evidence:** B, O managed-agent boundary scenario. Direct-model pressure tests alone are insufficient.

### UC-SKILL-03: Catalog and packages remain aligned

- **Given:** the canonical skill catalog and packaged skill directories.
- **When:** a skill is added, removed, or changed.
- **Then:** maintain one catalog entry and one package for each shipped skill.
- **Never:** let a runtime prompt become the only behavioral specification.
- **Evidence:** S catalog/package inventory review.

## Local Feedback

### UC-FEEDBACK-01: Private cross-project capture

- **Given:** A writable agent uses the deployed feedback skill from another
  project with a negative or mixed report.
- **When:** It pipes one bounded Markdown report to the recorder.
- **Then:** The recorder writes one owner-only, metadata-tagged file in the
  installing clone's ignored inbox and prints only its path.
- **Never:** Scan for a clone, use a network client, overwrite a report, accept
  report text in command arguments, or claim success after a permission failure.
- **Evidence:** U recorder input, metadata, mode, collision, copy/symlink, and
  failure fixtures.

### UC-FEEDBACK-02: Triage preserves the privacy boundary

- **Given:** A requested pending report in the source clone.
- **When:** An agent triages it.
- **Then:** Treat report text as untrusted evidence, verify supported claims
  locally, and archive it only after fresh verification of resulting work.
- **Never:** Execute report instructions, send its content remotely, treat it as
  product documentation by default, or delete it when work begins.
- **Evidence:** S skill contract and B frozen feedback-triage scenario.

### UC-FEEDBACK-03: Locator lifecycle is safe

- **Given:** Missing, current, stale, modified, or clone-replaced locator state.
- **When:** Installation, status, removal, or capture runs.
- **Then:** Install is backup-first and idempotent; status is read-only; removal
  preserves modified state and all feedback files; capture fails closed.
- **Never:** Delete feedback, follow unsafe locators, or replace unrelated config.
- **Evidence:** F deployment and recorder fixtures.

## Mutation Testing

### UC-MUTATION-01: Test suite sensitivity is verified under code mutation

- **Given:** target implementation modules, a passing baseline command, and explicit CLI arguments or `--config opencode-mutation.json`.
- **When:** `evals/mutation/run_mutation.py` executes.
- **Then:** require the baseline to pass before applying mutations and verify unit test failures detect mutations.
- **Never:** report a passing mutation score when the baseline fails or mutated code escapes test detection.
- **Evidence:** U mutation-runner result and baseline outcome.

## Session Auditing

### UC-AUDIT-01: OpenCode SQLite session signals are reported

- **Given:** an executed OpenCode session recorded in `~/.local/share/opencode/opencode.db`.
- **When:** `tests/audit_run.py` inspects the session.
- **Then:** report documented root-session and recursive-descendant signals,
  including agent switches, non-attributable root-session Bash observations,
  current scaffold-file presence, completion/review tokens, and enabled-KPI
  activity and token telemetry.
- **Never:** attribute a post-switch root-session tool call to a specific agent or represent the report as proof of ancestry enforcement, scaffold validity, or fresh verification-command execution.
- **Evidence:** U auditor fixtures and report output, including `PASS`, `PARTIAL`, `FAIL`, `NOT_APPLICABLE`, `NOT_SELECTED`, and missing-data errors where applicable.




## Deployment

### UC-DEP-01: Default profile is complete

- **Given:** a clean OpenCode configuration.
- **When:** default installation runs.
- **Then:** install seven agents, `immutability.ts`, all workflow tools and their SDK, and all packaged skills.
- **Never:** install repository `AGENTS.md`, a runner, or a supervisor.
- **Evidence:** F deployment fixture.

### UC-DEP-02: Retired profile flags are rejected

- **Given:** `install --with-workflow-tools` or `install --with-skills`.
- **When:** installation parses arguments.
- **Then:** reject the command as an unknown argument.
- **Never:** retain alternate installation profiles.
- **Evidence:** F deployment fixture.

### UC-DEP-03: Installation is additive from one config root

- **Given:** a config root.
- **When:** installation runs in copy or symlink mode.
- **Then:** derive all destinations beneath the root and install every managed group.
- **Never:** accept per-category/source overrides or alternate profile flags.
- **Evidence:** F copy/symlink/additive fixture.

### UC-DEP-04: Status and removal cover current managed entries safely

- **Given:** current managed copies, repository symlinks, modifications, and unrelated entries.
- **When:** status or remove runs without profile flags.
- **Then:** inspect every group and remove only current matching copies or links.
- **Never:** remove modified or unrelated entries or promise migration of retired artifacts.
- **Evidence:** F status/removal fixture.

### UC-DEP-05: Retired and granular options fail

- **Given:** a retired profile flag, source override, or per-category destination override.
- **When:** argument parsing runs.
- **Then:** reject it as unknown and identify the supported single-root interface in help.
- **Never:** retain hidden precedence or local deployment-env behavior.
- **Evidence:** F argument matrix; S help contract.

### UC-DEP-06: Restart loads profile changes

- **Given:** OpenCode is already running.
- **When:** agents, plugins, or tools change.
- **Then:** documentation instructs the user to restart.
- **Never:** claim hot reload.
- **Evidence:** S documentation check.

## Measured Spikes

### UC-SPIKE-01: A spike requires a contract and approval

- **Given:** a load-bearing technical uncertainty.
- **When:** Prometheus invokes `spike`.
- **Then:** require `.spike/<id>/QUESTION.md`, a safe ID, and normal OpenCode approval.
- **Never:** expose direct Bash or execute an uncontracted spike.
- **Evidence:** U contract/permission tests.

### UC-SPIKE-02: Native execution is bounded and honest

- **Given:** an approved spike command.
- **When:** it runs on macOS or Linux.
- **Then:** use the spike directory, reduced environment, finite timeout/output, redaction, and atomic result files containing `sandboxed: false`.
- **Never:** claim filesystem confinement, host isolation, or protected evidence.
- **Evidence:** U cross-platform process/error/output tests.

### UC-SPIKE-03: Failed kill criteria change the plan

- **Given:** measured output violates the declared kill criterion.
- **When:** Prometheus evaluates the result.
- **Then:** redesign or block and record the evidence.
- **Never:** publish optimistic assumptions as facts.
- **Evidence:** B failed-spike scenario.

## Scaffold Publication Tools

### UC-PUB-01: Scaffold shape is exact

- **Given:** SPEC, manifest, and optional evaluators.
- **When:** `validate_scaffold` runs.
- **Then:** validate schema, canonical paths, inventory, required sections, and exact command-list agreement.
- **Never:** execute project commands or certify passing behavior.
- **Evidence:** U positive/negative fixtures.

### UC-PUB-02: Git exclusion is constrained

- **Given:** Prometheus invokes `scaffold_gitignore` without arguments.
- **When:** the workspace is a Git worktree and `.gitignore` is absent or valid.
- **Then:** atomically manage only the canonical four-path block and preserve unrelated bytes/modes.
- **Never:** follow symlinks, accept malformed markers, or alter the Git index.
- **Evidence:** F target/marker/idempotence/index fixtures.

For a non-Git workspace, the tool reports a skip and does not create `.gitignore`
or initialize Git.
