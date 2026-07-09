#!/usr/bin/env bash
# ensure-venv.sh — idempotent pyenv virtualenv bootstrap for this project.
#
# Usage:
#   PYTHON="$(bash scripts/ensure-venv.sh)" && "$PYTHON" tests/verify_opencode.py
#
# Reads the venv name from .python-version in the repo root.
# Creates the venv if it does not exist (picks the latest pyenv-managed base
# Python automatically). Prints the resolved interpreter path to stdout.
# Prints human-readable status messages to stderr.
# Exits 1 only if pyenv itself is absent or no base Python is installed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_VERSION_FILE="$REPO_ROOT/.python-version"

# --- 1. Require pyenv ---
if ! command -v pyenv &>/dev/null; then
    echo "ERROR: pyenv not found on PATH. Install pyenv first: https://github.com/pyenv/pyenv" >&2
    exit 1
fi

# --- 2. Read desired venv name ---
if [[ ! -f "$PYTHON_VERSION_FILE" ]]; then
    echo "ERROR: .python-version not found at $PYTHON_VERSION_FILE" >&2
    exit 1
fi

VENV_NAME="$(tr -d '[:space:]' < "$PYTHON_VERSION_FILE")"

if [[ -z "$VENV_NAME" ]]; then
    echo "ERROR: .python-version is empty" >&2
    exit 1
fi

INTERP="$(pyenv root)/versions/$VENV_NAME/bin/python3"

# --- 3. Create venv if it does not exist ---
VENV_DIR="$(pyenv root)/versions/$VENV_NAME"

if [[ ! -d "$VENV_DIR" ]]; then
    # Pick latest non-venv (plain x.y.z) Python installed in pyenv.
    BASE_PYTHON="$(pyenv versions --bare 2>/dev/null \
        | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' \
        | sort -t. -k1,1n -k2,2n -k3,3n \
        | tail -1)"

    if [[ -z "$BASE_PYTHON" ]]; then
        echo "ERROR: No base Python version found in pyenv." >&2
        echo "       Install one with: pyenv install 3.12.7" >&2
        exit 1
    fi

    echo "Creating pyenv virtualenv $BASE_PYTHON $VENV_NAME ..." >&2
    pyenv virtualenv "$BASE_PYTHON" "$VENV_NAME" >&2
    echo "Virtualenv '$VENV_NAME' created." >&2
else
    echo "Virtualenv '$VENV_NAME' already exists." >&2
fi

# --- 4. Print interpreter path for caller ---
echo "$INTERP"
