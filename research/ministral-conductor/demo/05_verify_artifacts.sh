#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

printf 'Dataset receipt verification\n'
sha256sum --check receipts/input-sha256.txt

printf '\nAdapter receipt verification\n'
printf '%s  %s\n' \
  'e0e6655a16a10f28cbce898e564640bf6a4a64ca84bb2014a1da3a60c5f11eda' \
  'artifacts/ministral-14b-loom-conductor-v2/adapter/adapter_model.safetensors' \
  | sha256sum --check -

printf '\nResearch receipt hashes\n'
sha256sum data/manifest.json
sha256sum receipts/training_receipt.json receipts/trainer_log.jsonl receipts/gpu-telemetry.csv
sha256sum reports/*summary.json
sha256sum artifacts/ministral-14b-loom-conductor-v2/adapter/*
