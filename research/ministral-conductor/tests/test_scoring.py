from __future__ import annotations

import random
import unittest

from src.apply_runtime_guard import guarded_prediction
from src.conductor_data import enumerate_plans, feasible, generate_split, score_prediction, stable_json
from src.deterministic_router import deterministic_plan
from src.statistical_analysis import bootstrap_difference, exact_mcnemar, wilson


class ConductorScoringTests(unittest.TestCase):
    def test_deterministic_router_never_breaks_hard_limits(self) -> None:
        rows = generate_split(random.Random(23), "test",  ninety := 90)
        self.assertEqual(len(rows), ninety)
        for row in rows:
            score = score_prediction(row, stable_json(deterministic_plan(row)))
            self.assertTrue(score["json_valid"])
            self.assertTrue(score["schema_valid"])
            self.assertTrue(score["plan_valid"])
            self.assertTrue(score["receipt_consistent"])
            self.assertTrue(score["constraint_satisfied"])

    def test_invalid_output_receives_fixed_failure_penalty(self) -> None:
        row = generate_split(random.Random(29), "validation", 3)[0]
        score = score_prediction(row, "not a routing plan")
        self.assertFalse(score["json_valid"])
        self.assertFalse(score["schema_valid"])
        self.assertFalse(score["constraint_satisfied"])
        self.assertEqual(score["utility"], -1_000.0)
        self.assertGreater(score["utility_regret"], 1_000.0)

    def test_runtime_guard_replaces_invalid_and_over_budget_plans(self) -> None:
        row = generate_split(random.Random(37), "test", 3)[0]
        replacement, reason = guarded_prediction(row, "not json")
        self.assertEqual(reason, "invalid_json")
        self.assertTrue(score_prediction(row, replacement)["constraint_satisfied"])
        over_budget = next(
            plan for plan in enumerate_plans(row["workers"])
            if not feasible(plan, row["constraints"])
        )
        replacement, reason = guarded_prediction(row, stable_json(over_budget))
        self.assertEqual(reason, "over_budget")
        self.assertTrue(score_prediction(row, replacement)["constraint_satisfied"])

    def test_exact_mcnemar_and_paired_bootstrap(self) -> None:
        mcnemar = exact_mcnemar([False, False], [True, True])
        self.assertEqual(mcnemar["right_only_successes"], 2)
        self.assertEqual(mcnemar["two_sided_exact_p"], 0.5)
        bootstrap = bootstrap_difference([0.0, 0.0], [1.0, 1.0], 100, 31)
        self.assertEqual(bootstrap["right_minus_left"], 1.0)
        self.assertEqual(bootstrap["paired_bootstrap_95_ci"], [1.0, 1.0])

    def test_wilson_interval_contains_observed_rate(self) -> None:
        low, high = wilson(76, 90)
        observed = 76 / 90
        self.assertLessEqual(low, observed)
        self.assertGreaterEqual(high, observed)


if __name__ == "__main__":
    unittest.main()
