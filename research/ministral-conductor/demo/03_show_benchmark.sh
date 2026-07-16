#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
. .venv/bin/activate
python - <<'PY'
import json

lanes = [
    ("Deterministic Loom", "reports/deterministic_scored.summary.json"),
    ("Base Ministral 14B", "reports/base_scored.summary.json"),
    ("Dot-trained raw", "reports/trained_scored.summary.json"),
    ("Dot-trained + guard", "reports/trained_guarded_scored.summary.json"),
]
print(f"{'Lane':<24} {'JSON':>8} {'Receipt':>8} {'Policy':>8} {'Exact':>8} {'Budget':>8} {'Safe':>8} {'Regret':>10} {'P95 ms':>10}")
for label, path in lanes:
    row = json.load(open(path))
    safe = 1 - row["unsafe_under_escalation"]
    p95 = row.get("p95_inference_ms")
    p95_text = "local" if p95 is None else f"{p95:.1f}"
    print(
        f"{label:<24} {row['json_valid']*100:>7.1f}% {row['receipt_consistent']*100:>7.1f}% {row['policy_correct']*100:>7.1f}% "
        f"{row['exact_plan']*100:>7.1f}% {row['constraint_satisfied']*100:>7.1f}% {safe*100:>7.1f}% {row['mean_utility_regret']:>10.3f} "
        f"{p95_text:>10}"
    )
PY
