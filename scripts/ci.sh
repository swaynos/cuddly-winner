#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IFS=. read -r NODE_MAJOR NODE_MINOR NODE_PATCH <<<"$(node -p 'process.versions.node')"
if (( NODE_MAJOR < 22 || NODE_MAJOR >= 25 || (NODE_MAJOR == 22 && (NODE_MINOR < 22 || (NODE_MINOR == 22 && NODE_PATCH < 2))) )); then
  printf 'Unsupported Node.js version: %s (required >=22.22.2 <25)\n' "$(node --version)" >&2
  exit 1
fi

PYTHON="$(bash scripts/ensure-venv.sh)"
CI_PROFILE_PARENT="${CUDDLY_WINNER_CI_PROFILE_PARENT:-${TMPDIR:-/tmp}}"
[[ -d "$CI_PROFILE_PARENT" ]] || {
  printf 'CI profile parent does not exist: %s\n' "$CI_PROFILE_PARENT" >&2
  exit 1
}
CI_PROFILE_ROOT="$(mktemp -d "${CI_PROFILE_PARENT%/}/cuddly-winner-ci.XXXXXX")"
CI_CONFIG_DIR="${CI_PROFILE_ROOT}/opencode"
trap 'rm -rf "$CI_PROFILE_ROOT"' EXIT
OPENCODE_CLI_VERSION="$(<.opencode-cli-version)"
OPENCODE_CLI_PREFIX="${CI_PROFILE_ROOT}/opencode-cli"
NPM_CONFIG_CACHE="${CI_PROFILE_ROOT}/npm-cache" npm install --prefix "$OPENCODE_CLI_PREFIX" --no-save --no-audit --no-fund "opencode-ai@${OPENCODE_CLI_VERSION}" >/dev/null
OPENCODE_CLI_BIN_DIR="${OPENCODE_CLI_PREFIX}/node_modules/.bin"
OPENCODE_CLI_BIN="${OPENCODE_CLI_PREFIX}/node_modules/.bin/opencode"
[[ -x "$OPENCODE_CLI_BIN" ]] || {
  printf 'Pinned OpenCode CLI binary was not installed: %s\n' "$OPENCODE_CLI_BIN" >&2
  exit 1
}
[[ "$("$OPENCODE_CLI_BIN" --version)" == "$OPENCODE_CLI_VERSION" ]] || {
  printf 'Installed OpenCode CLI does not match pin %s.\n' "$OPENCODE_CLI_VERSION" >&2
  exit 1
}
PATH="$OPENCODE_CLI_BIN_DIR:$PATH"
OPENCODE_E2E_BIN="$OPENCODE_CLI_BIN"
export PATH OPENCODE_E2E_BIN
CUDDLY_WINNER_CI_FOCUSED="${CUDDLY_WINNER_CI_FOCUSED:-0}"
[[ "$CUDDLY_WINNER_CI_FOCUSED" == 0 || "$CUDDLY_WINNER_CI_FOCUSED" == 1 ]] || {
  printf 'CUDDLY_WINNER_CI_FOCUSED must be 0 or 1.\n' >&2
  exit 1
}

bash scripts/deploy-opencode-agents.sh install --config-dir "$CI_CONFIG_DIR"
"$PYTHON" tests/verify_opencode.py --skip-llm
if [[ "$CUDDLY_WINNER_CI_FOCUSED" == 1 ]]; then
  node --test --test-name-pattern='Node policy covers the locked plugin dependency engine' tests/integration/deploy_opencode_agents.test.mjs
else
  "$PYTHON" -m unittest discover -s tests -p 'test_verify_opencode.py'
  env -u OPENCODE_DEPLOY_CONFIG_DIR -u OPENCODE_CONFIG_DIR node --test tests/plugins/*.test.mjs tests/integration/*.test.mjs
  "$PYTHON" -m unittest discover -s evals/mutation/tests -p 'test_*.py'
  "$PYTHON" tests/test_skill_coverage.py --skip-llm
  "$PYTHON" -m unittest discover -s tests -p 'test_audit_run.py'
  "$PYTHON" evals/seed_build/test_planning.py --dry-run
  "$PYTHON" evals/seed_build/test_build.py --dry-run
fi
bash scripts/deploy-opencode-agents.sh status --config-dir "$CI_CONFIG_DIR"
bash scripts/deploy-opencode-agents.sh remove --config-dir "$CI_CONFIG_DIR"

if [[ "$CUDDLY_WINNER_CI_FOCUSED" == 1 ]]; then
  printf 'Focused CI completed; full suites and end-to-end remain enabled in the default run.\n'
  exit 0
fi

# Deterministic installed-product end-to-end test. Runs last because it is the
# slowest step, so the cheaper checks always report first.
"$PYTHON" evals/seed_build/test_end_to_end.py
