#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SDK_VERSION="1.18.31"
PLAYWRIGHT_VERSION="1.58.2"
YAML_VERSION="2.9.0"
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

Install deploys the Cuddly Winner profile. Status and remove inspect every managed entry.
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
      try {
        const lexical = lstatSync(candidate);
        const existing = realpathSync(candidate);
        if ((!lexical.isDirectory() && !lexical.isSymbolicLink()) || !statSync(existing).isDirectory()) {
          throw new Error(`config-root ancestor is not a directory: ${candidate}`);
        }
        const result = resolve(existing, ...missing);
        if (result === parse(result).root) throw new Error("the filesystem root cannot be an OpenCode config root");
        process.stdout.write(result);
        break;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        const parent = dirname(candidate);
        if (parent === candidate) throw new Error("no existing config-root ancestor");
        missing.unshift(basename(candidate));
        candidate = parent;
      }
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
    const relation = relative(root, destination);
    if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
      process.stderr.write(`managed destination escapes config root: ${destination}\n`);
      process.exit(1);
    }
    const parents = relative(root, dirname(destination));
    let current = root;
    for (const part of parents ? parents.split(sep) : []) {
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
        if (error?.code !== "ENOENT") throw error;
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
    process.exit(resolve(dirname(destination), readlinkSync(destination)) === resolve(source) ? 0 : 1);
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

sync_retired_agents() {
  local state_file="$1"
  local name source expected_sha256 dst output state_failed=0
  local source_args=()
  local agent_source
  assert_managed_destination "$state_file"
  for agent_source in "${AGENT_SOURCES[@]}"; do
    source_args+=(--source "$agent_source")
  done
  if [[ "$ACTION" == "status" ]]; then
    if output="$(node "$AGENT_STATE_HELPER" status --state "$state_file" "${source_args[@]}")"; then
      [[ -z "$output" ]] || printf '%s\n' "$output"
    else
      [[ -z "$output" ]] || printf '%s\n' "$output"
      mark_managed_entry_drift
      state_failed=1
    fi
  fi
  if ! output="$(node "$AGENT_STATE_HELPER" retired --state "$state_file" "${source_args[@]}")"; then
    if [[ "$ACTION" == "status" ]]; then
      [[ "$state_failed" == 1 ]] || printf 'Managed agent state: error\n'
      mark_managed_entry_drift
      return
    fi
    die "Unable to read managed agent state"
  fi
  while IFS=$'\t' read -r name source expected_sha256; do
    [[ -n "$name" ]] || continue
    dst="${AGENTS_DIR}/${name}"
    assert_managed_destination "$dst"
    if [[ "$ACTION" == "status" ]]; then
      if links_equal "$source" "$dst"; then
        printf '  [retired link] %s -> %s\n' "$dst" "$source"
        mark_managed_entry_drift
      elif [[ -f "$dst" && "$(node -e 'const { createHash } = require("node:crypto"); const { readFileSync } = require("node:fs"); process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"))' "$dst")" == "$expected_sha256" ]]; then
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
  done <<< "$output"
}

record_agent_state() {
  local source_args=()
  local agent_source
  for agent_source in "${AGENT_SOURCES[@]}"; do
    source_args+=(--source "$agent_source")
  done
  node "$AGENT_STATE_HELPER" record --state "$AGENT_STATE_FILE" --mode "$MODE" "${source_args[@]}"
}

sync_retired_assets() {
  if ! node "$RETIRED_ASSETS_HELPER" "$ACTION" --root "$CONFIG_DIR" --repo "$REPO_ROOT"; then
    if [[ "$ACTION" == "status" ]]; then
      mark_status_drift
    else
      die "Unable to inspect retired managed assets"
    fi
  fi
  rmdir "$SKILLS_DIR" 2>/dev/null || true
}

sync_feedback_locator() {
  assert_managed_destination "$FEEDBACK_LOCATOR"
  [[ -e "$FEEDBACK_LOCATOR" || -L "$FEEDBACK_LOCATOR" ]] || return 0
  local expected="${REPO_ROOT}/feedback"
  if [[ -f "$FEEDBACK_LOCATOR" && ! -L "$FEEDBACK_LOCATOR" && "$(<"$FEEDBACK_LOCATOR")" == "$expected" ]]; then
    if [[ "$ACTION" == "status" ]]; then
      printf '  [retired managed feedback locator] %s\n' "$FEEDBACK_LOCATOR"
      mark_status_drift
    else
      rm -f "$FEEDBACK_LOCATOR"
      printf 'Removed retired managed feedback locator: %s\n' "$FEEDBACK_LOCATOR"
    fi
  else
    printf 'Retired feedback locator conflict: %s (ownership not proven; preserved)\n' "$FEEDBACK_LOCATOR"
    [[ "$ACTION" == "status" ]] && mark_status_drift
  fi
}

legacy_rule_present() {
  node -e '
    const { existsSync, readFileSync } = require("node:fs");
    const [config, retired] = process.argv.slice(1);
    if (!existsSync(config)) process.exit(1);
    try {
      const value = JSON.parse(readFileSync(config, "utf8"));
      process.exit(Array.isArray(value.instructions) && value.instructions.includes(retired) ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' "$OPENCODE_JSON" "${RULES_DIR}/writing-and-output.md"
}

sync_rule_instructions() {
  local current="${RULES_DIR}/resource-selection.md"
  local retired="${RULES_DIR}/writing-and-output.md"
  case "$ACTION" in
    install)
      if [[ ! -e "$retired" && ! -L "$retired" ]]; then
        node "$INSTRUCTIONS_HELPER" remove --config "$OPENCODE_JSON" "$retired"
      else
        printf 'Retired rule instruction conflict: %s (ownership not proven; preserved)\n' "$retired"
      fi
      node "$INSTRUCTIONS_HELPER" add --config "$OPENCODE_JSON" "$current"
      ;;
    remove)
      node "$INSTRUCTIONS_HELPER" remove --config "$OPENCODE_JSON" "$current"
      if [[ ! -e "$retired" && ! -L "$retired" ]]; then
        node "$INSTRUCTIONS_HELPER" remove --config "$OPENCODE_JSON" "$retired"
      else
        printf 'Retired rule instruction conflict: %s (ownership not proven; preserved)\n' "$retired"
      fi
      ;;
    status)
      if ! node "$RULE_INSTRUCTIONS_STATUS_HELPER" status --config "$OPENCODE_JSON" "$current"; then
        mark_status_drift
      fi
      if legacy_rule_present; then
        printf '  [retired managed rule instruction] %s\n' "$retired"
        mark_status_drift
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
  local vendored_yaml="${vendored_modules}/yaml/package.json"
  local vendored_version=""
  local vendored_playwright_version=""
  local vendored_yaml_version=""
  local stage_root stage_runtime
  assert_managed_destination "${config_dir}/node_modules/@opencode-ai/plugin/package.json"
  assert_managed_destination "${config_dir}/node_modules/playwright/package.json"
  if [[ -f "$vendored_package" ]]; then
    vendored_version="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version)' "$vendored_package")"
  fi
  if [[ -f "$vendored_playwright" ]]; then
    vendored_playwright_version="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version)' "$vendored_playwright")"
  fi
  if [[ -f "$vendored_yaml" ]]; then
    vendored_yaml_version="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version)' "$vendored_yaml")"
  fi
  stage_root="$(mktemp -d "${config_dir}/.cuddly-winner-runtime-stage.XXXXXX")"
  stage_runtime="${stage_root}/node_modules"
  assert_managed_destination "$stage_runtime"
  if [[ "$vendored_version" == "$SDK_VERSION" && "$vendored_playwright_version" == "$PLAYWRIGHT_VERSION" && "$vendored_yaml_version" == "$YAML_VERSION" ]]; then
    if ! mkdir -p "$stage_runtime" || ! cp -R "${vendored_modules}/." "${stage_runtime}/"; then
      rm -rf "$stage_root"
      die "Unable to copy the pinned OpenCode tool runtime into a clean staging directory"
    fi
  else
    command -v npm >/dev/null 2>&1 || die "npm is required to install the OpenCode tool runtime"
    if ! PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefix "$stage_root" --no-save --no-audit --no-fund "@opencode-ai/plugin@${SDK_VERSION}" "playwright@${PLAYWRIGHT_VERSION}" "yaml@${YAML_VERSION}" >/dev/null; then
      rm -rf "$stage_root"
      die "Unable to install the OpenCode tool runtime in a clean staging directory"
    fi
  fi
  if ! node -e '
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const [root, sdk, playwright, yaml] = process.argv.slice(1);
    const version = name => JSON.parse(readFileSync(join(root, name, "package.json"), "utf8")).version;
    process.exit(version("@opencode-ai/plugin") === sdk && version("playwright") === playwright && version("yaml") === yaml ? 0 : 1);
  ' "$stage_runtime" "$SDK_VERSION" "$PLAYWRIGHT_VERSION" "$YAML_VERSION"; then
    rm -rf "$stage_root"
    die "Clean runtime staging did not produce the pinned package versions"
  fi
  if ! "${stage_runtime}/.bin/playwright" install chromium >/dev/null; then
    rm -rf "$stage_root"
    die "Unable to install the pinned Playwright Chromium build"
  fi
  if ! node -e '
    const { existsSync } = require("node:fs");
    const { chromium } = require(process.argv[1]);
    process.exit(existsSync(chromium.executablePath()) ? 0 : 1);
  ' "${stage_runtime}/playwright"; then
    rm -rf "$stage_root"
    die "Pinned Playwright Chromium build is unavailable after installation"
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

install_browser_control_file() {
  local src="$1"
  local dst="$2"
  assert_config_destination "$dst"
  if entries_equal "$src" "$dst"; then
    printf 'Unchanged: %s\n' "$dst"
    return
  fi
  if [[ -e "$dst" || -L "$dst" ]]; then
    backup_entry "$dst"
  fi
  cp "$src" "$dst"
  printf 'Copied: %s -> %s\n' "$src" "$dst"
}

browser_control_file_status() {
  local src="$1"
  local dst="$2"
  assert_config_destination "$dst"
  if entries_equal "$src" "$dst"; then
    printf '  [current copy] %s\n' "$dst"
  elif [[ -e "$dst" ]]; then
    printf '  [stale or modified copy] %s\n' "$dst"
    mark_status_drift
  else
    printf '  [missing] %s\n' "$dst"
    mark_status_drift
  fi
}

remove_browser_control_file() {
  local src="$1"
  local dst="$2"
  assert_config_destination "$dst"
  if entries_equal "$src" "$dst"; then
    rm -f "$dst"
    printf 'Removed copy: %s\n' "$dst"
  elif [[ -e "$dst" || -L "$dst" ]]; then
    printf 'Skipped modified or unrelated entry: %s\n' "$dst"
  fi
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
  elif ! actual="$(node -e 'const { readFileSync } = require("node:fs"); const value = JSON.parse(readFileSync(process.argv[1], "utf8")); if (typeof value.version !== "string") process.exit(1); process.stdout.write(value.version);' "$package_file" 2>/dev/null)"; then
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
  runtime_package_status "yaml" "$YAML_VERSION"
  if ! node -e '
    const { existsSync } = require("node:fs");
    const { chromium } = require(process.argv[1]);
    process.exit(existsSync(chromium.executablePath()) ? 0 : 1);
  ' "${CONFIG_DIR}/node_modules/playwright"; then
    printf '  [missing] runtime browser: Playwright Chromium\n'
    mark_status_drift
  else
    printf '  [current] runtime browser: Playwright Chromium\n'
  fi
  browser_control_file_status "$BROWSER_MCP_SERVER_SOURCE" "$BROWSER_MCP_SERVER_DEST"
  browser_control_file_status "$BROWSER_STATE_SOURCE" "$BROWSER_STATE_DEST"
  browser_control_file_status "$BROWSER_LOGIN_SOURCE" "$BROWSER_LOGIN_DEST"
  browser_control_file_status "$BROWSER_RUNTIME_SOURCE" "$BROWSER_RUNTIME_DEST"
  browser_control_file_status "$BROWSER_SERVICE_SOURCE" "$BROWSER_SERVICE_DEST"
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

[[ "$MODE" == "copy" || "$MODE" == "symlink" ]] || die "Invalid --mode '$MODE'. Use copy or symlink."
RAW_CONFIG_DIR="${CONFIG_ARG:-${OPENCODE_DEPLOY_CONFIG_DIR:-}}"
if [[ -z "$RAW_CONFIG_DIR" ]]; then
  RAW_CONFIG_DIR="$(debug_config_dir)" || die "Unable to resolve OpenCode config directory. Set --config-dir or OPENCODE_DEPLOY_CONFIG_DIR."
fi
CONFIG_DIR="$(canonical_config_root "$(resolve_path "$RAW_CONFIG_DIR")")" || die "Unable to resolve a safe OpenCode config directory: $RAW_CONFIG_DIR"
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
FEEDBACK_LOCATOR="${CONFIG_DIR}/feedback/cuddly-winner-feedback-root"
INSTRUCTIONS_HELPER="${SCRIPT_DIR}/opencode-instructions.mjs"
RULE_INSTRUCTIONS_STATUS_HELPER="${SCRIPT_DIR}/opencode-rule-instructions.mjs"
MCP_HELPER="${SCRIPT_DIR}/opencode-mcp-config.mjs"
AGENT_STATE_HELPER="${SCRIPT_DIR}/opencode-agent-state.mjs"
RETIRED_ASSETS_HELPER="${SCRIPT_DIR}/opencode-retired-assets.mjs"
RUNTIME_INTEGRITY_HELPER="${SCRIPT_DIR}/opencode-runtime-integrity.mjs"

BROWSER_MCP_SERVER_SOURCE="${SCRIPT_DIR}/opencode-playwright-mcp.mjs"
BROWSER_MCP_SERVER_DEST="${CONFIG_DIR}/opencode-playwright-mcp.mjs"
BROWSER_STATE_SOURCE="${SCRIPT_DIR}/opencode-browser-state.mjs"
BROWSER_STATE_DEST="${CONFIG_DIR}/opencode-browser-state.mjs"
BROWSER_LOGIN_SOURCE="${SCRIPT_DIR}/opencode-browser-login.mjs"
BROWSER_LOGIN_DEST="${CONFIG_DIR}/opencode-browser-login.mjs"
BROWSER_RUNTIME_SOURCE="${SCRIPT_DIR}/opencode-browser-runtime.mjs"
BROWSER_RUNTIME_DEST="${CONFIG_DIR}/opencode-browser-runtime.mjs"
BROWSER_SERVICE_SOURCE="${SCRIPT_DIR}/opencode-browser-service.mjs"
BROWSER_SERVICE_DEST="${CONFIG_DIR}/opencode-browser-service.mjs"

AGENT_SOURCES=(
  "${REPO_ROOT}/agents/ask.md"
  "${REPO_ROOT}/agents/grounder.md"
  "${REPO_ROOT}/agents/prometheus.md"
)
PLUGIN_SOURCES=("${REPO_ROOT}/plugins/immutability.ts" "${REPO_ROOT}/plugins/goal.ts")
TOOL_SOURCES=("${REPO_ROOT}/tools/publish_goal_agent.ts")
RULE_SOURCES=("${REPO_ROOT}/rules/resource-selection.md")

assert_config_destination "$OPENCODE_JSON"
assert_config_destination "$LEGACY_OPENCODE_JSON"

printf 'Action: %s\n' "$ACTION"
printf 'Mode: %s\n' "$MODE"
printf 'OpenCode config dir: %s\n' "$CONFIG_DIR"

if [[ "$ACTION" == "status" || "$ACTION" == "remove" ]]; then
  [[ "$ACTION" == "status" ]] && printf 'Retired agents:\n'
  sync_retired_agents "$AGENT_STATE_FILE"
  sync_retired_assets
  sync_group "Agents" "$AGENTS_DIR" "$ACTION" "$MODE" "${AGENT_SOURCES[@]}"
  sync_group "Plugins" "$PLUGINS_DIR" "$ACTION" "copy" "${PLUGIN_SOURCES[@]}"
  sync_group "Tools" "$TOOLS_DIR" "$ACTION" "$MODE" "${TOOL_SOURCES[@]}"
  sync_group "Rules" "$RULES_DIR" "$ACTION" "$MODE" "${RULE_SOURCES[@]}"
  sync_feedback_locator
  sync_rule_instructions
  if [[ "$ACTION" == "status" ]]; then
    if [[ "$MANAGED_ENTRY_DRIFT" == 0 ]]; then
      printf 'Managed entries: current\n'
    else
      printf 'Managed entries: drifted; run install, then restart OpenCode.\n'
    fi
    if ! node "$MCP_HELPER" status --config "$OPENCODE_JSON"; then
      mark_status_drift
    fi
    if ! node "$MCP_HELPER" status-retired --config "$LEGACY_OPENCODE_JSON"; then
      mark_status_drift
    fi
    runtime_status
    if [[ "$STATUS_DRIFT" == 0 ]]; then
      printf 'Managed profile: current\n'
    else
      printf 'Managed profile: drifted; run install, then restart OpenCode.\n'
    fi
    exit "$STATUS_DRIFT"
  fi
  node "$MCP_HELPER" remove --config "$OPENCODE_JSON"
  node "$MCP_HELPER" remove-retired --config "$LEGACY_OPENCODE_JSON"
  node "$RUNTIME_INTEGRITY_HELPER" remove --root "${CONFIG_DIR}/node_modules" --state "$RUNTIME_INTEGRITY_STATE"
  remove_browser_control_file "$BROWSER_MCP_SERVER_SOURCE" "$BROWSER_MCP_SERVER_DEST"
  remove_browser_control_file "$BROWSER_STATE_SOURCE" "$BROWSER_STATE_DEST"
  remove_browser_control_file "$BROWSER_LOGIN_SOURCE" "$BROWSER_LOGIN_DEST"
  remove_browser_control_file "$BROWSER_RUNTIME_SOURCE" "$BROWSER_RUNTIME_DEST"
  remove_browser_control_file "$BROWSER_SERVICE_SOURCE" "$BROWSER_SERVICE_DEST"
  exit 0
fi

sync_retired_agents "$AGENT_STATE_FILE"
sync_retired_assets
sync_feedback_locator
sync_group "Agents" "$AGENTS_DIR" "$ACTION" "$MODE" "${AGENT_SOURCES[@]}"
record_agent_state
sync_group "Plugins" "$PLUGINS_DIR" "$ACTION" "copy" "${PLUGIN_SOURCES[@]}"
sync_group "Tools" "$TOOLS_DIR" "$ACTION" "$MODE" "${TOOL_SOURCES[@]}"
install_tool_sdk "$CONFIG_DIR"
install_browser_control_file "$BROWSER_MCP_SERVER_SOURCE" "$BROWSER_MCP_SERVER_DEST"
install_browser_control_file "$BROWSER_STATE_SOURCE" "$BROWSER_STATE_DEST"
install_browser_control_file "$BROWSER_LOGIN_SOURCE" "$BROWSER_LOGIN_DEST"
install_browser_control_file "$BROWSER_RUNTIME_SOURCE" "$BROWSER_RUNTIME_DEST"
install_browser_control_file "$BROWSER_SERVICE_SOURCE" "$BROWSER_SERVICE_DEST"
sync_group "Rules" "$RULES_DIR" "$ACTION" "$MODE" "${RULE_SOURCES[@]}"
sync_rule_instructions
node "$MCP_HELPER" install --config "$OPENCODE_JSON"
if [[ -f "$LEGACY_OPENCODE_JSON" ]]; then
  node "$MCP_HELPER" cleanup-retired --config "$LEGACY_OPENCODE_JSON"
fi

printf 'Done. Restart OpenCode to load changed agents, plugins, or tools.\n'
