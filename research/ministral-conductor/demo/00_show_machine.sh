#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
printf 'GPU\n'
nvidia-smi --query-gpu=name,uuid,memory.total,driver_version,pstate,power.limit --format=csv,noheader
printf '\nCPU and memory\n'
lscpu | grep -E '^(Model name|CPU\(s\)|Thread|Core|Socket)'
free -h
printf '\nStorage\n'
df -h .
printf '\nPinned model and dataset receipts\n'
cat receipts/model-sha256.txt
cat receipts/input-sha256.txt
