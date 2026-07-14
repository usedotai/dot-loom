import test from "node:test";
import assert from "node:assert/strict";
import { calculateRunCost, renderEvalMarkdown, scoreCase, summarizeEval } from "../src/eval.mjs";

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
});

test("unscored cases do not inflate pass rate", () => {
  const scored = run("baseline", 0, 0, 1, 100);
  const unscored = { ...run("baseline", null, 1, 1, 100), quality: null };
  const [summary] = summarizeEval([scored, unscored], ["baseline"]);
  assert.equal(summary.passRate, 0);
});

test("Markdown report labels costs as averages", () => {
  const markdown = renderEvalMarkdown({
    dataset: "/tmp/eval.jsonl",
    caseCount: 1,
    iterations: 1,
    summary: [
      {
        strategy: "baseline",
        quality: 0.82,
        avgCostUsd: 0.1,
        costIndex: 100,
        p95LatencyMs: 4200,
        passRate: 0.88,
      },
    ],
  });
  assert.match(markdown, /Avg cost\/run/);
  assert.match(markdown, /Single-model baseline/);
  assert.match(markdown, /82\.0%/);
});

function run(strategy, quality, passed, costUsd, elapsedMs) {
  return {
    strategy,
    quality,
    passed: Boolean(passed),
    costUsd,
    elapsedMs,
    totalTokens: 10,
    missingPrices: [],
  };
}
