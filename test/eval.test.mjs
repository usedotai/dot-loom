import test from "node:test";
import assert from "node:assert/strict";
import { calculateRunCost, parseJudgeResponse, renderEvalMarkdown, scoreCase, summarizeEval } from "../src/eval.mjs";
import { renderEvalHtml, renderEvalSvg } from "../src/report.mjs";

test("scoreCase evaluates deterministic dataset checks", () => {
  const result = scoreCase("Billing is safe after verification tests.", [
    { type: "contains", value: "billing" },
    { type: "contains-any", values: ["verify", "verification"] },
    { type: "not-contains", value: "sorry" },
  ]);
  assert.equal(result.passed, true);
  assert.equal(result.score, 1);
});

test("calculateRunCost uses explicit per-million-token pricing", () => {
  const config = {
    pricing: {
      "test/model": { inputPerMillion: 2, outputPerMillion: 8 },
    },
  };
  const result = calculateRunCost(config, [
    {
      provider: "test",
      model: "model",
      modelRef: "test/model",
      usage: { prompt_tokens: 1_000_000, completion_tokens: 500_000 },
    },
  ]);
  assert.equal(result.pricingComplete, true);
  assert.equal(result.costUsd, 6);
  assert.deepEqual(result.modelUsage, [
    {
      modelRef: "test/model",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      costUsd: 6,
      spentCredits: null,
    },
  ]);
});

test("calculateRunCost refuses partial pricing", () => {
  const result = calculateRunCost({}, [
    { provider: "test", model: "model", modelRef: "test/model", usage: { total_tokens: 20 } },
  ]);
  assert.equal(result.costUsd, null);
  assert.deepEqual(result.missingPrices, ["test/model"]);
});

test("calculateRunCost preserves provider credit receipts", () => {
  const result = calculateRunCost({}, [
    {
      provider: "dot",
      model: "model",
      modelRef: "dot/model",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      payment: { spent_credits: 12.5 },
    },
  ]);
  assert.equal(result.costUsd, null);
  assert.equal(result.spentCredits, 12.5);
});

test("summary derives baseline-relative cost index and p95 latency", () => {
  const summary = summarizeEval(
    [
      run("baseline", 1, 1, 4, 100),
      run("baseline", 1, 1, 6, 200),
      run("adaptive", 0.5, 0, 2, 120),
      run("adaptive", 1, 1, 3, 180),
    ],
    ["baseline", "adaptive"],
  );
  assert.equal(summary[0].avgCostUsd, 5);
  assert.equal(summary[0].costIndex, 100);
  assert.equal(summary[0].p95LatencyMs, 200);
  assert.equal(summary[1].avgCostUsd, 2.5);
  assert.equal(summary[1].costIndex, 50);
  assert.equal(summary[1].quality, 0.75);
  assert.equal(summary[1].passRate, 0.5);
  assert.equal(summary[0].avgCalls, 1);
  assert.deepEqual(summary[0].qualityCi95, [1, 1]);
});

test("unscored cases do not inflate pass rate", () => {
  const scored = run("baseline", 0, 0, 1, 100);
  const unscored = { ...run("baseline", null, 1, 1, 100), quality: null };
  const [summary] = summarizeEval([scored, unscored], ["baseline"]);
  assert.equal(summary.passRate, 0);
});

test("summary reports adaptive selectivity and routing accuracy", () => {
  const [summary] = summarizeEval(
    [
      { ...run("adaptive-balanced", 1, 1, 2, 100), workflowMode: "adaptive", escalated: false, routingCorrect: true },
      { ...run("adaptive-balanced", 1, 1, 4, 200), workflowMode: "adaptive", escalated: true, routingCorrect: true },
    ],
    ["adaptive-balanced"],
  );
  assert.equal(summary.avgCalls, 2);
  assert.equal(summary.oneCallRate, 0);
  assert.equal(summary.escalationRate, 0.5);
  assert.equal(summary.routingAccuracy, 1);
});

test("Markdown report labels costs as averages", () => {
  const report = sampleReport();
  const markdown = renderEvalMarkdown(report);
  assert.match(markdown, /Avg cost\/run/);
  assert.match(markdown, /Single-model baseline/);
  assert.match(markdown, /82\.0%/);
});

test("judge response parser accepts fenced JSON and validates fields", () => {
  const result = parseJudgeResponse('```json\n{"score": 84, "passed": true, "reason": "Specific and correct."}\n```');
  assert.deepEqual(result, { score: 84, passed: true, reason: "Specific and correct." });
  assert.deepEqual(parseJudgeResponse("Score: 71/100\nPassed: no\nReason: misses a race."), {
    score: 71,
    passed: false,
    reason: "Score: 71/100\nPassed: no\nReason: misses a race.",
  });
  assert.throws(() => parseJudgeResponse('{"score": 140, "passed": true}'), /0 to 100/);
});

test("HTML and SVG reports are self-contained shareable artifacts", () => {
  const report = sampleReport();
  const html = renderEvalHtml(report);
  const svg = renderEvalSvg(report);
  assert.match(html, /<!doctype html>/);
  assert.match(html, /Measure the weave/);
  assert.match(html, /Strategy comparison/);
  assert.match(svg, /<svg/);
  assert.match(svg, /MEASURED, NOT ESTIMATED/);
});

function sampleReport() {
  return {
    version: 1,
    generatedAt: "2026-07-14T00:00:00.000Z",
    dataset: "/tmp/eval.jsonl",
    caseCount: 1,
    iterations: 1,
    evaluation: { qualitySource: "deterministic-checks", judgeModel: null },
    runs: [
      {
        caseId: "sample",
        strategy: "baseline",
        quality: 0.82,
        passed: true,
        totalTokens: 100,
        elapsedMs: 4200,
        costUsd: 0.1,
      },
    ],
    summary: [
      {
        strategy: "baseline",
        quality: 0.82,
        avgCostUsd: 0.1,
        costIndex: 100,
        p95LatencyMs: 4200,
        passRate: 0.88,
        avgTokens: 100,
      },
    ],
  };
}

function run(strategy, quality, passed, costUsd, elapsedMs) {
  return {
    strategy,
    quality,
    passed: Boolean(passed),
    costUsd,
    elapsedMs,
    totalTokens: 10,
    callCount: strategy === "baseline" ? 1 : 2,
    missingPrices: [],
  };
}
