#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const figureDir = resolve(root, "docs/figures");
const smoke = JSON.parse(await readFile(resolve(root, "docs/benchmarks/dot-code-review-smoke-v2.json"), "utf8"));
const routing = JSON.parse(await readFile(resolve(root, "docs/benchmarks/adaptive-routing-mock.json"), "utf8"));

await mkdir(figureDir, { recursive: true });
await Promise.all([
  writeFile(resolve(figureDir, "v02-cost-quality.svg"), renderSmokeFigure(smoke), "utf8"),
  writeFile(resolve(figureDir, "policy-selectivity.svg"), renderRoutingFigure(routing), "utf8"),
  writeFile(resolve(figureDir, "v02-smoke-summary.csv"), smokeCsv(smoke), "utf8"),
  writeFile(resolve(figureDir, "policy-selectivity.csv"), routingCsv(routing), "utf8"),
]);

console.log("Generated docs/figures/v02-cost-quality.svg");
console.log("Generated docs/figures/policy-selectivity.svg");

function renderSmokeFigure(report) {
  const strategies = report.summary.map((row) => ({
    ...row,
    label: label(row.strategy),
    credits: row.avgSpentCredits,
  }));
  const width = 1200;
  const height = 640;
  const left = { x: 72, y: 154, w: 470, h: 300 };
  const right = { x: 672, y: 154, w: 470, h: 300 };
  const qualityScale = linear(0.94, 1.005, left.y + left.h, left.y);
  const latencyScale = linear(45, 90, right.y + right.h, right.y);
  const creditLeft = linear(0.5, 4.5, left.x, left.x + left.w);
  const creditRight = linear(0.5, 4.5, right.x, right.x + right.w);
  const palette = { baseline: "#2563a6", "adaptive-balanced": "#d97706", fixed: "#6b7280" };
  const out = [svgOpen(width, height, "Dot Loom v0.2 exploratory benchmark figure")];

  out.push(text(54, 46, "Dot Loom v0.2: measured compute–quality trade-offs", "title"));
  out.push(text(54, 75, `${report.caseCount} high-risk code-review cases × ${report.iterations} iteration; ${report.evaluation.judgedRuns} judged runs`, "subtitle"));
  out.push(text(54, 98, "Workflow credits exclude judge calls. Error bars show the reported 95% interval for mean judge quality.", "subtitle"));

  out.push(text(left.x, 132, "A  Provider credits vs judge quality", "panel-title"));
  out.push(text(right.x, 132, "B  Provider credits vs P95 latency", "panel-title"));
  drawAxes(out, left, [1, 2, 3, 4], [0.94, 0.96, 0.98, 1], creditLeft, qualityScale, percent0, "Provider credits / run", "Judge quality");
  drawAxes(out, right, [1, 2, 3, 4], [45, 60, 75, 90], creditRight, latencyScale, integer, "Provider credits / run", "P95 latency (s)");

  const ordered = strategies.filter((row) => Number.isFinite(row.credits));
  out.push(`<path d="${ordered.map((row, index) => `${index ? "L" : "M"}${creditRight(row.credits).toFixed(1)},${latencyScale(row.p95LatencyMs / 1000).toFixed(1)}`).join(" ")}" fill="none" stroke="#cbd5e1" stroke-width="1.5"/>`);

  for (const row of ordered) {
    const color = palette[row.strategy] || "#111827";
    const qx = creditLeft(row.credits);
    const qy = qualityScale(row.quality);
    const ci = row.qualityCi95 || [row.quality, row.quality];
    out.push(`<line x1="${qx}" y1="${qualityScale(ci[0])}" x2="${qx}" y2="${qualityScale(ci[1])}" stroke="${color}" stroke-width="2"/>`);
    out.push(`<line x1="${qx - 6}" y1="${qualityScale(ci[0])}" x2="${qx + 6}" y2="${qualityScale(ci[0])}" stroke="${color}" stroke-width="2"/>`);
    out.push(`<line x1="${qx - 6}" y1="${qualityScale(ci[1])}" x2="${qx + 6}" y2="${qualityScale(ci[1])}" stroke="${color}" stroke-width="2"/>`);
    out.push(circle(qx, qy, 6.5, color));
    out.push(text(qx + 10, qy + labelOffset(row.strategy), `${row.label} · ${(row.quality * 100).toFixed(1)}%`, "point-label"));

    const lx = creditRight(row.credits);
    const ly = latencyScale(row.p95LatencyMs / 1000);
    out.push(circle(lx, ly, 6.5, color));
    out.push(text(lx + 10, ly - 10, `${row.label} · ${(row.p95LatencyMs / 1000).toFixed(1)}s`, "point-label"));
  }

  out.push(text(54, 540, "Interpretation: balanced halved calls/credits relative to fixed review and reduced P95 latency; it did not outperform the one-call baseline on this sample.", "note"));
  out.push(text(54, 570, "Limitations: n=3 synthetic cases, one iteration, one provider, one model judge, no human review; judge also served as critic.", "footnote"));
  out.push(text(54, 596, `Source: ${report.dataset} · generated ${report.generatedAt}`, "footnote"));
  out.push("</svg>\n");
  return out.join("\n");
}

function renderRoutingFigure(report) {
  const wanted = ["adaptive-lean", "adaptive-balanced", "adaptive-strict"];
  const rows = wanted.map((strategy) => ({ ...report.summary.find((row) => row.strategy === strategy), label: label(strategy) }));
  const width = 1200;
  const height = 640;
  const out = [svgOpen(width, height, "Dot Loom deterministic policy selectivity validation")];
  const barX = 205;
  const barW = 350;
  const dotX = linear(0, 1, 720, 1110);
  const ys = [205, 305, 405];

  out.push(text(54, 46, "Routerless policy validation on a frozen risk suite", "title"));
  out.push(text(54, 75, `${report.caseCount} cases: 8 low-risk, 8 research, 8 high-risk engineering`, "subtitle"));
  out.push(text(54, 98, "This figure validates routing behavior only; mock model outputs are excluded from quality interpretation.", "subtitle"));
  out.push(text(54, 142, "A  Execution depth", "panel-title"));
  out.push(text(676, 142, "B  Agreement with expected escalation labels", "panel-title"));

  out.push(text(barX, 169, "Share of requests", "axis-label"));
  for (const tick of [0, 0.25, 0.5, 0.75, 1]) {
    const x = barX + barW * tick;
    out.push(`<line x1="${x}" y1="180" x2="${x}" y2="448" stroke="#e5e7eb" stroke-width="1"/>`);
    out.push(text(x, 470, `${Math.round(tick * 100)}%`, "tick", "middle"));
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const y = ys[i];
    const one = row.oneCallRate || 0;
    const escalated = row.escalationRate || 0;
    out.push(text(54, y + 5, row.label, "category"));
    out.push(`<rect x="${barX}" y="${y - 17}" width="${barW * one}" height="34" fill="#2563a6"/>`);
    out.push(`<rect x="${barX + barW * one}" y="${y - 17}" width="${barW * escalated}" height="34" fill="#d97706"/>`);
    if (one > 0.12) out.push(text(barX + (barW * one) / 2, y + 5, `${Math.round(one * 100)}% one call`, "bar-label-light", "middle"));
    if (escalated > 0.12) out.push(text(barX + barW * one + (barW * escalated) / 2, y + 5, `${Math.round(escalated * 100)}% escalated`, "bar-label-light", "middle"));
  }

  for (const tick of [0, 0.25, 0.5, 0.75, 1]) {
    const x = dotX(tick);
    out.push(`<line x1="${x}" y1="180" x2="${x}" y2="448" stroke="#e5e7eb" stroke-width="1"/>`);
    out.push(text(x, 470, `${Math.round(tick * 100)}%`, "tick", "middle"));
  }
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const y = ys[i];
    out.push(`<line x1="${dotX(0)}" y1="${y}" x2="${dotX(row.routingAccuracy)}" y2="${y}" stroke="#cbd5e1" stroke-width="2"/>`);
    out.push(circle(dotX(row.routingAccuracy), y, 7, row.strategy === "adaptive-balanced" ? "#d97706" : "#2563a6"));
    out.push(text(dotX(row.routingAccuracy) + 12, y + 5, `${Math.round(row.routingAccuracy * 100)}%`, "point-label"));
  }

  out.push(`<rect x="54" y="505" width="14" height="14" fill="#2563a6"/>`);
  out.push(text(76, 517, "Completed in one call", "legend"));
  out.push(`<rect x="245" y="505" width="14" height="14" fill="#d97706"/>`);
  out.push(text(267, 517, "Escalated", "legend"));
  out.push(text(54, 557, "Balanced matched all frozen escalation labels: low-risk tasks stopped after one call; research and high-risk engineering tasks received review.", "note"));
  out.push(text(54, 588, `Source: ${report.dataset} · deterministic mock run · generated ${report.generatedAt}`, "footnote"));
  out.push("</svg>\n");
  return out.join("\n");
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

function smokeCsv(report) {
  const header = "strategy,runs,judge_quality,quality_ci_low,quality_ci_high,avg_calls,avg_provider_credits,p95_latency_ms,pass_rate\n";
  return header + report.summary.map((row) => [
    row.strategy,
    row.runs,
    row.quality,
    row.qualityCi95?.[0] ?? "",
    row.qualityCi95?.[1] ?? "",
    row.avgCalls,
    row.avgSpentCredits ?? "",
    row.p95LatencyMs,
    row.passRate,
  ].join(",")).join("\n") + "\n";
}

function routingCsv(report) {
  const header = "strategy,runs,avg_calls,one_call_rate,escalation_rate,routing_accuracy,budget_limited_rate\n";
  return header + report.summary.map((row) => [
    row.strategy,
    row.runs,
    row.avgCalls,
    row.oneCallRate ?? "",
    row.escalationRate ?? "",
    row.routingAccuracy ?? "",
    row.budgetLimitedRate ?? "",
  ].join(",")).join("\n") + "\n";
}

function svgOpen(width, height, description) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(description)}</title>
  <desc id="desc">${escapeXml(description)}. Values are generated from committed benchmark JSON receipts.</desc>
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <style>
    text { font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; fill:#111827; }
    .title { font-size:25px; font-weight:600; }
    .subtitle { font-size:14px; fill:#475569; }
    .panel-title { font-size:16px; font-weight:600; }
    .axis-label { font-size:13px; fill:#334155; }
    .tick { font-size:12px; fill:#64748b; }
    .point-label { font-size:12px; font-weight:600; }
    .category { font-size:14px; font-weight:600; }
    .bar-label-light { font-size:11px; font-weight:600; fill:#ffffff; }
    .legend { font-size:12px; fill:#334155; }
    .note { font-size:13px; font-weight:600; fill:#334155; }
    .footnote { font-size:11px; fill:#64748b; }
  </style>`;
}

function text(x, y, value, className, anchor = "start") {
  return `<text x="${x}" y="${y}" class="${className}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

function circle(x, y, radius, fill) {
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius}" fill="${fill}" stroke="#ffffff" stroke-width="2"/>`;
}

function linear(domainMin, domainMax, rangeMin, rangeMax) {
  return (value) => rangeMin + ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin);
}

function label(strategy) {
  return ({
    baseline: "Baseline",
    "adaptive-lean": "Lean",
    "adaptive-balanced": "Balanced",
    "adaptive-strict": "Strict",
    fixed: "Fixed",
  })[strategy] || strategy;
}

function labelOffset(strategy) {
  return strategy === "fixed" ? -10 : strategy === "adaptive-balanced" ? 17 : -10;
}

function percent0(value) {
  return `${Math.round(value * 100)}%`;
}

function integer(value) {
  return String(Math.round(value));
}

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[char]);
}
