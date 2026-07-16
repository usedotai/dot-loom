#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p receipts artifacts

telemetry="receipts/gpu-telemetry.csv"
printf 'timestamp,gpu_util_pct,memory_util_pct,memory_used_mib,memory_total_mib,power_w,temperature_c\n' > "$telemetry"
(
  while true; do
    timestamp=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
    metrics=$(nvidia-smi --query-gpu=utilization.gpu,utilization.memory,memory.used,memory.total,power.draw,temperature.gpu --format=csv,noheader,nounits)
    printf '%s,%s\n' "$timestamp" "$metrics" >> "$telemetry"
    sleep 2
  done
) &
telemetry_pid=$!
cleanup() {
  kill "$telemetry_pid" 2>/dev/null || true
  wait "$telemetry_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

. .venv/bin/activate
python -u src/train.py "$@" 2>&1 | tee receipts/training-console.log
