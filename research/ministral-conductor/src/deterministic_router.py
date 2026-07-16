from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from conductor_data import (
    aggregate_scores,
    enumerate_plans,
    feasible,
    outcome_for_plan,
    read_jsonl,
    score_prediction,
    stable_json,
)


def deterministic_plan(example: dict[str, Any]) -> dict[str, Any]:
    task = example["task"]
    constraints = example["constraints"]
    workers = example["workers"]
    # Faithful to Loom's current local policy: text/risk thresholds choose the depth,
    # while static capability tags choose roles. It does not optimize over the measured
    # quality, pass-rate, price, or latency fields that the learned conductor receives.
    pressure = task["risk"] * 0.5 + task["evidence_need"] * 0.3 + task["complexity"] * 0.2
    if constraints["max_calls"] >= 3 and pressure >= 0.78:
        preferred = "strict"
    elif constraints["max_calls"] >= 2 and (pressure >= 0.36 or task["category"] in {"research", "security", "financial", "health", "legal"}):
        preferred = "balanced"
    else:
        preferred = "lean"

    candidates = [plan for plan in enumerate_plans(workers) if feasible(plan, constraints)]
    if not candidates:
        candidates = list(enumerate_plans(workers))
    policy_rank = {"lean": 0, "balanced": 1, "strict": 2}
    preferred_rank = policy_rank[preferred]

    by_id = {worker["id"]: worker for worker in workers}

    def capability(worker_id: str | None, role: str) -> float:
        if worker_id is None:
            return 0.0
        strengths = set(by_id[worker_id]["strengths"])
        wanted = {
            "writer": {"drafting", "coding", "implementation"},
            "reviewer": {"review", "reasoning"},
            "finalizer": {"synthesis", "writing"},
        }[role]
        return float(len(strengths & wanted))

    def heuristic(plan: dict[str, Any]) -> tuple[float, float, float, float]:
        distance = abs(policy_rank[plan["policy"]] - preferred_rank)
        role_fit = capability(plan["writer"], "writer") + capability(plan["reviewer"], "reviewer") + capability(plan["finalizer"], "finalizer")
        independent = 1.0 if plan["independent_verification"] and pressure > 0.55 else 0.0
        # Costs and latency are only tie breakers after policy and static role fit.
        return -float(distance), role_fit + independent, -plan["estimated_credits"], -plan["estimated_latency_ms"]

    selected = max(candidates, key=heuristic)
    outcome = outcome_for_plan(task, workers, selected)
    return {
        **selected,
        "max_credits": constraints["max_credits"],
        "max_latency_ms": constraints["max_latency_ms"],
        "estimated_quality": outcome["quality"],
        "estimated_pass_rate": outcome["pass_rate"],
        "reason_codes": ["deterministic_local_policy"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate the current deterministic Loom-style router")
    parser.add_argument("--data", type=Path, default=Path("data/test.jsonl"))
    parser.add_argument("--output", type=Path, default=Path("reports/deterministic_predictions.jsonl"))
    args = parser.parse_args()
    rows = read_jsonl(args.data)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    scores: list[dict[str, Any]] = []
    with args.output.open("w", encoding="utf-8") as handle:
        for example in rows:
            prediction = stable_json(deterministic_plan(example))
            score = score_prediction(example, prediction)
            scores.append(score)
            handle.write(json.dumps({"id": example["id"], "prediction": prediction, "score": score}, sort_keys=True) + "\n")
    summary = {"lane": "deterministic_router", **aggregate_scores(scores)}
    summary_path = args.output.with_suffix(".summary.json")
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
