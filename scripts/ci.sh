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
