#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
sha256sum data/manifest.json data/train.jsonl data/validation.jsonl data/test.jsonl
sha256sum receipts/training_receipt.json receipts/trainer_log.jsonl receipts/gpu-telemetry.csv
sha256sum reports/*summary.json
sha256sum artifacts/ministral-14b-loom-conductor-v2/adapter/*
