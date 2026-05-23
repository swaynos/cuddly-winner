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
  --plugins-dir PATH  OpenCode plugins directory (used with --with-plugins)
  --skills-dir PATH   OpenCode skills directory (used with --with-skills)
  --tools-dir PATH    OpenCode tools directory (used with --with-tools)
  --mode MODE         Install mode: symlink (default) or copy
  --with-plugins      Also install files from plugins/ into OpenCode plugins directory
  --with-skills       Also install skill directories from .opencode/skills/ into OpenCode skills directory
  --with-tools        Also install files from tools/ into OpenCode tools directory
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
  OPENCODE_DEPLOY_PLUGINS_DIR
  OPENCODE_DEPLOY_SKILLS_DIR
  OPENCODE_DEPLOY_TOOLS_DIR
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
      OPENCODE_DEPLOY_SOURCE_DIR)  FILE_SOURCE_DIR="$value" ;;
      OPENCODE_DEPLOY_CONFIG_DIR)  FILE_CONFIG_DIR="$value" ;;
      OPENCODE_DEPLOY_AGENTS_DIR)  FILE_AGENTS_DIR="$value" ;;
      OPENCODE_DEPLOY_PLUGINS_DIR) FILE_PLUGINS_DIR="$value" ;;
      OPENCODE_DEPLOY_SKILLS_DIR)  FILE_SKILLS_DIR="$value" ;;
      OPENCODE_DEPLOY_TOOLS_DIR)   FILE_TOOLS_DIR="$value" ;;
      OPENCODE_DEPLOY_MODE)        FILE_MODE="$value" ;;
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

# Install or remove a set of files (agents, plugins, or tools) into a target dir.
# Usage: install_files <label> <source_dir> <dest_dir> <mode> <action> <glob>
install_files() {
  local label="$1"
  local src_dir="$2"
  local dst_dir="$3"
  local mode="$4"
  local action="$5"
  local glob="$6"

  if [[ ! -d "$src_dir" ]]; then
    printf 'Skipping %s: source directory does not exist: %s\n' "$label" "$src_dir"
    return
  fi

  shopt -s nullglob
  local files=("$src_dir"/$glob)
  shopt -u nullglob

  if [[ ${#files[@]} -eq 0 ]]; then
    printf 'Skipping %s: no files matching %s in %s\n' "$label" "$glob" "$src_dir"
    return
  fi

  printf '%s dir: %s\n' "$label" "$dst_dir"
  printf '%s files: %s\n' "$label" "${#files[@]}"

  if [[ "$action" == "status" ]]; then
    for src in "${files[@]}"; do
      local base dst
      base="$(basename "$src")"
      dst="${dst_dir}/${base}"
      if [[ -L "$dst" ]]; then
        local target
        target="$(readlink "$dst" || true)"
        printf '  [link] %s -> %s\n' "$dst" "$target"
      elif [[ -f "$dst" ]]; then
        printf '  [file] %s\n' "$dst"
      else
        printf '  [none] %s\n' "$dst"
      fi
    done
    return
  fi

  mkdir -p "$dst_dir"

  if [[ "$action" == "remove" ]]; then
    for src in "${files[@]}"; do
      local base dst
      base="$(basename "$src")"
      dst="${dst_dir}/${base}"
      if [[ -L "$dst" ]]; then
        local target
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
    return
  fi

  # install
  local timestamp
  timestamp="$(date +%Y%m%d%H%M%S)"
  for src in "${files[@]}"; do
    local base dst
    base="$(basename "$src")"
    dst="${dst_dir}/${base}"

    if [[ "$mode" == "symlink" ]]; then
      if [[ -L "$dst" ]]; then
        rm -f "$dst"
      elif [[ -e "$dst" ]]; then
        local backup="${dst}.bak.${timestamp}"
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
}


# Install or remove entries (files or directories) from a source dir into a target dir.
# Each entry in the source is symlinked or copied as-is. Useful for plugin packages
# where an entry is a directory containing package.json and index.(js|ts).
# Usage: install_entries <label> <source_dir> <dest_dir> <mode> <action>
install_entries() {
  local label="$1"
  local src_dir="$2"
  local dst_dir="$3"
  local mode="$4"
  local action="$5"

  if [[ ! -d "$src_dir" ]]; then
    printf 'Skipping %s: source directory does not exist: %s\n' "$label" "$src_dir"
    return
  fi

  shopt -s nullglob
  local entries=("$src_dir"/*)
  shopt -u nullglob

  if [[ ${#entries[@]} -eq 0 ]]; then
    printf 'Skipping %s: no entries in %s\n' "$label" "$src_dir"
    return
  fi

  printf '%s dir: %s\n' "$label" "$dst_dir"
  printf '%s entries: %s\n' "$label" "${#entries[@]}"

  if [[ "$action" == "status" ]]; then
    for src in "${entries[@]}"; do
      local base dst
      base="$(basename "$src")"
      dst="${dst_dir}/${base}"
      if [[ -L "$dst" ]]; then
        local target
        target="$(readlink "$dst" || true)"
        printf '  [link] %s -> %s\n' "$dst" "$target"
      elif [[ -e "$dst" ]]; then
        printf '  [exists] %s\n' "$dst"
      else
        printf '  [none] %s\n' "$dst"
      fi
    done
    return
  fi

  mkdir -p "$dst_dir"

  if [[ "$action" == "remove" ]]; then
    for src in "${entries[@]}"; do
      local base dst
      base="$(basename "$src")"
      dst="${dst_dir}/${base}"
      if [[ -L "$dst" ]]; then
        local target
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
    return
  fi

  local timestamp
  timestamp="$(date +%Y%m%d%H%M%S)"
  for src in "${entries[@]}"; do
    local base dst
    base="$(basename "$src")"
    dst="${dst_dir}/${base}"

    if [[ "$mode" == "symlink" ]]; then
      if [[ -L "$dst" ]]; then
        rm -f "$dst"
      elif [[ -e "$dst" ]]; then
        local backup="${dst}.bak.${timestamp}"
        mv "$dst" "$backup"
        printf 'Backed up existing entry: %s -> %s\n' "$dst" "$backup"
      fi
      ln -s "$src" "$dst"
      printf 'Linked: %s -> %s\n' "$dst" "$src"
    else
      if [[ -d "$src" ]]; then
        rm -rf "$dst"
        cp -R "$src" "$dst"
      else
        cp "$src" "$dst"
      fi
      printf 'Copied: %s -> %s\n' "$src" "$dst"
    fi
  done
}

ACTION="install"
CLI_SOURCE_DIR=""
CLI_CONFIG_DIR=""
CLI_AGENTS_DIR=""
CLI_PLUGINS_DIR=""
CLI_SKILLS_DIR=""
CLI_TOOLS_DIR=""
CLI_MODE=""
WITH_PLUGINS=false
WITH_SKILLS=false
WITH_TOOLS=false

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
    --plugins-dir)
      CLI_PLUGINS_DIR="${2:-}"
      shift 2
      ;;
    --skills-dir)
      CLI_SKILLS_DIR="${2:-}"
      shift 2
      ;;
    --tools-dir)
      CLI_TOOLS_DIR="${2:-}"
      shift 2
      ;;
    --mode)
      CLI_MODE="${2:-}"
      shift 2
      ;;
    --with-plugins)
      WITH_PLUGINS=true
      shift
      ;;
    --with-skills)
      WITH_SKILLS=true
      shift
      ;;
    --with-tools)
      WITH_TOOLS=true
      shift
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
FILE_PLUGINS_DIR=""
FILE_SKILLS_DIR=""
FILE_TOOLS_DIR=""
FILE_MODE=""
read_local_env

DEBUG_CONFIG_DIR="$(extract_debug_path config)"

RAW_CONFIG_DIR="$(path_or_default "$CLI_CONFIG_DIR" "${OPENCODE_DEPLOY_CONFIG_DIR:-}" "$FILE_CONFIG_DIR" "$DEBUG_CONFIG_DIR")"
RAW_AGENTS_DIR="$(path_or_default "$CLI_AGENTS_DIR" "${OPENCODE_DEPLOY_AGENTS_DIR:-}" "$FILE_AGENTS_DIR" "")"
RAW_PLUGINS_DIR="$(path_or_default "$CLI_PLUGINS_DIR" "${OPENCODE_DEPLOY_PLUGINS_DIR:-}" "$FILE_PLUGINS_DIR" "")"
RAW_SKILLS_DIR="$(path_or_default "$CLI_SKILLS_DIR" "${OPENCODE_DEPLOY_SKILLS_DIR:-}" "$FILE_SKILLS_DIR" "")"
RAW_TOOLS_DIR="$(path_or_default "$CLI_TOOLS_DIR" "${OPENCODE_DEPLOY_TOOLS_DIR:-}" "$FILE_TOOLS_DIR" "")"
RAW_SOURCE_DIR="$(path_or_default "$CLI_SOURCE_DIR" "${OPENCODE_DEPLOY_SOURCE_DIR:-}" "$FILE_SOURCE_DIR" "${REPO_ROOT}/agents")"
MODE="$(path_or_default "$CLI_MODE" "${OPENCODE_DEPLOY_MODE:-}" "$FILE_MODE" "symlink")"

if [[ -z "$RAW_CONFIG_DIR" ]]; then
  die "Unable to resolve OpenCode config directory. Set --config-dir or OPENCODE_DEPLOY_CONFIG_DIR."
fi

CONFIG_DIR="$(resolve_path "$RAW_CONFIG_DIR" "$REPO_ROOT")"

if [[ -z "$RAW_AGENTS_DIR" ]]; then
  RAW_AGENTS_DIR="${CONFIG_DIR}/agents"
fi
if [[ -z "$RAW_PLUGINS_DIR" ]]; then
  RAW_PLUGINS_DIR="${CONFIG_DIR}/plugins"
fi
if [[ -z "$RAW_SKILLS_DIR" ]]; then
  RAW_SKILLS_DIR="${CONFIG_DIR}/skills"
fi
if [[ -z "$RAW_TOOLS_DIR" ]]; then
  RAW_TOOLS_DIR="${CONFIG_DIR}/tools"
fi

AGENTS_DIR="$(resolve_path "$RAW_AGENTS_DIR" "$REPO_ROOT")"
PLUGINS_DIR="$(resolve_path "$RAW_PLUGINS_DIR" "$REPO_ROOT")"
SKILLS_DIR="$(resolve_path "$RAW_SKILLS_DIR" "$REPO_ROOT")"
TOOLS_DIR="$(resolve_path "$RAW_TOOLS_DIR" "$REPO_ROOT")"
SOURCE_DIR="$(resolve_path "$RAW_SOURCE_DIR" "$REPO_ROOT")"

if [[ "$MODE" != "symlink" && "$MODE" != "copy" ]]; then
  die "Invalid --mode '$MODE'. Use 'symlink' or 'copy'."
fi

if ! command -v opencode >/dev/null 2>&1; then
  die "opencode not found in PATH"
fi

printf 'Action: %s\n' "$ACTION"
printf 'Mode: %s\n' "$MODE"
printf 'OpenCode config dir: %s\n' "$CONFIG_DIR"

# --- Agents ---
install_files "Agents" "$SOURCE_DIR" "$AGENTS_DIR" "$MODE" "$ACTION" "*.md"

# --- Plugins (opt-in) ---
if [[ "$WITH_PLUGINS" == true ]]; then
  install_entries "Plugins" "${REPO_ROOT}/plugins" "$PLUGINS_DIR" "$MODE" "$ACTION"
fi

# --- Skills (opt-in) ---
if [[ "$WITH_SKILLS" == true ]]; then
  install_entries "Skills" "${REPO_ROOT}/.opencode/skills" "$SKILLS_DIR" "$MODE" "$ACTION"
fi

# --- Tools (opt-in) ---
if [[ "$WITH_TOOLS" == true ]]; then
  install_files "Tools" "${REPO_ROOT}/tools" "$TOOLS_DIR" "$MODE" "$ACTION" "*.ts"
fi

if [[ "$ACTION" == "status" ]]; then
  exit 0
fi

if [[ "$ACTION" == "remove" ]]; then
  exit 0
fi

printf 'Done. Start OpenCode anywhere and invoke an agent by name, e.g. @prometheus, @autonomous, @karpathy\n'
if [[ "$WITH_PLUGINS" == false || "$WITH_SKILLS" == false || "$WITH_TOOLS" == false ]]; then
  printf 'Tip: use --with-plugins, --with-skills, and --with-tools to also install plugins, skills, and any custom tools.\n'
fi
