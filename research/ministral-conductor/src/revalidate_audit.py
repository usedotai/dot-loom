from __future__ import annotations

import argparse
import json
from pathlib import Path

from audit_labels import validate_alternative
from conductor_data import read_jsonl


def main() -> None:
    parser = argparse.ArgumentParser(description="Revalidate judge alternatives without another API call")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--train", type=Path, default=Path("data/train.jsonl"))
    parser.add_argument("--validation", type=Path, default=Path("data/validation.jsonl"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    receipt = json.loads(args.input.read_text(encoding="utf-8"))
    examples = {row["id"]: row for row in read_jsonl(args.train) + read_jsonl(args.validation)}
    disagreements = []
    for result in receipt["results"]:
        result["alternative_validation"] = validate_alternative(examples[result["id"]], result.get("audit"))
        if result.get("audit", {}).get("agree") is not True:
            disagreements.append(result)
    valid = sum(
        result["alternative_validation"]["plan_valid"]
        and result["alternative_validation"]["constraint_satisfied"]
        for result in disagreements
    )
    improving = sum(result["alternative_validation"]["oracle_improving"] for result in disagreements)
    receipt["summary"].update({
        "valid_feasible_alternatives": valid,
        "invalid_or_infeasible_alternatives": len(disagreements) - valid,
        "oracle_improving_alternatives": improving,
        "validated_disagreement_rate": round(valid / max(1, receipt["summary"]["valid_json"]), 6),
        "oracle_improving_disagreement_rate": round(improving / max(1, receipt["summary"]["valid_json"]), 6),
        "revalidated_without_api_calls": True,
    })
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(receipt["summary"], indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
