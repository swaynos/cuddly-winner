#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_ENV_FILE="${REPO_ROOT}/.opencode-deploy.local.env"

usage() {
  cat <<'EOF'
Usage:
  deploy-opencode-agents.sh [action] [options]

Actions:
  install (default)   Install agent files into OpenCode global agents directory
  status              Print resolved paths and what would be installed
  remove              Remove managed symlinks for this repo's agent files

Options:
  --source-dir PATH   Source directory containing agent markdown files
  --config-dir PATH   OpenCode config directory
  --agents-dir PATH   OpenCode agents directory
  --mode MODE         Install mode: symlink (default) or copy
  -h, --help          Show this help

Override precedence (highest to lowest):
  1) CLI flags
  2) Environment variables
  3) .opencode-deploy.local.env
  4) opencode debug paths
  5) Script defaults

Environment variables:
  OPENCODE_DEPLOY_SOURCE_DIR
  OPENCODE_DEPLOY_CONFIG_DIR
  OPENCODE_DEPLOY_AGENTS_DIR
  OPENCODE_DEPLOY_MODE
EOF
}

die() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

unquote() {
  local value="$1"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    printf '%s' "${value:1:${#value}-2}"
    return
  fi
  if [[ "$value" == \'*\' && "$value" == *\' ]]; then
    printf '%s' "${value:1:${#value}-2}"
    return
  fi
  printf '%s' "$value"
}

resolve_path() {
  local path="$1"
  local base="$2"
  if [[ -z "$path" ]]; then
    printf ''
    return
  fi

  case "$path" in
    ~) printf '%s' "$HOME" ;;
    ~/*) printf '%s/%s' "$HOME" "${path#~/}" ;;
    /*) printf '%s' "$path" ;;
    *) printf '%s/%s' "$base" "$path" ;;
  esac
}

read_local_env() {
  if [[ ! -f "$LOCAL_ENV_FILE" ]]; then
    return
  fi

  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    local line
    line="$(trim "$raw_line")"
    [[ -z "$line" || "$line" == \#* ]] && continue

    if [[ "$line" != *=* ]]; then
      continue
    fi

    local key="${line%%=*}"
    local value="${line#*=}"
    key="$(trim "$key")"
    value="$(trim "$value")"
    value="$(unquote "$value")"

    case "$key" in
      OPENCODE_DEPLOY_SOURCE_DIR) FILE_SOURCE_DIR="$value" ;;
      OPENCODE_DEPLOY_CONFIG_DIR) FILE_CONFIG_DIR="$value" ;;
      OPENCODE_DEPLOY_AGENTS_DIR) FILE_AGENTS_DIR="$value" ;;
      OPENCODE_DEPLOY_MODE) FILE_MODE="$value" ;;
    esac
  done < "$LOCAL_ENV_FILE"
}

extract_debug_path() {
  local key="$1"
  local output
  output="$(opencode debug paths 2>/dev/null || true)"
  if [[ -z "$output" ]]; then
    printf ''
    return
  fi
  printf '%s\n' "$output" | awk -v key="$key" '$1==key { $1=""; sub(/^[[:space:]]+/, ""); print; exit }'
}

path_or_default() {
  local cli="$1"
  local envv="$2"
  local filev="$3"
  local fallback="$4"

  if [[ -n "$cli" ]]; then
    printf '%s' "$cli"
    return
  fi
  if [[ -n "$envv" ]]; then
    printf '%s' "$envv"
    return
  fi
  if [[ -n "$filev" ]]; then
    printf '%s' "$filev"
    return
  fi
  printf '%s' "$fallback"
}

ACTION="install"
CLI_SOURCE_DIR=""
CLI_CONFIG_DIR=""
CLI_AGENTS_DIR=""
CLI_MODE=""

if [[ $# -gt 0 ]]; then
  case "$1" in
    install|status|remove)
      ACTION="$1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
  esac
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-dir)
      CLI_SOURCE_DIR="${2:-}"
      shift 2
      ;;
    --config-dir)
      CLI_CONFIG_DIR="${2:-}"
      shift 2
      ;;
    --agents-dir)
      CLI_AGENTS_DIR="${2:-}"
      shift 2
      ;;
    --mode)
      CLI_MODE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

FILE_SOURCE_DIR=""
FILE_CONFIG_DIR=""
FILE_AGENTS_DIR=""
FILE_MODE=""
read_local_env

DEBUG_CONFIG_DIR="$(extract_debug_path config)"

RAW_CONFIG_DIR="$(path_or_default "$CLI_CONFIG_DIR" "${OPENCODE_DEPLOY_CONFIG_DIR:-}" "$FILE_CONFIG_DIR" "$DEBUG_CONFIG_DIR")"
RAW_AGENTS_DIR="$(path_or_default "$CLI_AGENTS_DIR" "${OPENCODE_DEPLOY_AGENTS_DIR:-}" "$FILE_AGENTS_DIR" "")"
RAW_SOURCE_DIR="$(path_or_default "$CLI_SOURCE_DIR" "${OPENCODE_DEPLOY_SOURCE_DIR:-}" "$FILE_SOURCE_DIR" "${REPO_ROOT}/agents")"
MODE="$(path_or_default "$CLI_MODE" "${OPENCODE_DEPLOY_MODE:-}" "$FILE_MODE" "symlink")"

if [[ -z "$RAW_CONFIG_DIR" ]]; then
  die "Unable to resolve OpenCode config directory. Set --config-dir or OPENCODE_DEPLOY_CONFIG_DIR."
fi

CONFIG_DIR="$(resolve_path "$RAW_CONFIG_DIR" "$REPO_ROOT")"
if [[ -z "$RAW_AGENTS_DIR" ]]; then
  RAW_AGENTS_DIR="${CONFIG_DIR}/agents"
fi
AGENTS_DIR="$(resolve_path "$RAW_AGENTS_DIR" "$REPO_ROOT")"
SOURCE_DIR="$(resolve_path "$RAW_SOURCE_DIR" "$REPO_ROOT")"

if [[ "$MODE" != "symlink" && "$MODE" != "copy" ]]; then
  die "Invalid --mode '$MODE'. Use 'symlink' or 'copy'."
fi

if ! command -v opencode >/dev/null 2>&1; then
  die "opencode not found in PATH"
fi

[[ -d "$SOURCE_DIR" ]] || die "Source directory does not exist: $SOURCE_DIR"

shopt -s nullglob
AGENT_FILES=("$SOURCE_DIR"/*.md)
shopt -u nullglob

if [[ ${#AGENT_FILES[@]} -eq 0 ]]; then
  die "No .md agent files found in source directory: $SOURCE_DIR"
fi

printf 'Action: %s\n' "$ACTION"
printf 'Mode: %s\n' "$MODE"
printf 'Source dir: %s\n' "$SOURCE_DIR"
printf 'OpenCode config dir: %s\n' "$CONFIG_DIR"
printf 'OpenCode agents dir: %s\n' "$AGENTS_DIR"
printf 'Agent files: %s\n' "${#AGENT_FILES[@]}"

if [[ "$ACTION" == "status" ]]; then
  for src in "${AGENT_FILES[@]}"; do
    base="$(basename "$src")"
    dst="${AGENTS_DIR}/${base}"
    if [[ -L "$dst" ]]; then
      target="$(readlink "$dst" || true)"
      printf '  [link] %s -> %s\n' "$dst" "$target"
    elif [[ -f "$dst" ]]; then
      printf '  [file] %s\n' "$dst"
    else
      printf '  [none] %s\n' "$dst"
    fi
  done
  exit 0
fi

mkdir -p "$AGENTS_DIR"

if [[ "$ACTION" == "remove" ]]; then
  for src in "${AGENT_FILES[@]}"; do
    base="$(basename "$src")"
    dst="${AGENTS_DIR}/${base}"

    if [[ -L "$dst" ]]; then
      target="$(readlink "$dst" || true)"
      if [[ "$target" == "$src" ]]; then
        rm -f "$dst"
        printf 'Removed link: %s\n' "$dst"
      else
        printf 'Skipped link with different target: %s\n' "$dst"
      fi
    else
      printf 'Skipped non-link: %s\n' "$dst"
    fi
  done
  exit 0
fi

timestamp="$(date +%Y%m%d%H%M%S)"
for src in "${AGENT_FILES[@]}"; do
  base="$(basename "$src")"
  dst="${AGENTS_DIR}/${base}"

  if [[ "$MODE" == "symlink" ]]; then
    if [[ -L "$dst" ]]; then
      rm -f "$dst"
    elif [[ -e "$dst" ]]; then
      backup="${dst}.bak.${timestamp}"
      mv "$dst" "$backup"
      printf 'Backed up existing file: %s -> %s\n' "$dst" "$backup"
    fi
    ln -s "$src" "$dst"
    printf 'Linked: %s -> %s\n' "$dst" "$src"
  else
    cp "$src" "$dst"
    printf 'Copied: %s -> %s\n' "$src" "$dst"
  fi
done

printf 'Done. Start OpenCode anywhere and invoke an agent by filename, e.g. @prometheus, @karpathy, or @autonomous\n'
