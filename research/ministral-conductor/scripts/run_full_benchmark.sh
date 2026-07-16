#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
. .venv/bin/activate

limit="${BENCHMARK_LIMIT:-1200}"
batch_size="${BENCHMARK_BATCH_SIZE:-96}"
max_new_tokens="${BENCHMARK_MAX_NEW_TOKENS:-180}"

mkdir -p reports receipts charts artifacts
exec > >(tee receipts/benchmark-console.log) 2>&1

python -u src/summarize_checkpoint.py

python -u src/summarize_telemetry.py \
  --input receipts/gpu-telemetry.csv \
  --output receipts/gpu-telemetry.summary.json

python -u src/deterministic_router.py \
  --data data/test.jsonl \
  --output reports/deterministic_predictions.jsonl

python -u src/score_predictions.py \
  --lane deterministic_router \
  --data data/test.jsonl \
  --predictions reports/deterministic_predictions.jsonl \
  --output reports/deterministic_scored.jsonl

python -u src/run_inference.py \
  --data data/test.jsonl \
  --output reports/base_predictions.jsonl \
  --limit "$limit" \
  --batch-size "$batch_size" \
  --max-new-tokens "$max_new_tokens"

python -u src/score_predictions.py \
  --lane base_ministral \
  --data data/test.jsonl \
  --predictions reports/base_predictions.jsonl \
  --output reports/base_scored.jsonl

python -u src/run_inference.py \
  --adapter artifacts/ministral-14b-loom-conductor-v2/adapter \
  --data data/test.jsonl \
  --output reports/trained_predictions.jsonl \
  --limit "$limit" \
  --batch-size "$batch_size" \
  --max-new-tokens "$max_new_tokens"

python -u src/score_predictions.py \
  --lane trained_conductor_raw \
  --data data/test.jsonl \
  --predictions reports/trained_predictions.jsonl \
  --output reports/trained_scored.jsonl

python -u src/apply_runtime_guard.py \
  --data data/test.jsonl \
  --predictions reports/trained_predictions.jsonl \
  --output reports/trained_guarded_predictions.jsonl

python -u src/score_predictions.py \
  --lane trained_conductor_guarded \
  --data data/test.jsonl \
  --predictions reports/trained_guarded_predictions.jsonl \
  --output reports/trained_guarded_scored.jsonl

python -u src/statistical_analysis.py \
  --deterministic reports/deterministic_scored.jsonl \
  --base reports/base_scored.jsonl \
  --trained reports/trained_guarded_scored.jsonl \
  --output reports/paired-statistics.json \
  --iterations 10000

python -u src/make_charts.py --reports reports --receipts receipts --output charts
python -u src/write_report.py --reports reports --receipts receipts --output reports/CONDUCTOR-BENCHMARK.md
python -u src/package_results.py --root . --output artifacts/RESULTS-MANIFEST.json
