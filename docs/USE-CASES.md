# Regression Use Cases

## Authority And Use

This document is the regression catalog derived from `README.md`,
`docs/REQUIREMENTS.md` (REQ), and `docs/ARCHITECTURE.md` (ARCH). Those documents
remain authoritative if this catalog conflicts with them. A use case is complete
only when its stated evidence is produced by the named test layer; worker prose,
checklist edits, and reviewer verdicts are never substitute evidence.

Use the stable IDs in test names, fixtures, release reports, and traceability.
The canonical ID form includes the `UC-` prefix (for example `UC-CAN-01`), and
that same form is used in the Release Traceability Matrix and every
cross-reference. The current implementation and tests are not behavioral
authority and must not be used to weaken these scenarios.

`Source` lines cite the authoritative documents by section heading rather than
by line number, so ordinary edits to those documents do not silently invalidate
the citations. Cite the nearest enclosing section (and subsection where it
helps); a documentation-consistency audit resolves each cited heading.

Test layers:

- **S**: static contract/documentation test
- **U**: pure validator, reducer, or policy unit test
- **F**: filesystem, Git, or deployment component test in a disposable worktree
- **L**: Linux protected-runner integration test with Bubblewrap
- **C**: deterministic coordinator simulation with scripted workers
- **B**: behavioral agent evaluation with a frozen repository and rubric
- **O**: authenticated live OpenCode release smoke test

## Contract Gaps

The following cases are mandatory but cannot assert numeric values or detailed
formats until their durable contract is defined in `docs/`:

| Gap | Affected cases | Required durable decision |
| --- | --- | --- |
| Manifest schema | UC-PUB-01 to UC-PUB-05, UC-AUT-02, UC-KAR-01 | version, fields, enums, errors, migration |
| Resource limits | UC-RUN-03, UC-RAL-08, UC-KAR-05 | defaults, units, owner, and override rules |
| Evidence threat model | UC-RUN-02 to UC-RUN-04 | protected paths, tampering guarantees, redaction policy |
| Platform support | UC-DEP-06, UC-RUN-01 | supported Linux/Bubblewrap contract and unavailable behavior |
| Restart/recovery | UC-RAL-07, UC-KAR-05 | same-machine restart and stale-run rules |
| External research policy | UC-ID-09 | citation, privacy, credential, and offline behavior |
| Release evidence | UC-DOC-02 | fixtures, platforms, and pass thresholds |

Ralph-versus-Karpathy strategy selection is no longer an open gap: REQ resolves
it. A scaffold that does not declare scalar-optimization intent runs Ralph; a
scaffold that declares that intent with an incomplete or invalid Karpathy
contract blocks rather than falling back to Ralph (see UC-AUT-04, UC-KAR-01).

## Native Compatibility

### UC-CAN-01: Durable authority wins

- **Actors:** maintainer, release validation.
- **Given:** implementation or generated scaffold diverges from durable docs.
- **When:** a change is reviewed or released.
- **Then:** correct implementation or update durable docs in the same change.
- **Never:** treat `SPEC.md` or a generated scaffold as durable authority.
- **Evidence:** S documentation-consistency audit.
- **Source:** README intro; REQ § Document Roles.

### UC-CAN-02: Native Plan bypasses every managed boundary

- **Given:** any installation profile, no scaffold, and no Autonomous state.
- **When:** native `plan` invokes a tool or reaches an idle/error lifecycle event.
- **Then:** its original prompt, routing, permissions, tools, Bash access,
  mutation and completion behavior remain intact; no coordinator state exists.
- **Never:** inspect Plan command/path requests, demand a scaffold, route to
  Prometheus, or initialize runner/supervisor state.
- **Evidence:** U early-bypass test; O installed-runtime control test.
- **Source:** README § Native Plan And Build; REQ § Native Compatibility
  Invariant, § Autonomous Profile; ARCH § Boundary, § Identity Enforcement,
  § Autonomous Flow.

### UC-CAN-03: Native Build bypasses every managed boundary

- **Given:** any profile, including a host without the Autonomous runner.
- **When:** native `build` mutates files or executes Bash.
- **Then:** its native behavior remains intact without a SPEC, manifest, or
  trusted evidence artifact.
- **Never:** replace Bash with the runner, route work to Autonomous, or reduce
  Build because the optional profile is unavailable.
- **Evidence:** U early-bypass test; O installed-runtime control test.
- **Source:** README § Native Plan And Build, § Optional Autonomous Profile;
  REQ § Native Compatibility Invariant, § Autonomous Profile; ARCH § Boundary.

### UC-CAN-04: Unmanaged identities bypass immediately

- **Given:** an unknown, future built-in, or third-party identity.
- **When:** the immutability hook receives a request.
- **Then:** it returns before parsing a project marker, policy file, command, or
  mutation path.
- **Never:** apply managed defaults to an unresolved identity.
- **Evidence:** U mocked inspection sentinel; O third-party control test.
- **Source:** REQ § Native Compatibility Invariant, § Managed Agents > Identity
  Resolution; ARCH § Identity Enforcement.

### UC-CAN-05: Managed workflows are explicit

- **Given:** specialist agents are installed.
- **When:** a user performs ordinary planning or implementation without selecting
  a managed agent.
- **Then:** native Plan/Build remain the workflow.
- **Never:** auto-start a managed workflow or require a six-agent sequence.
- **Evidence:** S routing audit; O native control test.
- **Source:** README § Optional Agents; REQ § Managed Agents, § Validation.

## Deployment And Profiles

### UC-DEP-01: Default copy-mode installation

- **Given:** a valid OpenCode configuration destination.
- **When:** `install` runs with no optional flags.
- **Then:** install six agent definitions and the identity hook only.
- **Never:** install supervisor, runner, publication tool, non-core skills, or
  repository `AGENTS.md`.
- **Evidence:** F isolated-global-config snapshot.
- **Source:** README § Install Specialist Agents; REQ § Deployment;
  ARCH § Deployment.

### UC-DEP-02: Autonomous profile installation

- **Given:** default install inputs.
- **When:** `install --with-autonomous` runs.
- **Then:** add supervisor, protected runner, and `scaffold_gitignore` tool.
- **Never:** make these default-profile components or native prerequisites.
- **Evidence:** F profile inventory and downgrade test.
- **Source:** README § Install Specialist Agents, § Optional Autonomous Profile;
  REQ § Deployment; ARCH § Deployment.

### UC-DEP-03: Skills profile installation

- **Given:** optional skills are available.
- **When:** `install --with-skills` runs, alone or with Autonomous.
- **Then:** add optional skills without omitting other selected profile content.
- **Never:** install optional skills by default.
- **Evidence:** F profile matrix.
- **Source:** README § Install Specialist Agents; REQ § Deployment;
  ARCH § Deployment.

### UC-DEP-04: Reconciliation preserves unrelated configuration

- **Given:** old managed entries plus unrelated user-owned configuration.
- **When:** any install, downgrade, uninstall, or status reconciliation runs.
- **Then:** remove obsolete managed entries, report all managed targets, and
  preserve unrelated files and links.
- **Never:** leave stale managed copies active or delete user configuration.
- **Evidence:** F upgrade/downgrade/idempotence matrix.
- **Source:** README § Install Specialist Agents; REQ § Deployment, § Validation;
  ARCH § Deployment.

### UC-DEP-05: Restart is required after profile change

- **Given:** OpenCode is already running.
- **When:** installation profile changes.
- **Then:** documentation and status communicate that restart loads the change.
- **Never:** claim the running process automatically reloaded it.
- **Evidence:** S installer/documentation contract test.
- **Source:** README § Install Specialist Agents.

### UC-DEP-06: Unsupported platforms degrade only optional execution

- **Given:** Bubblewrap or supported Linux capabilities are unavailable.
- **When:** native agents or non-runner specialists are used.
- **Then:** they remain available; only protected Autonomous execution is
  unavailable with a concrete reason.
- **Never:** reduce native Plan/Build functionality.
- **Evidence:** U platform gate; F deployment profile test.
- **Source:** README § Optional Autonomous Profile; REQ § Autonomous Profile.

### UC-DEP-07: Managed agents fail closed without their profile

- **Given:** the default profile installed Prometheus and Autonomous but not the
  supervisor, protected runner, or `scaffold_gitignore` tool.
- **When:** Prometheus attempts to publish, or Autonomous is invoked to execute.
- **Then:** each reports that `--with-autonomous` is required. Prometheus may
  still triage, interview, research, and draft, but cannot validate an evaluator,
  invoke the exclusion tool, or write the publication marker; Autonomous does not
  initialize run-coordinator state or edit files unsupervised.
- **Never:** degrade silently, edit without protected evidence, or reduce native
  Plan/Build behavior.
- **Evidence:** F profile-mismatch fixture; S installer/documentation contract.
- **Source:** README § Optional Autonomous Profile; REQ § Deployment;
  ARCH § Deployment.

## Identity, Permissions, And Delegation

### UC-ID-01: Topmost managed ancestor governs descendants

- **Given:** a direct, nested, or multi-level delegated session with a managed
  topmost ancestor.
- **When:** the child requests a tool.
- **Then:** apply the originating managed identity's fixed boundary.
- **Never:** permit identity spoofing or escape through delegation.
- **Evidence:** U ancestry matrix including missing/cyclic metadata and spoofing.
- **Source:** README § Managed-Agent Immutability; REQ § Managed Agents,
  § Managed Agents > Identity Resolution; ARCH § Identity Enforcement.

### UC-ID-02: Ask remains focused and read-only

- **Given:** a focused user question with sufficient session context.
- **When:** Ask responds.
- **Then:** answer without file mutation, command execution, planning, or
  implementation workflow.
- **Never:** prescribe manual edits to evade its boundary.
- **Evidence:** S permission parse; B focused-question rubric.
- **Source:** REQ § Managed Agents > Ask.

### UC-ID-03: Ask delegates only necessary research

- **Given:** session context cannot answer the focused question.
- **When:** Ask escalates.
- **Then:** delegate only to Grounder and only as far as evidence requires.
- **Never:** delegate to a planner, editor, or unrestricted workflow.
- **Evidence:** U allowlist; B escalation scenario.
- **Source:** REQ § Managed Agents > Ask.

### UC-ID-04: Prometheus is scaffold-only

- **Given:** Prometheus attempts a mutation or execution.
- **When:** the hook evaluates it.
- **Then:** permit only fixed planning/scaffold paths and the constrained
  exclusion tool; deny direct shell and production-file writes.
- **Never:** allow arbitrary `.gitignore` mutation.
- **Evidence:** U path/tool matrix; F active-run lock test.
- **Source:** REQ § Managed Agents > Prometheus; ARCH § Identity Enforcement,
  § Prometheus Flow.

### UC-ID-05: Autonomous is the sole managed editor

- **Given:** a validated active worktree.
- **When:** Autonomous mutates ordinary project files.
- **Then:** allow only worktree changes consistent with fixed permissions and
  `implementation_scope`.
- **Never:** allow published scaffold, coordinator, evidence, progress,
  quarantine, or external-worktree mutation.
- **Evidence:** U canonical-path matrix; C scope-diff simulation.
- **Source:** REQ § Managed Agents > Autonomous, § Autonomous Profile >
  Implementation Discretion; ARCH § Identity Enforcement.

### UC-ID-06: Autonomous delegates only advisory roles

- **Given:** supervised implementation needs research, review, or optimization
  advice.
- **When:** Autonomous delegates.
- **Then:** allow Grounder, Reviewer, and Karpathy only.
- **Never:** delegate implementation to native Build.
- **Evidence:** S frontmatter contract; U allowlist matrix.
- **Source:** REQ § Managed Agents > Autonomous, § Autonomous Profile.

### UC-ID-07: Karpathy is read-only even under Autonomous ancestry

- **Given:** Autonomous delegates Karpathy in a valid Karpathy run.
- **When:** a proposal or measurement is requested.
- **Then:** Karpathy proposes only; its mutation tools remain denied while
  protected measurement runs under inherited Autonomous identity.
- **Never:** let Karpathy edit, shell directly, or own implementation.
- **Evidence:** U tool/ancestry intersection; C experiment simulation.
- **Source:** REQ § Managed Agents > Karpathy, § Autonomous Profile > Karpathy:
  Scalar-Metric Optimization, § Karpathy Strategy Agent.

### UC-ID-08: Reviewer is advisory only

- **Given:** a review rubric and candidate change.
- **When:** Reviewer responds.
- **Then:** emit structured advice ending in `APPROVE` or `REQUEST_CHANGES`.
- **Never:** execute, mutate, delegate, or affect completion eligibility.
- **Evidence:** S permission parse; C verdict-ignored transition test.
- **Source:** REQ § Managed Agents > Reviewer, § Autonomous Profile.

### UC-ID-09: Grounder returns cited facts, not decisions

- **Given:** a local or external evidence request.
- **When:** Grounder researches.
- **Then:** return cited facts and conflicts using read-only facilities.
- **Never:** mutate, execute commands, delegate, or make product decisions.
- **Evidence:** S permission parse; B evidence/conflict rubric.
- **Source:** REQ § Managed Agents > Grounder.

### UC-ID-10: Read-only delegates can overlap

- **Given:** independent Grounder and Reviewer work.
- **When:** the coordinator runs them concurrently.
- **Then:** concurrent read-only work is permitted.
- **Never:** permit concurrent mutation or direct run-state writes.
- **Evidence:** C concurrent-delegate simulation.
- **Source:** ARCH § Complexity Boundary.

## Prometheus Triage And Readiness

### UC-PRO-01: Outcome is separated from requested solution

- **Given:** a request includes a preferred implementation or diagnosis.
- **When:** Prometheus starts triage.
- **Then:** identify the independent outcome and classify the request.
- **Never:** adopt the requested approach as fact.
- **Evidence:** B predetermined-solution scenario.
- **Source:** REQ § Prometheus Profile > Persona, > Triage Ladder; § Validation.

### UC-PRO-02: Defect symptoms precede root-cause acceptance

- **Given:** a defect report claims a root cause.
- **When:** current behavior is established.
- **Then:** distinguish symptom from cause and inspect sibling paths.
- **Never:** accept an unsupported diagnosis; accept a correct one when evidence
  supports it.
- **Evidence:** B false- and true-diagnosis repository scenarios.
- **Source:** REQ § Prometheus Profile > Triage Ladder; § Validation.

### UC-PRO-03: Credible smaller alternatives are surfaced

- **Given:** configuration, documentation, reuse, existing capability, narrower
  correction, or no-build can meet the outcome.
- **When:** approaches are compared.
- **Then:** recommend the smallest sufficient credible option with consequences.
- **Never:** assume a new build is required or invent alternatives as ceremony.
- **Evidence:** B reuse/configuration/no-build scenarios.
- **Source:** REQ § Prometheus Profile > Triage Ladder; § Validation.

### UC-PRO-04: Material ambiguity gets a focused question

- **Given:** an unknown could change scope, architecture, safety, policy, or
  acceptance criteria.
- **When:** Prometheus detects it.
- **Then:** ask one decision-changing question or a coherent small batch early.
- **Never:** publish with the ambiguity unresolved or issue a generic survey.
- **Evidence:** B ambiguous-policy scenario.
- **Source:** REQ § Prometheus Profile > Triage Ladder, > Interview Discipline;
  § Validation; ARCH § Prometheus Flow.

### UC-PRO-05: Clear work avoids manufactured interviews

- **Given:** outcome, policy, scope, and success criteria are clear.
- **When:** planning begins.
- **Then:** proceed without unnecessary questions.
- **Never:** keep interviewing after questions become investigable facts.
- **Evidence:** B clear-request scenario.
- **Source:** REQ § Prometheus Profile > Interview Discipline; § Validation.

### UC-PRO-06: Technical unknowns are researched

- **Given:** an unknown is discoverable through the repository, Grounder, or a
  bounded measurement.
- **When:** Prometheus resolves it.
- **Then:** gather evidence instead of asking the product owner to decide a
  technical fact.
- **Never:** use direct shell or unbounded production mutation for a spike.
- **Evidence:** B repository-fact scenario; L contracted-spike test.
- **Source:** REQ § Prometheus Profile > Triage Ladder, > Interview Discipline;
  ARCH § Prometheus Flow, § Git Exclusion Tool.

### UC-PRO-07: Informed non-safety overrides are respected

- **Given:** Prometheus presents evidence, consequence, and a sufficient
  alternative; the issue is not a readiness veto.
- **When:** the user chooses the original approach.
- **Then:** record and honor the informed override.
- **Never:** silently reshape it or reopen settled debate.
- **Evidence:** B override scenario.
- **Source:** REQ § Prometheus Profile > Triage Ladder, > Disagreement Authority;
  § Validation.

### UC-PRO-08: Unsafe or unverifiable work cannot publish

- **Given:** a scaffold is impossible, unsafe, destructively unauthorized,
  unboundedly lossy, inconsistent, contrary to durable requirements, or
  unverifiable.
- **When:** publication is requested, even with user insistence.
- **Then:** refuse as a readiness failure.
- **Never:** convert insistence into a valid scaffold.
- **Evidence:** B veto matrix; F publication denial.
- **Source:** REQ § Prometheus Profile > Disagreement Authority; § Validation.

### UC-PRO-09: Execution material changes return to planning

- **Given:** execution finds decision-changing ambiguity.
- **When:** continuing would alter product intent or material scaffold content.
- **Then:** record a planning blocker for Prometheus.
- **Never:** have Autonomous negotiate or invent requirements.
- **Evidence:** C material-blocker transition; B execution-boundary scenario.
- **Source:** REQ § Prometheus Profile, § Managed Agents > Autonomous,
  § Autonomous Profile > Implementation Discretion; § Validation.

## Scaffold Publication And Git Exclusion

### UC-PUB-01: Complete Ralph scaffold publishes last-marker

- **Given:** ordinary deterministic implementation work.
- **When:** Prometheus publishes.
- **Then:** provide right-sized items, acceptance criteria, verification,
  discretion, handoff, bounded stopping, manifest, and write `SPEC.md` last.
- **Never:** publish a readiness marker for partial scaffolding.
- **Evidence:** F publication-order trace.
- **Source:** REQ § Prometheus Profile > Readiness and Handoff; ARCH § Prometheus
  Flow.

### UC-PUB-02: Existing deterministic checks can be sufficient

- **Given:** project checks prove Ralph acceptance criteria.
- **When:** the manifest is validated.
- **Then:** permit an empty evaluator inventory after baseline validation.
- **Never:** require generated evaluators simply because Autonomous is used.
- **Evidence:** U manifest fixtures; F publication fixture.
- **Source:** REQ § Prometheus Profile > Readiness and Handoff; ARCH § Prometheus
  Flow.

### UC-PUB-03: Custom evaluator is isolated and validated

- **Given:** existing checks cannot prove acceptance criteria.
- **When:** Prometheus declares a custom evaluator.
- **Then:** isolate it under `.prometheus/evaluator/**` and validate positive,
  negative, and malformed cases through protected spike execution.
- **Never:** place it in production code or publish it unvalidated.
- **Evidence:** F evaluator inventory; L evaluator-validation fixture.
- **Source:** REQ § Prometheus Profile > Readiness and Handoff; ARCH § Prometheus
  Flow.

### UC-PUB-04: Manifest paths and inventory are exact

- **Given:** manifest paths and evaluator files exist.
- **When:** validation runs.
- **Then:** require canonical worktree-relative paths, no escaping symlinks,
  SPEC consistency, every declared file present, and no unlisted evaluator file.
- **Never:** accept absolute, escaping, missing, or residual paths.
- **Evidence:** U path/inventory matrix; F symlink fixture.
- **Source:** ARCH § Prometheus Flow.

### UC-PUB-05: Strategy incompleteness fails closed

- **Given:** malformed manifest or missing Ralph/Karpathy required content.
- **When:** publication is attempted.
- **Then:** withhold publication; Karpathy additionally requires its validated
  scalar evaluator, baseline, noise, targets, limits, and stop criteria.
- **Never:** silently fill gaps or publish `SPEC.md` as ready.
- **Evidence:** U schema-negative fixtures; F partial-publication test.
- **Source:** REQ § Prometheus Profile > Readiness and Handoff; ARCH § Prometheus
  Flow.

### UC-GIT-01: Tool owns one exact Gitignore block

- **Given:** Prometheus invokes `scaffold_gitignore` without path arguments.
- **When:** root `.gitignore` is absent or valid.
- **Then:** atomically create/replace only the exact canonical managed block,
  preserve unrelated content and modes, and be byte-idempotent.
- **Never:** permit arbitrary target paths or duplicate blocks.
- **Evidence:** F empty/populated/CRLF/idempotence fixtures.
- **Source:** ARCH § Git Exclusion Tool.

### UC-GIT-02: Unsafe Gitignore targets fail closed

- **Given:** duplicate/malformed markers, symlink, non-regular target, or
  worktree escape.
- **When:** the exclusion tool runs.
- **Then:** reject without guessing or writing.
- **Never:** follow a symlink or damage unrelated rules.
- **Evidence:** F malformed-target matrix.
- **Source:** ARCH § Git Exclusion Tool.

### UC-GIT-03: Tracked artifacts warn without index mutation

- **Given:** a managed generated artifact is tracked.
- **When:** exclusion completes.
- **Then:** return structured warnings and preserve the Git index exactly.
- **Never:** stage, unstage, remove, or otherwise alter the index.
- **Evidence:** F pre/post index snapshot.
- **Source:** REQ § Prometheus Profile > Readiness and Handoff; ARCH § Git
  Exclusion Tool.

### UC-PUB-06: Published scaffold is frozen

- **Given:** an Autonomous run started from a valid scaffold.
- **When:** a fingerprinted SPEC, manifest, or evaluator file changes.
- **Then:** deny managed mutation and block run state changes until revalidation
  creates a new run.
- **Never:** adopt changed content in place.
- **Evidence:** F active-run lock; C fingerprint mismatch transition.
- **Source:** REQ § Prometheus Profile > Readiness and Handoff, § Autonomous
  Profile > Ralph: General Iterative Implementation; ARCH § Scaffold Handoff.

## Protected Execution And Autonomous Startup

### UC-RUN-01: State-changing commands use protected runner

- **Given:** Prometheus or Autonomous needs command output that can alter item or
  completion state.
- **When:** it executes a command.
- **Then:** use the protected boundary, including Bubblewrap on supported Linux.
- **Never:** accept direct shell output as protected evidence.
- **Evidence:** L runner invocation and unsupported-platform tests.
- **Source:** REQ § Managed Agents > Prometheus, > Autonomous, § Autonomous
  Profile; README § Optional Autonomous Profile.

### UC-RUN-02: Runner confines worktree and provenance

- **Given:** an active run and command.
- **When:** evidence is generated.
- **Then:** confine execution to the active worktree and bind artifact to run and
  combined scaffold fingerprint.
- **Never:** permit external mutation or use foreign/stale provenance.
- **Evidence:** L alias/symlink/foreign-evidence attack matrix.
- **Source:** REQ § Managed Agents > Autonomous, § Autonomous Profile;
  ARCH § Autonomous Flow.

### UC-RUN-03: Evidence is bounded and redacted

- **Given:** command output contains large data, likely credentials, or reaches
  a configured time/resource/output bound.
- **When:** runner persists evidence.
- **Then:** enforce the bound, redact likely credentials, and persist atomically.
- **Never:** expose likely secrets, accept partial writes, or run unbounded.
- **Evidence:** L timeout/output/redaction/interruption fixtures.
- **Source:** REQ § Autonomous Profile, § Autonomous Profile > Ralph: General
  Iterative Implementation.

### UC-RUN-04: Workers cannot decide outcomes

- **Given:** a worker writes a checklist, prose claim, or reviewer verdict.
- **When:** coordinator evaluates completion.
- **Then:** transition only from exact, fresh protected evidence and state.
- **Never:** accept free-form text as a reducer input.
- **Evidence:** C forged-claim/verdict simulation.
- **Source:** REQ § Autonomous Profile, § Autonomous Profile > Ralph: General
  Iterative Implementation; ARCH § Autonomous Flow.

### UC-AUT-01: Top-level Autonomous only initializes coordination

- **Given:** a top-level explicit Autonomous session with optional profile.
- **When:** it starts.
- **Then:** validate publication, inventory, and combined fingerprint; persist
  protected run state.
- **Never:** initialize for native sessions or an arbitrary child session.
- **Evidence:** C lifecycle simulation; O top-level activation smoke test.
- **Source:** REQ § Autonomous Profile; ARCH § Scaffold Handoff, § Autonomous
  Flow.

### UC-AUT-02: Missing or altered scaffold blocks startup/continuation

- **Given:** SPEC, manifest, inventory, or fingerprint is missing, invalid, or
  changed.
- **When:** startup or a state-changing check occurs.
- **Then:** report blocker and require a new validated run.
- **Never:** synthesize scaffold or continue under changed evaluator content.
- **Evidence:** U validation matrix; C mismatch simulation.
- **Source:** REQ § Autonomous Profile; ARCH § Scaffold Handoff.

### UC-AUT-03: Scope is an execution contract, not permission grant

- **Given:** an iteration diff is inside or outside `implementation_scope`.
- **When:** coordinator validates the handoff.
- **Then:** inside-scope changes may proceed; outside-scope changes cannot pass
  and require repair or blocker.
- **Never:** use scope to expand fixed tools or permissions.
- **Evidence:** U diff validator; C scope matrix.
- **Source:** REQ § Autonomous Profile > Implementation Discretion; ARCH
  § Prometheus Flow, § Autonomous Flow > Ralph Transition.

### UC-AUT-04: Ralph is default and Karpathy requires intent

- **Given:** a valid Autonomous scaffold without declared optimization intent, or
  optimization files incidentally present.
- **When:** strategy is selected before mutation.
- **Then:** persist Ralph through a validated machine-readable transition. A
  scaffold that declares optimization intent but is an incomplete or invalid
  Karpathy contract blocks rather than falling back to Ralph.
- **Never:** select Karpathy solely from file presence or free-form text, or
  silently downgrade a declared-optimization scaffold to Ralph.
- **Evidence:** U strategy matrix; C pre-mutation transition test.
- **Source:** REQ § Autonomous Profile, § Autonomous Profile > Ralph: General
  Iterative Implementation; ARCH § Shared Run Coordinator.

### UC-AUT-05: Local repair differs from material replanning

- **Given:** an implementation issue is either a minor reversible mismatch or
  alters outcome, acceptance, evaluator, immutable target, material scope,
  trust boundary, policy, or high-impact tradeoff.
- **When:** Autonomous evaluates it.
- **Then:** repair and hand off the local case; create a planning blocker for the
  material case.
- **Never:** escalate ordinary debugging or proceed through material change.
- **Evidence:** C table-driven discretion reducer; B boundary scenario.
- **Source:** REQ § Autonomous Profile > Implementation Discretion; ARCH
  § Autonomous Flow > Ralph Transition.

## Ralph Coordinator

### UC-RAL-01: One coordinator, worker, worktree, and item

- **Given:** a Ralph run is active.
- **When:** work is scheduled.
- **Then:** maintain exactly one coordinator, durable state document, worktree,
  active mutating worker, and highest-priority active item.
- **Never:** create parallel mutation, a DAG, worker messaging, general
  checkpoints, distributed execution, or cross-machine recovery.
- **Evidence:** C concurrency and invariant simulation.
- **Source:** ARCH § Complexity Boundary, § Shared Run Coordinator; REQ
  § Autonomous Profile > Ralph: General Iterative Implementation.

### UC-RAL-02: Fresh worker handles one stable item

- **Given:** pending items with stable IDs and acceptance criteria.
- **When:** an iteration begins.
- **Then:** start a fresh context from fingerprint, worktree, protected item
  state, previous handoff, and instructions; reserve one item only.
- **Never:** use transcript memory or broaden into an unrelated sibling issue.
- **Evidence:** C fresh-context/item-reservation simulation.
- **Source:** REQ § Autonomous Profile > Ralph: General Iterative Implementation;
  ARCH § Autonomous Flow > Ralph Transition.

### UC-RAL-03: Protected item state and structured handoff

- **Given:** an iteration ends.
- **When:** worker returns or idles.
- **Then:** coordinator controls pending/in-progress/passed/blocked state and
  records selected item, changes, evidence, blockers, findings, and next work.
- **Never:** let worker edit state directly or require a literal handoff footer.
- **Evidence:** U handoff/state schema; C forged/malformed handoff matrix.
- **Source:** REQ § Autonomous Profile > Ralph: General Iterative Implementation;
  § Validation.

### UC-RAL-04: Fresh focused evidence passes an item

- **Given:** selected-item changes are complete.
- **When:** item verification occurs.
- **Then:** run focused deterministic and necessary regression checks through the
  runner; pass only from fresh evidence.
- **Never:** pass from mutation, stale output, or a model assertion.
- **Evidence:** C fresh/stale/foreign evidence matrix.
- **Source:** REQ § Autonomous Profile > Ralph: General Iterative Implementation;
  ARCH § Autonomous Flow > Ralph Transition.

### UC-RAL-05: Full verification gates completion

- **Given:** all items appear complete or run completion is possible.
- **When:** coordinator evaluates completion.
- **Then:** run exact fresh full-SPEC verification and stop successfully only if
  it passes.
- **Never:** infer full success from item checks alone.
- **Evidence:** C complete-evidence transition test.
- **Source:** REQ § Autonomous Profile > Ralph: General Iterative Implementation;
  ARCH § Autonomous Flow > Ralph Transition.

### UC-RAL-06: Fast path stops after one successful iteration

- **Given:** the first fresh worker produces valid complete evidence.
- **When:** its handoff is evaluated.
- **Then:** complete without launching a second worker.
- **Never:** continue merely because Ralph can iterate.
- **Evidence:** C one-iteration trace; O minimal end-to-end smoke test.
- **Source:** REQ § Managed Agents > Autonomous, § Autonomous Profile > Ralph:
  General Iterative Implementation; § Validation; ARCH § Autonomous Flow > Fast
  Path.

### UC-RAL-07: Repair and worktree continuity are bounded

- **Given:** a retryable failure inside scope.
- **When:** it does not yet prove a blocker.
- **Then:** start a bounded fresh repair worker using durable worktree and prior
  handoff; never auto-commit.
- **Never:** require a general checkpoint engine or replan ordinary debugging.
- **Evidence:** C repair/restart/no-commit traces.
- **Source:** REQ § Autonomous Profile > Implementation Discretion, > Ralph:
  General Iterative Implementation; ARCH § Autonomous Flow > Fast Path, > Ralph
  Transition.

### UC-RAL-08: Progress and stop rules are evidence-based

- **Given:** iterations show item transitions, new passing evidence, blockers,
  file-only mutation, repeated errors, or no new evidence.
- **When:** reducer evaluates each iteration.
- **Then:** count only transition/new evidence/evidence-backed blocker as
  progress; stop at fingerprint, blocker, and configured iteration, no-progress,
  error, time, command, or output bounds.
- **Never:** count mutation alone or run indefinitely.
- **Evidence:** C threshold-boundary transition matrix.
- **Source:** REQ § Autonomous Profile > Ralph: General Iterative Implementation;
  § Validation.

### UC-RAL-09: Missing feedback/scope is established or blocks

- **Given:** repository lacks deterministic feedback or bounded mutation scope.
- **When:** Ralph begins.
- **Then:** first bounded item establishes it, or records a blocker if unsafe.
- **Never:** run open-ended without both prerequisites.
- **Evidence:** C prerequisite cases.
- **Source:** REQ § Autonomous Profile > Ralph: General Iterative Implementation.

## Karpathy Coordinator Branch

### UC-KAR-01: Karpathy requires a complete frozen optimization contract

- **Given:** explicit scalar-optimization intent plus objective, direction,
  baseline, evaluator/score extraction, noise probe, mutable/immutable targets,
  limits, and stop criteria.
- **When:** selection occurs.
- **Then:** select Karpathy; missing/invalid required content blocks rather than
  improvising harness or strategy.
- **Never:** use Karpathy for ordinary feature work.
- **Evidence:** U manifest/selection negatives; C initialization trace.
- **Source:** REQ § Autonomous Profile > Karpathy: Scalar-Metric Optimization,
  § Karpathy Strategy Agent; § Validation; ARCH § Karpathy Flow.

### UC-KAR-02: Exactly one bounded change is proposed and applied

- **Given:** a valid Karpathy iteration.
- **When:** strategist selects an experiment.
- **Then:** accept one bounded proposal; Autonomous alone applies it.
- **Never:** allow multi-change batches, Karpathy edits, or unrelated changes.
- **Evidence:** C proposal/diff enforcement test.
- **Source:** REQ § Autonomous Profile > Karpathy: Scalar-Metric Optimization,
  § Karpathy Strategy Agent; ARCH § Karpathy Flow.

### UC-KAR-03: Mutable targets are preserved and immutable targets stay fixed

- **Given:** declared mutable and immutable target sets.
- **When:** experiment starts or touches a target.
- **Then:** preserve only mutable targets needed for reversal; reject immutable
  or out-of-target changes.
- **Never:** implement a general worktree checkpoint.
- **Evidence:** F target snapshot/restore fixtures; C target violation trace.
- **Source:** REQ § Autonomous Profile > Karpathy: Scalar-Metric Optimization;
  ARCH § Karpathy Flow.

### UC-KAR-04: Protected measurement makes KEEP or REVERT

- **Given:** one proposed change is applied.
- **When:** frozen evaluator produces a valid protected measurement.
- **Then:** compare against best score with direction and noise threshold; KEEP
  retains/update score, REVERT restores exactly saved mutable targets.
- **Never:** use strategist prose or unprotected metrics.
- **Evidence:** C min/max/noise/invalid-score/KEEP/REVERT matrix.
- **Source:** REQ § Autonomous Profile > Karpathy: Scalar-Metric Optimization,
  § Karpathy Strategy Agent; ARCH § Karpathy Flow.

### UC-KAR-05: Stagnation pivots; objectives and limits stop

- **Given:** declared failure threshold, objective, and experiment budget.
- **When:** failures accumulate, objective is reached, or budget exhausts.
- **Then:** pivot on threshold while budget remains; otherwise persist record and
  stop.
- **Never:** repeat stalled strategy indefinitely.
- **Evidence:** C pivot and boundary-limit traces.
- **Source:** REQ § Autonomous Profile > Karpathy: Scalar-Metric Optimization,
  § Karpathy Strategy Agent; ARCH § Karpathy Flow.

## Documentation And Release Evidence

### UC-DOC-01: Documentation agrees with delivered behavior

- **Given:** agents, profiles, permissions, tools, paths, strategies, and tests.
- **When:** documentation consistency validation runs.
- **Then:** README, requirements, architecture, prompts, deployment help, and CI
  agree; obsolete names and false tool claims fail validation.
- **Never:** document ordinary Plan/Build as requiring custom agents or runner.
- **Evidence:** S semantic reference/inventory audit.
- **Source:** README intro, § Native Plan And Build; REQ § Document Roles,
  § Native Compatibility Invariant, § Validation; ARCH § Boundary, § Deployment.

### UC-DOC-02: Release evidence covers all canonical categories

- **Given:** a release candidate.
- **When:** release validation executes.
- **Then:** separately produce evidence for every validation category below;
  dry-run evaluator plumbing does not count as release evidence.
- **Never:** silently skip required deterministic tests or report a template-only
  agent evaluation as behavioral proof.
- **Evidence:** CI report plus explicit live-test status.
- **Source:** README § Validation; REQ § Validation.

## Release Traceability Matrix

Every release category in REQ § Validation must have at least one passing
positive case and one relevant denial/boundary case.

| REQ category | Positive cases | Denial/boundary cases |
| --- | --- | --- |
| 1. Native and unmanaged bypass | UC-CAN-02, UC-CAN-03 | UC-CAN-04, UC-DEP-06 |
| 2. Roles and descendants | UC-ID-01, UC-ID-05, UC-ID-07 | UC-ID-02 to UC-ID-04, UC-ID-06, UC-ID-08 to UC-ID-10 |
| 3. Prometheus framing | UC-PRO-01, UC-PRO-02 | UC-PRO-03, UC-PRO-08 |
| 4. Interview discipline | UC-PRO-04, UC-PRO-06 | UC-PRO-05 |
| 5. Alternatives and veto | UC-PRO-03, UC-PRO-07 | UC-PRO-08 |
| 6. Publication and exclusion | UC-PUB-01 to UC-PUB-04, UC-GIT-01, UC-GIT-03 | UC-PUB-05, UC-GIT-02, UC-PUB-06 |
| 7. Operational blockers | UC-AUT-02, UC-AUT-05 | UC-PRO-09 |
| 8. Ralph default and fast path | UC-AUT-04, UC-RAL-06 | UC-KAR-01 |
| 9. Local versus material | UC-AUT-03, UC-AUT-05 | UC-PRO-09 |
| 10. Worker/item/handoff/repair | UC-RAL-01 to UC-RAL-03, UC-RAL-07 | UC-RAL-08, UC-RAL-09 |
| 11. Progress and completion | UC-RAL-04, UC-RAL-05 | UC-RAL-08, UC-RUN-04 |
| 12. Karpathy experiments | UC-KAR-01 to UC-KAR-05 | UC-AUT-04, UC-KAR-03 |
| 13. Deployment cleanup | UC-DEP-01 to UC-DEP-04 | UC-DEP-05, UC-DEP-06, UC-DEP-07 |
| 14. Documentation consistency | UC-DOC-01, UC-DOC-02 | UC-CAN-01 |

## Required Fixture Families

- **Identity:** six top-level roles; unknown/future/third-party identities;
  nested ancestry; missing/cyclic ancestry; spoofed identity; every allowlist.
- **Scaffold:** valid/minimal/invalid Ralph and Karpathy manifests; missing
  publication artifacts; schema mismatch; path and symlink escape; inventory
  omission; changed fingerprint.
- **Evaluator:** positive, negative, malformed, timeout, missing/NaN score,
  noisy score, min/max direction, evaluator mutation attempt, threshold edges.
- **Coordinator:** ordered items; legal/illegal transitions; valid/forged/
  malformed handoffs; fresh/stale/foreign evidence; crash points; no-progress
  traces; scope violations; reviewer completion claims.
- **Git/deployment:** empty, populated, malformed, duplicate, CRLF, symlinked
  `.gitignore`; tracked artifacts; clean/old/stale/unrelated global profiles;
  install/upgrade/downgrade/repeat snapshots; profile-mismatch (managed agents
  present without `--with-autonomous`).
- **Behavioral repositories:** clear request; ambiguous policy; false and true
  diagnoses; reuse/config/no-build; sound direct build; unsafe/unverifiable
  request; explicit optimization; incidental metric.

## Automation Rules

1. Run S, U, F, and C in every CI run. Run L on supported Linux release CI.
2. Run B against frozen prompts, repositories, and structured rubrics; grade
   decisions and cited evidence, not keyword counts or literal templates.
3. Make O visible and release-gated when authentication is available. A skipped
   live check is reported as missing evidence, not as a passing test.
4. Test publication, runner, and reducer inputs with positive, negative, and
   malformed fixtures. Test all limit values at their exact boundaries once
   durable defaults exist.
5. Do not require a six-agent workflow, a literal handoff footer, Prometheus,
   or Autonomous for ordinary work.
