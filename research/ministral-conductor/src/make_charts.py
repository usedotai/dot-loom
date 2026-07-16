from __future__ import annotations

import argparse
import csv
import html
import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any


WIDTH = 1400
HEIGHT = 820
INK = "#172033"
MUTED = "#687083"
GRID = "#d9deea"
PAPER = "#ffffff"
LANES = (
    ("deterministic", "Deterministic Loom", "#67758d"),
    ("base", "Base Ministral 14B", "#df8b3a"),
    ("trained", "Dot-trained + runtime guard", "#2d68c4"),
)


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def esc(value: Any) -> str:
    return html.escape(str(value))


def svg_document(title: str, description: str, body: list[str], height: int = HEIGHT) -> str:
    style = f"""
    <style>
      text {{ font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; fill: {INK}; }}
      .title {{ font-size: 30px; font-weight: 700; }}
      .subtitle {{ font-size: 16px; fill: {MUTED}; }}
      .label {{ font-size: 15px; font-weight: 600; }}
      .small {{ font-size: 13px; fill: {MUTED}; }}
      .value {{ font-size: 14px; font-weight: 700; }}
      .axis {{ stroke: {GRID}; stroke-width: 1; }}
    </style>
    """.strip()
    return "\n".join([
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{height}" viewBox="0 0 {WIDTH} {height}" role="img" aria-labelledby="title desc">',
        f'<title id="title">{esc(title)}</title>',
        f'<desc id="desc">{esc(description)}</desc>',
        f'<rect width="{WIDTH}" height="{height}" fill="{PAPER}"/>',
        style,
        *body,
        "</svg>",
        "",
    ])


def text(x: float, y: float, value: Any, css: str = "small", anchor: str = "start") -> str:
    return f'<text x="{x:.1f}" y="{y:.1f}" class="{css}" text-anchor="{anchor}">{esc(value)}</text>'


def line(x1: float, y1: float, x2: float, y2: float, color: str = GRID, width: float = 1.0) -> str:
    return f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{color}" stroke-width="{width:.1f}"/>'


def rect(x: float, y: float, width: float, height: float, fill: str, radius: float = 0) -> str:
    return f'<rect x="{x:.1f}" y="{y:.1f}" width="{max(0, width):.1f}" height="{max(0, height):.1f}" rx="{radius:.1f}" fill="{fill}"/>'


def circle(x: float, y: float, radius: float, fill: str, stroke: str = PAPER) -> str:
    return f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{radius:.1f}" fill="{fill}" stroke="{stroke}" stroke-width="2"/>'


def path(points: list[tuple[float, float]], stroke: str, width: float = 3.0) -> str:
    if not points:
        return ""
    commands = " ".join(("M" if index == 0 else "L") + f" {x:.1f} {y:.1f}" for index, (x, y) in enumerate(points))
    return f'<path d="{commands}" fill="none" stroke="{stroke}" stroke-width="{width:.1f}" stroke-linejoin="round" stroke-linecap="round"/>'


def downsample(points: list[tuple[float, float]], maximum: int = 240) -> list[tuple[float, float]]:
    if len(points) <= maximum:
        return points
    return [points[round(index * (len(points) - 1) / (maximum - 1))] for index in range(maximum)]


def legend(body: list[str], x: float, y: float) -> None:
    cursor = x
    for _, label, color in LANES:
        body.append(circle(cursor, y - 5, 6, color))
        body.append(text(cursor + 12, y, label, "small"))
        cursor += 215


def read_summaries(report_dir: Path) -> dict[str, dict[str, Any]]:
    candidates = {
        "deterministic": (
            "deterministic_scored.summary.json",
            "deterministic_predictions-v2.summary.json",
            "deterministic_predictions.summary.json",
        ),
        "base": ("base_scored.summary.json",),
        "trained": ("trained_guarded_scored.summary.json",),
    }
    summaries: dict[str, dict[str, Any]] = {}
    for lane, names in candidates.items():
        for name in names:
            path_value = report_dir / name
            if path_value.exists():
                summaries[lane] = load_json(path_value)
                break
    return summaries


def benchmark_overview(summaries: dict[str, dict[str, Any]]) -> str:
    metrics = (
        ("policy_correct", "Policy accuracy", True, True, False),
        ("exact_plan", "Exact plan match", True, True, False),
        ("constraint_satisfied", "Hard constraints met", True, True, False),
        ("quality_target_met_rate", "Quality target met", True, True, False),
        ("mean_utility_regret", "Mean utility regret (log scale)", False, False, True),
        ("unsafe_under_escalation", "Unsafe under-escalation", False, True, False),
    )
    body = [text(70, 58, "Held-out conductor benchmark", "title"), text(70, 88, "Balanced 1,200-case test set with disjoint task families", "subtitle")]
    legend(body, 70, 125)
    facet_width = 400
    facet_height = 260
    for index, (key, label, higher, percentage, log_scale) in enumerate(metrics):
        col = index % 3
        row = index // 3
        x0 = 70 + col * 445
        y0 = 175 + row * 300
        values = [float(summaries.get(lane, {}).get(key) or 0) for lane, _, _ in LANES]
        plotted_values = [math.log1p(value) for value in values] if log_scale else values
        maximum = 1.0 if percentage else max(max(plotted_values) * 1.15, 0.01)
        body.append(text(x0, y0, label, "label"))
        body.append(text(x0 + facet_width, y0, "higher is better" if higher else "lower is better", "small", "end"))
        plot_top = y0 + 30
        plot_bottom = y0 + 220
        body.append(line(x0, plot_bottom, x0 + facet_width, plot_bottom))
        for tick in range(5):
            plotted_tick = maximum * tick / 4
            value = math.expm1(plotted_tick) if log_scale else plotted_tick
            y = plot_bottom - (plot_bottom - plot_top) * tick / 4
            body.append(line(x0, y, x0 + facet_width, y))
            formatted = f"{value * 100:.0f}%" if percentage else f"{value:.1f}"
            body.append(text(x0 - 8, y + 4, formatted, "small", "end"))
        bar_width = 72
        gap = 46
        for lane_index, ((_, _, color), value, plotted_value) in enumerate(zip(LANES, values, plotted_values)):
            x = x0 + 48 + lane_index * (bar_width + gap)
            bar_height = (plot_bottom - plot_top) * plotted_value / maximum
            body.append(rect(x, plot_bottom - bar_height, bar_width, bar_height, color, 3))
            formatted = f"{value * 100:.1f}%" if percentage else f"{value:.2f}"
            body.append(text(x + bar_width / 2, plot_bottom - bar_height - 8, formatted, "value", "middle"))
    body.append(text(70, 790, "Quality and utility are calculated from the frozen v2 oracle. Raw predictions and scoring receipts are included.", "small"))
    return svg_document("Held-out conductor benchmark", "Six benchmark facets compare deterministic Loom, raw base Ministral, and the Dot-trained conductor.", body)


def family_generalization(summaries: dict[str, dict[str, Any]]) -> str:
    families = sorted({family for summary in summaries.values() for family in summary.get("by_family", {})})
    body = [text(70, 58, "Generalization to unseen task families", "title"), text(70, 88, "Exact plan match on families excluded from training and validation", "subtitle")]
    legend(body, 70, 125)
    x0, x1 = 330, 1320
    y0 = 175
    row_height = min(66, 535 / max(1, len(families)))
    for tick in range(6):
        x = x0 + (x1 - x0) * tick / 5
        body.append(line(x, y0 - 15, x, y0 + row_height * len(families)))
        body.append(text(x, y0 - 25, f"{tick * 20}%", "small", "middle"))
    for row, family in enumerate(families):
        y = y0 + row * row_height
        body.append(text(x0 - 22, y + 8, family.replace("_", " "), "label", "end"))
        body.append(line(x0, y + 16, x1, y + 16, "#edf0f6"))
        for lane_index, (lane, _, color) in enumerate(LANES):
            value = float(summaries.get(lane, {}).get("by_family", {}).get(family, {}).get("exact_plan") or 0)
            yy = y + (lane_index - 1) * 14
            xx = x0 + (x1 - x0) * value
            body.append(circle(xx, yy, 7, color))
            body.append(text(min(x1 - 2, xx + 12), yy + 5, f"{value * 100:.1f}%", "small"))
    body.append(text(70, 790, "Families: payment races, tenant isolation, webhook replay, OAuth integrity, SSRF, stream settlement, health triage, and contract risk.", "small"))
    return svg_document("Generalization to unseen task families", "A dot plot compares exact plan match across held-out task families.", body)


def confusion_matrices(summaries: dict[str, dict[str, Any]]) -> str:
    body = [text(70, 58, "Policy confusion matrices", "title"), text(70, 88, "Rows are oracle policy, columns are predicted policy. Values are row percentages.", "subtitle")]
    policies = ("lean", "balanced", "strict", "invalid")
    for lane_index, (lane, label, color) in enumerate(LANES):
        x0 = 70 + lane_index * 445
        y0 = 180
        body.append(text(x0, 135, label, "label"))
        matrix = summaries.get(lane, {}).get("policy_confusion", {})
        cell = 78
        for col, predicted in enumerate(policies):
            body.append(text(x0 + 110 + col * cell + cell / 2, y0 - 20, predicted, "small", "middle"))
        for row, expected in enumerate(policies[:3]):
            body.append(text(x0 + 95, y0 + row * cell + cell / 2 + 5, expected, "small", "end"))
            counts = matrix.get(expected, {})
            total = max(1, sum(int(counts.get(policy, 0)) for policy in policies))
            for col, predicted in enumerate(policies):
                value = int(counts.get(predicted, 0)) / total
                opacity = 0.08 + 0.82 * value
                x = x0 + 110 + col * cell
                y = y0 + row * cell
                body.append(f'<rect x="{x}" y="{y}" width="{cell - 4}" height="{cell - 4}" rx="4" fill="{color}" fill-opacity="{opacity:.3f}"/>')
                body.append(text(x + (cell - 4) / 2, y + cell / 2 + 5, f"{value * 100:.1f}%", "value", "middle"))
    body.append(text(70, 790, "Invalid includes non-JSON output, missing roles, duplicate roles, or plans that do not match the declared execution depth.", "small"))
    return svg_document("Policy confusion matrices", "Three heatmaps show lean, balanced, strict, and invalid predictions for each benchmark lane.", body)


def parse_telemetry(path_value: Path) -> list[dict[str, float]]:
    rows: list[dict[str, float]] = []
    with path_value.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        first_time: datetime | None = None
        for row in reader:
            try:
                moment = datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
                first_time = first_time or moment
                rows.append({
                    "minutes": (moment - first_time).total_seconds() / 60,
                    "gpu": float(row["gpu_util_pct"]),
                    "memory": 100 * float(row["memory_used_mib"]) / float(row["memory_total_mib"]),
                    "power": float(row["power_w"]),
                    "temperature": float(row["temperature_c"]),
                })
            except (KeyError, TypeError, ValueError, ZeroDivisionError):
                continue
    return rows


def parse_trainer_log(path_value: Path) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
    train: list[tuple[float, float]] = []
    evaluation: list[tuple[float, float]] = []
    for raw in path_value.read_text(encoding="utf-8").splitlines():
        row = json.loads(raw)
        step = float(row.get("step") or 0)
        if row.get("loss") is not None:
            train.append((step, float(row["loss"])))
        if row.get("eval_loss") is not None:
            evaluation.append((step, float(row["eval_loss"])))
    return train, evaluation


def training_dynamics(receipt_dir: Path) -> str | None:
    telemetry_path = receipt_dir / "gpu-telemetry.csv"
    log_path = receipt_dir / "trainer_log.jsonl"
    if not telemetry_path.exists() or not log_path.exists():
        return None
    telemetry = parse_telemetry(telemetry_path)
    train_loss, eval_loss = parse_trainer_log(log_path)
    if not telemetry or not train_loss:
        return None
    body = [text(70, 58, "Training dynamics and H200 utilization", "title"), text(70, 88, "Rank-32 LoRA, BF16, 2 epochs, seed 20260716", "subtitle")]
    panels = ((70, 170, 590, 510), (760, 170, 590, 510))

    x, y, width, height = panels[0]
    body.append(text(x, 140, "Optimization loss", "label"))
    max_step = max(point[0] for point in train_loss)
    max_loss = max(max(point[1] for point in train_loss), max((point[1] for point in eval_loss), default=0))
    max_loss = max(0.1, math.ceil(max_loss * 10) / 10)
    for tick in range(6):
        yy = y + height - height * tick / 5
        body.append(line(x, yy, x + width, yy))
        body.append(text(x - 10, yy + 4, f"{max_loss * tick / 5:.2f}", "small", "end"))
    train_points = [(x + width * step / max_step, y + height - height * loss / max_loss) for step, loss in train_loss]
    body.append(path(downsample(train_points), LANES[2][2], 3))
    for step, loss in eval_loss:
        body.append(circle(x + width * step / max_step, y + height - height * loss / max_loss, 7, LANES[1][2]))
    body.append(text(x, y + height + 30, "optimizer step", "small"))
    body.append(text(x + width, y + height + 30, f"{int(max_step)}", "small", "end"))
    body.append(circle(x + 20, y + height + 66, 5, LANES[2][2]))
    body.append(text(x + 32, y + height + 71, "train loss", "small"))
    body.append(circle(x + 145, y + height + 66, 5, LANES[1][2]))
    body.append(text(x + 157, y + height + 71, "validation loss", "small"))

    x, y, width, height = panels[1]
    body.append(text(x, 140, "GPU utilization and memory", "label"))
    max_minutes = max(point["minutes"] for point in telemetry)
    for tick in range(6):
        yy = y + height - height * tick / 5
        body.append(line(x, yy, x + width, yy))
        body.append(text(x - 10, yy + 4, f"{tick * 20}%", "small", "end"))
    gpu_points = [(x + width * point["minutes"] / max_minutes, y + height - height * point["gpu"] / 100) for point in telemetry]
    memory_points = [(x + width * point["minutes"] / max_minutes, y + height - height * point["memory"] / 100) for point in telemetry]
    body.append(path(downsample(gpu_points), LANES[2][2], 2.5))
    body.append(path(downsample(memory_points), LANES[0][2], 2.5))
    body.append(text(x, y + height + 30, "elapsed minutes", "small"))
    body.append(text(x + width, y + height + 30, f"{max_minutes:.1f}", "small", "end"))
    body.append(circle(x + 20, y + height + 66, 5, LANES[2][2]))
    body.append(text(x + 32, y + height + 71, "GPU utilization", "small"))
    body.append(circle(x + 175, y + height + 66, 5, LANES[0][2]))
    body.append(text(x + 187, y + height + 71, "VRAM used", "small"))
    mean_gpu = sum(point["gpu"] for point in telemetry) / len(telemetry)
    mean_power = sum(point["power"] for point in telemetry) / len(telemetry)
    body.append(text(70, 790, f"Telemetry samples: {len(telemetry):,}. Mean GPU: {mean_gpu:.1f}%. Peak VRAM: {max(point['memory'] for point in telemetry):.1f}%. Mean power: {mean_power:.0f} W.", "small"))
    return svg_document("Training dynamics and H200 utilization", "Loss curves and H200 utilization are plotted from training receipts.", body)


def audit_validation(receipt_dir: Path) -> str | None:
    candidates = sorted(receipt_dir.glob("independent-label-audit*v2*90-validated.json"))
    if not candidates:
        candidates = sorted(receipt_dir.glob("independent-label-audit*v2*90.json"))
    if not candidates:
        return None
    summary = load_json(candidates[-1])["summary"]
    sample = int(summary["sample_size"])
    agree = int(summary["agreement_count"])
    feasible = int(summary.get("valid_feasible_alternatives") or 0)
    invalid = int(summary.get("invalid_or_infeasible_alternatives") or 0)
    segments = (
        (agree, "Judge agreed", LANES[2][2]),
        (feasible, "Feasible alternative", LANES[1][2]),
        (invalid, "Invalid or over-budget alternative", LANES[0][2]),
    )
    body = [text(70, 58, "Independent label audit", "title"), text(70, 88, f"{sample} stratified pretraining labels, model identities blinded", "subtitle")]
    x, y, width, height = 110, 250, 1180, 100
    cursor = x
    for count, _, color in segments:
        segment_width = width * count / max(1, sample)
        body.append(rect(cursor, y, segment_width, height, color, 0))
        if segment_width > 80:
            body.append(text(cursor + segment_width / 2, y + 58, f"{100 * count / sample:.1f}%", "value", "middle"))
        cursor += segment_width
    legend_y = 430
    for index, (count, label, color) in enumerate(segments):
        yy = legend_y + index * 64
        body.append(circle(130, yy - 5, 8, color))
        body.append(text(150, yy, label, "label"))
        body.append(text(620, yy, f"{count} of {sample}", "value", "end"))
    body.append(text(70, 690, "Disagreements had to name a complete alternative writer, reviewer, and finalizer plan.", "subtitle"))
    body.append(text(70, 720, "A deterministic validator then checked role uniqueness plus call, credit, and latency limits.", "subtitle"))
    return svg_document("Independent label audit", "A stacked bar separates judge agreements, feasible alternatives, and invalid alternatives.", body)


def write_chart(path_value: Path, content: str | None) -> None:
    if content is None:
        return
    path_value.parent.mkdir(parents=True, exist_ok=True)
    path_value.write_text(content, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create deterministic SVG charts from conductor receipts")
    parser.add_argument("--reports", type=Path, default=Path("reports"))
    parser.add_argument("--receipts", type=Path, default=Path("receipts"))
    parser.add_argument("--output", type=Path, default=Path("charts"))
    args = parser.parse_args()
    summaries = read_summaries(args.reports)
    if len(summaries) == 3:
        write_chart(args.output / "benchmark-overview.svg", benchmark_overview(summaries))
        write_chart(args.output / "family-generalization.svg", family_generalization(summaries))
        write_chart(args.output / "policy-confusion.svg", confusion_matrices(summaries))
    write_chart(args.output / "training-dynamics.svg", training_dynamics(args.receipts))
    write_chart(args.output / "label-audit.svg", audit_validation(args.receipts))
    print(json.dumps({"charts": sorted(path.name for path in args.output.glob("*.svg"))}, indent=2))


if __name__ == "__main__":
    main()
