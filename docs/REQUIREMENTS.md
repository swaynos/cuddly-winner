# Control-Plane Requirements

## Durable contract

The trusted computing base is `tools/run.ts`, `plugins/immutability.ts`,
and `plugins/opencode-autonomous-supervisor/`. Prometheus alone owns root
`SPEC.md`; it is confined to `SPEC.md` and `.spike/**`, and commands go through
the runner. Autonomous reads and fingerprints that canonical file and never
rewrites it.

The checked-in root `opencode-immutable.json` policy enumerates trusted source
files explicitly and contains no recursive readonly globs. Runtime runner and
supervisor evidence paths are intrinsically protected by the immutability plugin.
`write_allowlist` entries establish exclusive path ownership and also confine the
named agent to those paths.

The runner durably and atomically writes a log and JSON result before resolving.
Every execution result contains `run_id`, `supervisor_run_id`, `spec_fingerprint`,
`started_at`, `finished_at`, `duration_ms`, exact
normalized `command`, `exit_code`, output tails, `timed_out`, and `context`, plus
`spike_id` for a contracted spike. Execution evidence lives under
`.opencode/runs/`; spike evidence lives only under `.spike/<id>/runs/`.
On Linux, spike commands require `/usr/bin/bwrap`: the runner bind-mounts `/`
read-only and rebinds only `.spike/<id>` writable. Spike execution fails closed
when that sandbox is unavailable. Prometheus may use `run` only with `context`
`spike`; direct shell and execution-context runs are denied by the hook.
Execution-context commands use the same sandbox with the project read-only and a
private writable `/tmp`. Evaluation reports are written beneath that private
temporary directory rather than through a writable project mount.
This prevents command-level forgery of runner and supervisor state; source edits
remain the responsibility of mutation tools before verification.

Completion is a pure disk-state decision. Every unique command item in the one
valid `## Verification` section needs exact, fresh, passing execution evidence
bound to the active supervisor run and SPEC fingerprint.
Only a resolved pyenv interpreter path may normalize to `python3`. Freshness is
measured against code, tests, agents, plugins, runner, evals, skills, and deploy
scripts, excluding docs, README, SPEC, progress, spikes, runs, and supervisor
state. Promise tokens request evaluation but are not evidence. Reviewer output
is advisory.

Supervisor state is atomically serialized per run and survives restart with run
ID, SPEC fingerprint, command satisfaction, correction counters, status,
history, and blocker reason. Corrections are deduplicated and capped at three
per failure class and twelve globally; reaching either cap blocks automatic
delivery pending user intervention. Parent/child activity is scoped to its
actual run.
Only a top-level Autonomous `chat.params` event initializes a run and captures
the fingerprint. Idle events evaluate an existing run only. Child sessions walk
their real parent chain; unrelated sessions are ignored. Corrupt state fails
closed, and blocked state remains terminal until explicit user intervention.

`.opencode/runs/` and `.opencode/supervisor/` are intrinsically readonly to all
agent mutation tools. The trusted runner and supervisor write them directly.

The runner source is an OpenCode SDK custom-tool definition with a validated
argument schema and execute callback. Committed control-plane inputs use visible
root paths; `.opencode/` is reserved for ignored runtime evidence and supervisor
state. If Autonomous reports that `run` is unavailable, the supervisor records
a terminal infrastructure blocker and does not issue impossible verification
retries. Tool deployment changes require restarting OpenCode.

Mutation validation is opt-in. A configured result is an uncommitted repository
artifact; no agent auto-commits it. It must have a valid generation timestamp,
finite threshold-passing score, non-empty existing file list, and freshness
against the files it evaluates.

The six supported agents are Ask, Prometheus, Autonomous, Karpathy, Reviewer,
and Grounder. Karpathy requires `program.md`, `opencode-karpathy.json`, and a
frozen evaluator, and routes every measurement through the runner. Grounder and
Reviewer are read-only.

Default deployment installs agents, root `skills/`, the runner, supervisor, and
immutability hook. No Git commit is created without explicit user instruction.
Live planning and build evaluations fail closed when provider credentials are
unavailable. Dry-run evaluator checks never qualify as release evidence.
The live harness loads the gitignored root `.env` without logging values, redacts
loaded secrets from child output, provisions workspace-local writable XDG data,
cache, and state directories, passes an explicit workspace through `--dir`, and
uses an isolated Git worktree so plugins resolve the same project root.
