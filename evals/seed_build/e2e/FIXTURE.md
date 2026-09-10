# Frozen Fixture — Installed Workflow End To End

Fixture for `evals/seed_build/test_end_to_end.py`. Satisfies the required
fixture contents in `docs/TEST-PLAN.md` § Behavioral Fixture Registry.

## Scenario

A freshly installed managed profile receives one implementation request in an
empty Git worktree. Prometheus plans it, publishes a generated task package (a
project-local execution-agent definition, a durable brief, a schema-v1 manifest,
and the generated-agent registry), and hands off. It then stops before any
implementation and tells the user to restart OpenCode and start a new
conversation.

The published project-local generated agent then runs as a separate process. It
reads its brief and manifest, implements the work, and runs the declared
verification through native Bash. There is no fixed Autonomous, Karpathy, or
Implementation Validator role. The generated definition denies edits by default,
allows only the manifest's two exact edit paths, and has no separate write grant.
The runtime also enforces the manifest's edit-path and Bash boundaries.

## Prompt and inputs

| Input | Value |
| --- | --- |
| Workspace seed | `evals/seed_build/e2e/request.md`, committed as `request.md` |
| Prometheus prompt | `Read request.md and plan this work.` |
| Prometheus approval mode | normal (no `--auto`) |
| Generated agent name | `retry-schedule-policy` |
| Generated agent prompt | `Read your task brief and implement the retry schedule policy.` |
| Generated agent approval mode | documented automatic approval (`--auto`) |
| Model | scripted loopback provider, `test/test-model` |

The scripted turns live in `_prometheus_turns` and `_generated_turns` in the
harness. They are part of the fixture: changing them changes what the test
proves.

## Revisions

The harness records the repository revision, the OpenCode CLI version, and the
platform in every report (`repository_revision`, `opencode_version`,
`platform`). The CLI version is pinned by `.opencode-cli-version` and asserted,
so a runtime change fails loudly instead of silently altering the evidence.

## Rubric

Every check is pass or fail; the threshold is all checks passing. A check whose
probe never reached the provider fails as unproven rather than passing silently.

| Group | Requirement |
| --- | --- |
| Installation | The installer deploys four agents (`ask`, `grounder`, `prometheus`, `reviewer`), all three plugins, all four workflow tools, the pinned SDK, and the pinned Playwright library. |
| Permissions | Effective per-agent tool availability matches `docs/USE-CASES.md` UC-ID-02 through UC-ID-04, and the generated agent resolves to wildcard edit denial followed by the two exact manifest allows with no separate write rule. |
| Planning | Prometheus publishes the four task-package files, the manifest is schema v1 with a direct strategy and consistent ids and commands, the registry references the manifest, static validation passes, and the run ends with the fresh-context restart handoff. |
| Execution | The generated agent is discovered as a project-local agent, runs from its published definition, consumes the brief and manifest, creates every required file, and runs each declared command through native Bash. |
| Execution boundary | Rewriting the published package, editing trusted control-plane sources, writing outside the declared edit paths, and invoking a governance tool it does not own are each refused for their specific documented reason, and the published package bytes are unchanged by execution. |
| Git | `HEAD`, the commit count, and the index are unchanged, and produced work is left pending. |
| External scoring | The hidden acceptance suite passes, an independent replay of each declared command exits 0, and the hidden assets never entered the workspace. |
| Harness integrity | No provider request is unscripted and no scripted turn goes unused. |

## Evidence retained

Written to the artifacts directory for every run, and to a retained workspace
copy on failure:

- per-agent JSON event streams and stderr, including permission requests;
- every provider request body with the tool schemas offered;
- installer output;
- hidden oracle output;
- effective per-agent tool exposure;
- the generated agent's resolved tool exposure and edit/write rules from `debug agent`;
- child session agent names from the isolated OpenCode database.

## Deliberate limits

A scripted provider proves wiring, policy, and permission boundaries. It does
not prove agent judgement, because the tool calls are supplied by the fixture
rather than chosen by a model. Run `test_planning.py` and `test_build.py` without
`--dry-run` for opt-in live-agent coverage; those runs need real credentials.
