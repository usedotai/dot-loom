#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const partialPath = resolve(root, "reports/cross-model-code-review-v1.partial.json");
const committedPath = resolve(root, "docs/benchmarks/cross-model-baselines-v1.json");
let source;
try {
  source = JSON.parse(await readFile(partialPath, "utf8"));
} catch {
  source = JSON.parse(await readFile(committedPath, "utf8"));
}
const wanted = ["openai-solo", "claude-solo", "dot-solo"];
const lanes = wanted.map((id) => source.lanes.find((lane) => lane.id === id));
if (lanes.some((lane) => !lane)) throw new Error("All three completed solo lanes are required.");

const receipt = {
  version: 1,
  benchmark: "cross-model-baselines-v1",
  complete: true,
  generatedAt: source.generatedAt,
  dataset: source.dataset,
  datasetCaseCount: source.datasetCaseCount,
  caseCount: source.caseCount,
  iterations: source.iterations,
  concurrency: source.concurrency,
  settings: source.settings,
  methodology: source.benchmark === "cross-model-baselines-v1" ? source.methodology : {
    ...source.methodology,
    scope: "Completed single-model baselines from the larger cross-model benchmark matrix.",
    stoppedMatrixReason: "The provider returned HTTP 402 before the cross-review lanes completed.",
  },
  totalWorkflowCredits: sum(lanes.flatMap((lane) => lane.runs.map((run) => run.spentCredits))),
  totalJudgeCredits: sum(lanes.flatMap((lane) => lane.runs.map((run) => run.judge?.spentCredits))),
  lanes,
};

const benchmarkDir = resolve(root, "docs/benchmarks");
const figureDir = resolve(root, "docs/figures");
await mkdir(benchmarkDir, { recursive: true });
await mkdir(figureDir, { recursive: true });
await Promise.all([
  writeFile(resolve(benchmarkDir, "cross-model-baselines-v1.json"), JSON.stringify(receipt, null, 2) + "\n", "utf8"),
  writeFile(resolve(figureDir, "cross-model-baselines.svg"), renderSummary(receipt), "utf8"),
  writeFile(resolve(figureDir, "cross-model-baseline-heatmap.svg"), renderHeatmap(receipt), "utf8"),
  writeFile(resolve(figureDir, "cross-model-baselines.csv"), summaryCsv(receipt), "utf8"),
]);

console.log("Generated completed cross-model baseline receipt, figures, and CSV.");

function renderSummary(data) {
  const width = 1200;
  const height = 660;
  const left = { x: 76, y: 164, w: 460, h: 280 };
  const right = { x: 680, y: 164, w: 460, h: 280 };
  const rows = data.lanes.map((lane) => ({ ...lane.summary, id: lane.id, label: lane.label }));
  const xCredits = linear(0, 14, left.x, left.x + left.w);
  const yQuality = linear(0.35, 1.02, left.y + left.h, left.y);
  const xLatency = linear(0, 80, right.x, right.x + right.w);
  const yQualityRight = linear(0.35, 1.02, right.y + right.h, right.y);
  const out = [svgOpen(width, height, "OpenAI, Claude, and Dot single-model backend review baselines")];

  out.push(text(54, 46, "Single-model baselines on the same backend review tasks", "title"));
  out.push(text(54, 76, `${data.caseCount} frozen cases per model; ${data.lanes.length * data.caseCount} judged outputs; one iteration`, "subtitle"));
  out.push(text(54, 100, `Independent judge: ${shortModel(data.settings.judgeModel)}. Error bars show the reported 95% mean interval.`, "subtitle"));
  out.push(text(left.x, 140, "A  Judge quality vs provider credits", "panel-title"));
  out.push(text(right.x, 140, "B  Judge quality vs P95 latency", "panel-title"));

  drawAxes(out, left, [0, 3.5, 7, 10.5, 14], [0.4, 0.55, 0.7, 0.85, 1], xCredits, yQuality, percent0, "Provider credits / run", "Judge quality");
  drawAxes(out, right, [0, 20, 40, 60, 80], [0.4, 0.55, 0.7, 0.85, 1], xLatency, yQualityRight, percent0, "P95 workflow latency (s)", "Judge quality");

  for (const row of rows) {
    const color = colorFor(row.id);
    const cx = xCredits(row.avgSpentCredits);
    const cy = yQuality(row.quality);
    errorBar(out, cx, yQuality(row.qualityCi95[0]), yQuality(row.qualityCi95[1]), color);
    out.push(circle(cx, cy, 7, color));
    out.push(text(cx + labelDx(row.id), cy - 12, `${shortLane(row.label)} ${(row.quality * 100).toFixed(1)}%`, "point-label", labelAnchor(row.id)));

    const lx = xLatency(row.p95LatencyMs / 1000);
    const ly = yQualityRight(row.quality);
    errorBar(out, lx, yQualityRight(row.qualityCi95[0]), yQualityRight(row.qualityCi95[1]), color);
    out.push(circle(lx, ly, 7, color));
    out.push(text(lx + labelDx(row.id), ly - 12, `${shortLane(row.label)} ${(row.p95LatencyMs / 1000).toFixed(1)}s`, "point-label", labelAnchor(row.id)));
  }

  out.push(text(54, 530, "Observed frontier: higher mean judge quality required more provider credits and latency in this six-case sample.", "note"));
  out.push(text(54, 562, "This is a baseline comparison, not evidence that cross-model review improves answers. The review matrix ran out of credits.", "footnote"));
  out.push(text(54, 590, `Raw receipt: docs/benchmarks/cross-model-baselines-v1.json | generated ${data.generatedAt}`, "footnote"));
  out.push("</svg>\n");
  return out.join("\n");
}

function renderHeatmap(data) {
  const width = 1200;
  const height = 570;
  const left = 310;
  const top = 180;
  const cellW = 132;
  const cellH = 64;
  const caseIds = [...new Set(data.lanes.flatMap((lane) => lane.runs.map((run) => run.caseId)))];
  const out = [svgOpen(width, height, "Case-level single-model judge scores")];

  out.push(text(54, 46, "The aggregate ranking is not uniform across cases", "title"));
  out.push(text(54, 76, "Cells show blinded judge score. A dot marks answers that also passed every deterministic check.", "subtitle"));
  out.push(text(54, 100, "Use case-level variation to avoid choosing a model from one average alone.", "subtitle"));

  caseIds.forEach((caseId, column) => {
    out.push(text(left + column * cellW + (cellW - 4) / 2, top - 16, shortCase(caseId), "tick", "middle"));
  });
  data.lanes.forEach((lane, row) => {
    const y = top + row * cellH;
    out.push(text(54, y + 38, lane.label, "category"));
    caseIds.forEach((caseId, column) => {
      const run = lane.runs.find((item) => item.caseId === caseId);
      const quality = run?.quality ?? 0;
      const x = left + column * cellW;
      out.push(`<rect x="${x}" y="${y}" width="${cellW - 4}" height="${cellH - 4}" fill="${heatColor(quality)}"/>`);
      out.push(text(x + (cellW - 4) / 2, y + 37, `${Math.round(quality * 100)}`, quality > 0.72 ? "heat-label-light" : "heat-label-dark", "middle"));
      if (run?.passed) out.push(circle(x + cellW - 17, y + 14, 3.5, quality > 0.72 ? "#ffffff" : "#111827"));
    });
  });

  const legendY = top + data.lanes.length * cellH + 40;
  for (let step = 0; step <= 10; step += 1) {
    out.push(`<rect x="${left + step * 24}" y="${legendY}" width="24" height="15" fill="${heatColor(step / 10)}"/>`);
  }
  out.push(text(left, legendY + 35, "0", "tick"));
  out.push(text(left + 264, legendY + 35, "100 judge score", "tick", "end"));
  out.push(text(54, 526, "Limits: six synthetic cases, one iteration, one model judge, no human review, and one shared API gateway.", "footnote"));
  out.push("</svg>\n");
  return out.join("\n");
}

function summaryCsv(data) {
  const header = "lane,runs,judge_quality,ci_low,ci_high,pass_rate,avg_calls,avg_credits,p95_latency_ms,avg_tokens\n";
  return header + data.lanes.map((lane) => {
    const row = lane.summary;
    return [lane.id, row.runs, row.quality, row.qualityCi95[0], row.qualityCi95[1], row.passRate, row.avgCalls, row.avgSpentCredits, row.p95LatencyMs, row.avgTokens].join(",");
  }).join("\n") + "\n";
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
    out.push(text(x, box.y + box.h + 24, Number.isInteger(value) ? String(value) : value.toFixed(1), "tick", "middle"));
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
    .note { font-size:13px; font-weight:600; fill:#334155; }
    .footnote { font-size:11px; fill:#64748b; }
    .heat-label-light { font-size:13px; font-weight:600; fill:#ffffff; }
    .heat-label-dark { font-size:13px; font-weight:600; fill:#111827; }
  </style>`;
}

function errorBar(out, x, lowY, highY, color) {
  out.push(`<line x1="${x}" y1="${lowY}" x2="${x}" y2="${highY}" stroke="${color}" stroke-width="2"/>`);
  out.push(`<line x1="${x - 6}" y1="${lowY}" x2="${x + 6}" y2="${lowY}" stroke="${color}" stroke-width="2"/>`);
  out.push(`<line x1="${x - 6}" y1="${highY}" x2="${x + 6}" y2="${highY}" stroke="${color}" stroke-width="2"/>`);
}

function text(x, y, value, className, anchor = "start") {
  return `<text x="${x}" y="${y}" class="${className}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

function circle(x, y, radius, fill) {
  return `<circle cx="${Number(x).toFixed(1)}" cy="${Number(y).toFixed(1)}" r="${radius}" fill="${fill}" stroke="#ffffff" stroke-width="1.5"/>`;
}

function linear(domainMin, domainMax, rangeMin, rangeMax) {
  return (value) => rangeMin + ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin);
}

function heatColor(value) {
  const start = [239, 246, 255];
  const end = [30, 90, 150];
  const v = Math.min(1, Math.max(0, value));
  return `rgb(${start.map((channel, index) => Math.round(channel + (end[index] - channel) * v)).join(",")})`;
}

function colorFor(id) {
  return ({ "openai-solo": "#2563a6", "claude-solo": "#d97706", "dot-solo": "#6b7280" })[id];
}

function labelDx(id) {
  return id === "openai-solo" ? -10 : 10;
}

function labelAnchor(id) {
  return id === "openai-solo" ? "end" : "start";
}

function shortLane(value) {
  return value.replace(" solo", "");
}

function shortCase(value) {
  return ({
    "idempotent-credit-spend": "Credits spend",
    "tenant-cache-leak": "Tenant cache",
    "webhook-signature-replay": "Webhook replay",
    "streaming-refund-semantics": "Stream refund",
    "oauth-state-pkce": "OAuth PKCE",
    "ssrf-webhook-destination": "SSRF webhook",
  })[value] || value.slice(0, 16);
}

function shortModel(value) {
  return String(value).replace(/^dot\//, "");
}

function percent0(value) {
  return `${Math.round(value * 100)}%`;
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
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
