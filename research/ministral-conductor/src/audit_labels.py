from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import random
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from conductor_data import (
    POLICIES,
    feasible,
    outcome_for_plan,
    plan_from_prediction,
    read_jsonl,
    stable_json,
    utility,
)


SYSTEM = (
    "You are an independent routing-label auditor. Check whether the proposed Dot Loom plan is defensible "
    "given the task risk, worker quality/pass-rate/cost/latency profiles, and limits. Maximum calls, credits, "
    "and latency are hard constraints. minimum_quality is an optimization target that may be unattainable. "
    "Judge the plan's estimated combined quality, not whether every individual worker exceeds the target. "
    "A reviewer can improve a stronger writer, but must still be reliable enough to provide useful verification. "
    "The finalizer produces the delivered answer, so weak finalizers require special scrutiny. Do not solve the task. "
    "If you disagree, provide a complete alternative using only listed worker IDs. The alternative must obey maximum "
    "calls, credits, and latency. If no better feasible alternative exists, agree even when the quality target is "
    "unattainable. Return the requested audit function only."
)


def stratified_sample(rows: list[dict[str, Any]], limit: int, seed: int) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    buckets = {policy: [row for row in rows if row["label"]["policy"] == policy] for policy in POLICIES}
    for bucket in buckets.values():
        rng.shuffle(bucket)
    result: list[dict[str, Any]] = []
    while len(result) < limit and any(buckets.values()):
        for policy in POLICIES:
            if buckets[policy] and len(result) < limit:
                result.append(buckets[policy].pop())
    rng.shuffle(result)
    return result


def audit_one(example: dict[str, Any], api_key: str, base_url: str, model: str) -> dict[str, Any]:
    payload = {
        "task": example["task"],
        "constraints": example["constraints"],
        "workers": example["workers"],
        "proposed_plan": example["label"],
        "oracle_outcome": example["oracle"],
    }
    body = json.dumps({
        "model": model,
        "temperature": 0,
        "max_tokens": 320,
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "record_audit",
                    "description": "Record the routing-label audit. Do not answer or execute the underlying task.",
                    "parameters": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": [
                            "agree",
                            "alternative_policy",
                            "alternative_writer",
                            "alternative_reviewer",
                            "alternative_finalizer",
                            "hard_constraint_violation",
                            "reason",
                        ],
                        "properties": {
                            "agree": {"type": "boolean"},
                            "alternative_policy": {
                                "anyOf": [
                                    {"type": "string", "enum": ["lean", "balanced", "strict"]},
                                    {"type": "null"},
                                ],
                            },
                            "alternative_writer": {
                                "anyOf": [{"type": "string"}, {"type": "null"}],
                            },
                            "alternative_reviewer": {
                                "anyOf": [{"type": "string"}, {"type": "null"}],
                            },
                            "alternative_finalizer": {
                                "anyOf": [{"type": "string"}, {"type": "null"}],
                            },
                            "hard_constraint_violation": {"type": "boolean"},
                            "reason": {"type": "string", "maxLength": 320},
                        },
                    },
                },
            },
        ],
        "tool_choice": {"type": "function", "function": {"name": "record_audit"}},
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": stable_json(payload)},
        ],
    }).encode()
    last_error: Exception | None = None
    for attempt in range(4):
        request = urllib.request.Request(
            base_url.rstrip("/") + "/chat/completions",
            data=body,
            method="POST",
            headers={
                "content-type": "application/json",
                "authorization": "Bearer " + api_key,
                "user-agent": "dot-loom-conductor-audit/1.0",
            },
        )
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                result = json.load(response)
            message = result.get("choices", [{}])[0].get("message", {})
            content = message.get("content", "") or ""
            tool_calls = message.get("tool_calls") or []
            arguments = ""
            if tool_calls:
                arguments = str((tool_calls[0].get("function") or {}).get("arguments") or "")
            parsed = parse_object(arguments) or parse_object(content)
            return {
                "id": example["id"],
                "policy": example["label"]["policy"],
                "audit": parsed,
                "raw": arguments or content,
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 3),
                "usage": result.get("usage"),
                "payment": (result.get("dot_parameters") or {}).get("agent_api_payment"),
                "model": model,
            }
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Audit failed for {example['id']}: {last_error}")


def parse_object(text: str) -> dict[str, Any] | None:
    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None


def validate_alternative(example: dict[str, Any], audit: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(audit, dict) or audit.get("agree") is True:
        return {
            "provided": False,
            "plan_valid": False,
            "constraint_satisfied": False,
            "oracle_improving": False,
            "plan": None,
        }
    prediction = {
        "policy": audit.get("alternative_policy"),
        "writer": audit.get("alternative_writer"),
        "reviewer": audit.get("alternative_reviewer"),
        "finalizer": audit.get("alternative_finalizer"),
    }
    plan = plan_from_prediction(prediction, example)
    constraint_satisfied = bool(plan and feasible(plan, example["constraints"]))
    alternative_outcome = outcome_for_plan(example["task"], example["workers"], plan) if constraint_satisfied else None
    alternative_utility = (
        utility(example["task"], example["constraints"], plan, alternative_outcome, example["workers"])
        if constraint_satisfied and alternative_outcome
        else None
    )
    oracle_utility = float(example["oracle"]["utility"])
    return {
        "provided": any(value is not None for value in prediction.values()),
        "plan_valid": plan is not None,
        "constraint_satisfied": constraint_satisfied,
        "outcome": alternative_outcome,
        "utility": alternative_utility,
        "oracle_utility": oracle_utility,
        "utility_delta_vs_oracle": round(alternative_utility - oracle_utility, 6) if alternative_utility is not None else None,
        "oracle_improving": bool(alternative_utility is not None and alternative_utility > oracle_utility + 1e-6),
        "plan": plan,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit optimizer labels with an independent API model")
    parser.add_argument("--train", default="data/train.jsonl")
    parser.add_argument("--validation", default="data/validation.jsonl")
    parser.add_argument("--output", default="receipts/independent-label-audit.json")
    parser.add_argument("--limit", type=int, default=90)
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--seed", type=int, default=20260716)
    parser.add_argument("--model", default="dot-deepseek-v4-pro")
    parser.add_argument("--base-url", default="https://api.usedot.xyz/agent/v1")
    args = parser.parse_args()

    api_key = os.environ.get("DOT_API_KEY", "")
    if not api_key:
        raise RuntimeError("DOT_API_KEY is required")
    rows = read_jsonl(Path(args.train)) + read_jsonl(Path(args.validation))
    sample = stratified_sample(rows, args.limit, args.seed)
    results: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = [executor.submit(audit_one, example, api_key, args.base_url, args.model) for example in sample]
        for index, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            result = future.result()
            results.append(result)
            print(f"LABEL_AUDIT {index}/{len(sample)} id={result['id']}", flush=True)
    valid = [result for result in results if isinstance(result.get("audit"), dict)]
    agreement = sum(result["audit"].get("agree") is True for result in valid)
    hard_violations = sum(result["audit"].get("hard_constraint_violation") is True for result in valid)
    for result in results:
        result["alternative_validation"] = validate_alternative(
            next(example for example in sample if example["id"] == result["id"]),
            result.get("audit"),
        )
    disagreements = [result for result in valid if result["audit"].get("agree") is not True]
    valid_alternatives = sum(
        result["alternative_validation"]["plan_valid"]
        and result["alternative_validation"]["constraint_satisfied"]
        for result in disagreements
    )
    oracle_improving = sum(result["alternative_validation"]["oracle_improving"] for result in disagreements)
    spent = sum(float((result.get("payment") or {}).get("spent_credits") or 0) for result in results)
    summary = {
        "model": args.model,
        "sample_size": len(results),
        "valid_json": len(valid),
        "agreement_count": agreement,
        "agreement_rate": round(agreement / max(1, len(valid)), 6),
        "disagreement_count": len(disagreements),
        "valid_feasible_alternatives": valid_alternatives,
        "oracle_improving_alternatives": oracle_improving,
        "invalid_or_infeasible_alternatives": len(disagreements) - valid_alternatives,
        "validated_disagreement_rate": round(valid_alternatives / max(1, len(valid)), 6),
        "hard_constraint_violations": hard_violations,
        "spent_credits": spent,
        "no_test_labels_audited": True,
        "no_user_prompts": True,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"summary": summary, "results": sorted(results, key=lambda item: item["id"])}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
