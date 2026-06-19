# Shell and Script Portability Conventions

This project targets **macOS and Linux** with identical behavior on both.

---

## Python environment — MANDATORY

**NEVER run against the system Python. NEVER use pixi, poetry, pipenv, conda, or pdm.**

This project uses **pyenv + virtualenv** exclusively. Before running any `python3`
command in a script or agent:

1. Confirm a virtualenv is active:
   `python3 -c "import sys; assert sys.prefix != sys.base_prefix, 'NOT IN A VENV'"`
2. If no venv is active, stop and surface an error. Do not fall back to system Python.
3. Never create a virtualenv with any tool other than pyenv.

Violating this rule corrupts the user's system Python and poisons test results.
This is not a suggestion. It is a hard rule enforced at the top of `AGENTS.md`.

---

## The core rule

> **Detect the shell. Delegate to the right interpreter. Never assume.**

A script that needs a specific shell should detect whether it is running under
that shell and re-exec itself under the correct one if not. Logic that is more
than a one-liner belongs in Python, not shell — Python is available on both
OSes and behaves identically.

---

## Why this matters

OpenCode's `bash` tool executes commands using **the user's login shell
(`$SHELL`)** — `/bin/zsh` on macOS, `/bin/bash` on most Linux systems.
The same command string can silently misbehave depending on which shell runs
it: array indexing, regex capture variables, `shopt`, and `$BASH_VERSION`
guards all differ between bash and zsh.

This is confirmed behavior, not hypothetical. Running `echo $0` inside the
`bash` tool on this Mac returns `/bin/zsh`.

The deploy script (`scripts/deploy-opencode-agents.sh`) is fine: it is
explicitly invoked as `bash <script>` by the validator and carries
`#!/usr/bin/env bash`. Agent-emitted runtime commands are the risk surface.

---

## Rule 1 — Scripts that need bash: re-exec themselves

If a script requires bash, it detects whether it is running under bash and
re-execs itself with `bash` if not. This means it always runs correctly
regardless of the caller's `$SHELL`:

```sh
#!/usr/bin/env sh
# Re-exec under bash if we are not already running under it.
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
# --- bash-specific code below this line is safe ---
set -euo pipefail
arr=(one two three)
echo "${arr[0]}"
```

The deploy script already uses `#!/usr/bin/env bash` and is always called
explicitly as `bash deploy-opencode-agents.sh`, so it does not need the
re-exec guard. Apply the guard to any new script that might be sourced or
called without an explicit interpreter prefix.

---

## Rule 2 — Anything non-trivial: use Python

If the logic involves file parsing, JSON, arithmetic, loops over collections,
or more than three shell commands chained together, write it in Python.

```sh
# Instead of a fragile shell pipeline, delegate:
python3 - <<'EOF'
import json, pathlib
data = json.loads(pathlib.Path("results.json").read_text())
print(data["f1"])
EOF
```

Python sub-scripts can live in `scripts/` as standalone `.py` files. Shell
scripts call them with `python3 scripts/helper.py`.

---

## Rule 3 — Agent-emitted commands: POSIX or explicit bash

Because agents run under `$SHELL`, every command written in `SPEC.md`
Verification blocks, `progress.txt`, or sent to the `bash` tool must be one
of:

1. **POSIX-compatible** — works under any POSIX sh, bash, or zsh.
2. **Explicitly bash-invoked** — `bash -c 'bash-specific-syntax'`.
3. **Delegated to Python** — `python3 -c '...'` or `python3 script.py`.

Common substitutions:

| Avoid (bash/zsh-specific) | Use instead |
|---|---|
| `[[ $x =~ pat ]]` + `$BASH_REMATCH` | `echo "$x" \| grep -E 'pat'` |
| `shopt -s globstar; **/*.py` | `find . -name '*.py'` |
| Shell arrays across sh/zsh | Python list |
| `source script.sh` with bashisms | `bash script.sh` |

---

## Rule 4 — Authored scripts must pass shellcheck

Every `*.sh` file must pass `shellcheck -s bash` (or `-s sh` for POSIX-only
scripts) with zero warnings before merge.

Suppress a warning only with an inline directive and a comment:

```sh
# shellcheck disable=SC2206  # intentional glob; nullglob set above
local files=("$src_dir"/$glob)
```

The project validator (`tests/verify_opencode.py`) runs shellcheck in
preflight. It warns if shellcheck is not installed; set
`SHELLCHECK_REQUIRED=1` to make that a hard failure in CI.

---

## Checklist for new shell scripts

- [ ] Uses `#!/usr/bin/env bash` (or `#!/bin/sh` for strict POSIX)
- [ ] Includes bash re-exec guard if it may be called without an explicit interpreter
- [ ] `set -euo pipefail` on line 2 (or `set -eu` for sh)
- [ ] Non-trivial logic delegated to `python3`
- [ ] No `mapfile`/`readarray` — bash 4+ only; macOS ships bash 3.2
- [ ] `shellcheck -s bash <script>` exits 0
