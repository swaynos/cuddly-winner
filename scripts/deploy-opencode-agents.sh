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
  --plugins-dir PATH  OpenCode plugins directory
  --skills-dir PATH   OpenCode skills directory (used with --with-skills)
  --tools-dir PATH    OpenCode tools directory
  --mode MODE         Install mode: copy (default) or symlink
  --with-autonomous   Install the optional Autonomous supervisor and OpenCode tools
  --with-skills       Install optional non-core skills
  --with-tools        Install the OpenCode run and scaffold_gitignore tools
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
  # shellcheck disable=SC2206  # intentional glob expansion; nullglob set above ensures empty array on no match
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
      elif [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
        # Managed copy: byte-identical to the source, so it is safe to remove.
        # A user-modified file will not match and is preserved.
        rm -f "$dst"
        printf 'Removed copy: %s\n' "$dst"
      elif [[ -e "$dst" ]]; then
        printf 'Skipped modified or unrelated file: %s\n' "$dst"
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
        local target
        target="$(readlink "$dst" || true)"
        if [[ "$target" == "$src" ]]; then
          rm -f "$dst"
        else
          local backup="${dst}.bak.${timestamp}"
          mv "$dst" "$backup"
          printf 'Backed up existing link: %s -> %s\n' "$dst" "$backup"
        fi
      elif [[ -e "$dst" ]]; then
        local backup="${dst}.bak.${timestamp}"
        mv "$dst" "$backup"
        printf 'Backed up existing file: %s -> %s\n' "$dst" "$backup"
      fi
      ln -s "$src" "$dst"
      printf 'Linked: %s -> %s\n' "$dst" "$src"
    else
      if [[ -L "$dst" ]]; then
        local target
        target="$(readlink "$dst" || true)"
        if [[ "$target" == "$src" ]]; then
          rm -f "$dst"
        else
          local backup="${dst}.bak.${timestamp}"
          mv "$dst" "$backup"
          printf 'Backed up existing link: %s -> %s\n' "$dst" "$backup"
        fi
      elif [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
        printf 'Unchanged: %s\n' "$dst"
        continue
      elif [[ -e "$dst" ]]; then
        local backup="${dst}.bak.${timestamp}"
        mv "$dst" "$backup"
        printf 'Backed up existing file: %s -> %s\n' "$dst" "$backup"
      fi
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
      elif [[ -d "$dst" && -d "$src" ]] && diff -r -q "$src" "$dst" >/dev/null 2>&1; then
        rm -rf "$dst"
        printf 'Removed copy: %s\n' "$dst"
      elif [[ -f "$dst" && -f "$src" ]] && cmp -s "$src" "$dst"; then
        rm -f "$dst"
        printf 'Removed copy: %s\n' "$dst"
      elif [[ -e "$dst" ]]; then
        printf 'Skipped modified or unrelated entry: %s\n' "$dst"
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
        local target
        target="$(readlink "$dst" || true)"
        if [[ "$target" == "$src" ]]; then
          rm -f "$dst"
        else
          local backup="${dst}.bak.${timestamp}"
          mv "$dst" "$backup"
          printf 'Backed up existing link: %s -> %s\n' "$dst" "$backup"
        fi
      elif [[ -e "$dst" ]]; then
        local backup="${dst}.bak.${timestamp}"
        mv "$dst" "$backup"
        printf 'Backed up existing entry: %s -> %s\n' "$dst" "$backup"
      fi
      ln -s "$src" "$dst"
      printf 'Linked: %s -> %s\n' "$dst" "$src"
    else
      if [[ -L "$dst" ]]; then
        local target
        target="$(readlink "$dst" || true)"
        if [[ "$target" == "$src" ]]; then
          rm -f "$dst"
        else
          local backup="${dst}.bak.${timestamp}"
          mv "$dst" "$backup"
          printf 'Backed up existing link: %s -> %s\n' "$dst" "$backup"
        fi
      elif [[ -e "$dst" ]]; then
        local backup="${dst}.bak.${timestamp}"
        mv "$dst" "$backup"
        printf 'Backed up existing entry: %s -> %s\n' "$dst" "$backup"
      fi
      if [[ -d "$src" ]]; then
        cp -R "$src" "$dst"
      else
        cp "$src" "$dst"
      fi
      printf 'Copied: %s -> %s\n' "$src" "$dst"
    fi
  done
}

# Legacy entries have no current source to compare. Only links into this
# repository can have been created by an earlier deployment.
remove_legacy_repo_link() {
  local label="$1"
  local dst="$2"

  if [[ ! -L "$dst" ]]; then
    return
  fi

  local target
  target="$(readlink "$dst" || true)"
  if [[ "$target" == "${REPO_ROOT}/"* ]]; then
    rm -f "$dst"
    printf 'Removed obsolete managed %s: %s\n' "$label" "$dst"
  else
    printf 'Skipped obsolete %s with different target: %s\n' "$label" "$dst"
  fi
}

remove_managed_file() {
  local label="$1"
  local src="$2"
  local dst="$3"

  if [[ -L "$dst" ]]; then
    local target
    target="$(readlink "$dst" || true)"
    if [[ "$target" == "$src" ]]; then
      rm -f "$dst"
      printf 'Removed %s link: %s\n' "$label" "$dst"
    else
      printf 'Skipped %s link with different target: %s\n' "$label" "$dst"
    fi
  elif [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
    rm -f "$dst"
    printf 'Removed %s copy: %s\n' "$label" "$dst"
  elif [[ -e "$dst" ]]; then
    printf 'Skipped modified or unrelated %s: %s\n' "$label" "$dst"
  fi
}

ACTION="install"
CLI_SOURCE_DIR=""
CLI_CONFIG_DIR=""
CLI_AGENTS_DIR=""
CLI_PLUGINS_DIR=""
CLI_SKILLS_DIR=""
CLI_TOOLS_DIR=""
CLI_MODE=""
WITH_PLUGINS=true
WITH_SKILLS=false
WITH_TOOLS=false
WITH_AUTONOMOUS=false

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
    --with-autonomous)
      WITH_AUTONOMOUS=true
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
MODE="$(path_or_default "$CLI_MODE" "${OPENCODE_DEPLOY_MODE:-}" "$FILE_MODE" "copy")"

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

# Remove obsolete managed entries and repository-specific global instructions.
if [[ "$ACTION" == "install" || "$ACTION" == "remove" ]]; then
  for obsolete in opencode-autonomous-gate opencode-autonomous-loop opencode-autonomous-gate.js opencode-autonomous-loop.js shared; do
    candidate="${PLUGINS_DIR}/${obsolete}"
    remove_legacy_repo_link "plugin" "$candidate"
  done
  for obsolete in builder data-scientist octopus-arm octopus ralph-wiggum; do
    candidate="${AGENTS_DIR}/${obsolete}.md"
    remove_legacy_repo_link "agent" "$candidate"
  done
  candidate="${CONFIG_DIR}/AGENTS.md"
  if [[ -L "$candidate" && "$(readlink "$candidate" || true)" == "${REPO_ROOT}/AGENTS.md" ]]; then
    rm -f "$candidate"
    printf 'Removed repository-specific global rules: %s\n' "$candidate"
  fi
  if [[ "$ACTION" == "install" && "$WITH_AUTONOMOUS" == false ]]; then
    remove_legacy_repo_link "Autonomous plugin" "${PLUGINS_DIR}/opencode-autonomous-supervisor.js"
    remove_managed_file "Autonomous tool" "${REPO_ROOT}/tools/run.ts" "${TOOLS_DIR}/run.ts"
    remove_managed_file "Autonomous tool" "${REPO_ROOT}/tools/scaffold_gitignore.ts" "${TOOLS_DIR}/scaffold_gitignore.ts"
    remove_managed_file "Autonomous validator" "${REPO_ROOT}/tools/manifest.ts" "${TOOLS_DIR}/manifest.ts"

    candidate="${PLUGINS_DIR}/opencode-autonomous-supervisor"
    if [[ -L "$candidate" && "$(readlink "$candidate" || true)" == "${REPO_ROOT}/plugins/opencode-autonomous-supervisor" ]]; then
      rm -f "$candidate"
      printf 'Removed Autonomous plugin link: %s\n' "$candidate"
    elif [[ -d "$candidate" ]] && diff -r -q "${REPO_ROOT}/plugins/opencode-autonomous-supervisor" "$candidate" >/dev/null 2>&1; then
      rm -rf "$candidate"
      printf 'Removed Autonomous plugin copy: %s\n' "$candidate"
    elif [[ -e "$candidate" ]]; then
      printf 'Skipped modified or unrelated Autonomous plugin: %s\n' "$candidate"
    fi
  fi
fi

# --- Agents ---
install_files "Agents" "$SOURCE_DIR" "$AGENTS_DIR" "$MODE" "$ACTION" "*.md"

# --- Managed-agent immutability and optional Autonomous profile ---
if [[ "$ACTION" == "remove" ]]; then
  # Removal is profile-independent: preserve user changes while reconciling all
  # current plugin sources, including Autonomous artifacts from an old profile.
  install_entries "Plugins" "${REPO_ROOT}/plugins" "$PLUGINS_DIR" "$MODE" "$ACTION"
elif [[ "$WITH_PLUGINS" == true && "$WITH_AUTONOMOUS" == false ]]; then
  install_files "Plugins" "${REPO_ROOT}/plugins" "$PLUGINS_DIR" "$MODE" "$ACTION" "immutability.ts"
elif [[ "$WITH_AUTONOMOUS" == true ]]; then
  install_entries "Plugins" "${REPO_ROOT}/plugins" "$PLUGINS_DIR" "$MODE" "$ACTION"
fi

# --- Skills ---
if [[ "$WITH_SKILLS" == true ]]; then
  install_entries "Skills" "${REPO_ROOT}/skills" "$SKILLS_DIR" "$MODE" "$ACTION"
fi

# --- OpenCode runner and scaffold tools ---
if [[ "$ACTION" == "remove" ]]; then
  install_files "Tools" "${REPO_ROOT}/tools" "$TOOLS_DIR" "$MODE" "$ACTION" "run.ts"
  install_files "Tools" "${REPO_ROOT}/tools" "$TOOLS_DIR" "$MODE" "$ACTION" "scaffold_gitignore.ts"
  install_files "Manifest validator" "${REPO_ROOT}/tools" "$TOOLS_DIR" "$MODE" "$ACTION" "manifest.ts"
elif [[ "$WITH_TOOLS" == true ]]; then
  install_files "Tools" "${REPO_ROOT}/tools" "$TOOLS_DIR" "$MODE" "$ACTION" "run.ts"
  install_files "Tools" "${REPO_ROOT}/tools" "$TOOLS_DIR" "$MODE" "$ACTION" "scaffold_gitignore.ts"
  if [[ "$WITH_AUTONOMOUS" == true ]]; then
    install_files "Manifest validator" "${REPO_ROOT}/tools" "$TOOLS_DIR" "$MODE" "$ACTION" "manifest.ts"
  fi
fi

# Custom tools resolve SDK imports from the deployment target, never from this
# repository. Install the pinned runtime dependency for both copy and symlink
# modes without requiring a repository node_modules link.
if [[ "$ACTION" == "install" && "$WITH_TOOLS" == true ]]; then
  # Use the vendored closure only when it matches the declared SDK pin. A stale
  # cache must never silently override the tested runtime dependency.
  VENDORED_MODULES="${REPO_ROOT}/.opencode/node_modules"
  VENDORED_PACKAGE="${VENDORED_MODULES}/@opencode-ai/plugin/package.json"
  VENDORED_VERSION=""
  if [[ -f "$VENDORED_PACKAGE" ]]; then
    VENDORED_VERSION="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version)' "$VENDORED_PACKAGE")"
  fi
  if [[ "$VENDORED_VERSION" == "1.17.15" ]]; then
    mkdir -p "${CONFIG_DIR}/node_modules"
    cp -R "${VENDORED_MODULES}/." "${CONFIG_DIR}/node_modules/"
  else
    command -v npm >/dev/null 2>&1 || die "npm is required to install the OpenCode tool runtime"
    npm install --prefix "$CONFIG_DIR" --no-save --no-audit --no-fund @opencode-ai/plugin@1.17.15 >/dev/null
  fi
fi

if [[ "$ACTION" == "status" ]]; then
  exit 0
fi

if [[ "$ACTION" == "remove" ]]; then
  exit 0
fi

printf 'Done. Native Plan/Build remain unchanged; optional specialist agents are available by name.\n'
