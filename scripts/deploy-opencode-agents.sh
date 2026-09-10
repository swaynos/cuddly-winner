#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SDK_VERSION="1.17.15"
PLAYWRIGHT_VERSION="1.58.2"
MANAGED_ENTRY_DRIFT=0
STATUS_DRIFT=0

mark_managed_entry_drift() {
  MANAGED_ENTRY_DRIFT=1
  STATUS_DRIFT=1
}

mark_status_drift() {
  STATUS_DRIFT=1
}

usage() {
  cat <<'EOF'
Usage:
  deploy-opencode-agents.sh [install|status|remove] [options]

Options:
  --config-dir PATH      OpenCode configuration root
  --mode MODE            Install mode: copy (default) or symlink
  -h, --help             Show this help

Configuration root precedence:
  1) --config-dir
  2) OPENCODE_DEPLOY_CONFIG_DIR
  3) `opencode debug paths`

Install deploys the complete managed profile. Status and remove always inspect
every managed entry.
EOF
}

die() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

resolve_path() {
  local value="$1"
  case "$value" in
    ~) printf '%s' "$HOME" ;;
    ~/*) printf '%s/%s' "$HOME" "${value#~/}" ;;
    /*) printf '%s' "$value" ;;
    *) printf '%s/%s' "$PWD" "$value" ;;
  esac
}

canonical_config_root() {
  node -e '
    const { lstatSync, realpathSync, statSync } = require("node:fs");
    const { basename, dirname, parse, resolve } = require("node:path");
    let candidate = resolve(process.argv[1]);
    const missing = [];
    for (;;) {
      let lexical;
      try {
        lexical = lstatSync(candidate);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const parent = dirname(candidate);
        if (parent === candidate) throw new Error("no existing config-root ancestor");
        missing.unshift(basename(candidate));
        candidate = parent;
        continue;
      }
      const existing = realpathSync(candidate);
      if (!lexical.isDirectory() && !lexical.isSymbolicLink() || !statSync(existing).isDirectory()) {
        throw new Error(`config-root ancestor is not a directory: ${candidate}`);
      }
      const result = resolve(existing, ...missing);
      if (result === parse(result).root) throw new Error("the filesystem root cannot be an OpenCode config root");
      process.stdout.write(result);
      break;
    }
  ' "$1"
}

assert_managed_destination() {
  local destination="$1"
  node -e '
    const { lstatSync } = require("node:fs");
    const { dirname, isAbsolute, join, relative, resolve, sep } = require("node:path");
    const root = resolve(process.argv[1]);
    const destination = resolve(process.argv[2]);
    const destinationRelative = relative(root, destination);
    if (destinationRelative === ".." || destinationRelative.startsWith(`..${sep}`) || isAbsolute(destinationRelative)) {
      process.stderr.write(`managed destination escapes config root: ${destination}\n`);
      process.exit(1);
    }
    const parentRelative = relative(root, dirname(destination));
    let current = root;
    for (const part of parentRelative ? parentRelative.split(sep) : []) {
      current = join(current, part);
      try {
        const stat = lstatSync(current);
        if (stat.isSymbolicLink()) {
          process.stderr.write(`symlinked managed parent: ${current}\n`);
          process.exit(1);
        }
        if (!stat.isDirectory()) {
          process.stderr.write(`non-directory managed parent: ${current}\n`);
          process.exit(1);
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  ' "$CONFIG_DIR" "$destination" || die "Unsafe managed destination: $destination"
}

assert_config_destination() {
  local destination="$1"
  assert_managed_destination "$destination"
  [[ ! -L "$destination" ]] || die "symlinked managed destination leaf: $destination"
}

debug_config_dir() {
  command -v opencode >/dev/null 2>&1 || return 1
  local key value output
  if ! output="$(opencode debug paths 2>/dev/null)"; then
    return 1
  fi
  while read -r key value; do
    if [[ "$key" == "config" && -n "${value:-}" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done <<< "$output"
  return 1
}

entries_equal() {
  local src="$1"
  local dst="$2"
  if [[ -f "$src" && -f "$dst" && ! -L "$dst" ]]; then
    cmp -s "$src" "$dst"
  elif [[ -d "$src" && -d "$dst" && ! -L "$dst" ]]; then
    diff -r -q "$src" "$dst" >/dev/null 2>&1
  else
    return 1
  fi
}

links_equal() {
  local src="$1"
  local dst="$2"
  [[ -L "$dst" ]] || return 1
  node -e '
    const { readlinkSync } = require("node:fs");
    const { dirname, resolve } = require("node:path");
    const [source, destination] = process.argv.slice(1);
    const target = resolve(dirname(destination), readlinkSync(destination));
    process.exit(target === resolve(source) ? 0 : 1);
  ' "$src" "$dst"
}

entry_status() {
  local src="$1"
  local dst="$2"
  if [[ -L "$dst" ]]; then
    if links_equal "$src" "$dst"; then
      printf '  [current link] %s -> %s\n' "$dst" "$(readlink "$dst" || true)"
    else
      printf '  [foreign link] %s -> %s\n' "$dst" "$(readlink "$dst" || true)"
      mark_managed_entry_drift
    fi
  elif entries_equal "$src" "$dst"; then
    printf '  [current copy] %s\n' "$dst"
  elif [[ -e "$dst" ]]; then
    printf '  [stale or modified copy] %s\n' "$dst"
    mark_managed_entry_drift
  else
    printf '  [missing] %s\n' "$dst"
    mark_managed_entry_drift
  fi
}

backup_entry() {
  local dst="$1"
  local relative="${dst#"${CONFIG_DIR}/"}"
  local backup_dir="${CONFIG_DIR}/backups/$(dirname "$relative")"
  local backup="${backup_dir}/$(basename "$dst").bak.$(date +%Y%m%d%H%M%S).$$"
  assert_managed_destination "$backup"
  mkdir -p "$backup_dir"
  mv "$dst" "$backup"
  printf 'Backed up existing entry: %s -> %s\n' "$dst" "$backup"
}

sync_entry() {
  local action="$1"
  local mode="$2"
  local src="$3"
  local dst="$4"
  assert_managed_destination "$dst"

  if [[ "$action" == "status" ]]; then
    entry_status "$src" "$dst"
    return
  fi

  if [[ "$action" == "remove" ]]; then
    if [[ -L "$dst" ]]; then
      if links_equal "$src" "$dst"; then
        rm -f "$dst"
        printf 'Removed link: %s\n' "$dst"
      else
        printf 'Skipped link with different target: %s\n' "$dst"
      fi
    elif entries_equal "$src" "$dst"; then
      rm -rf "$dst"
      printf 'Removed copy: %s\n' "$dst"
    elif [[ -e "$dst" ]]; then
      printf 'Skipped modified or unrelated entry: %s\n' "$dst"
    fi
    return
  fi

  mkdir -p "$(dirname "$dst")"
  if [[ "$mode" == "symlink" ]]; then
    if links_equal "$src" "$dst"; then
      printf 'Unchanged: %s\n' "$dst"
      return
    fi
    if [[ -e "$dst" || -L "$dst" ]]; then
      backup_entry "$dst"
    fi
    ln -s "$src" "$dst"
    printf 'Linked: %s -> %s\n' "$dst" "$src"
    return
  fi

  if entries_equal "$src" "$dst"; then
    printf 'Unchanged: %s\n' "$dst"
    return
  fi
  if [[ -e "$dst" || -L "$dst" ]]; then
    backup_entry "$dst"
  fi
  if [[ -d "$src" ]]; then
    cp -R "$src" "$dst"
  else
    cp "$src" "$dst"
  fi
  printf 'Copied: %s -> %s\n' "$src" "$dst"
}

sync_group() {
  local label="$1"
  local destination="$2"
  local action="$3"
  local mode="$4"
  shift 4
  local sources=("$@")

  printf '%s dir: %s\n' "$label" "$destination"
  printf '%s entries: %s\n' "$label" "${#sources[@]}"
  local src
  for src in "${sources[@]}"; do
    sync_entry "$action" "$mode" "$src" "$destination/$(basename "$src")"
  done
}

sync_discoverable_skill_backups() {
  # Iterate matches directly under nullglob. Bash 3.2 rejects "${empty[@]}"
  # when nounset is set, so no intermediate array is collected here.
  local backup target source name
  assert_managed_destination "${SKILLS_DIR}/.cuddly-winner-parent-check"
  shopt -s nullglob
  for source in "${SKILL_SOURCES[@]}"; do
    name="$(basename "$source")"
    for backup in "${SKILLS_DIR}/${name}.bak."*; do
      if [[ "$ACTION" == "status" ]]; then
        printf '  [discoverable backup] %s\n' "$backup"
        mark_managed_entry_drift
      elif [[ "$ACTION" == "install" ]]; then
        target="${CONFIG_DIR}/backups/skills/$(basename "$backup")"
        assert_managed_destination "$target"
        mkdir -p "$(dirname "$target")"
        mv "$backup" "$target"
        printf 'Relocated discoverable backup: %s -> %s\n' "$backup" "$target"
      fi
    done
  done
  shopt -u nullglob
}

sync_retired_agents() {
  local state_file="$1"
  local name source expected_sha256 dst retired_output state_status_output state_status_failed=0
  local source_args=()
  assert_managed_destination "$state_file"
  local agent_source
  for agent_source in "${AGENT_SOURCES[@]}"; do
    source_args+=(--source "$agent_source")
  done
  if [[ "$ACTION" == "status" ]]; then
    if state_status_output="$(node "$AGENT_STATE_HELPER" status --state "$state_file" "${source_args[@]}")"; then
      printf '%s' "$state_status_output"
      [[ -z "$state_status_output" ]] || printf '\n'
    else
      if [[ -n "$state_status_output" ]]; then
        printf '%s\n' "$state_status_output"
      else
        printf 'Managed agent state: error\n'
      fi
      mark_managed_entry_drift
      state_status_failed=1
    fi
  fi
  if ! retired_output="$(node "$AGENT_STATE_HELPER" retired --state "$state_file" "${source_args[@]}")"; then
    if [[ "$ACTION" == "status" ]]; then
      if [[ "$state_status_failed" == 0 ]]; then
        printf 'Managed agent state: error\n'
      fi
      mark_managed_entry_drift
    else
      return 1
    fi
  fi
  while IFS=$'\t' read -r name source expected_sha256; do
    [[ -n "$name" ]] || continue
    dst="${AGENTS_DIR}/${name}"
    assert_managed_destination "$dst"
    if [[ "$ACTION" == "status" ]]; then
      if links_equal "$source" "$dst"; then
        printf '  [retired link] %s -> %s\n' "$dst" "$source"
        mark_managed_entry_drift
      elif [[ -f "$dst" ]] && [[ "$(node -e 'const { createHash } = require("node:crypto"); const { readFileSync } = require("node:fs"); process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"))' "$dst")" == "$expected_sha256" ]]; then
        printf '  [retired copy] %s\n' "$dst"
        mark_managed_entry_drift
      elif [[ -e "$dst" || -L "$dst" ]]; then
        printf '  [modified or unrelated] %s\n' "$dst"
        mark_managed_entry_drift
      fi
    elif [[ "$ACTION" == "install" || "$ACTION" == "remove" ]]; then
      if links_equal "$source" "$dst" || [[ -f "$dst" && "$(node -e 'const { createHash } = require("node:crypto"); const { readFileSync } = require("node:fs"); process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"))' "$dst")" == "$expected_sha256" ]]; then
        rm -f "$dst"
        printf 'Removed retired agent: %s\n' "$dst"
      elif [[ -e "$dst" || -L "$dst" ]]; then
        printf 'Skipped modified or unrelated retired agent: %s\n' "$dst"
      fi
    fi
  done <<< "$retired_output"
}

git_blob_matches() {
  local file="$1"
  local expected="$2"
  [[ -f "$file" && ! -L "$file" ]] || return 1
  node -e '
    const { createHash } = require("node:crypto");
    const { readFileSync } = require("node:fs");
    const [file, expected] = process.argv.slice(1);
    const bytes = readFileSync(file);
    const actual = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    process.exit(actual === expected ? 0 : 1);
  ' "$file" "$expected"
}

legacy_supervisor_directory_matches() {
  local directory="$1"
  [[ -d "$directory" && ! -L "$directory" ]] || return 1
  node -e '
    const { createHash } = require("node:crypto");
    const { readFileSync, readdirSync } = require("node:fs");
    const { join } = require("node:path");
    const directory = process.argv[1];
    const expected = new Map([
      ["index.js", "e2a671b53677820427c10558b7cceeff932c3a6e"],
      ["package.json", "5f1c68d15f12f1ef34b8769cacf6319a1aa98fcd"],
    ]);
    const entries = readdirSync(directory, { withFileTypes: true });
    if (entries.length !== expected.size || entries.some(entry => !entry.isFile() || !expected.has(entry.name))) process.exit(1);
    for (const entry of entries) {
      const bytes = readFileSync(join(directory, entry.name));
      const actual = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      if (actual !== expected.get(entry.name)) process.exit(1);
    }
  ' "$directory"
}

retired_artifact_owned() {
  local relative="$1"
  local dst="${CONFIG_DIR}/${relative}"
  if [[ -L "$dst" ]] && links_equal "${REPO_ROOT}/${relative}" "$dst"; then
    return 0
  fi
  case "$relative" in
    plugins/opencode-autonomous-supervisor.js)
      git_blob_matches "$dst" "c43313a21bb4c0a05bd3810079b5cad45b650340"
      ;;
    plugins/opencode-autonomous-supervisor)
      legacy_supervisor_directory_matches "$dst"
      ;;
    tools/run.ts)
      git_blob_matches "$dst" "fec121e626de9da1776b0d8167174acb41c8168e"
      ;;
    *)
      return 1
      ;;
  esac
}

remove_owned_retired_artifact() {
  local relative="$1"
  local dst="${CONFIG_DIR}/${relative}"
  if [[ -L "$dst" || -f "$dst" ]]; then
    rm -f "$dst"
  else
    rm -f "$dst/index.js" "$dst/package.json"
    rmdir "$dst"
  fi
  printf 'Removed retired managed artifact: %s\n' "$dst"
}

sync_retired_artifacts() {
  local relative dst
  for relative in \
    plugins/opencode-autonomous-supervisor.js \
    plugins/opencode-autonomous-supervisor \
    tools/run.ts; do
    dst="${CONFIG_DIR}/${relative}"
    assert_managed_destination "$dst"
    [[ -e "$dst" || -L "$dst" ]] || continue
    if retired_artifact_owned "$relative"; then
      if [[ "$ACTION" == "status" ]]; then
        printf '  [retired managed artifact] %s\n' "$dst"
        mark_managed_entry_drift
      else
        remove_owned_retired_artifact "$relative"
      fi
    else
      printf 'Retired artifact conflict: %s (ownership not proven; preserved)\n' "$dst"
      if [[ "$ACTION" == "status" ]]; then
        mark_managed_entry_drift
      fi
    fi
  done
}

record_agent_state() {
  local state_file="$1"
  local source_args=()
  local agent_source
  assert_managed_destination "$state_file"
  for agent_source in "${AGENT_SOURCES[@]}"; do
    source_args+=(--source "$agent_source")
  done
  node "$AGENT_STATE_HELPER" record --state "$state_file" --mode "$MODE" "${source_args[@]}"
}

sync_rule_instructions() {
  local action="$1"
  shift
  local sources=("$@")
  [[ ${#sources[@]} -eq 0 ]] && return
  assert_managed_destination "$OPENCODE_JSON"
  command -v node >/dev/null 2>&1 || die "node is required to manage opencode.json instructions"
  local dests=()
  local src
  for src in "${sources[@]}"; do
    dests+=("${RULES_DIR}/$(basename "$src")")
    assert_managed_destination "${RULES_DIR}/$(basename "$src")"
  done
  case "$action" in
    install) node "$INSTRUCTIONS_HELPER" add --config "$OPENCODE_JSON" "${dests[@]}" ;;
    remove) node "$INSTRUCTIONS_HELPER" remove --config "$OPENCODE_JSON" "${dests[@]}" ;;
    status) node "$RULE_INSTRUCTIONS_STATUS_HELPER" status --config "$OPENCODE_JSON" "${dests[@]}" ;;
  esac
}

feedback_locator_status() {
  if [[ ! -e "$FEEDBACK_LOCATOR" && ! -L "$FEEDBACK_LOCATOR" ]]; then
    printf 'Feedback locator: missing\n'
    mark_status_drift
    return
  fi
  if [[ -L "$FEEDBACK_LOCATOR" || ! -f "$FEEDBACK_LOCATOR" ]]; then
    printf 'Feedback locator: modified\n'
    mark_status_drift
    return
  fi
  local value locator_mode directory_mode
  value="$(<"$FEEDBACK_LOCATOR")"
  if ! locator_mode="$(node -e 'const { lstatSync } = require("node:fs"); process.stdout.write((lstatSync(process.argv[1]).mode & 0o777).toString(8))' "$FEEDBACK_LOCATOR")" ||
     ! directory_mode="$(node -e 'const { lstatSync } = require("node:fs"); process.stdout.write((lstatSync(process.argv[1]).mode & 0o777).toString(8))' "$FEEDBACK_LOCATOR_DIR")"; then
    printf 'Feedback locator: modified\n'
    mark_status_drift
  elif [[ "$value" == "$FEEDBACK_ROOT" && "$locator_mode" == "600" && "$directory_mode" == "700" ]]; then
    printf 'Feedback locator: current\n'
  elif [[ "$value" == /* && ! -d "$(dirname "$value")" ]]; then
    printf 'Feedback locator: stale\n'
    mark_status_drift
  else
    printf 'Feedback locator: modified\n'
    mark_status_drift
  fi
}

sync_feedback_locator() {
  assert_managed_destination "$FEEDBACK_LOCATOR"
  case "$ACTION" in
    status)
      feedback_locator_status
      ;;
    remove)
      if [[ -f "$FEEDBACK_LOCATOR" && ! -L "$FEEDBACK_LOCATOR" && "$(<"$FEEDBACK_LOCATOR")" == "$FEEDBACK_ROOT" ]]; then
        rm -f "$FEEDBACK_LOCATOR"
        printf 'Feedback locator: removed\n'
      elif [[ -e "$FEEDBACK_LOCATOR" || -L "$FEEDBACK_LOCATOR" ]]; then
        printf 'Feedback locator: modified; preserved\n'
      else
        printf 'Feedback locator: missing\n'
      fi
      ;;
    install)
      mkdir -p "$FEEDBACK_LOCATOR_DIR"
      chmod 700 "$FEEDBACK_LOCATOR_DIR"
      if [[ -f "$FEEDBACK_LOCATOR" && ! -L "$FEEDBACK_LOCATOR" && "$(<"$FEEDBACK_LOCATOR")" == "$FEEDBACK_ROOT" ]]; then
        chmod 600 "$FEEDBACK_LOCATOR"
        printf 'Feedback locator: current\n'
      else
        if [[ -e "$FEEDBACK_LOCATOR" || -L "$FEEDBACK_LOCATOR" ]]; then
          backup_entry "$FEEDBACK_LOCATOR"
        fi
        (umask 077 && printf '%s\n' "$FEEDBACK_ROOT" > "$FEEDBACK_LOCATOR")
        chmod 600 "$FEEDBACK_LOCATOR"
        printf 'Feedback locator: installed\n'
      fi
      ;;
  esac
}

install_tool_sdk() {
  local config_dir="$1"
  local runtime_root="${config_dir}/node_modules"
  local vendored_modules="${REPO_ROOT}/node_modules"
  local vendored_package="${vendored_modules}/@opencode-ai/plugin/package.json"
  local vendored_playwright="${vendored_modules}/playwright/package.json"
  local vendored_version=""
  local vendored_playwright_version=""
  local stage_root stage_runtime
  assert_managed_destination "${config_dir}/node_modules/@opencode-ai/plugin/package.json"
  assert_managed_destination "${config_dir}/node_modules/playwright/package.json"
  if [[ -f "$vendored_package" ]]; then
    vendored_version="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version)' "$vendored_package")"
  fi
  if [[ -f "$vendored_playwright" ]]; then
    vendored_playwright_version="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version)' "$vendored_playwright")"
  fi
  stage_root="$(mktemp -d "${config_dir}/.cuddly-winner-runtime-stage.XXXXXX")"
  stage_runtime="${stage_root}/node_modules"
  assert_managed_destination "$stage_runtime"
  if [[ "$vendored_version" == "$SDK_VERSION" && "$vendored_playwright_version" == "$PLAYWRIGHT_VERSION" ]]; then
    if ! mkdir -p "$stage_runtime" || ! cp -R "${vendored_modules}/." "${stage_runtime}/"; then
      rm -rf "$stage_root"
      die "Unable to copy the pinned OpenCode tool runtime into a clean staging directory"
    fi
  else
    if ! command -v npm >/dev/null 2>&1; then
      rm -rf "$stage_root"
      die "npm is required to install the OpenCode tool runtime"
    fi
    if ! PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefix "$stage_root" --no-save --no-audit --no-fund "@opencode-ai/plugin@${SDK_VERSION}" "playwright@${PLAYWRIGHT_VERSION}" >/dev/null; then
      rm -rf "$stage_root"
      die "Unable to install the OpenCode tool runtime in a clean staging directory"
    fi
  fi
  if ! node -e '
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const [root, sdk, playwright] = process.argv.slice(1);
    const version = name => JSON.parse(readFileSync(join(root, name, "package.json"), "utf8")).version;
    process.exit(version("@opencode-ai/plugin") === sdk && version("playwright") === playwright ? 0 : 1);
  ' "$stage_runtime" "$SDK_VERSION" "$PLAYWRIGHT_VERSION"; then
    rm -rf "$stage_root"
    die "Clean runtime staging did not produce the pinned package versions"
  fi

  if [[ -e "$runtime_root" || -L "$runtime_root" ]]; then
    if node "$RUNTIME_INTEGRITY_HELPER" compare --root "$runtime_root" --state "$RUNTIME_INTEGRITY_STATE" --expected-root "$stage_runtime" &&
       node "$RUNTIME_INTEGRITY_HELPER" status --root "$runtime_root" --state "$RUNTIME_INTEGRITY_STATE" >/dev/null; then
      rm -rf "$stage_root"
      printf 'Runtime packages: unchanged clean tree\n'
      return
    fi
    backup_entry "$runtime_root"
  fi
  if ! mv "$stage_runtime" "$runtime_root"; then
    rm -rf "$stage_root"
    die "Unable to activate the clean OpenCode tool runtime; the prior tree remains in backups"
  fi
  rm -rf "$stage_root"
  node "$RUNTIME_INTEGRITY_HELPER" record --root "$runtime_root" --state "$RUNTIME_INTEGRITY_STATE"
  node "$RUNTIME_INTEGRITY_HELPER" status --root "$runtime_root" --state "$RUNTIME_INTEGRITY_STATE" >/dev/null
}

runtime_package_status() {
  local package="$1"
  local expected="$2"
  local package_file="${CONFIG_DIR}/node_modules/${package}/package.json"
  local actual
  assert_managed_destination "$package_file"
  if [[ ! -f "$package_file" || -L "$package_file" ]]; then
    printf '  [missing] runtime package: %s (expected %s)\n' "$package" "$expected"
    mark_status_drift
    return
  fi
  if ! actual="$(node -e '
    const { readFileSync } = require("node:fs");
    const value = JSON.parse(readFileSync(process.argv[1], "utf8"));
    if (typeof value.version !== "string") process.exit(1);
    process.stdout.write(value.version);
  ' "$package_file" 2>/dev/null)"; then
    printf '  [invalid metadata] runtime package: %s (expected %s)\n' "$package" "$expected"
    mark_status_drift
  elif [[ "$actual" == "$expected" ]]; then
    printf '  [current: %s] runtime package: %s\n' "$actual" "$package"
  else
    printf '  [version mismatch: %s] runtime package: %s (expected %s)\n' "$actual" "$package" "$expected"
    mark_status_drift
  fi
}

runtime_status() {
  printf 'Runtime packages:\n'
  runtime_package_status "@opencode-ai/plugin" "$SDK_VERSION"
  runtime_package_status "playwright" "$PLAYWRIGHT_VERSION"
  assert_managed_destination "$RUNTIME_INTEGRITY_STATE"
  if ! node "$RUNTIME_INTEGRITY_HELPER" status --root "${CONFIG_DIR}/node_modules" --state "$RUNTIME_INTEGRITY_STATE"; then
    mark_status_drift
  fi
}

ACTION="install"
MODE="copy"
CONFIG_ARG=""

if [[ $# -gt 0 ]]; then
  case "$1" in
    install|status|remove) ACTION="$1"; shift ;;
    -h|--help) usage; exit 0 ;;
  esac
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-dir)
      [[ $# -ge 2 && -n "$2" ]] || die "--config-dir requires a path"
      CONFIG_ARG="$2"
      shift 2
      ;;
    --mode)
      [[ $# -ge 2 && -n "$2" ]] || die "--mode requires copy or symlink"
      MODE="$2"
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ "$MODE" == "copy" || "$MODE" == "symlink" ]] || die "Invalid --mode '$MODE'. Use 'copy' or 'symlink'."

RAW_CONFIG_DIR="${CONFIG_ARG:-${OPENCODE_DEPLOY_CONFIG_DIR:-}}"
if [[ -z "$RAW_CONFIG_DIR" ]]; then
  if ! RAW_CONFIG_DIR="$(debug_config_dir)"; then
    die "Unable to resolve OpenCode config directory. Set --config-dir or OPENCODE_DEPLOY_CONFIG_DIR."
  fi
fi
[[ -n "$RAW_CONFIG_DIR" ]] || die "Unable to resolve OpenCode config directory. Set --config-dir or OPENCODE_DEPLOY_CONFIG_DIR."

if ! CONFIG_DIR="$(canonical_config_root "$(resolve_path "$RAW_CONFIG_DIR")")"; then
  die "Unable to resolve a safe OpenCode config directory: $RAW_CONFIG_DIR"
fi
if [[ "$ACTION" == "install" ]]; then
  mkdir -p "$CONFIG_DIR"
  CONFIG_DIR="$(cd "$CONFIG_DIR" && pwd -P)"
fi
AGENTS_DIR="${CONFIG_DIR}/agents"
PLUGINS_DIR="${CONFIG_DIR}/plugins"
TOOLS_DIR="${CONFIG_DIR}/tools"
SKILLS_DIR="${CONFIG_DIR}/skills"
RULES_DIR="${CONFIG_DIR}/rules"
OPENCODE_JSON="${CONFIG_DIR}/opencode.json"
LEGACY_OPENCODE_JSON="${CONFIG_DIR}/config.json"
AGENT_STATE_FILE="${AGENTS_DIR}/cuddly-winner-managed.json"
RUNTIME_INTEGRITY_STATE="${CONFIG_DIR}/node_modules/.cuddly-winner-runtime-integrity.json"
FEEDBACK_LOCATOR_DIR="${CONFIG_DIR}/feedback"
FEEDBACK_LOCATOR="${FEEDBACK_LOCATOR_DIR}/cuddly-winner-feedback-root"
FEEDBACK_ROOT="$(cd "$REPO_ROOT" && pwd -P)/feedback"
[[ "$FEEDBACK_ROOT" != *$'\n'* ]] || die "Repository path cannot contain a newline."
INSTRUCTIONS_HELPER="${SCRIPT_DIR}/opencode-instructions.mjs"
RULE_INSTRUCTIONS_STATUS_HELPER="${SCRIPT_DIR}/opencode-rule-instructions.mjs"
MCP_HELPER="${SCRIPT_DIR}/opencode-mcp-config.mjs"
AGENT_STATE_HELPER="${SCRIPT_DIR}/opencode-agent-state.mjs"
RUNTIME_INTEGRITY_HELPER="${SCRIPT_DIR}/opencode-runtime-integrity.mjs"

shopt -s nullglob
AGENT_SOURCES=("${REPO_ROOT}"/agents/*.md)
SKILL_SOURCES=("${REPO_ROOT}"/skills/*)
RULE_SOURCES=("${REPO_ROOT}"/rules/*.md)
shopt -u nullglob
PLUGIN_SOURCES=("${REPO_ROOT}/plugins/immutability.ts" "${REPO_ROOT}/plugins/autonomous-kpis.ts" "${REPO_ROOT}/plugins/announce-hygiene.ts")
PLUGIN_MODE="copy"
SESSION_FETCH_SOURCE="${REPO_ROOT}/tools/session_fetch.ts"
SESSION_FETCH_MODE="copy"
TOOL_SOURCES=(
  "${REPO_ROOT}/tools/scaffold_gitignore.ts"
  "${REPO_ROOT}/tools/spike.ts"
  "${REPO_ROOT}/tools/validate_scaffold.ts"
)

assert_config_destination "$OPENCODE_JSON"
assert_config_destination "$LEGACY_OPENCODE_JSON"

printf 'Action: %s\n' "$ACTION"
printf 'Mode: %s\n' "$MODE"
printf 'OpenCode config dir: %s\n' "$CONFIG_DIR"

if [[ "$ACTION" == "status" || "$ACTION" == "remove" ]]; then
  if [[ "$ACTION" == "status" ]]; then
    printf 'Retired agents:\n'
  fi
  sync_retired_agents "$AGENT_STATE_FILE"
  sync_group "Agents" "$AGENTS_DIR" "$ACTION" "$MODE" "${AGENT_SOURCES[@]}"
  sync_group "Plugins" "$PLUGINS_DIR" "$ACTION" "$PLUGIN_MODE" "${PLUGIN_SOURCES[@]}"
  sync_group "Session fetch tool" "$TOOLS_DIR" "$ACTION" "$SESSION_FETCH_MODE" "$SESSION_FETCH_SOURCE"
  sync_group "Workflow tools" "$TOOLS_DIR" "$ACTION" "$MODE" "${TOOL_SOURCES[@]}"
  sync_group "Skills" "$SKILLS_DIR" "$ACTION" "$MODE" "${SKILL_SOURCES[@]}"
  sync_discoverable_skill_backups
  sync_group "Rules" "$RULES_DIR" "$ACTION" "$MODE" "${RULE_SOURCES[@]}"
  sync_retired_artifacts
  if [[ "$ACTION" == "status" ]]; then
    if [[ "$MANAGED_ENTRY_DRIFT" == 0 ]]; then
      printf 'Managed entries: current\n'
    else
      printf 'Managed entries: drifted; run install, then restart OpenCode.\n'
    fi
    if ! sync_rule_instructions "$ACTION" "${RULE_SOURCES[@]}"; then
      mark_status_drift
    fi
    if ! node "$MCP_HELPER" "$ACTION" --config "$OPENCODE_JSON"; then
      mark_status_drift
    fi
    if ! node "$MCP_HELPER" status-retired --config "$LEGACY_OPENCODE_JSON"; then
      mark_status_drift
    fi
    sync_feedback_locator
    runtime_status
    if [[ "$STATUS_DRIFT" == 0 ]]; then
      printf 'Managed profile: current\n'
    else
      printf 'Managed profile: drifted; run install, then restart OpenCode.\n'
    fi
    exit "$STATUS_DRIFT"
  fi
  sync_rule_instructions "$ACTION" "${RULE_SOURCES[@]}"
  node "$MCP_HELPER" "$ACTION" --config "$OPENCODE_JSON"
  node "$MCP_HELPER" remove-retired --config "$LEGACY_OPENCODE_JSON"
  sync_feedback_locator
  assert_managed_destination "$RUNTIME_INTEGRITY_STATE"
  node "$RUNTIME_INTEGRITY_HELPER" remove --root "${CONFIG_DIR}/node_modules" --state "$RUNTIME_INTEGRITY_STATE"
  exit 0
fi

sync_retired_agents "$AGENT_STATE_FILE"
sync_group "Agents" "$AGENTS_DIR" "$ACTION" "$MODE" "${AGENT_SOURCES[@]}"
sync_retired_artifacts
record_agent_state "$AGENT_STATE_FILE"
sync_group "Plugins" "$PLUGINS_DIR" "$ACTION" "$PLUGIN_MODE" "${PLUGIN_SOURCES[@]}"
sync_group "Session fetch tool" "$TOOLS_DIR" "$ACTION" "$SESSION_FETCH_MODE" "$SESSION_FETCH_SOURCE"
sync_group "Workflow tools" "$TOOLS_DIR" "$ACTION" "$MODE" "${TOOL_SOURCES[@]}"
install_tool_sdk "$CONFIG_DIR"
sync_discoverable_skill_backups
sync_group "Skills" "$SKILLS_DIR" "$ACTION" "$MODE" "${SKILL_SOURCES[@]}"
sync_group "Rules" "$RULES_DIR" "$ACTION" "$MODE" "${RULE_SOURCES[@]}"
sync_rule_instructions "$ACTION" "${RULE_SOURCES[@]}"
node "$MCP_HELPER" "$ACTION" --config "$OPENCODE_JSON"
if [[ "$ACTION" == "install" && -f "$LEGACY_OPENCODE_JSON" ]]; then
  node "$MCP_HELPER" cleanup-retired --config "$LEGACY_OPENCODE_JSON"
fi
sync_feedback_locator

printf 'Done. Restart OpenCode to load changed agents, plugins, or tools.\n'
