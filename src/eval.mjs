import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runAdaptive } from "./adaptive.mjs";
import { runBaseline, runFusion } from "./fusion.mjs";

const RUNNERS = {
  baseline: runBaseline,
  fixed: runFusion,
  adaptive: runAdaptive,
};

export async function runEval(config, options = {}) {
  const datasetPath = options.dataset || "evals/mock-code-review.jsonl";
  const cases = await loadEvalCases(datasetPath);
  const strategies = normalizeStrategies(options.strategies);
  const iterations = positiveInteger(options.iterations, 1);
  const runs = [];

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    for (const evalCase of cases) {
      for (const strategy of strategies) {
        options.onRunStart?.({ evalCase, strategy, iteration, iterations });
        const result = await RUNNERS[strategy](config, evalCase.prompt, {
          pipeline: evalCase.pipeline || options.pipeline || "general",
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          stream: false,
        });
        const assessment = scoreCase(result.answer, evalCase.checks || []);
        const cost = calculateRunCost(config, result.trace);
        const run = {
          caseId: evalCase.id,
          iteration,
          strategy,
          pipeline: result.pipeline,
          passed: assessment.passed,
          quality: assessment.score,
          checks: assessment.checks,
          elapsedMs: result.metrics.elapsedMs,
          totalTokens: result.metrics.totalTokens || 0,
          costUsd: cost.costUsd,
          pricingComplete: cost.pricingComplete,
          missingPrices: cost.missingPrices,
          modelUsage: cost.modelUsage,
          answer: options.includeAnswers ? result.answer : undefined,
        };
        runs.push(run);
        options.onRunEnd?.(run);
      }
    }
  }

  const summary = summarizeEval(runs, strategies);
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    dataset: resolve(process.cwd(), datasetPath),
    caseCount: cases.length,
    iterations,
    strategies,
    summary,
    runs,
  };

  if (options.output) {
    const outputPath = resolve(process.cwd(), options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      options.output.endsWith(".md") ? `${renderEvalMarkdown(report)}\n` : `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    report.output = outputPath;
  }

  return report;
}

export async function loadEvalCases(datasetPath) {
  const path = resolve(process.cwd(), datasetPath);
  const raw = await readFile(path, "utf8");
  const cases = [];
  const ids = new Set();

  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    let evalCase;
    try {
      evalCase = JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid JSONL at ${path}:${index + 1}: ${error.message}`);
    }
    validateEvalCase(evalCase, path, index + 1);
    if (ids.has(evalCase.id)) throw new Error(`Duplicate eval case id "${evalCase.id}" at ${path}:${index + 1}.`);
    ids.add(evalCase.id);
    cases.push(evalCase);
  }

  if (!cases.length) throw new Error(`Eval dataset ${path} contains no cases.`);
  return cases;
}

export function scoreCase(answer, checks) {
  const text = String(answer || "");
  const normalized = text.toLowerCase();
  const results = checks.map((check) => evaluateCheck(normalized, check));
  const passedCount = results.filter((result) => result.passed).length;
  return {
    passed: results.length ? passedCount === results.length : true,
    score: results.length ? passedCount / results.length : null,
    checks: results,
  };
}

export function calculateRunCost(config, trace) {
  let costUsd = 0;
  const missingPrices = new Set();
  const modelUsage = [];

  for (const item of trace) {
    const pricing = findPricing(config, item);
    const usage = item.usage || {};
    const inputTokens = Number(usage.prompt_tokens || 0);
    const outputTokens = Number(usage.completion_tokens || 0);
    if (!pricing) {
      missingPrices.add(item.modelRef);
      modelUsage.push({
        modelRef: item.modelRef,
        inputTokens,
        outputTokens,
        costUsd: null,
      });
      continue;
    }
    const itemCost =
      (inputTokens / 1_000_000) * Number(pricing.inputPerMillion || 0) +
      (outputTokens / 1_000_000) * Number(pricing.outputPerMillion || 0);
    costUsd += itemCost;
    modelUsage.push({
      modelRef: item.modelRef,
      inputTokens,
      outputTokens,
      costUsd: itemCost,
    });
  }

  return {
    costUsd: missingPrices.size ? null : costUsd,
    pricingComplete: missingPrices.size === 0,
    missingPrices: [...missingPrices],
    modelUsage,
  };
}

export function summarizeEval(runs, strategies) {
  const summaries = strategies.map((strategy) => {
    const group = runs.filter((run) => run.strategy === strategy);
    const scored = group.filter((run) => run.quality !== null);
    const priced = group.filter((run) => run.costUsd !== null);
    const pricingComplete = priced.length === group.length;
    return {
      strategy,
      runs: group.length,
      quality: scored.length ? average(scored.map((run) => run.quality)) : null,
      passRate: scored.length ? scored.filter((run) => run.passed).length / scored.length : null,
      avgCostUsd: pricingComplete && group.length ? average(group.map((run) => run.costUsd)) : null,
      costIndex: null,
      p95LatencyMs: percentile(group.map((run) => run.elapsedMs), 0.95),
      avgTokens: group.length ? average(group.map((run) => run.totalTokens)) : 0,
      pricingComplete,
      missingPrices: [...new Set(group.flatMap((run) => run.missingPrices || []))],
    };
  });

  const baseline = summaries.find((item) => item.strategy === "baseline");
  const baselineCost = baseline?.avgCostUsd;
  if (Number.isFinite(baselineCost) && baselineCost > 0) {
    for (const item of summaries) {
      if (Number.isFinite(item.avgCostUsd)) item.costIndex = (item.avgCostUsd / baselineCost) * 100;
    }
  }
  return summaries;
}

export function renderEvalMarkdown(report) {
  const lines = [
    "# Dot Loom evaluation",
    "",
    `Dataset: ${report.dataset}`,
    `Cases: ${report.caseCount} · Iterations: ${report.iterations}`,
    "",
    "| Strategy | Quality | Avg cost/run | Cost index | P95 latency | Pass rate |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  for (const item of report.summary) {
    lines.push(
      `| ${displayStrategy(item.strategy)} | ${percent(item.quality)} | ${money(item.avgCostUsd)} | ${index(item.costIndex)} | ${seconds(item.p95LatencyMs)} | ${percent(item.passRate)} |`,
    );
  }
  lines.push("", "Quality and pass rate come from dataset checks. Cost is shown only when every invoked model has explicit pricing.");
  return lines.join("\n");
}

function normalizeStrategies(value) {
  const requested = Array.isArray(value)
    ? value
    : String(value || "baseline,fixed,adaptive").split(",");
  const strategies = [...new Set(requested.map((item) => item.trim()).filter(Boolean))];
  for (const strategy of strategies) {
    if (!RUNNERS[strategy]) throw new Error(`Unknown eval strategy "${strategy}". Use baseline,fixed,adaptive.`);
  }
  if (!strategies.length) throw new Error("At least one eval strategy is required.");
  return strategies;
}

function validateEvalCase(evalCase, path, line) {
  if (!evalCase || typeof evalCase !== "object" || Array.isArray(evalCase)) {
    throw new Error(`Invalid eval case at ${path}:${line}: expected an object.`);
  }
  if (!evalCase.id || typeof evalCase.id !== "string") {
    throw new Error(`Invalid eval case at ${path}:${line}: missing string id.`);
  }
  if (!evalCase.prompt || typeof evalCase.prompt !== "string") {
    throw new Error(`Invalid eval case "${evalCase.id}": missing string prompt.`);
  }
  if (evalCase.checks !== undefined && !Array.isArray(evalCase.checks)) {
    throw new Error(`Invalid eval case "${evalCase.id}": checks must be an array.`);
  }
  for (const check of evalCase.checks || []) validateCheck(check, evalCase.id);
}

function validateCheck(check, caseId) {
  const allowed = ["contains", "contains-any", "not-contains"];
  if (!check || !allowed.includes(check.type)) {
    throw new Error(`Invalid check in eval case "${caseId}". Use ${allowed.join(", ")}.`);
  }
  if (check.type === "contains-any") {
    if (!Array.isArray(check.values) || !check.values.length || check.values.some((value) => typeof value !== "string")) {
      throw new Error(`Check "contains-any" in eval case "${caseId}" requires string values.`);
    }
  } else if (typeof check.value !== "string" || !check.value) {
    throw new Error(`Check "${check.type}" in eval case "${caseId}" requires a string value.`);
  }
}

function evaluateCheck(text, check) {
  if (check.type === "contains") {
    return { ...check, passed: text.includes(check.value.toLowerCase()) };
  }
  if (check.type === "not-contains") {
    return { ...check, passed: !text.includes(check.value.toLowerCase()) };
  }
  return {
    ...check,
    passed: check.values.some((value) => text.includes(value.toLowerCase())),
  };
}

function findPricing(config, item) {
  const direct = config.pricing?.[item.modelRef];
  if (validPricing(direct)) return direct;
  const provider = config.providers?.[item.provider];
  const providerPrice = provider?.pricing?.[item.model];
  return validPricing(providerPrice) ? providerPrice : null;
}

function validPricing(pricing) {
  return Boolean(
    pricing &&
      Number.isFinite(Number(pricing.inputPerMillion)) &&
      Number.isFinite(Number(pricing.outputPerMillion)) &&
      Number(pricing.inputPerMillion) >= 0 &&
      Number(pricing.outputPerMillion) >= 0,
  );
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)];
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function displayStrategy(strategy) {
  return strategy === "fixed" ? "Loom fixed" : strategy === "adaptive" ? "Loom adaptive" : "Single-model baseline";
}

function percent(value) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function money(value) {
  return value === null ? "—" : `$${value.toFixed(value >= 0.01 ? 4 : 6)}`;
}

function index(value) {
  return value === null ? "—" : `${value.toFixed(1)}`;
}

function seconds(value) {
  return `${(value / 1000).toFixed(2)}s`;
}
