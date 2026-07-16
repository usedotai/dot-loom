from __future__ import annotations

import json
import random
import tempfile
import unittest
from pathlib import Path

from src.conductor_data import (
    FAMILIES,
    POLICIES,
    feasible,
    generate_split,
    outcome_for_plan,
    plan_record,
    read_jsonl,
    score_prediction,
    write_dataset,
)


class ConductorDatasetTests(unittest.TestCase):
    def test_balanced_policy_distribution_and_feasible_labels(self) -> None:
        rows = generate_split(random.Random(7), "train",  ninety := 90)
        self.assertEqual(len(rows), ninety)
        counts = {policy: 0 for policy in POLICIES}
        for row in rows:
            counts[row["label"]["policy"]] += 1
            self.assertTrue(feasible(row["label"], row["constraints"]))
            self.assertEqual(json.loads(row["target"])["policy"], row["label"]["policy"])
        self.assertEqual(counts, {"lean": 30, "balanced": 30, "strict": 30})

    def test_family_splits_are_disjoint(self) -> None:
        grouped = {
            split: {family.name for family in FAMILIES if family.split == split}
            for split in ("train", "validation", "test")
        }
        self.assertFalse(grouped["train"] & grouped["validation"])
        self.assertFalse(grouped["train"] & grouped["test"])
        self.assertFalse(grouped["validation"] & grouped["test"])

    def test_round_trip_and_oracle_score(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = write_dataset(root, seed=9, train_size=12, validation_size=6, test_size=6)
            self.assertTrue(manifest["no_user_prompts"])
            rows = read_jsonl(root / "test.jsonl")
            score = score_prediction(rows[0], rows[0]["target"])
            self.assertTrue(score["json_valid"])
            self.assertTrue(score["schema_valid"])
            self.assertTrue(score["plan_valid"])
            self.assertTrue(score["receipt_consistent"])
            self.assertTrue(score["constraint_satisfied"])
            self.assertTrue(score["exact_plan"])
            self.assertAlmostEqual(score["utility_regret"], 0.0, places=5)

    def test_finalizer_capability_affects_delivered_quality(self) -> None:
        task = {
            "risk": 0.9,
            "complexity": 0.9,
            "consequence": 0.9,
            "ambiguity": 0.7,
            "evidence_need": 0.9,
            "reversibility": 0.2,
        }
        workers = [
            {
                "id": "worker_a", "provider_group": "a", "quality": 0.68, "pass_rate": 0.5,
                "credits_per_call": 1.0, "p95_latency_ms": 10_000, "strengths": ["drafting"],
            },
            {
                "id": "worker_b", "provider_group": "b", "quality": 0.84, "pass_rate": 0.8,
                "credits_per_call": 3.0, "p95_latency_ms": 20_000, "strengths": ["review", "reasoning"],
            },
            {
                "id": "worker_c", "provider_group": "c", "quality": 0.97, "pass_rate": 0.96,
                "credits_per_call": 10.0, "p95_latency_ms": 30_000, "strengths": ["synthesis", "reasoning"],
            },
        ]
        strong_finalizer = plan_record("strict", workers[0], workers[1], workers[2])
        weak_finalizer = plan_record("strict", workers[2], workers[1], workers[0])
        strong_outcome = outcome_for_plan(task, workers, strong_finalizer)
        weak_outcome = outcome_for_plan(task, workers, weak_finalizer)
        self.assertGreater(strong_outcome["quality"], weak_outcome["quality"])
        self.assertGreater(strong_outcome["pass_rate"], weak_outcome["pass_rate"])

    def test_labels_publish_combined_quality_estimates(self) -> None:
        rows = generate_split(random.Random(13), "validation", 12)
        for row in rows:
            self.assertIn("estimated_quality", row["label"])
            self.assertIn("estimated_pass_rate", row["label"])
            self.assertEqual(
                row["oracle"]["quality_target_met"],
                row["label"]["estimated_quality"] >= row["constraints"]["minimum_quality"],
            )


if __name__ == "__main__":
    unittest.main()
