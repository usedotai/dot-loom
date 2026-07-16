from __future__ import annotations

import argparse
import csv
import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any


def percentile(values: list[float], proportion: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, math.floor(proportion * (len(ordered) - 1))))]


def describe(values: list[float]) -> dict[str, float]:
    return {
        "mean": round(sum(values) / len(values), 4),
        "p50": round(percentile(values, 0.5), 4),
        "p95": round(percentile(values, 0.95), 4),
        "max": round(max(values), 4),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Summarize H200 telemetry with energy integration")
    parser.add_argument("--input", type=Path, default=Path("receipts/gpu-telemetry.csv"))
    parser.add_argument("--output", type=Path, default=Path("receipts/gpu-telemetry.summary.json"))
    args = parser.parse_args()
    rows: list[dict[str, Any]] = []
    with args.input.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            rows.append({
                "time": datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00")),
                "gpu_util_pct": float(row["gpu_util_pct"]),
                "memory_util_pct": float(row["memory_util_pct"]),
                "memory_used_mib": float(row["memory_used_mib"]),
                "memory_total_mib": float(row["memory_total_mib"]),
                "power_w": float(row["power_w"]),
                "temperature_c": float(row["temperature_c"]),
            })
    if len(rows) < 2:
        raise RuntimeError("Telemetry requires at least two samples")
    energy_watt_seconds = 0.0
    for before, after in zip(rows, rows[1:]):
        elapsed = max(0.0, (after["time"] - before["time"]).total_seconds())
        energy_watt_seconds += elapsed * (before["power_w"] + after["power_w"]) / 2
    output = {
        "samples": len(rows),
        "started_at": rows[0]["time"].isoformat(),
        "ended_at": rows[-1]["time"].isoformat(),
        "duration_seconds": round((rows[-1]["time"] - rows[0]["time"]).total_seconds(), 3),
        "gpu_util_pct": describe([row["gpu_util_pct"] for row in rows]),
        "memory_util_pct": describe([row["memory_util_pct"] for row in rows]),
        "memory_used_mib": describe([row["memory_used_mib"] for row in rows]),
        "power_w": describe([row["power_w"] for row in rows]),
        "temperature_c": describe([row["temperature_c"] for row in rows]),
        "integrated_energy_kwh": round(energy_watt_seconds / 3_600_000, 6),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
