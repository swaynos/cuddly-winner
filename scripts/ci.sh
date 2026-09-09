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
"$PYTHON" tests/verify_opencode.py --skip-llm
"$PYTHON" -m unittest discover -s tests -p 'test_verify_opencode.py'
node --test tests/plugins/*.test.mjs tests/integration/*.test.mjs
"$PYTHON" -m unittest discover -s evals/mutation/tests -p 'test_*.py'
"$PYTHON" tests/test_skill_coverage.py --skip-llm
"$PYTHON" -m unittest discover -s tests -p 'test_audit_run.py'
"$PYTHON" evals/seed_build/test_planning.py --dry-run
"$PYTHON" evals/seed_build/test_build.py --dry-run
bash scripts/deploy-opencode-agents.sh status

# Deterministic installed-product end-to-end test. Runs last because it is the
# slowest step, so the cheaper checks always report first. It needs the pinned
# OpenCode CLI; exit status 2 means that prerequisite is absent, which is a skip
# rather than a failure so this script stays usable without the CLI.
set +e
"$PYTHON" evals/seed_build/test_end_to_end.py
E2E_STATUS=$?
set -e
case "$E2E_STATUS" in
  0) ;;
  2) printf 'End-to-end test skipped: pinned OpenCode CLI %s not available.\n' "$(cat .opencode-cli-version)" ;;
  *) exit "$E2E_STATUS" ;;
esac
