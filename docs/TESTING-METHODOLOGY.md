# Testing Methodology

## Purpose

This document defines how the project gathers runtime, filesystem, behavioral,
and session evidence for native OpenCode behavior, the four shipped agents, and
registered generated agents.

`docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/NEXT-ITERATION.md`,
`docs/SKILLS.md`, and `docs/USE-CASES.md` define the contracts. This document
defines how tests measure them.

## Evidence Rules

Evidence classes come from `docs/TEST-PLAN.md`.

- Deterministic unit, filesystem, and static checks may prove parsing, package
  shape, installation, path enforcement, and scripted state transitions.
- Behavioral evidence requires a frozen prompt, repository fixture, observable
  rubric, retained transcript, and threshold declared before the run.
- Optional live smoke evidence records the active profile, model, provider,
  runtime, platform, and fixture revision.
- Installed-product class E evidence uses the real pinned OpenCode process and a
  scripted provider. It proves wiring and policy, not model judgment.
- A dry run, skipped prerequisite, source-string assertion, or evaluator
  self-test cannot stand in for behavioral or live evidence.

Missing required evidence yields a blocked or incomplete evidence set. It never
yields a pass.

## Standardized Verdict Definitions

The project uses these report labels. The session auditor currently emits
`PASS`, `PARTIAL`, or `NOT_APPLICABLE` for KPI evidence and exits through the
`ERROR` path when required input cannot be read. Seed-build and behavioral
harnesses use the other applicable labels. Every harness records its exit
mapping in the test result.

| Verdict | Meaning | Auditor exit code |
| --- | --- | --- |
| `PASS` | Every requirement evaluated by that report has supporting evidence. | `0` |
| `PARTIAL` | Useful evidence exists, but one or more nonfatal report checks are incomplete. | `1` |
| `FAIL` | A required check failed or the evidence shows a hard contract violation. | `2` |
| `NOT_APPLICABLE` | The report section does not apply to the selected session. | `0` |
| `NOT_SELECTED` | The optional role or strategy was not observed. | `0` |
| `SKIPPED` | A harness prerequisite was absent and no applicable test ran. | Harness-specific |
| `ERROR` | Required session data or the OpenCode database could not be read. | `3` |

A zero exit for `NOT_APPLICABLE`, `NOT_SELECTED`, or a CI-accepted skip does not
prove the corresponding use case.

## Deterministic CI

`scripts/ci.sh` runs the following sequence:

1. Check Node.js against the supported version range and resolve the project
   Python interpreter through `scripts/ensure-venv.sh`.
2. Install the managed profile into a temporary configuration root that CI
   removes when the run ends.
3. Run `tests/verify_opencode.py --skip-llm` and its deterministic assertion
   tests. The `--skip-llm` run checks source and installed-profile structure; it
   does not invoke a model or run behavioral scenarios.
4. Run Node plugin and integration tests, mutation-runner unit tests, skill
   coverage with model checks skipped, and session-auditor unit tests.
5. Run `evals/seed_build/test_planning.py --dry-run` and
   `evals/seed_build/test_build.py --dry-run`, then inspect deployment status.
6. Run `evals/seed_build/test_end_to_end.py` last because it is the slowest
   deterministic check.

The deterministic package checks exercise registry-wide structure and full
schema-v1 validation of the named package, including malformed and duplicate
entries, reserved native and shipped names, and incomplete named manifests.
Immutability tests separately prove that an invalid non-reserved name already
listed in the registry stays blocked rather than becoming unmanaged, while a
reserved entry cannot hijack native or shipped identity handling. Ancestry-cycle
tests require managed mutation and Bash to fail closed. These checks do not prove
that a live model publishes or executes a sound package.

The two seed-build dry runs use the canonical schema-v1 package and stub
responses to exercise workspace setup, package scoring, report output, and
failure paths. Their non-dry-run modes invoke Prometheus and the canonical
generated agent with a configured provider, but CI does not run those modes.
Dry-run reports render `DRY-RUN (STUB)`, carry `execution_mode: dry-run`, and
mark synthetic events as stubs. The CI commands prove only dry-run plumbing, not
behavioral, live-provider, or installed-product evidence.

The canonical generated-agent input copies only the seed and the package under
`evals/seed_build/canonical/.opencode/`. Hidden acceptance tests, oracle code, and
the reference implementation remain outside the agent workspace. In build mode,
the harness requires an exact completed native-Bash tool event for every command
listed in the manifest. Only then does it replay each command independently; a
missing, changed, or incomplete event blocks that replay and fails the evidence
set.

The final installed-product test exits `2` when it cannot resolve an OpenCode
binary. `scripts/ci.sh` records that result as a skip so contributors can run
the cheaper suite without the CLI. A resolved binary whose version differs from
the pin continues through diagnostic probes but returns a nonpassing result, so
CI fails. Release evidence still records TP-NEXT-05 as blocked until that same
test passes with the pinned binary.

## Installed-Product End To End

`evals/seed_build/test_end_to_end.py` is the repository's class-E test. Its
fixture is exactly `evals/seed_build/e2e/`.

### Scope

One run performs these phases:

1. Install the managed profile in an isolated configuration root and read back
   effective tool exposure for Ask, Grounder, Prometheus, and Reviewer.
2. Start the pinned real OpenCode binary with Prometheus in normal approval
   mode and no preloaded task package.
3. Have Prometheus publish a schema-v1 registry, manifest, project-local agent
   definition, and durable brief, then stop with a handoff naming the agent,
   brief, and manifest plus quit, restart, new-conversation, and selection steps.
4. Start the published generated agent as a separate OpenCode process in
   documented automatic-approval mode.
5. Verify declared edits and native Bash checks, refuse package, trusted-source,
   out-of-scope, and governance-tool probes, then score the result externally.

The harness retains installed files, effective tool schemas, provider request
bodies, JSON tool events, process output, package hashes, generated artifacts,
session records, Git publication state, hidden acceptance output, and an
independent replay of every declared verification command.

### Scripted Provider

`evals/seed_build/_llm_server.py` serves scripted server-sent events through an
OpenAI-compatible endpoint. Each turn is matched to the expected agent system
prompt. The server records every request and the tools OpenCode offered.

An unexpected provider request fails the run. An unused scripted turn also
fails it. These checks prevent a shortened or diverted flow from passing.

### Isolation

The harness redirects `HOME`, all `XDG_*` roots, `ZDOTDIR`, and
`OPENCODE_CONFIG_DIR`; supplies only the loopback provider; removes provider
credentials; disables model fetching and automatic updates; and keeps the
managed research browser offline. It resolves temporary paths through symlinks
before the run so OpenCode and the test agree on the worktree root.

The hidden suite remains in `evals/seed_build/e2e/hidden/`. It never enters the
agent workspace and is not named in the request.

### Runtime Pin

`.opencode-cli-version` is the source of truth for the supported OpenCode CLI
version. The harness checks the selected binary against that value and records
the version, repository revision, and platform. `OPENCODE_E2E_BIN` may select a
specific binary, and `OPENCODE_E2E_ARTIFACTS` may select an evidence directory.

### Limits

The provider chooses tool calls from a frozen script, so class E does not show
that a model selected a sound strategy, asked the right question, used judgment
well, or recognized completion. Hidden-suite success shows only that the
delivered files satisfy the hidden checks. Phase 5 behavioral fixtures must
measure judgment separately.

## Behavioral And Live Evaluation

Every B-class row in `docs/TEST-PLAN.md`, including TP-NEXT-01 through
TP-NEXT-04, is blocked until Phase 5 authors its named fixture. No current frozen
fixture means no behavioral pass. Prometheus publication and generated-agent
execution have deterministic class-E coverage, but their live-provider fixtures
remain deferred and blocked until Phase 5.

The Phase 5 roster contains only these targets:

- native Plan and Build behavior;
- Ask and Grounder question and research behavior;
- Prometheus research, readiness, strategy selection, publication, and handoff;
- Reviewer advisory approval and rejection;
- generated-agent `direct`, `ralph`, and `optimization` execution.

`tests/verify_opencode.py` has an optional model-enabled path with seven inline
smoke scenarios for Ask, Grounder, Prometheus, and Reviewer. It does not cover
the generated execution strategies or use the complete frozen-fixture format
required for B-class evidence. CI calls it with `--skip-llm`. Until Phase 5
authors the registered fixtures and strategy scenarios, a no-flag run is useful
supplemental evidence but not a complete behavioral release set.

Before the current repository-profile smoke harness invokes a model, it compares
the active OpenCode configuration root with the repository's full managed
inventory and effective agent metadata. It rejects discoverable retired
`autonomous`, `karpathy`, `implementation-validator`, and
`out-of-the-box-thinker` profile agents, both retired autonomous-supervisor
plugin paths, and the retired `run.ts` tool path in singular or plural global
discovery directories. It also invokes the canonical runtime-integrity helper's
read-only `status` action against the installed mode-`0600` state. Missing or
invalid state and modified, missing, or unsafe recorded runtime content fail even
when top-level package versions match. Default mode fails before model invocation
on drift and prints install-and-restart guidance. An explicit active-profile
diagnostic mode may run against drift but labels the result as
active-profile-only.

Reviewer and Grounder run as delegated subagents in these smokes. The harness
accepts their output only from a completed `task` tool event for the requested
child and uses the exported child session when it needs tool-use evidence. The
Reviewer checks accept only an exact `APPROVE` or `REQUEST_CHANGES` token on the
last non-empty line and establish the child verdict and cited response that was
observed. The local Grounder check establishes the child response. The private
Grounder check establishes only that the exported child tool list contains no
`webfetch`, the response states that no external corroboration occurred, and the
seeded token was not echoed. Those observations do not prove broad
non-disclosure, all possible external-tool absence, or the full B-class role
contracts.

Each live scenario runs in a disposable workspace and records nonzero agent exit
status as failure. Assertions inspect tool events and filesystem state rather
than accepting a filename or generic phrase in model output as proof.

## Session Audit Procedure

`tests/audit_run.py` opens `~/.local/share/opencode/opencode.db`, or a caller
supplied database, in read-only mode. It is an investigative report over one
selected session, same-project recursive descendants, and available project
artifacts. Before aggregation, the auditor normalizes and compares every
descendant's absolute directory/worktree metadata with the requested project.
Cross-project, missing, blank, relative, or unresolvable child metadata aborts
the report with an error instead of contributing evidence.

### SQLite Sources

The report reads:

- `session` for the selected session and recursive descendants;
- `part` for root-session tool calls and text output;
- `session_message` for agent-switch events;
- `message` for message role, assistant timing, and token usage.

OpenCode records root-session tool calls without enough information to attribute
a call to a selected role after an in-session agent switch. The auditor must
report such calls as root-session observations only.

Reviewer approval is narrower than a text search. The auditor joins text parts
to assistant message records, limits candidates to selected or descendant
sessions whose recorded agent is `reviewer`, combines their output in recorded
order, and accepts only `APPROVE` as the last non-empty line. A user message,
arbitrary root text, an earlier token, or `APPROVE` with added words reports no
Reviewer approval.

The current script supports raw session discovery, ancestry inspection, switch
reporting, root tool observations, and message-usage calculations. For a
selected registered schema-v1 generated agent, it also reports the linked
manifest, declared strategy, referenced agent and brief presence, and optional
run-KPI policy. Registry or manifest names reserved for the seven OpenCode
built-ins or four shipped agents fail closed. Focused unit fixtures cover
current registration, reserved and unsupported identities, same-project
recursive usage, cross-project and ambiguous descendant metadata, spoofed and
attributed Reviewer tokens, and observational KPI verdicts.

These observations do not validate the whole package, prove that the declared
strategy was followed, attribute root calls after an in-session switch, prove
permission enforcement, or prove fresh verification.

## Generated Runtime KPI Testing

Deterministic runtime-plugin tests cover absent and disabled policies,
registered-agent activation, overlapping active intervals, token accounting,
hard output-budget enforcement, and unregistered identities. Auditor fixtures
independently cover schema-v1 policy discovery, descendant usage aggregation,
and observational verdicts. Static inspection confirms that this optional
policy has no tool-approval hook and cannot replace task completion evidence.

## Optimization Example Testing

The checked-in `examples/ml-loop` package keeps the candidate producer separate
from score ownership. `tools/score.py` computes its score from
`artifacts/candidate.json` and held-out data rather than reading a claimed score.
Deterministic checks verify the published immutable hashes and confirm that a
forged score log is ignored. These checks prove the example boundary and command
behavior, not a live agent's optimization judgment.

## Resource And Session-Fetch Testing

Resource-selection tests use static prompts, JSON fixtures, synthetic browser
profiles, and fake browser processes. They do not contact provider accounts or
launch a real browser. Live provider checks remain opt-in diagnostics and use
non-sensitive prompts.

Session-fetch tests inject a fake browser and local HTTP boundary. They verify
OpenCode approval, opaque handles, configured HTTPS origins, same-origin
redirects, bounded bodies, private cookie forwarding, cross-session denial,
capacity, expiry, and close without exposing credentials.

## Skills Validation

`tests/test_skill_coverage.py --skip-llm` validates package discovery,
frontmatter, paths, selected content contracts, deployment, and catalog coverage
without model credentials. Node integration tests cover managed deployment.

Direct-model skill pressure checks remain optional. They cannot replace tests
that load a skill through a current managed or registered generated identity and
observe plugin-enforced permissions.

## Mutation Testing

`evals/mutation/run_mutation.py` first runs the caller's unchanged baseline
command. It applies selected mutations only after that baseline passes. A failed
baseline makes the result invalid rather than producing a mutation score.

Callers pass source files, a command, threshold, and result path through explicit
arguments or `--config opencode-mutation.json`. The tests under
`evals/mutation/tests/` verify the runner itself, not the mutation quality of a
target project.

## Evidence Retention

Every nontrivial run records the test and use-case identifiers, fixture and
repository revisions, platform, runtime and model details, exact command or
prompt, expected result, observed result, retained artifacts, and final verdict.
If a prerequisite or platform is missing, the record names it and leaves the
corresponding claim unproved.
