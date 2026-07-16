from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def load(path_value: Path) -> dict[str, Any]:
    return json.loads(path_value.read_text(encoding="utf-8"))


def percent(value: float | int | None) -> str:
    return "n/a" if value is None else f"{100 * float(value):.1f}%"


def number(value: float | int | None, digits: int = 3) -> str:
    return "n/a" if value is None else f"{float(value):.{digits}f}"


def bytes_gib(value: int | float) -> str:
    return f"{float(value) / (1024 ** 3):.1f} GiB"


def main() -> None:
    parser = argparse.ArgumentParser(description="Write the conductor benchmark report from raw receipts")
    parser.add_argument("--reports", type=Path, default=Path("reports"))
    parser.add_argument("--receipts", type=Path, default=Path("receipts"))
    parser.add_argument("--output", type=Path, default=Path("reports/CONDUCTOR-BENCHMARK.md"))
    args = parser.parse_args()
    lanes = [
        ("Deterministic Loom", load(args.reports / "deterministic_scored.summary.json")),
        ("Base Ministral 14B", load(args.reports / "base_scored.summary.json")),
        ("Dot-trained raw proposals", load(args.reports / "trained_scored.summary.json")),
        ("Dot-trained + runtime guard", load(args.reports / "trained_guarded_scored.summary.json")),
    ]
    stats = load(args.reports / "paired-statistics.json")
    training = load(args.receipts / "training_receipt.json")
    checkpoint = load(args.receipts / "checkpoint-selection.json")
    telemetry = load(args.receipts / "gpu-telemetry.summary.json")
    audit = load(args.receipts / "independent-label-audit-v2-openai-90-validated.json")["summary"]
    comparison = stats["comparisons"]["trained_vs_deterministic"]
    adapter_weights = next(
        item for item in checkpoint["adapter_files"] if item["path"] == "adapter_model.safetensors"
    )

    lines = [
        "# Dot Loom Ministral 14B Conductor Benchmark",
        "",
        "We trained a local 14B Mistral model to decide when one AI model is enough and when a task needs independent verification.",
        "",
        "![Held-out benchmark](../charts/benchmark-overview.svg)",
        "",
        "## Held-out results",
        "",
        "The test set contains 1,200 synthetic cases from eight task families that never appear in training or validation.",
        "",
        "| Lane | JSON valid | Receipt consistent | Policy accuracy | Exact plan | Constraints met | Fallback | Unsafe under-escalation | Mean regret | P95 batch latency |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for label, row in lanes:
        lines.append(
            f"| {label} | {percent(row.get('json_valid'))} | {percent(row.get('receipt_consistent'))} | {percent(row.get('policy_correct'))} | "
            f"{percent(row.get('exact_plan'))} | {percent(row.get('constraint_satisfied'))} | "
            f"{percent(row.get('runtime_fallback_rate'))} | {percent(row.get('unsafe_under_escalation'))} | "
            f"{number(row.get('mean_utility_regret'))} | {number(row.get('p95_inference_ms'), 1)} ms |"
        )

    exact = comparison["exact_plan"]
    regret = comparison["utility_regret_reduction"]
    unsafe = comparison["unsafe_under_escalation_reduction"]
    quality_target = comparison["quality_target_met"]
    raw_trained = lanes[2][1]
    guarded_trained = lanes[3][1]
    regret_reduction_percent = regret["right_minus_left"] / regret["right_mean"]
    mcnemar_p = exact["mcnemar"]["two_sided_exact_p"]
    mcnemar_text = "< 1e-12" if mcnemar_p == 0 else str(mcnemar_p)
    lines.extend([
        "",
        f"The raw conductor exceeded a hard budget on {round((1 - raw_trained['constraint_satisfied']) * raw_trained['examples'])} of {raw_trained['examples']:,} proposals. "
        f"The local guard caught all of them and invoked the deterministic fallback on {guarded_trained['runtime_fallback_count']} cases ({percent(guarded_trained['runtime_fallback_rate'])}).",
        "",
        "Declared quality and pass-rate estimates are evaluated as calibration errors, not as hard receipt fields.",
        "",
        "| Lane | Quality estimate MAE | Quality estimate P95 error | Pass-rate estimate MAE |",
        "|---|---:|---:|---:|",
    ])
    for label, row in lanes:
        lines.append(
            f"| {label} | {number(row.get('mean_declared_quality_abs_error'), 4)} | "
            f"{number(row.get('p95_declared_quality_abs_error'), 4)} | "
            f"{number(row.get('mean_declared_pass_rate_abs_error'), 4)} |"
        )
    lines.extend([
        "",
        "## Paired statistical comparison",
        "",
        f"- Exact-plan improvement over deterministic Loom: {percent(exact['right_minus_left'])}, paired bootstrap 95% CI {percent(exact['paired_bootstrap_95_ci'][0])} to {percent(exact['paired_bootstrap_95_ci'][1])}.",
        f"- Mean utility-regret reduction: {number(regret['right_minus_left'])} ({percent(regret_reduction_percent)}), paired bootstrap 95% CI {number(regret['paired_bootstrap_95_ci'][0])} to {number(regret['paired_bootstrap_95_ci'][1])}.",
        f"- Quality-target attainment improvement: {percent(quality_target['right_minus_left'])}, paired bootstrap 95% CI {percent(quality_target['paired_bootstrap_95_ci'][0])} to {percent(quality_target['paired_bootstrap_95_ci'][1])}.",
        f"- Unsafe under-escalation reduction: {percent(unsafe['right_minus_left'])}, paired bootstrap 95% CI {percent(unsafe['paired_bootstrap_95_ci'][0])} to {percent(unsafe['paired_bootstrap_95_ci'][1])}.",
        f"- Exact-plan McNemar two-sided p-value: {mcnemar_text}.",
        "",
        "![Held-out family results](../charts/family-generalization.svg)",
        "",
        "## Training receipt",
        "",
        f"- Base revision: `{training['base_model_commit']}`",
        f"- Training examples: {training['train_examples']:,}",
        f"- Validation examples: {training['validation_examples']:,}",
        f"- Trainable parameters: {training['trainable_parameters']:,} of {training['total_parameters']:,}",
        f"- Validation-selected checkpoint: `{checkpoint['best_checkpoint']}` at loss {number(checkpoint['best_metric'], 6)}",
        f"- Adapter weights: {adapter_weights['bytes'] / (1024 ** 2):.1f} MiB, SHA-256 `{adapter_weights['sha256']}`",
        f"- Duration: {training['duration_seconds'] / 60:.1f} minutes",
        f"- Peak allocated VRAM: {bytes_gib(training['peak_gpu_memory_bytes'])}",
        f"- Mean GPU utilization: {percent(telemetry['gpu_util_pct']['mean'] / 100)}",
        f"- Integrated GPU energy: {number(telemetry['integrated_energy_kwh'], 3)} kWh",
        f"- Final validation loss: {number(training['evaluation']['eval_loss'], 6)}",
        f"- Train data SHA-256: `{training['train_data_sha256']}`",
        "",
        "![Training dynamics](../charts/training-dynamics.svg)",
        "",
        "## Label audit",
        "",
        f"A blinded independent OpenAI judge agreed with {audit['agreement_count']} of {audit['sample_size']} pretraining labels. "
        f"It proposed {audit['disagreement_count']} alternatives. Deterministic validation found "
        f"{audit['valid_feasible_alternatives']} feasible and {audit['invalid_or_infeasible_alternatives']} invalid or over-budget.",
        f"None of the feasible alternatives improved the disclosed oracle utility ({audit['oracle_improving_alternatives']} of {audit['valid_feasible_alternatives']}).",
        "",
        "![Label audit](../charts/label-audit.svg)",
        "",
        "## Reproduce",
        "",
        "```bash",
        "cd /home/sesterce/dot-loom-conductor",
        "scripts/run_full_benchmark.sh",
        "demo/03_show_benchmark.sh",
        "demo/05_verify_artifacts.sh",
        "```",
        "",
        "## Scope",
        "",
        "This study measures constrained routing-plan generation, not end-to-end code quality. Labels come from a disclosed simulator calibrated to a six-case Dot Loom receipt. See [`docs/METHODS.md`](../docs/METHODS.md) for assumptions and limitations.",
        "",
    ])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"report": str(args.output), "lines": len(lines)}, indent=2))


if __name__ == "__main__":
    main()
