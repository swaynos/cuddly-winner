#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IFS=. read -r NODE_MAJOR NODE_MINOR NODE_PATCH <<<"$(node -p 'process.versions.node')"
if (( NODE_MAJOR < 22 || NODE_MAJOR >= 25 || (NODE_MAJOR == 22 && (NODE_MINOR < 22 || (NODE_MINOR == 22 && NODE_PATCH < 2))) )); then
  printf 'Unsupported Node.js version: %s (required >=22.22.2 <25)\n' "$(node --version)" >&2
  exit 1
fi

CI_PROFILE_PARENT="${CUDDLY_WINNER_CI_PROFILE_PARENT:-${TMPDIR:-/tmp}}"
[[ -d "$CI_PROFILE_PARENT" ]] || {
  printf 'CI profile parent does not exist: %s\n' "$CI_PROFILE_PARENT" >&2
  exit 1
}
CI_PROFILE_ROOT="$(mktemp -d "${CI_PROFILE_PARENT%/}/cuddly-winner-ci.XXXXXX")"
CI_CONFIG_DIR="${CI_PROFILE_ROOT}/opencode"
trap 'rm -rf "$CI_PROFILE_ROOT"' EXIT

bash scripts/deploy-opencode-agents.sh install --config-dir "$CI_CONFIG_DIR"
env -u OPENCODE_DEPLOY_CONFIG_DIR -u OPENCODE_CONFIG_DIR npm test
bash scripts/deploy-opencode-agents.sh status --config-dir "$CI_CONFIG_DIR"
bash scripts/deploy-opencode-agents.sh remove --config-dir "$CI_CONFIG_DIR"
