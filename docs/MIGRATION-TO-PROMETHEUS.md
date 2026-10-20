# Migrate to Prometheus

[Prometheus][prometheus] is the replacement project for OpenCode V2.
It extends native Plan and Build instead of publishing named Goal Agents.
This guide describes an operator-managed transition, not a Goal-state converter or compatibility runtime.
It does not change Cuddly Winner's existing contract.

## Status and scope

This guide uses Cuddly Winner `0b3e67f` and Prometheus `b9289b7` as its source baseline, dated 2026-10-20.
Check the replacement's current documentation before adopting a later version.

- The Prometheus controller is experimental. It targets OpenCode **2.0.29** and rejects other service versions until qualified.
- Managed process execution currently requires macOS `sandbox-exec`.
  This restriction belongs to the controller, not the separate browser runtime.
- Scripted tests establish mechanics. Real-model qualification and the plain-Build comparison remain incomplete.
- Browser migration and controller installation are separate choices. Neither requires importing an old Goal checkpoint.

The machine used to prepare this guide ran OpenCode 2.0.29.
Its global Cuddly Winner agents and plugins were absent, but `cuddly-winner-browser` remained configured and connected.
That observation does not prove a complete uninstall or browser migration.
Available history did not establish a database purge. No database purge is part of this procedure.

OpenCode V2 retains supported V1 configuration and file-based definitions.
Its plugin and server APIs changed, and terminal settings moved to global `cli.json`.
Cuddly Winner pins the V1 plugin package `@opencode-ai/plugin` at 1.18.31.
Renaming its plugins or configuration fields does not port them to V2.
Use the [OpenCode migration guide][opencode-migration] for upstream changes.

## What changes

| Cuddly Winner | Replacement Prometheus |
| --- | --- |
| Planning-only `prometheus` agent and `publish_goal_agent` | Native Plan and Build with `/spike`, `/grill-me`, and `/goal` |
| `.opencode/agents/generated/<name>.md` | Conversation-derived goal, specification, and controller records |
| Selected Goal Agent implements in its root conversation | Controller creates a fresh Build worker, which retains its conversation through repair |
| `goal_evaluate` and evaluator-only `goal_verdict` | Controller-managed fresh evaluation of the exact candidate |
| `session.metadata.cuddly_winner_goal` | Separate private controller store, without an automatic checkpoint import |
| Exact edit paths and approval-gated Bash, without a shell sandbox | Managed processes enforce authorized file boundaries in enrolled workflows |
| Managed browser tools available to Goal workers | `/browser` remains human-invoked in a separate native conversation, outside enrolled workflows |

There is no separate `/plan` command. Switching to Build alone does not authorize execution.
Ordinary Plan and Build remain available without enrolling a goal.
Do not assume that removing the old immutability plugin preserves its protections in unrelated native sessions.

## 1. Preserve work and choose the configuration root

The checkout tools require Node.js `>=22.22.2 <25` and npm.
Use the Cuddly Winner source revision that supplied your installed files, with its helper dependencies available.
Use the actual configuration directory throughout this procedure.
The examples use:

```sh
CONFIG_DIR="$HOME/.config/opencode"
```

1. Record the installed OpenCode version and the relevant Cuddly Winner source revision.
2. Preserve unfinished work, generated Goal definitions, acceptance criteria, user decisions, and available evaluation evidence.
   Retain prior permissions, consumed allowances, stops, and unknown side effects as historical evidence.
3. Back up the affected configuration, installed profile files, installation receipts, and browser settings and authentication.
   Include applicable project configuration, instruction files, and OpenCode history.
4. Pause active work. Reconcile pending consequential actions before considering another attempt.
5. Complete or cancel browser login handoffs. Stop affected OpenCode clients and services before changing installed files.

Keep backups outside repositories. Use owner-only directories and private authentication files, with modes 0700 and 0600 respectively.
Never print cookies, tokens, or saved browser state into chat or logs.
Use consistent backups or supported exports for OpenCode history. Do not delete or edit its database.

See [OpenCode troubleshooting][opencode-troubleshooting] for service lifecycle and backup precautions.
Do not run API inspection commands during the stopped phase. They can start the service again.

If the old runtime still works, inspect the Goal's state before removal.
If it no longer loads, preserve the available evidence without inventing missing history.
Do not run V1 against configuration already converted to V2-only syntax.

## 2. Remove the old profile deliberately

**The old remover removes the full managed profile, including matching browser runtime files and runtime dependencies.**
It has no workflow-only removal option.
If you want browser access, complete the browser installation below before restarting the affected service.

Removal preserves modified or unrelated entries when ownership is not proven.
Exception: it deletes a file or symlink at the retired `tools/publish_direct_agent.ts` path, including customized copies.
It preserves browser settings and saved sessions, but those files alone do not provide a working browser service.

Account for these legacy-helper limits **before running removal**:

- Configuration helpers target `opencode.json` and legacy `config.json`, using strict JSON.
  Do not run removal against commented or invalid versions of those files.
  Failure can occur after some managed files are already removed.
- The remover does not reconcile `opencode.jsonc` or V2 `cli.json`.
- MCP removal recognizes exact V1-style `mcp.<name>` entries, not native V2 `mcp.servers.<name>` entries.
  A V2 browser registration can remain after its runtime files are removed.

From the Cuddly Winner checkout, inspect the installed inventory:

```sh
bash scripts/deploy-opencode-agents.sh status --config-dir "$CONFIG_DIR"
```

A nonzero status can mean missing or modified entries. It is not an instruction to reinstall the old profile.
Review ownership and backups before removal:

```sh
bash scripts/deploy-opencode-agents.sh remove --config-dir "$CONFIG_DIR"
```

Review preserved customizations and registrations manually. Preserve unrelated configuration and comments.
Check global, project, and ancestor configuration for remaining references to removed plugins, tools, rules, and TUI assets.
If you retain the browser, let the new installer consume a recognized legacy registration.
Otherwise remove only the confirmed old browser registration and its obsolete instruction references.

Global profile removal does not remove project-local generated Goal Agent files.
Archive retired definitions outside discovered agent directories after preserving their evidence.
Do not select them as replacement Prometheus workers.

Do not run the old remover after the new browser migration. It can change configuration recorded by the new receipt.

## 3. Install the controller, if wanted

Follow the replacement's [package guide][package-guide] for packaging, dependencies, configuration, and user-selected limits.
Install the packaged controller outside projects that its workers can modify.
Do not load active controller code from a worker-writable checkout.
Keep its private state outside the target project.

Add the package through V2's `plugins` configuration without replacing unrelated settings.
Choose your own model and resource allowance before paid execution.
The package supplies no hidden default allowance, and its observed cost estimate is not a billing guarantee.
Review native permissions rather than assuming old permission names or defaults still apply.
Native V2 rules use `shell` and `subagent` instead of `bash` and `task`.
V2 allows `external_directory` by default. Add an explicit `ask` rule if you require external-path prompts.

Complete controller configuration and other planned edits to the browser's configuration file **before** browser migration.
The browser receipt hashes the whole file. Later edits cause drift and prevent automatic rollback.

After the restart in section 5, start a fresh native conversation for unfinished Cuddly Winner work.
Use retained definitions and evidence as reference material, not as executable authority or imported runtime state.
Agree on the remaining outcome, criteria, permissions, and limits.
Preserve prior consumption and unresolved effects. A new controller does not authorize renewed spending or replay.

Use `/goal` in Plan to prepare the goal.
Explicitly request execution in Build when ready.
The controller creates a fresh worker and supplies the specification and relevant evidence, not the entire planning conversation.
See the [runtime reference][runtime-guide] for pause, recovery, and acceptance behavior.

## 4. Migrate the browser separately, if wanted

Run this section from the Prometheus checkout, with the same `CONFIG_DIR` value.
Keep browser tasks, login helpers, and affected OpenCode services stopped.
The `--quiescent` flag asserts that you stopped them. It does not detect active processes.

The helper expects at most one `opencode.json` or `opencode.jsonc`, with native V2 `mcp.servers` when MCP configuration exists.
Convert any remaining V1 MCP configuration using the upstream migration guide first.
This is a helper prerequisite, not a general requirement to rewrite supported OpenCode configuration.
Unrecognized legacy commands or customized resource rules require manual reconciliation.

```sh
npm ci
node scripts/browser-profile.mjs install --config-dir "$CONFIG_DIR" --migrate --quiescent
node scripts/browser-profile.mjs status --config-dir "$CONFIG_DIR"
```

The migration uses these names:

| Old | New |
| --- | --- |
| MCP server `cuddly-winner-browser` | `prometheus-browser` |
| `cuddly-winner-browser.json` | `prometheus-browser.json` |
| `cuddly-winner-sessions/` | `prometheus-sessions/` |
| Login coordination under `cuddly-winner-logins/` | New coordination under `prometheus-logins/`, without copying active handoffs |
| `CUDDLY_WINNER_CONFIG_DIR` and `CUDDLY_WINNER_*` environment settings | `PROMETHEUS_CONFIG_DIR` and corresponding `PROMETHEUS_*` settings |
| Five runtime files directly under the configuration root | Same filenames under `<config_dir>/prometheus-browser/` |

The helper copies settings and saved sessions without deleting the originals.
Missing saved sessions are acceptable. Conflicting destination data prevents replacement.
Nonempty legacy login coordination also prevents migration until you inspect and settle it.
The helper retains a recognized old Node command and `codemode` setting. Without a legacy registration, it uses the current Node executable.

The helper updates matching permission action prefixes in the selected configuration file and replaces the known resource-rule reference.
Review other configuration files, agent files, instructions, and permission patterns separately.
Internal tool names such as `browser_navigate` remain unchanged, but exposed names use the new server prefix.

For `default` or `chromium` channels, install the browser build required by the new runtime:

```sh
node "$CONFIG_DIR/prometheus-browser/node_modules/playwright/cli.js" install chromium
```

An installed Chrome channel has a separate browser dependency.
Do not change the selected channel or execution mode to bypass access denial.
The existing five-file runtime structure, origin restrictions, and private authentication boundary remain in place.
See the replacement's [browser reference][browser-guide] and [installer source][browser-installer] for current procedures.
The installed login helper is now `<config_dir>/prometheus-browser/opencode-browser-login.mjs`.

## 5. Restart and verify

Restart the affected OpenCode service and open a fresh conversation in the target project.
For the managed V2 service, use the following checks.
Replace `/absolute/path/to/target-project` with its absolute directory. URL-encode the directory if necessary.

```sh
opencode service restart
opencode service status
opencode api get /api/info
opencode api get '/api/plugin?location[directory]=/absolute/path/to/target-project'
opencode api get '/api/mcp?location[directory]=/absolute/path/to/target-project'
```

Verify the relevant project location, not only global configuration.

- If you installed the controller, check its loaded version and command availability.
  Files on disk do not prove that a running service loaded them.
- If you migrated the browser, check that only `prometheus-browser` connects.
  Inspect `browser_status` for the selected mode and page health.
  Confirm actual authorized task access after restoring saved login state.
- Check preserved project files and user changes.
  New acceptance requires fresh independent evidence for the current candidate.

Scripted controller and browser tests do not establish arbitrary live outcomes or real-model reliability.
Read the replacement's [qualification reference][qualification-guide] before relying on its experimental automation.

## Recovery and rollback

An unchanged successful browser installation is a no-op when repeated.
Drift, conflicting data, an existing unowned runtime directory, or an interrupted installation requires inspection.
Failed dependency preparation can leave an incomplete runtime directory without changing the registration.
Do not delete locks, receipts, or private data merely to force another attempt.

The browser helper records `prometheus-browser-migration.json` and private backups under `prometheus-browser-backups/`.
Treat receipts and backups as sensitive because they can contain prior configuration or authentication data.
Automatic rollback requires unchanged hashes for every recorded file, including the entire configuration and copied session files.
Later edits require reviewed manual reconciliation. Do not discard them to satisfy the receipt.

From the Prometheus checkout, after stopping affected activity again:

```sh
node scripts/browser-profile.mjs rollback --config-dir "$CONFIG_DIR" --quiescent
```

Rollback restores recorded pre-install bytes. It does not reinstall old files or dependencies removed in section 2.
Restore those from your private backup before enabling a restored legacy browser registration.
The helper's `remove` operation also restores pre-install configuration, but retains copied settings and sessions.
Both operations retain private backups and the dependency directory. Neither is a data purge.

For controller rollback, stop owned work and reconcile uncertain effects first.
Remove only its plugin registration, preserving unrelated settings, artifacts, and private evidence.
Restart the affected service. Restore the old profile only with its matching runtime and compatible configuration.
Neither rollback nor a status request authorizes a paused Goal to resume.

[prometheus]: https://github.com/swaynos/prometheus
[package-guide]: https://github.com/swaynos/prometheus/blob/main/packages/prometheus/README.md
[runtime-guide]: https://github.com/swaynos/prometheus/blob/main/docs/PROMETHEUS.md
[browser-guide]: https://github.com/swaynos/prometheus/blob/main/docs/RESOURCE-SELECTION.md
[browser-installer]: https://github.com/swaynos/prometheus/blob/b9289b7bf73da028ffa99a0f69fb9c0ee3632ef7/scripts/browser-profile.mjs
[qualification-guide]: https://github.com/swaynos/prometheus/blob/main/docs/QUALIFICATION.md
[opencode-migration]: https://opencode.ai/v2/docs/migrate-v1
[opencode-troubleshooting]: https://opencode.ai/v2/docs/troubleshooting
