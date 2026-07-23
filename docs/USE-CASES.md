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
- **When:** Autonomous or Prometheus requests Bash.
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
- **When:** `.gitignore` is absent or valid.
- **Then:** atomically manage only the canonical four-path block and preserve unrelated bytes/modes.
- **Never:** follow symlinks, accept malformed markers, or alter the Git index.
- **Evidence:** F target/marker/idempotence/index fixtures.

### UC-PUB-03: Publication hands off final verification

- **Given:** static scaffold validation succeeds.
- **When:** Prometheus completes handoff.
- **Then:** tell the user to invoke Autonomous, which owns command execution.
- **Never:** describe static publication as proof that final tests pass.
- **Evidence:** S prompt/doc contract; B handoff scenario.

## Autonomous Execution


### UC-AUT-01: Ralph is the ordinary default

- **Given:** feature, defect, or technical-debt work without explicit scalar optimization.
- **When:** Autonomous reads the manifest.
- **Then:** execute bounded right-sized Ralph iterations.
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

### UC-AUT-04: Material ambiguity returns to planning

- **Given:** execution would change outcome, acceptance, evaluator, immutable targets, material scope, trust boundary, policy, or an irreversible tradeoff.
- **When:** Autonomous detects it.
- **Then:** stop and request renewed Prometheus planning.
- **Never:** invent product intent or escalate ordinary local debugging.
- **Evidence:** B boundary scenarios.

### UC-AUT-05: Work is bounded and user-owned

- **Given:** success, repeated no progress, exhausted limits, or a blocker.
- **When:** a stopping condition occurs.
- **Then:** stop with an honest status and leave the worktree visible.
- **Never:** loop indefinitely, auto-commit, or hide unverified edits.
- **Evidence:** B stopping scenarios; S prompt check.

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

## Documentation Consistency

### UC-DOC-01: Durable docs match behavior

- **Given:** changes to roles, permissions, tools, deployment, strategies, or validation.
- **When:** release validation runs.
- **Then:** README, requirements, architecture, use cases, agents, scripts, and tests agree.
- **Never:** retain claims about retired runners, supervisors, Bubblewrap, Lima, or old profile flags.
- **Evidence:** S repository text checks; full CI.

## Skills Ecosystem

### UC-SKILL-01: Skill frontmatter and content structure are release-validated

- **Given:** packaged skill assets under `skills/`.
- **When:** a validation suite targets the packaged and deployed skill source.
- **Then:** verify YAML frontmatter schema, required instruction sections, and path structure.
- **Never:** allow invalid or unparseable skills to be deployed.
- **Evidence:** U validation suite whose source path is recorded. The current legacy-path script is not this evidence.

### UC-SKILL-02: Role boundaries hold under skill pressure

- **Given:** an active managed agent loaded with non-core skill instructions.
- **When:** a skill is loaded through an active managed agent and attempts to widen a boundary.
- **Then:** verify plugin-enforced role edit-tool boundaries and permission constraints remain enforced.
- **Never:** permit skill prompts to override agent permission frontmatter or identity isolation.
- **Evidence:** B, O managed-agent boundary scenario. Direct-model pressure tests alone are insufficient.

## Mutation Testing

### UC-MUTATION-01: Test suite sensitivity is verified under code mutation

- **Given:** target implementation modules and explicit runner CLI arguments.
- **When:** `evals/mutation/run_mutation.py` executes using the supplied source files, threshold, result path, and test command.
- **Then:** apply mutations to target modules and verify unit test failures detect mutations.
- **Never:** report a passing mutation score if mutated code escapes test detection.
- **Evidence:** U mutation-runner result. `opencode-mutation.json` is policy/example data and is not read by the runner.

## Session Auditing

### UC-AUDIT-01: OpenCode SQLite session signals are reported

- **Given:** an executed OpenCode session recorded in `~/.local/share/opencode/opencode.db`.
- **When:** `tests/audit_run.py` inspects the session.
- **Then:** report documented root-session and direct-child signals, including agent switches, root-session Bash use, current scaffold-file presence, and completion/review tokens.
- **Never:** represent the report as proof of ancestry enforcement, scaffold validity, or fresh verification-command execution.
- **Evidence:** U auditor fixtures and report output, including `PASS`, `PARTIAL`, `FAIL`, `NOT_APPLICABLE`, `NOT_SELECTED`, and missing-data errors where applicable.




## Deferred Infrastructure

The following use cases cover the optional governance layer (deployment lifecycle,
spike tool, and scaffold validation tools). They are deferred pending validation
of core agent behavior; see `docs/REQUIREMENTS.md` for context.

## Deployment

### UC-DEP-01: Default profile is lightweight

- **Given:** a clean OpenCode configuration.
- **When:** default installation runs.
- **Then:** install six agents and `immutability.ts` only.
- **Never:** install tools, SDK dependencies, repository `AGENTS.md`, a runner, or a supervisor.
- **Evidence:** F deployment fixture.

### UC-DEP-02: Workflow tools are opt-in

- **Given:** `install --with-workflow-tools`.
- **When:** installation completes.
- **Then:** install `spike`, `validate_scaffold`, `scaffold_gitignore`, and the pinned tool SDK.
- **Never:** install Bubblewrap, Lima, a VM, a runner, or a supervisor.
- **Evidence:** F deployment fixture and import smoke test.

### UC-DEP-03: Installation is additive from one config root

- **Given:** a config root and any optional install flags.
- **When:** installation runs in copy or symlink mode.
- **Then:** derive all destinations beneath the root and add requested groups without removing omitted optional groups.
- **Never:** accept per-category/source overrides or treat omitted flags as uninstall requests.
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
- **When:** `.gitignore` is absent or valid.
- **Then:** atomically manage only the canonical four-path block and preserve unrelated bytes/modes.
- **Never:** follow symlinks, accept malformed markers, or alter the Git index.
- **Evidence:** F target/marker/idempotence/index fixtures.
