export function renderEvalHtml(report) {
  const rows = report.summary.map(summaryRow).join("");
  const runRows = report.runs.map(runRow).join("");
  const qualityChart = metricChart(report.summary, "quality", "Quality", (value) => percent(value));
  const callsMax = Math.max(...report.summary.map((item) => item.avgCalls || 0), 1);
  const callsChart = metricChart(
    report.summary,
    "avgCalls",
    "Calls per request",
    (value) => value.toFixed(2),
    callsMax,
    true,
  );
  const costAvailable = report.summary.some((item) => item.costIndex !== null);
  const costChart = costAvailable
    ? `<div class="chart">${metricChart(
        report.summary,
        "costIndex",
        "Cost index",
        (value) => value.toFixed(1),
        Math.max(...report.summary.map((item) => item.costIndex || 0), 100),
        true,
      )}</div>`
    : `<div class="empty"><strong>Cost index unavailable</strong><span>Add explicit pricing for every invoked model. Loom will not estimate missing prices.</span></div>`;
  const judge = report.evaluation?.judgeModel
    ? `<span class="method-chip">judge · ${escapeHtml(report.evaluation.judgeModel)}</span>`
    : `<span class="method-chip">deterministic checks</span>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dot Loom benchmark</title>
  <style>
    :root { color-scheme:dark; --ink:#ece9df; --muted:#96958e; --line:#2d302d; --panel:#151816; --accent:#b7f36b; --warm:#e3b86c; --danger:#ff866e; --bg:#0c0f0d; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    body::before { content:""; position:fixed; inset:0; pointer-events:none; opacity:.22; background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px); background-size:32px 32px; }
    main { width:min(1180px,calc(100% - 48px)); margin:0 auto; padding:56px 0 80px; position:relative; }
    header { display:grid; grid-template-columns:minmax(0,1.45fr) minmax(280px,.55fr); gap:48px; align-items:end; border-bottom:1px solid var(--line); padding-bottom:36px; }
    .eyebrow,.label { color:var(--accent); font:700 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.16em; text-transform:uppercase; }
    h1 { margin:14px 0 16px; max-width:760px; font-size:clamp(44px,7vw,88px); line-height:.9; letter-spacing:-.065em; font-weight:760; }
    .lede { color:#b9b8b1; max-width:700px; font-size:18px; line-height:1.55; margin:0; }
    .meta { display:grid; gap:12px; border-left:1px solid var(--line); padding-left:24px; min-width:0; }
    .meta-row { display:flex; justify-content:space-between; gap:20px; font-size:13px; }
    .meta-row span:first-child { color:var(--muted); }
    .meta-row strong { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-weight:500; overflow-wrap:anywhere; text-align:right; }
    .trust { display:inline-flex; width:max-content; gap:8px; align-items:center; color:var(--accent); border:1px solid #3e5b2d; padding:7px 9px; font:700 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.1em; text-transform:uppercase; }
    section { margin-top:52px; }
    .section-head { display:flex; align-items:end; justify-content:space-between; gap:24px; margin-bottom:18px; }
    h2 { margin:7px 0 0; font-size:28px; letter-spacing:-.035em; }
    .method-chip { color:var(--muted); border:1px solid var(--line); padding:7px 10px; font:11px ui-monospace,SFMono-Regular,Menlo,monospace; }
    .table-wrap { overflow:auto; border:1px solid var(--line); background:rgba(21,24,22,.86); }
    table { border-collapse:collapse; width:100%; min-width:760px; }
    th,td { padding:17px 18px; border-bottom:1px solid var(--line); text-align:right; font-size:14px; }
    th { color:var(--muted); font:700 10px ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.1em; text-transform:uppercase; background:#111411; }
    th:first-child,td:first-child { text-align:left; }
    tbody tr:last-child td { border-bottom:0; }
    td:first-child { font-weight:680; }
    .value-good { color:var(--accent); }
    .charts { display:grid; grid-template-columns:1.2fr 1fr 1fr; gap:1px; background:var(--line); border:1px solid var(--line); }
    .chart { min-width:0; background:var(--panel); padding:22px; }
    .chart h3 { margin:0 0 24px; color:var(--muted); font:700 10px ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.1em; text-transform:uppercase; }
    .bar-row { margin-top:18px; }
    .bar-meta { display:flex; justify-content:space-between; gap:16px; font-size:12px; margin-bottom:8px; }
    .bar-meta span:first-child { color:#c3c2bb; }
    .bar-meta strong { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
    .track { height:7px; background:#252925; overflow:hidden; }
    .fill { height:100%; background:var(--accent); }
    .reverse .fill { background:var(--warm); }
    .empty { min-height:180px; background:var(--panel); padding:22px; display:flex; flex-direction:column; justify-content:flex-end; gap:9px; }
    .empty strong { color:var(--warm); font-size:15px; }
    .empty span { color:var(--muted); font-size:13px; line-height:1.5; }
    .runs td { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
    .pass { color:var(--accent); } .fail { color:var(--danger); }
    footer { margin-top:36px; border-top:1px solid var(--line); padding-top:20px; display:flex; justify-content:space-between; gap:24px; color:var(--muted); font-size:12px; line-height:1.5; }
    footer strong { color:#c3c2bb; }
    @media (max-width:980px) { header { grid-template-columns:1fr; } .meta { border-left:0; border-top:1px solid var(--line); padding:20px 0 0; } .charts { grid-template-columns:1fr; } }
    @media (max-width:620px) {
      main { width:min(100% - 28px,1180px); padding-top:32px; }
      h1 { font-size:50px; }
      .section-head,footer { align-items:flex-start; flex-direction:column; }
      header { gap:28px; }
      .lede { font-size:16px; }
      .meta-row strong { max-width:62%; }
      table { min-width:100%; table-layout:auto; }
      th,td { padding:13px 10px; font-size:12px; }
      .summary th:nth-child(4),.summary td:nth-child(4),.summary th:nth-child(5),.summary td:nth-child(5),.summary th:nth-child(6),.summary td:nth-child(6),.summary th:nth-child(8),.summary td:nth-child(8),.summary th:nth-child(10),.summary td:nth-child(10) { display:none; }
      .runs th:nth-child(3),.runs td:nth-child(3),.runs th:nth-child(4),.runs td:nth-child(4),.runs th:nth-child(6),.runs td:nth-child(6),.runs th:nth-child(7),.runs td:nth-child(7) { display:none; }
    }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <div class="eyebrow">Dot Loom · evaluation receipt</div>
      <h1>Measure the weave.</h1>
      <p class="lede">Direct, fixed, and budgeted adaptive inference compared on the same tasks, with quality, call count, escalation, cost, and latency kept visible.</p>
    </div>
    <div class="meta">
      <div class="trust">● measured, not estimated</div>
      <div class="meta-row"><span>Dataset</span><strong>${escapeHtml(shortPath(report.dataset))}</strong></div>
      <div class="meta-row"><span>Cases</span><strong>${report.caseCount} × ${report.iterations} iteration${report.iterations === 1 ? "" : "s"}</strong></div>
      <div class="meta-row"><span>Generated</span><strong>${escapeHtml(report.generatedAt)}</strong></div>
    </div>
  </header>
  <section>
    <div class="section-head"><div><div class="label">01 · Result</div><h2>Strategy comparison</h2></div>${judge}</div>
    <div class="table-wrap"><table class="summary"><thead><tr><th>Strategy</th><th>Quality</th><th>Avg calls</th><th>One call</th><th>Escalation</th><th>Route accuracy</th><th>Avg cost/run</th><th>Cost index</th><th>P95 latency</th><th>Pass rate</th></tr></thead><tbody>${rows}</tbody></table></div>
  </section>
  <section>
    <div class="section-head"><div><div class="label">02 · Shape</div><h2>Performance profile</h2></div></div>
    <div class="charts"><div class="chart">${qualityChart}</div><div class="chart reverse">${callsChart}</div>${costChart}</div>
  </section>
  <section>
    <div class="section-head"><div><div class="label">03 · Evidence</div><h2>Run ledger</h2></div><span class="method-chip">${report.runs.length} runs</span></div>
    <div class="table-wrap"><table class="runs"><thead><tr><th>Case</th><th>Strategy</th><th>Quality</th><th>Status</th><th>Calls</th><th>Escalated</th><th>Latency</th><th>Cost</th></tr></thead><tbody>${runRows}</tbody></table></div>
  </section>
  <footer><span><strong>Quality source:</strong> ${escapeHtml(report.evaluation?.qualitySource || "deterministic-checks")}. Workflow cost excludes judge calls.</span><span>Generated by Dot Loom · verify the JSON receipt before publishing claims.</span></footer>
</main>
</body>
</html>`;
}

export function renderEvalSvg(report) {
  const columnWidth = 1072 / Math.max(report.summary.length, 1);
  const barMaxWidth = Math.max(100, Math.min(292, columnWidth - 36));
  const columns = report.summary.map((item, index) => {
    const x = 64 + index * columnWidth;
    const quality = item.quality === null ? 0 : item.quality;
    const barWidth = barMaxWidth * quality;
    return `<g transform="translate(${x} 0)">
      <text x="0" y="258" fill="#96958e" font-size="13" font-family="ui-monospace,monospace">${escapeXml(displayStrategy(item.strategy).toUpperCase())}</text>
      <text x="0" y="330" fill="#ece9df" font-size="54" font-weight="700" font-family="Inter,system-ui,sans-serif">${escapeXml(percent(item.quality))}</text>
      <rect x="0" y="354" width="${barMaxWidth.toFixed(1)}" height="9" fill="#252925"/><rect x="0" y="354" width="${barWidth.toFixed(1)}" height="9" fill="#b7f36b"/>
      <text x="0" y="405" fill="#96958e" font-size="14" font-family="ui-monospace,monospace">PASS ${escapeXml(percent(item.passRate))}</text>
      <text x="0" y="435" fill="#96958e" font-size="14" font-family="ui-monospace,monospace">CALLS ${escapeXml(Number(item.avgCalls || 0).toFixed(2))}</text>
      <text x="0" y="465" fill="#96958e" font-size="14" font-family="ui-monospace,monospace">COST ${escapeXml(formatSummaryCost(item))}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Dot Loom benchmark summary">
    <rect width="1200" height="630" fill="#0c0f0d"/>
    <path d="M0 1H1200M0 33H1200M0 65H1200M0 97H1200M0 129H1200M0 161H1200M0 193H1200M0 225H1200M0 257H1200M0 289H1200M0 321H1200M0 353H1200M0 385H1200M0 417H1200M0 449H1200M0 481H1200M0 513H1200M0 545H1200M0 577H1200M0 609H1200" stroke="#151815"/>
    <text x="64" y="72" fill="#b7f36b" font-size="14" font-weight="700" letter-spacing="2" font-family="ui-monospace,monospace">DOT LOOM · EVALUATION RECEIPT</text>
    <text x="64" y="155" fill="#ece9df" font-size="68" font-weight="750" letter-spacing="-3" font-family="Inter,system-ui,sans-serif">Measure the weave.</text>
    <text x="64" y="198" fill="#96958e" font-size="18" font-family="Inter,system-ui,sans-serif">${escapeXml(report.caseCount)} cases · ${escapeXml(report.iterations)} iteration${report.iterations === 1 ? "" : "s"} · ${escapeXml(shortPath(report.dataset))}</text>
    ${columns}
    <line x1="64" y1="530" x2="1136" y2="530" stroke="#2d302d"/>
    <text x="64" y="570" fill="#96958e" font-size="14" font-family="ui-monospace,monospace">QUALITY SOURCE: ${escapeXml((report.evaluation?.qualitySource || "deterministic-checks").toUpperCase())}</text>
    <text x="1136" y="570" text-anchor="end" fill="#96958e" font-size="14" font-family="ui-monospace,monospace">MEASURED, NOT ESTIMATED</text>
  </svg>`;
}

function metricChart(summary, key, title, formatter, explicitMax = null, lowerIsBetter = false) {
  const values = summary.map((item) => item[key]).filter((value) => value !== null && Number.isFinite(value));
  const max = explicitMax || Math.max(...values, 1);
  const bars = summary.map((item) => {
    const value = item[key];
    const available = Number.isFinite(value);
    const width = available ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return `<div class="bar-row"><div class="bar-meta"><span>${escapeHtml(displayStrategy(item.strategy))}</span><strong>${available ? escapeHtml(formatter(value)) : "n/a"}</strong></div><div class="track"><div class="fill" style="width:${width.toFixed(1)}%"></div></div></div>`;
  }).join("");
  return `<h3>${escapeHtml(title)}${lowerIsBetter ? " · lower is better" : ""}</h3>${bars}`;
}

function summaryRow(item) {
  return `<tr><td>${escapeHtml(displayStrategy(item.strategy))}</td><td class="value-good">${percentWithCi(item.quality, item.qualityCi95)}</td><td>${Number(item.avgCalls || 0).toFixed(2)}</td><td>${percent(item.oneCallRate)}</td><td>${percent(item.escalationRate)}</td><td>${percent(item.routingAccuracy)}</td><td>${formatSummaryCost(item)}</td><td>${item.costIndex === null ? "n/a" : item.costIndex.toFixed(1)}</td><td>${seconds(item.p95LatencyMs)}</td><td>${percent(item.passRate)}</td></tr>`;
}

function runRow(run) {
  return `<tr><td>${escapeHtml(run.caseId)}</td><td>${escapeHtml(displayStrategy(run.strategy))}</td><td>${percent(run.quality)}</td><td class="${run.passed ? "pass" : "fail"}">${run.passed ? "PASS" : "FAIL"}</td><td>${Number(run.callCount || 0)}</td><td>${run.workflowMode === "adaptive" ? run.escalated ? "YES" : "NO" : "n/a"}</td><td>${seconds(run.elapsedMs)}</td><td>${formatRunCost(run)}</td></tr>`;
}

function displayStrategy(strategy) {
  const labels = { baseline:"Single-model baseline", fixed:"Loom fixed", adaptive:"Loom balanced", "adaptive-lean":"Loom lean", "adaptive-balanced":"Loom balanced", "adaptive-strict":"Loom strict" };
  return labels[strategy] || strategy;
}

function percent(value) { return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "n/a"; }
function percentWithCi(value, interval) { return Number.isFinite(value) && interval ? `${percent(value)}<br><small>${percent(interval[0])} to ${percent(interval[1])}</small>` : percent(value); }
function money(value) { return value === null ? "n/a" : `$${value.toFixed(value >= 0.01 ? 4 : 6)}`; }
function formatSummaryCost(item) { return item.avgCostUsd !== null ? money(item.avgCostUsd) : Number.isFinite(item.avgSpentCredits) ? `${item.avgSpentCredits.toFixed(2)} cr` : "n/a"; }
function formatRunCost(run) { return run.costUsd !== null ? money(run.costUsd) : Number.isFinite(run.spentCredits) ? `${run.spentCredits.toFixed(2)} cr` : "n/a"; }
function seconds(value) { return `${(Number(value || 0) / 1000).toFixed(2)}s`; }
function shortPath(value) { return String(value || "").split(/[\\/]/).slice(-2).join("/"); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]); }
function escapeXml(value) { return escapeHtml(value); }
