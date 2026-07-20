# OpenCode Extension Use Cases

## Purpose

This is a plain-language companion to `USE-CASES.md`. It explains what each
regression case protects, without test-layer detail or implementation jargon.
The canonical requirements remain `README.md`, `REQUIREMENTS.md`, and
`ARCHITECTURE.md`.

## How To Read This Guide

Each row has a stable ID matching the regression catalog. "Expected result" is
the behavior the rebuilt product must deliver. "Must not" identifies the
regression the case prevents.

## Native OpenCode Compatibility

| ID | Use case | Expected result | Must not |
| --- | --- | --- | --- |
| UC-CAN-01 | Durable documents win | README and docs decide product behavior. | Let a temporary SPEC or generated file override them. |
| UC-CAN-02 | Native Plan stays native | Plan works unchanged with no custom setup. | Inspect, restrict, or route Plan through Prometheus. |
| UC-CAN-03 | Native Build stays native | Build keeps its normal tools and Bash behavior. | Replace Build execution with the protected runner. |
| UC-CAN-04 | Unmanaged agents bypass | Unknown and third-party agents are untouched. | Apply managed-agent restrictions to them. |
| UC-CAN-05 | Specialist workflow is opt-in | Users select specialist agents deliberately. | Start a managed workflow automatically. |

## Installation And Platform Support

| ID | Use case | Expected result | Must not |
| --- | --- | --- | --- |
| UC-DEP-01 | Default installation | Install six specialist agents and the identity hook. | Install the runner, supervisor, skills, or this repository's AGENTS file. |
| UC-DEP-02 | Autonomous installation | `--with-autonomous` adds the supervisor, runner, and publication tool. | Make those components part of the default install. |
| UC-DEP-03 | Skills installation | `--with-skills` adds optional skills, alone or with Autonomous. | Install optional skills by default. |
| UC-DEP-04 | Safe installation updates | Clean obsolete managed entries while preserving user configuration. | Delete unrelated configuration or leave stale managed files active. |
| UC-DEP-05 | Restart boundary | Explain that OpenCode must restart after profile changes. | Claim that a running process reloads profiles automatically. |
| UC-DEP-06 | Unsupported platforms | Native and non-runner specialist work remains usable. | Degrade Plan or Build because Autonomous execution is unavailable. |

## Identity, Permissions, And Delegation

| ID | Use case | Expected result | Must not |
| --- | --- | --- | --- |
| UC-ID-01 | Delegated identity inheritance | Children retain the topmost managed parent's restrictions. | Escape controls by delegating work or spoofing identity. |
| UC-ID-02 | Ask answers only | Ask gives focused, read-only answers. | Edit files, run commands, or launch implementation. |
| UC-ID-03 | Ask researches narrowly | Ask may ask Grounder for only needed evidence. | Delegate to planners, editors, or arbitrary agents. |
| UC-ID-04 | Prometheus writes only scaffolding | Prometheus creates planning/scaffold artifacts and uses its constrained Gitignore tool. | Edit production files, edit Gitignore directly, or use direct shell. |
| UC-ID-05 | Autonomous is the managed editor | Autonomous edits ordinary project files in the active worktree. | Edit frozen scaffold, coordinator code, protected evidence, or external worktrees. |
| UC-ID-06 | Autonomous gets advisory help only | Autonomous may delegate research, review, and optimization advice. | Hand implementation to native Build. |
| UC-ID-07 | Karpathy advises but never edits | Karpathy suggests one experiment; Autonomous performs edits. | Give Karpathy mutation tools or direct shell access. |
| UC-ID-08 | Reviewer stays advisory | Reviewer returns APPROVE or REQUEST_CHANGES as advice. | Let its verdict complete or block a run automatically. |
| UC-ID-09 | Grounder supplies facts | Grounder returns cited evidence and conflicts. | Let Grounder edit, execute, delegate, or decide product direction. |
| UC-ID-10 | Read-only help may overlap | Research and review can run at the same time. | Allow concurrent project mutation or run-state updates. |

## Prometheus: Triage And Readiness

| ID | Use case | Expected result | Must not |
| --- | --- | --- | --- |
| UC-PRO-01 | Outcome before solution | Identify the user's desired outcome separately from their proposed fix. | Treat a requested implementation as proven correct. |
| UC-PRO-02 | Diagnose defects with evidence | Separate symptom from root cause and inspect related paths. | Accept a reported root cause without evidence. |
| UC-PRO-03 | Consider the smallest solution | Surface credible reuse, configuration, documentation, or no-build options. | Assume new code is always necessary or invent fake alternatives. |
| UC-PRO-04 | Ask focused questions | Ask early questions only when answers would change the work. | Publish with material ambiguity or issue a generic questionnaire. |
| UC-PRO-05 | Avoid unnecessary discovery | Move forward when the request is already clear. | Keep questioning after facts can be investigated. |
| UC-PRO-06 | Research technical facts | Use repository evidence, Grounder, or a bounded spike. | Ask product owners to supply discoverable technical facts. |
| UC-PRO-07 | Respect informed choices | Record and honor a non-safety user override. | Quietly reshape the decision or keep arguing it. |
| UC-PRO-08 | Refuse unsafe publication | Block impossible, unsafe, destructive, inconsistent, or unverifiable work. | Publish because a user insists. |
| UC-PRO-09 | Return material changes to planning | Send changed outcomes, policy, trust, or scope decisions back to Prometheus. | Let Autonomous negotiate or invent product requirements. |

## Scaffold Publication And Git Exclusion

| ID | Use case | Expected result | Must not |
| --- | --- | --- | --- |
| UC-PUB-01 | Complete Ralph handoff | Publish work items, checks, discretion, limits, manifest, then SPEC last. | Mark partial scaffolding ready. |
| UC-PUB-02 | Reuse adequate project checks | A Ralph scaffold can use existing deterministic checks. | Require a custom evaluator when existing checks prove the result. |
| UC-PUB-03 | Isolate and validate custom evaluators | Keep evaluator assets separate and test good, bad, and malformed inputs. | Put evaluator code in production or publish it unvalidated. |
| UC-PUB-04 | Validate paths and inventory | Manifest files stay inside the worktree and evaluator inventory is exact. | Accept missing, absolute, escaping, or unlisted files. |
| UC-PUB-05 | Reject incomplete strategies | Fail closed when a manifest or strategy lacks required information. | Guess missing fields or publish a partial Karpathy setup. |
| UC-GIT-01 | Own one Gitignore block | Safely add or replace the exact generated-artifact block. | Modify arbitrary paths, duplicate the block, or rewrite unrelated rules. |
| UC-GIT-02 | Reject unsafe Gitignore targets | Stop on malformed markers, symlinks, non-files, or escapes. | Guess which block to change or follow unsafe paths. |
| UC-GIT-03 | Warn about tracked artifacts | Report tracked generated files without changing the index. | Stage, unstage, or remove tracked files. |
| UC-PUB-06 | Freeze a published scaffold | Stop a run if its SPEC, manifest, or evaluator changes. | Continue with changed scaffolding or evaluator content. |

## Protected Execution And Startup

| ID | Use case | Expected result | Must not |
| --- | --- | --- | --- |
| UC-RUN-01 | Use protected execution | Commands that influence state run through the protected runner. | Accept direct shell output as trusted evidence. |
| UC-RUN-02 | Bind evidence to worktree and run | Runner stays in the active worktree and records run/scaffold provenance. | Use stale or foreign evidence, or modify outside the worktree. |
| UC-RUN-03 | Bound and redact evidence | Limit execution/output, redact likely credentials, and write evidence atomically. | Leak likely secrets, keep partial evidence, or run indefinitely. |
| UC-RUN-04 | Coordinator decides outcomes | Only fresh protected evidence can change item/run state. | Trust checklists, prose claims, or reviewer verdicts. |
| UC-AUT-01 | Start only top-level Autonomous runs | A direct Autonomous session validates and records protected run state. | Initialize coordination for Plan, Build, or arbitrary child sessions. |
| UC-AUT-02 | Block bad scaffolds | Missing, invalid, or changed publication artifacts block the run. | Invent missing scaffold content or continue after a fingerprint change. |
| UC-AUT-03 | Treat scope as a contract | Only in-scope iteration changes can pass. | Use scope to grant extra permissions. |
| UC-AUT-04 | Default to Ralph | Use Ralph unless explicit optimization intent and a valid Karpathy setup exist. | Select Karpathy from incidental files or free-form text. |
| UC-AUT-05 | Repair locally, replan materially | Fix reversible implementation issues locally; return material decisions to planning. | Treat material outcome, trust, or policy changes as ordinary repairs. |

## Ralph: General Iterative Implementation

| ID | Use case | Expected result | Must not |
| --- | --- | --- | --- |
| UC-RAL-01 | Keep coordination simple | One coordinator, worktree, durable state file, worker, and active item per run. | Add parallel mutation, DAG orchestration, messaging, or general checkpoints. |
| UC-RAL-02 | Use fresh workers on one item | Each iteration starts fresh and reserves one highest-priority item. | Depend on transcript memory or work unrelated items together. |
| UC-RAL-03 | Protect state and record handoffs | Coordinator controls item states and records each iteration's useful handoff. | Let workers edit run state or require a literal handoff footer. |
| UC-RAL-04 | Pass items with fresh checks | Run focused protected verification for the selected item. | Pass from stale output, file changes, or model claims. |
| UC-RAL-05 | Fully verify before completion | Run exact full-SPEC verification whenever the run may be done. | Infer total success from item checks alone. |
| UC-RAL-06 | Finish simple work in one iteration | Stop immediately after the first worker proves complete success. | Launch another worker just because Ralph is iterative. |
| UC-RAL-07 | Repair within bounds | Start a fresh repair iteration using durable worktree and handoff context. | Auto-commit, require checkpoints, or replan normal debugging. |
| UC-RAL-08 | Measure progress honestly | Count item transitions, new evidence, or proven blockers as progress and stop at limits. | Treat file mutation as progress or run without bounds. |
| UC-RAL-09 | Establish feedback or stop | First establish deterministic feedback and bounded scope if missing. | Continue open-endedly without either prerequisite. |

## Karpathy: Scalar Optimization

| ID | Use case | Expected result | Must not |
| --- | --- | --- | --- |
| UC-KAR-01 | Require a complete optimization contract | Use Karpathy only with explicit intent, frozen evaluator, metric, baseline, noise, targets, and limits. | Improvise missing optimization machinery or use Karpathy for ordinary features. |
| UC-KAR-02 | Apply one proposed change | Karpathy proposes one bounded experiment and Autonomous applies it. | Batch changes, allow Karpathy edits, or add unrelated optimizations. |
| UC-KAR-03 | Preserve only mutable targets | Save only declared mutable targets and reject immutable/out-of-target changes. | Use a general worktree checkpoint. |
| UC-KAR-04 | Keep or revert from measurements | Use protected measurement and noise threshold to retain or restore an experiment. | Keep changes because a strategist claims they help. |
| UC-KAR-05 | Pivot or stop when bounded | Pivot after declared stagnation; stop at objective or budget. | Repeat a stalled approach indefinitely. |

## Documentation And Release Evidence

| ID | Use case | Expected result | Must not |
| --- | --- | --- | --- |
| UC-DOC-01 | Keep claims consistent | README, docs, prompts, installer help, CI, and delivered behavior agree. | Leave obsolete names, false capabilities, or native-workflow requirements. |
| UC-DOC-02 | Prove each release category | Produce separate evidence for all 14 canonical validation categories. | Count dry-run plumbing or silent skips as release proof. |

## Open Decisions Before Full Automation

The catalog intentionally does not invent unspecified details. Before tests can
assert exact values, durable docs must define the manifest schema, Ralph versus
Karpathy fallback behavior, resource limits, runner threat model, supported
platforms, restart behavior, external research policy, and release-test
thresholds.
