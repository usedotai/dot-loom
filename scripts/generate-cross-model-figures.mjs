#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolve(root, "docs/benchmarks/cross-model-code-review-v1.json");
const outputDir = resolve(root, "docs/figures");
const report = JSON.parse(await readFile(inputPath, "utf8"));
if (!report.complete) throw new Error("Cross-model benchmark receipt is incomplete.");

await mkdir(outputDir, { recursive: true });
const deltas = pairedDeltas(report);
await Promise.all([
  writeFile(resolve(outputDir, "cross-model-pareto.svg"), renderPareto(report), "utf8"),
  writeFile(resolve(outputDir, "cross-model-paired-deltas.svg"), renderPairedDeltas(report, deltas), "utf8"),
  writeFile(resolve(outputDir, "cross-model-case-heatmap.svg"), renderHeatmap(report), "utf8"),
  writeFile(resolve(outputDir, "cross-model-summary.csv"), summaryCsv(report), "utf8"),
  writeFile(resolve(outputDir, "cross-model-paired-deltas.csv"), deltasCsv(deltas), "utf8"),
]);

console.log("Generated cross-model benchmark figures and CSV files.");

function renderPareto(data) {
  const width = 1200;
  const height = 680;
  const left = { x: 76, y: 164, w: 460, h: 330 };
  const right = { x: 680, y: 164, w: 460, h: 330 };
  const rows = data.lanes.map((lane) => ({ ...lane.summary, id: lane.id, label: lane.label }));
  const qualityMin = clamp(Math.floor((Math.min(...rows.map((row) => row.quality)) - 0.06) * 20) / 20, 0, 0.9);
  const latencyMax = Math.ceil(Math.max(...rows.map((row) => row.p95LatencyMs / 1000)) / 30) * 30;
  const xLeft = linear(0.8, 3.2, left.x, left.x + left.w);
  const xRight = linear(0.8, 3.2, right.x, right.x + right.w);
  const yQuality = linear(qualityMin, 1, left.y + left.h, left.y);
  const yLatency = linear(0, latencyMax, right.y + right.h, right.y);
  const out = [svgOpen(width, height, "Cross-model code-review quality, cost, and latency")];

  out.push(text(54, 46, "Cross-model code review: quality, credits, and latency", "title"));
  out.push(text(54, 76, `${data.caseCount} frozen backend cases, ${data.lanes.length} lanes, ${data.lanes.length * data.caseCount * data.iterations} judged outputs`, "subtitle"));
  out.push(text(54, 100, `Independent judge: ${shortModel(data.settings.judgeModel)}. Workflow credits exclude judge calls.`, "subtitle"));
  out.push(text(left.x, 140, "A  Judge quality vs workflow credits", "panel-title"));
  out.push(text(right.x, 140, "B  P95 latency vs workflow credits", "panel-title"));

  drawAxes(out, left, [1, 2, 3], ticks(qualityMin, 1, 4), xLeft, yQuality, percent0, "Provider credits / run", "Judge quality");
  drawAxes(out, right, [1, 2, 3], ticks(0, latencyMax, 4), xRight, yLatency, integer, "Provider credits / run", "P95 latency (s)");

  for (const row of rows) {
    const color = laneColor(row.id);
    const qx = xLeft(row.avgSpentCredits);
    const qy = yQuality(row.quality);
    const ci = row.qualityCi95 || [row.quality, row.quality];
    errorBar(out, qx, yQuality(ci[0]), yQuality(ci[1]), color);
    out.push(mark(qx, qy, row.id, color));
    const labelPosition = pointLabelPosition(row.id);
    out.push(text(qx + labelPosition.dx, qy + labelPosition.dy, `${shortLane(row.label)} ${(row.quality * 100).toFixed(1)}%`, "point-label", labelPosition.anchor));

    const lx = xRight(row.avgSpentCredits);
    const ly = yLatency(row.p95LatencyMs / 1000);
    out.push(mark(lx, ly, row.id, color));
    out.push(text(lx + labelPosition.dx, ly + labelPosition.dy, `${shortLane(row.label)} ${(row.p95LatencyMs / 1000).toFixed(1)}s`, "point-label", labelPosition.anchor));
  }

  const best = [...rows].sort((a, b) => b.quality - a.quality)[0];
  out.push(text(54, 555, `Observed result: ${best.label} had the highest mean judge score at ${(best.quality * 100).toFixed(1)}% in this sample.`, "note"));
  out.push(text(54, 584, "Limits: synthetic high-risk tasks, one iteration, one model judge, no human review, and a shared API gateway.", "footnote"));
  out.push(text(54, 610, `Receipt: docs/benchmarks/cross-model-code-review-v1.json | generated ${data.generatedAt}`, "footnote"));
  out.push("</svg>\n");
  return out.join("\n");
}

function renderPairedDeltas(data, comparisons) {
  const width = 1200;
  const height = 650;
  const plot = { x: 290, y: 170, w: 820, h: 300 };
  const all = comparisons.flatMap((comparison) => comparison.deltas.map((item) => item.delta));
  const extent = Math.max(10, Math.ceil(Math.max(...all.map(Math.abs)) / 10) * 10);
  const x = linear(-extent, extent, plot.x, plot.x + plot.w);
  const out = [svgOpen(width, height, "Paired quality changes from cross-model review")];

  out.push(text(54, 46, "Does a second model improve the writer's answer?", "title"));
  out.push(text(54, 76, "Paired change in blinded judge score for the same task. Positive values favor Loom review.", "subtitle"));
  out.push(text(54, 100, `Each row contains ${data.caseCount} case-level deltas; diamonds show the mean change.`, "subtitle"));

  for (const tick of ticks(-extent, extent, 8)) {
    const px = x(tick);
    out.push(`<line x1="${px}" y1="${plot.y}" x2="${px}" y2="${plot.y + plot.h}" stroke="${tick === 0 ? "#64748b" : "#e5e7eb"}" stroke-width="${tick === 0 ? 1.5 : 1}"/>`);
    out.push(text(px, plot.y + plot.h + 28, `${tick > 0 ? "+" : ""}${tick}`, "tick", "middle"));
  }
  out.push(text(plot.x + plot.w / 2, plot.y + plot.h + 56, "Judge score change (percentage points)", "axis-label", "middle"));

  const ys = [220, 320, 420];
  for (let rowIndex = 0; rowIndex < comparisons.length; rowIndex += 1) {
    const comparison = comparisons[rowIndex];
    const y = ys[rowIndex];
    out.push(text(54, y + 5, comparison.label, "category"));
    comparison.deltas.forEach((item, index) => {
      const jitter = (index % 3 - 1) * 9;
      out.push(circle(x(item.delta), y + jitter, 5, "#2563a6"));
    });
    out.push(diamond(x(comparison.mean), y, 9, "#d97706"));
    out.push(text(x(comparison.mean) + (comparison.mean >= 0 ? 14 : -14), y - 13, `mean ${signed(comparison.mean)} pp`, "point-label", comparison.mean >= 0 ? "start" : "end"));
  }

  out.push(circle(70, 535, 5, "#2563a6"));
  out.push(text(84, 539, "Individual case", "legend"));
  out.push(diamond(235, 535, 8, "#d97706"));
  out.push(text(251, 539, "Mean paired change", "legend"));
  out.push(text(54, 581, "Interpret per-case spread, not only the mean. A reviewer can help some tasks and hurt others.", "note"));
  out.push(text(54, 610, "Model judge only; one iteration; no human adjudication.", "footnote"));
  out.push("</svg>\n");
  return out.join("\n");
}

function renderHeatmap(data) {
  const width = 1200;
  const height = 700;
  const left = 330;
  const top = 175;
  const cellW = 132;
  const cellH = 58;
  const caseIds = [...new Set(data.lanes.flatMap((lane) => lane.runs.map((run) => run.caseId)))];
  const out = [svgOpen(width, height, "Case-level cross-model judge scores")];

  out.push(text(54, 46, "Case-level judge scores reveal where review helps", "title"));
  out.push(text(54, 76, "Cells show blinded judge quality. A dot marks runs that also passed every deterministic check.", "subtitle"));
  out.push(text(54, 100, "Reading across a column compares all model combinations on exactly the same task.", "subtitle"));

  caseIds.forEach((caseId, column) => {
    out.push(rotatedText(left + column * cellW + cellW / 2, top - 16, shortCase(caseId), "tick", -26));
  });

  data.lanes.forEach((lane, row) => {
    const y = top + row * cellH;
    out.push(text(54, y + 35, lane.label, "category"));
    caseIds.forEach((caseId, column) => {
      const run = lane.runs.find((item) => item.caseId === caseId);
      const quality = run?.quality ?? 0;
      const x = left + column * cellW;
      const fill = heatColor(quality);
      out.push(`<rect x="${x}" y="${y}" width="${cellW - 4}" height="${cellH - 4}" fill="${fill}"/>`);
      out.push(text(x + (cellW - 4) / 2, y + 33, `${Math.round(quality * 100)}`, quality > 0.72 ? "heat-label-light" : "heat-label-dark", "middle"));
      if (run?.passed) out.push(circle(x + cellW - 17, y + 13, 3.5, quality > 0.72 ? "#ffffff" : "#111827"));
    });
  });

  const legendY = top + data.lanes.length * cellH + 46;
  for (let step = 0; step <= 10; step += 1) {
    out.push(`<rect x="${left + step * 24}" y="${legendY}" width="24" height="15" fill="${heatColor(step / 10)}"/>`);
  }
  out.push(text(left, legendY + 36, "0", "tick"));
  out.push(text(left + 264, legendY + 36, "100 judge score", "tick", "end"));
  out.push(text(54, 627, "Averages can hide regressions. Use the paired-delta figure and raw answers before choosing a production lane.", "note"));
  out.push(text(54, 656, `Receipt includes all ${data.lanes.length * data.caseCount * data.iterations} candidate answers and judge reasons.`, "footnote"));
  out.push("</svg>\n");
  return out.join("\n");
}

function pairedDeltas(data) {
  const definitions = [
    ["OpenAI + Claude vs OpenAI", "openai-claude-review", "openai-solo"],
    ["Claude + OpenAI vs Claude", "claude-openai-review", "claude-solo"],
    ["Dot + Claude + OpenAI vs Dot", "dot-claude-openai", "dot-solo"],
  ];
  return definitions.map(([label, treatmentId, baselineId]) => {
    const treatment = data.lanes.find((lane) => lane.id === treatmentId);
    const baseline = data.lanes.find((lane) => lane.id === baselineId);
    const deltas = treatment.runs.map((run) => {
      const match = baseline.runs.find((item) => item.caseId === run.caseId && item.iteration === run.iteration);
      return {
        comparison: label,
        caseId: run.caseId,
        iteration: run.iteration,
        treatmentQuality: run.quality,
        baselineQuality: match.quality,
        delta: (run.quality - match.quality) * 100,
      };
    });
    return { label, treatmentId, baselineId, deltas, mean: average(deltas.map((item) => item.delta)) };
  });
}

function summaryCsv(data) {
  const header = "lane,runs,judge_quality,ci_low,ci_high,pass_rate,avg_calls,avg_credits,p95_latency_ms,avg_tokens\n";
  return header + data.lanes.map((lane) => {
    const row = lane.summary;
    return [lane.id, row.runs, row.quality, row.qualityCi95?.[0] ?? "", row.qualityCi95?.[1] ?? "", row.passRate, row.avgCalls, row.avgSpentCredits, row.p95LatencyMs, row.avgTokens].join(",");
  }).join("\n") + "\n";
}

function deltasCsv(comparisons) {
  const header = "comparison,case_id,iteration,treatment_quality,baseline_quality,delta_percentage_points\n";
  return header + comparisons.flatMap((comparison) => comparison.deltas.map((item) => [
    csv(item.comparison), item.caseId, item.iteration, item.treatmentQuality, item.baselineQuality, item.delta,
  ].join(","))).join("\n") + "\n";
}

function drawAxes(out, box, xTicks, yTicks, xScale, yScale, yFormat, xLabel, yLabel) {
  for (const value of yTicks) {
    const y = yScale(value);
    out.push(`<line x1="${box.x}" y1="${y}" x2="${box.x + box.w}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`);
    out.push(text(box.x - 11, y + 4, yFormat(value), "tick", "end"));
  }
  for (const value of xTicks) {
    const x = xScale(value);
    out.push(`<line x1="${x}" y1="${box.y}" x2="${x}" y2="${box.y + box.h}" stroke="#f1f5f9" stroke-width="1"/>`);
    out.push(text(x, box.y + box.h + 24, String(value), "tick", "middle"));
  }
  out.push(`<line x1="${box.x}" y1="${box.y + box.h}" x2="${box.x + box.w}" y2="${box.y + box.h}" stroke="#111827" stroke-width="1.25"/>`);
  out.push(`<line x1="${box.x}" y1="${box.y}" x2="${box.x}" y2="${box.y + box.h}" stroke="#111827" stroke-width="1.25"/>`);
  out.push(text(box.x + box.w / 2, box.y + box.h + 54, xLabel, "axis-label", "middle"));
  out.push(`<text x="${box.x - 54}" y="${box.y + box.h / 2}" class="axis-label" text-anchor="middle" transform="rotate(-90 ${box.x - 54} ${box.y + box.h / 2})">${escapeXml(yLabel)}</text>`);
}

function svgOpen(width, height, description) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(description)}</title>
  <desc id="desc">${escapeXml(description)}. Values come from a committed raw benchmark receipt.</desc>
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <style>
    text { font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; fill:#111827; }
    .title { font-size:25px; font-weight:600; }
    .subtitle { font-size:14px; fill:#475569; }
    .panel-title { font-size:16px; font-weight:600; }
    .axis-label { font-size:13px; fill:#334155; }
    .tick { font-size:12px; fill:#64748b; }
    .point-label { font-size:11px; font-weight:600; }
    .category { font-size:13px; font-weight:600; }
    .legend { font-size:12px; fill:#334155; }
    .note { font-size:13px; font-weight:600; fill:#334155; }
    .footnote { font-size:11px; fill:#64748b; }
    .heat-label-light { font-size:13px; font-weight:600; fill:#ffffff; }
    .heat-label-dark { font-size:13px; font-weight:600; fill:#111827; }
  </style>`;
}

function pointLabelPosition(id) {
  const positions = {
    "openai-solo": { dx: 10, dy: -13, anchor: "start" },
    "claude-solo": { dx: 10, dy: 20, anchor: "start" },
    "dot-solo": { dx: -10, dy: -13, anchor: "end" },
    "openai-claude-review": { dx: 10, dy: -13, anchor: "start" },
    "claude-openai-review": { dx: 10, dy: 20, anchor: "start" },
    "dot-claude-openai": { dx: -10, dy: -13, anchor: "end" },
  };
  return positions[id] || { dx: 10, dy: -10, anchor: "start" };
}

function laneColor(id) {
  if (id.includes("claude-openai") || id.includes("openai-claude")) return "#d97706";
  if (id === "dot-claude-openai") return "#6b7280";
  return "#2563a6";
}

function mark(x, y, id, fill) {
  if (id === "dot-claude-openai") return diamond(x, y, 8, fill);
  if (id.includes("review")) return `<rect x="${(x - 6).toFixed(1)}" y="${(y - 6).toFixed(1)}" width="12" height="12" fill="${fill}" stroke="#ffffff" stroke-width="2"/>`;
  return circle(x, y, 6.5, fill);
}

function errorBar(out, x, lowY, highY, color) {
  out.push(`<line x1="${x}" y1="${lowY}" x2="${x}" y2="${highY}" stroke="${color}" stroke-width="2"/>`);
  out.push(`<line x1="${x - 6}" y1="${lowY}" x2="${x + 6}" y2="${lowY}" stroke="${color}" stroke-width="2"/>`);
  out.push(`<line x1="${x - 6}" y1="${highY}" x2="${x + 6}" y2="${highY}" stroke="${color}" stroke-width="2"/>`);
}

function text(x, y, value, className, anchor = "start") {
  return `<text x="${x}" y="${y}" class="${className}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

function rotatedText(x, y, value, className, degrees) {
  return `<text x="${x}" y="${y}" class="${className}" text-anchor="end" transform="rotate(${degrees} ${x} ${y})">${escapeXml(value)}</text>`;
}

function circle(x, y, radius, fill) {
  return `<circle cx="${Number(x).toFixed(1)}" cy="${Number(y).toFixed(1)}" r="${radius}" fill="${fill}" stroke="#ffffff" stroke-width="1.5"/>`;
}

function diamond(x, y, radius, fill) {
  return `<path d="M ${x} ${y - radius} L ${x + radius} ${y} L ${x} ${y + radius} L ${x - radius} ${y} Z" fill="${fill}" stroke="#ffffff" stroke-width="1.5"/>`;
}

function linear(domainMin, domainMax, rangeMin, rangeMax) {
  return (value) => rangeMin + ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin);
}

function ticks(min, max, count) {
  return Array.from({ length: count + 1 }, (_, index) => min + ((max - min) * index) / count);
}

function heatColor(value) {
  const start = [239, 246, 255];
  const end = [30, 90, 150];
  const v = clamp(value, 0, 1);
  const rgb = start.map((channel, index) => Math.round(channel + (end[index] - channel) * v));
  return `rgb(${rgb.join(",")})`;
}

function shortLane(label) {
  return label.replace(" review", "").replace(" + ", "+");
}

function shortCase(value) {
  return value.replace("-signature", "").replace("-destination", "").slice(0, 24);
}

function shortModel(value) {
  return String(value).replace(/^dot\//, "");
}

function percent0(value) {
  return `${Math.round(value * 100)}%`;
}

function integer(value) {
  return String(Math.round(value));
}

function signed(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function csv(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]);
}
