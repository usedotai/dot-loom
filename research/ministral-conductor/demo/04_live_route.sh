#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
. .venv/bin/activate
python -u src/live_demo.py --preset "${1:-payment-race}"
