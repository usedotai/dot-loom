from __future__ import annotations

import argparse
import json
from pathlib import Path

from conductor_data import extract_json_object, feasible, plan_from_prediction, read_jsonl, stable_json
from deterministic_router import deterministic_plan


def guarded_prediction(example: dict, raw: str) -> tuple[str, str | None]:
    parsed = extract_json_object(raw)
    fallback_reason = None
    if parsed is None:
        fallback_reason = "invalid_json"
    else:
        plan = plan_from_prediction(parsed, example)
        if plan is None:
            fallback_reason = "invalid_plan"
        elif not feasible(plan, example["constraints"]):
            fallback_reason = "over_budget"
    if fallback_reason:
        return stable_json(deterministic_plan(example)), fallback_reason
    return raw, None


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply hard runtime validation and deterministic fallback")
    parser.add_argument("--data", type=Path, default=Path("data/test.jsonl"))
    parser.add_argument("--predictions", type=Path, default=Path("reports/trained_predictions.jsonl"))
    parser.add_argument("--output", type=Path, default=Path("reports/trained_guarded_predictions.jsonl"))
    args = parser.parse_args()
    examples = {row["id"]: row for row in read_jsonl(args.data)}
    predictions = read_jsonl(args.predictions)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    counts = {"accepted": 0, "invalid_json": 0, "invalid_plan": 0, "over_budget": 0}
    with args.output.open("w", encoding="utf-8") as handle:
        for record in predictions:
            example = examples[record["id"]]
            raw = str(record.get("prediction") or "")
            prediction, fallback_reason = guarded_prediction(example, raw)
            if fallback_reason:
                counts[fallback_reason] += 1
            else:
                counts["accepted"] += 1
            handle.write(json.dumps({
                **record,
                "prediction": prediction,
                "raw_prediction": raw,
                "runtime_fallback_used": fallback_reason is not None,
                "runtime_fallback_reason": fallback_reason,
            }, sort_keys=True, ensure_ascii=True) + "\n")
    fallback_count = len(predictions) - counts["accepted"]
    summary = {
        "examples": len(predictions),
        "accepted": counts["accepted"],
        "fallback_count": fallback_count,
        "fallback_rate": round(fallback_count / len(predictions), 6),
        "reasons": {key: value for key, value in counts.items() if key != "accepted"},
    }
    args.output.with_suffix(".guard.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
