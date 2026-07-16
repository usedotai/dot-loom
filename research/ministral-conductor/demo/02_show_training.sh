#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
. .venv/bin/activate
python - <<'PY'
import csv
import json
from pathlib import Path

receipt = json.load(open("receipts/training_receipt.json"))
checkpoint = json.load(open("receipts/checkpoint-selection.json"))
telemetry_summary = json.load(open("receipts/gpu-telemetry.summary.json"))
telemetry = list(csv.DictReader(open("receipts/gpu-telemetry.csv")))
gpu = [float(row["gpu_util_pct"]) for row in telemetry]
memory = [float(row["memory_used_mib"]) for row in telemetry]
power = [float(row["power_w"]) for row in telemetry]
adapter_bytes = sum(path.stat().st_size for path in Path(receipt["config"]["output"], "adapter").rglob("*") if path.is_file())
print(json.dumps({
    "run": receipt["run"],
    "base_model_commit": receipt["base_model_commit"],
    "gpu": receipt["gpu"],
    "train_examples": receipt["train_examples"],
    "validation_examples": receipt["validation_examples"],
    "epochs": receipt["config"]["epochs"],
    "optimizer_steps": receipt["estimated_total_steps"],
    "validation_selected_checkpoint": checkpoint["best_checkpoint"],
    "best_validation_loss": checkpoint["best_metric"],
    "trainable_parameters": receipt["trainable_parameters"],
    "total_parameters": receipt["total_parameters"],
    "adapter_bytes": adapter_bytes,
    "duration_seconds": receipt["duration_seconds"],
    "peak_allocated_vram_bytes": receipt["peak_gpu_memory_bytes"],
    "telemetry_samples": len(telemetry),
    "mean_gpu_util_pct": round(sum(gpu) / len(gpu), 2),
    "peak_memory_used_mib": max(memory),
    "peak_power_w": max(power),
    "integrated_energy_kwh": telemetry_summary["integrated_energy_kwh"],
    "p95_gpu_util_pct": telemetry_summary["gpu_util_pct"]["p95"],
    "final_evaluation": receipt["evaluation"],
    "train_data_sha256": receipt["train_data_sha256"],
}, indent=2, sort_keys=True))
PY
