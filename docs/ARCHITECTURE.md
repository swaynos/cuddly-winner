# Architecture

## Planning and execution flow

Prometheus investigates the repository and uses `.spike/<id>/QUESTION.md` for
load-bearing empirical questions. The trusted runner routes spike artifacts to
that spike only. Once grounded, Prometheus writes canonical root `SPEC.md` and
hands it to Autonomous.

Autonomous validates and fingerprints the SPEC, implements its checklist, and
runs each exact verification command through the runner. Runner artifacts are
written atomically under `.opencode/runs/`. A SPEC change invalidates the active
run rather than carrying evidence into a changed contract.

The supervisor is the sole completion and correction owner. It parses the SPEC,
validates artifact schemas and freshness, validates configured mutation output,
and persists bounded run state under `.opencode/supervisor/`. Text, tokens,
unrelated commands, spike runs, and Reviewer verdicts cannot complete work.
The runner is exported through the OpenCode custom-tool SDK. Missing runner
registration is a terminal infrastructure blocker rather than a verification
failure, preventing retries that cannot repair the active process's startup-time
tool registry.

## Trust boundaries

- **Runner:** process lifecycle, timeout handling, exact command capture, and
  durable context-separated evidence. Linux spike processes run inside
  `/usr/bin/bwrap` with the project mounted read-only and only their own spike
  directory writable; absence of the sandbox is fatal. Execution commands also
  see the project read-only, with private temporary storage and the seed report
  output as the only writable exception, so they cannot forge control-plane
  artifacts.
- **Immutability hook:** independent per-path project-root discovery, readonly
  rules, Prometheus confinement, unknown-identity fail-closed handling, and
  denial of unrestricted shell/interpreter execution for scoped agents.
- **Supervisor:** strict contract parsing, exact/fresh evidence matching,
  serialized durable state, deduplication, and correction caps. A top-level
  Autonomous message initializes state before idle evaluation. Parent lookup
  maps child activity to that run; unrelated sessions do nothing. Corruption
  and SPEC changes fail closed, and blocked runs stay blocked.

The deployment script installs these components globally by default. The visible
root marker `opencode-immutable.json` activates project-local policy. Committed
control-plane inputs remain outside hidden directories; ignored runtime evidence
and supervisor state are written below `.opencode/` in the command's project.
