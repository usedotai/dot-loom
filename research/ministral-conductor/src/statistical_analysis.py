from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
from pathlib import Path
from typing import Any, Callable

from conductor_data import read_jsonl


def percentile(values: list[float], proportion: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.floor(proportion * (len(ordered) - 1))))
    return ordered[index]


def wilson(successes: int, total: int, z: float = 1.959963984540054) -> list[float]:
    if total <= 0:
        return [0.0, 0.0]
    rate = successes / total
    denominator = 1 + z * z / total
    center = (rate + z * z / (2 * total)) / denominator
    margin = z * math.sqrt(rate * (1 - rate) / total + z * z / (4 * total * total)) / denominator
    return [round(max(0.0, center - margin), 6), round(min(1.0, center + margin), 6)]


def exact_mcnemar(left: list[bool], right: list[bool]) -> dict[str, Any]:
    left_only = sum(a and not b for a, b in zip(left, right))
    right_only = sum(b and not a for a, b in zip(left, right))
    discordant = left_only + right_only
    if discordant == 0:
        p_value = 1.0
    else:
        tail = sum(
            math.exp(
                math.lgamma(discordant + 1)
                - math.lgamma(k + 1)
                - math.lgamma(discordant - k + 1)
                - discordant * math.log(2)
            )
            for k in range(min(left_only, right_only) + 1)
        )
        p_value = min(1.0, 2 * tail)
    return {
        "left_only_successes": left_only,
        "right_only_successes": right_only,
        "discordant_pairs": discordant,
        "two_sided_exact_p": round(p_value, 12),
    }


def bootstrap_difference(
    left: list[float],
    right: list[float],
    iterations: int,
    seed: int,
) -> dict[str, Any]:
    if len(left) != len(right) or not left:
        raise ValueError("Paired samples must be non-empty and equal length")
    differences = [b - a for a, b in zip(left, right)]
    observed = sum(differences) / len(differences)
    rng = random.Random(seed)
    samples: list[float] = []
    count = len(differences)
    for _ in range(iterations):
        samples.append(sum(differences[rng.randrange(count)] for _ in range(count)) / count)
    return {
        "left_mean": round(sum(left) / count, 6),
        "right_mean": round(sum(right) / count, 6),
        "right_minus_left": round(observed, 6),
        "paired_bootstrap_95_ci": [round(percentile(samples, 0.025), 6), round(percentile(samples, 0.975), 6)],
        "iterations": iterations,
        "seed": seed,
    }


def file_sha256(path_value: Path) -> str:
    digest = hashlib.sha256()
    with path_value.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def score_map(path_value: Path) -> dict[str, dict[str, Any]]:
    return {row["id"]: row["score"] for row in read_jsonl(path_value)}


def values(rows: list[dict[str, Any]], accessor: Callable[[dict[str, Any]], float]) -> list[float]:
    return [float(accessor(row)) for row in rows]


def main() -> None:
    parser = argparse.ArgumentParser(description="Paired statistics for the held-out conductor benchmark")
    parser.add_argument("--deterministic", type=Path, default=Path("reports/deterministic_scored.jsonl"))
    parser.add_argument("--base", type=Path, default=Path("reports/base_scored.jsonl"))
    parser.add_argument("--trained", type=Path, default=Path("reports/trained_scored.jsonl"))
    parser.add_argument("--output", type=Path, default=Path("reports/paired-statistics.json"))
    parser.add_argument("--iterations", type=int, default=10_000)
    parser.add_argument("--seed", type=int, default=20260716)
    args = parser.parse_args()

    lanes = {
        "deterministic": score_map(args.deterministic),
        "base": score_map(args.base),
        "trained": score_map(args.trained),
    }
    ids = sorted(set.intersection(*(set(lane) for lane in lanes.values())))
    if len(ids) != len(lanes["trained"]):
        raise RuntimeError("Benchmark lanes do not contain the same example IDs")
    ordered = {lane: [rows[id_value] for id_value in ids] for lane, rows in lanes.items()}

    binary_fields = (
        "json_valid", "schema_valid", "plan_valid", "receipt_consistent",
        "constraint_satisfied", "policy_correct", "exact_plan", "quality_target_met",
    )
    lane_intervals: dict[str, Any] = {}
    for lane, rows in ordered.items():
        lane_intervals[lane] = {
            field: {
                "rate": round(sum(bool(row[field]) for row in rows) / len(rows), 6),
                "wilson_95_ci": wilson(sum(bool(row[field]) for row in rows), len(rows)),
            }
            for field in binary_fields
        }

    comparisons: dict[str, Any] = {}
    for left_name in ("deterministic", "base"):
        left = ordered[left_name]
        right = ordered["trained"]
        key = f"trained_vs_{left_name}"
        comparisons[key] = {}
        for field in binary_fields:
            left_values = [bool(row[field]) for row in left]
            right_values = [bool(row[field]) for row in right]
            result = bootstrap_difference(
                [float(value) for value in left_values],
                [float(value) for value in right_values],
                args.iterations,
                args.seed + sum(ord(character) for character in key + field),
            )
            result["mcnemar"] = exact_mcnemar(left_values, right_values)
            comparisons[key][field] = result
        comparisons[key]["utility_regret_reduction"] = bootstrap_difference(
            values(right, lambda row: row["utility_regret"]),
            values(left, lambda row: row["utility_regret"]),
            args.iterations,
            args.seed + sum(ord(character) for character in key + "regret"),
        )
        comparisons[key]["unsafe_under_escalation_reduction"] = bootstrap_difference(
            values(right, lambda row: bool(row["unsafe_under_escalation"])),
            values(left, lambda row: bool(row["unsafe_under_escalation"])),
            args.iterations,
            args.seed + sum(ord(character) for character in key + "unsafe"),
        )

    output = {
        "examples": len(ids),
        "paired_by_example_id": True,
        "bootstrap_iterations": args.iterations,
        "seed": args.seed,
        "input_sha256": {
            "deterministic": file_sha256(args.deterministic),
            "base": file_sha256(args.base),
            "trained": file_sha256(args.trained),
        },
        "lane_intervals": lane_intervals,
        "comparisons": comparisons,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
