#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SDK_VERSION="1.17.15"

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

debug_config_dir() {
  command -v opencode >/dev/null 2>&1 || return
  local key value
  while read -r key value; do
    if [[ "$key" == "config" && -n "${value:-}" ]]; then
      printf '%s' "$value"
      return
    fi
  done < <(opencode debug paths 2>/dev/null || true)
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

entry_status() {
  local dst="$1"
  if [[ -L "$dst" ]]; then
    printf '  [link] %s -> %s\n' "$dst" "$(readlink "$dst" || true)"
  elif [[ -e "$dst" ]]; then
    printf '  [copy] %s\n' "$dst"
  else
    printf '  [none] %s\n' "$dst"
  fi
}

backup_entry() {
  local dst="$1"
  local backup="${dst}.bak.$(date +%Y%m%d%H%M%S).$$"
  mv "$dst" "$backup"
  printf 'Backed up existing entry: %s -> %s\n' "$dst" "$backup"
}

sync_entry() {
  local action="$1"
  local mode="$2"
  local src="$3"
  local dst="$4"

  if [[ "$action" == "status" ]]; then
    entry_status "$dst"
    return
  fi

  if [[ "$action" == "remove" ]]; then
    if [[ -L "$dst" ]]; then
      if [[ "$(readlink "$dst" || true)" == "$src" ]]; then
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
    if [[ -L "$dst" && "$(readlink "$dst" || true)" == "$src" ]]; then
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

sync_rule_instructions() {
  local action="$1"
  shift
  local sources=("$@")
  [[ ${#sources[@]} -eq 0 ]] && return
  command -v node >/dev/null 2>&1 || die "node is required to manage opencode.json instructions"
  local dests=()
  local src
  for src in "${sources[@]}"; do
    dests+=("${RULES_DIR}/$(basename "$src")")
  done
  case "$action" in
    install) node "$INSTRUCTIONS_HELPER" add --config "$OPENCODE_JSON" "${dests[@]}" ;;
    remove) node "$INSTRUCTIONS_HELPER" remove --config "$OPENCODE_JSON" "${dests[@]}" ;;
    status) node "$INSTRUCTIONS_HELPER" status --config "$OPENCODE_JSON" "${dests[@]}" ;;
  esac
}

feedback_locator_status() {
  if [[ ! -e "$FEEDBACK_LOCATOR" && ! -L "$FEEDBACK_LOCATOR" ]]; then
    printf 'Feedback locator: missing\n'
    return
  fi
  if [[ -L "$FEEDBACK_LOCATOR" || ! -f "$FEEDBACK_LOCATOR" ]]; then
    printf 'Feedback locator: modified\n'
    return
  fi
  local value
  value="$(<"$FEEDBACK_LOCATOR")"
  if [[ "$value" == "$FEEDBACK_ROOT" ]]; then
    printf 'Feedback locator: current\n'
  elif [[ "$value" == /* && ! -d "$(dirname "$value")" ]]; then
    printf 'Feedback locator: stale\n'
  else
    printf 'Feedback locator: modified\n'
  fi
}

sync_feedback_locator() {
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
  local vendored_modules="${REPO_ROOT}/.opencode/node_modules"
  local vendored_package="${vendored_modules}/@opencode-ai/plugin/package.json"
  local vendored_version=""
  if [[ -f "$vendored_package" ]]; then
    vendored_version="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version)' "$vendored_package")"
  fi
  if [[ "$vendored_version" == "$SDK_VERSION" ]]; then
    mkdir -p "${config_dir}/node_modules"
    cp -R "${vendored_modules}/." "${config_dir}/node_modules/"
  else
    command -v npm >/dev/null 2>&1 || die "npm is required to install the OpenCode tool runtime"
    npm install --prefix "$config_dir" --no-save --no-audit --no-fund "@opencode-ai/plugin@${SDK_VERSION}" >/dev/null
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
  RAW_CONFIG_DIR="$(debug_config_dir)"
fi
[[ -n "$RAW_CONFIG_DIR" ]] || die "Unable to resolve OpenCode config directory. Set --config-dir or OPENCODE_DEPLOY_CONFIG_DIR."

CONFIG_DIR="$(resolve_path "$RAW_CONFIG_DIR")"
AGENTS_DIR="${CONFIG_DIR}/agents"
PLUGINS_DIR="${CONFIG_DIR}/plugins"
TOOLS_DIR="${CONFIG_DIR}/tools"
SKILLS_DIR="${CONFIG_DIR}/skills"
RULES_DIR="${CONFIG_DIR}/rules"
OPENCODE_JSON="${CONFIG_DIR}/opencode.json"
FEEDBACK_LOCATOR_DIR="${CONFIG_DIR}/feedback"
FEEDBACK_LOCATOR="${FEEDBACK_LOCATOR_DIR}/cuddly-winner-feedback-root"
FEEDBACK_ROOT="$(cd "$REPO_ROOT" && pwd -P)/feedback"
[[ "$FEEDBACK_ROOT" != *$'\n'* ]] || die "Repository path cannot contain a newline."
INSTRUCTIONS_HELPER="${SCRIPT_DIR}/opencode-instructions.mjs"
MCP_HELPER="${SCRIPT_DIR}/opencode-mcp-config.mjs"

shopt -s nullglob
AGENT_SOURCES=("${REPO_ROOT}"/agents/*.md)
SKILL_SOURCES=("${REPO_ROOT}"/skills/*)
RULE_SOURCES=("${REPO_ROOT}"/rules/*.md)
shopt -u nullglob
PLUGIN_SOURCES=("${REPO_ROOT}/plugins/immutability.ts")
PLUGIN_MODE="copy"
TOOL_SOURCES=(
  "${REPO_ROOT}/tools/scaffold_gitignore.ts"
  "${REPO_ROOT}/tools/spike.ts"
  "${REPO_ROOT}/tools/validate_scaffold.ts"
)

printf 'Action: %s\n' "$ACTION"
printf 'Mode: %s\n' "$MODE"
printf 'OpenCode config dir: %s\n' "$CONFIG_DIR"

if [[ "$ACTION" == "status" || "$ACTION" == "remove" ]]; then
  sync_group "Agents" "$AGENTS_DIR" "$ACTION" "$MODE" "${AGENT_SOURCES[@]}"
  sync_group "Plugins" "$PLUGINS_DIR" "$ACTION" "$PLUGIN_MODE" "${PLUGIN_SOURCES[@]}"
  sync_group "Workflow tools" "$TOOLS_DIR" "$ACTION" "$MODE" "${TOOL_SOURCES[@]}"
  sync_group "Skills" "$SKILLS_DIR" "$ACTION" "$MODE" "${SKILL_SOURCES[@]}"
  sync_group "Rules" "$RULES_DIR" "$ACTION" "$MODE" "${RULE_SOURCES[@]}"
  sync_rule_instructions "$ACTION" "${RULE_SOURCES[@]}"
  node "$MCP_HELPER" "$ACTION" --config "$OPENCODE_JSON"
  sync_feedback_locator
  exit 0
fi

sync_group "Agents" "$AGENTS_DIR" "$ACTION" "$MODE" "${AGENT_SOURCES[@]}"
sync_group "Plugins" "$PLUGINS_DIR" "$ACTION" "$PLUGIN_MODE" "${PLUGIN_SOURCES[@]}"
sync_group "Workflow tools" "$TOOLS_DIR" "$ACTION" "$MODE" "${TOOL_SOURCES[@]}"
install_tool_sdk "$CONFIG_DIR"
sync_group "Skills" "$SKILLS_DIR" "$ACTION" "$MODE" "${SKILL_SOURCES[@]}"
sync_group "Rules" "$RULES_DIR" "$ACTION" "$MODE" "${RULE_SOURCES[@]}"
sync_rule_instructions "$ACTION" "${RULE_SOURCES[@]}"
node "$MCP_HELPER" "$ACTION" --config "$OPENCODE_JSON"
sync_feedback_locator

# Remove known retired artifacts that earlier installs may have left behind.
for retired in \
  "${PLUGINS_DIR}/opencode-autonomous-supervisor.js" \
  "${PLUGINS_DIR}/opencode-autonomous-supervisor" \
  "${TOOLS_DIR}/run.ts"; do
  if [[ -e "$retired" || -L "$retired" ]]; then
    rm -rf "$retired"
    printf 'Removed retired artifact: %s\n' "$retired"
  fi
done

printf 'Done. Restart OpenCode to load changed agents, plugins, or tools.\n'
