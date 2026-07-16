from __future__ import annotations

import argparse
import collections
import json
import math
from pathlib import Path
from typing import Any

from conductor_data import aggregate_scores, read_jsonl, score_prediction


def percentile(values: list[float], proportion: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(proportion * len(ordered)) - 1)]


def main() -> None:
    parser = argparse.ArgumentParser(description="Score raw conductor predictions")
    parser.add_argument("--lane", required=True)
    parser.add_argument("--data", default="data/test.jsonl")
    parser.add_argument("--predictions", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    examples = {row["id"]: row for row in read_jsonl(Path(args.data))}
    predictions = read_jsonl(Path(args.predictions))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    scores: list[dict[str, Any]] = []
    scored_examples: list[tuple[dict[str, Any], dict[str, Any]]] = []
    latencies: list[float] = []
    fallback_reasons = collections.Counter()
    with output.open("w", encoding="utf-8") as handle:
        for record in predictions:
            example = examples[record["id"]]
            score = score_prediction(example, record.get("prediction", ""))
            scores.append(score)
            scored_examples.append((example, score))
            if record.get("elapsed_ms") is not None:
                latencies.append(float(record["elapsed_ms"]))
            if record.get("runtime_fallback_used"):
                fallback_reasons[str(record.get("runtime_fallback_reason") or "unspecified")] += 1
            handle.write(json.dumps({**record, "score": score}, sort_keys=True, ensure_ascii=True) + "\n")
    summary = {"lane": args.lane, **aggregate_scores(scores)}
    by_expected_policy: dict[str, Any] = {}
    for policy in ("lean", "balanced", "strict"):
        subset = [score for example, score in scored_examples if example["label"]["policy"] == policy]
        if subset:
            by_expected_policy[policy] = aggregate_scores(subset)
    by_family: dict[str, Any] = {}
    for family in sorted({example["family"] for example, _ in scored_examples}):
        subset = [score for example, score in scored_examples if example["family"] == family]
        by_family[family] = aggregate_scores(subset)
    confusion: dict[str, dict[str, int]] = {
        policy: {predicted: 0 for predicted in ("lean", "balanced", "strict", "invalid")}
        for policy in ("lean", "balanced", "strict")
    }
    predicted_depth = collections.Counter()
    for example, score in scored_examples:
        expected = example["label"]["policy"]
        parsed = score.get("parsed") or {}
        predicted = parsed.get("policy") if parsed.get("policy") in {"lean", "balanced", "strict"} else "invalid"
        confusion[expected][predicted] += 1
        predicted_depth[str(score.get("predicted_calls") or "invalid")] += 1
    summary.update({
        "by_expected_policy": by_expected_policy,
        "by_family": by_family,
        "policy_confusion": confusion,
        "predicted_call_distribution": dict(sorted(predicted_depth.items())),
        "runtime_fallback_count": sum(fallback_reasons.values()),
        "runtime_fallback_rate": round(sum(fallback_reasons.values()) / len(scored_examples), 6),
        "runtime_fallback_reasons": dict(sorted(fallback_reasons.items())),
    })
    if latencies:
        summary.update({
            "mean_inference_ms": round(sum(latencies) / len(latencies), 3),
            "p50_inference_ms": round(percentile(latencies, 0.5), 3),
            "p95_inference_ms": round(percentile(latencies, 0.95), 3),
        })
    summary_path = output.with_suffix(".summary.json")
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
