#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runEval } from "../src/eval.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiKey = process.env.DOT_API_KEY;
if (!apiKey) throw new Error("DOT_API_KEY is required.");

const settings = {
  dataset: "evals/code-review-v1.jsonl",
  limit: positiveInteger(process.env.LOOM_BENCH_CASES, 6),
  iterations: positiveInteger(process.env.LOOM_BENCH_ITERATIONS, 1),
  concurrency: positiveInteger(process.env.LOOM_BENCH_CONCURRENCY, 3),
  temperature: 0.1,
  maxTokens: positiveInteger(process.env.LOOM_BENCH_MAX_TOKENS, 900),
  judgeMaxTokens: 300,
};

const models = {
  openai: "dot/openai-gpt-5.5",
  claude: "dot/claude-sonnet-5",
  dot: "dot/dot-qwen-coder-480b",
  judge: "dot/dot-deepseek-v4-pro",
  router: "dot/dot-nemotron-nano",
};

const laneDefinitions = [
  {
    id: "openai-solo",
    label: "OpenAI solo",
    strategy: "baseline",
    writer: models.openai,
    reviewer: null,
    finalizer: models.openai,
  },
  {
    id: "claude-solo",
    label: "Claude solo",
    strategy: "baseline",
    writer: models.claude,
    reviewer: null,
    finalizer: models.claude,
  },
  {
    id: "dot-solo",
    label: "Dot solo",
    strategy: "baseline",
    writer: models.dot,
    reviewer: null,
    finalizer: models.dot,
  },
  {
    id: "openai-claude-review",
    label: "OpenAI + Claude review",
    strategy: "adaptive-balanced",
    writer: models.openai,
    reviewer: models.claude,
    finalizer: models.openai,
  },
  {
    id: "claude-openai-review",
    label: "Claude + OpenAI review",
    strategy: "adaptive-balanced",
    writer: models.claude,
    reviewer: models.openai,
    finalizer: models.claude,
  },
  {
    id: "dot-claude-openai",
    label: "Dot + Claude + OpenAI",
    strategy: "adaptive-strict",
    writer: models.dot,
    reviewer: models.claude,
    finalizer: models.openai,
  },
];

const outputPath = resolve(root, "docs/benchmarks/cross-model-code-review-v1.json");
const checkpointPath = resolve(root, "reports/cross-model-code-review-v1.partial.json");
await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(checkpointPath), { recursive: true });

const resumed = await loadCheckpoint();
const startedAt = resumed?.startedAt || new Date().toISOString();
const completedLanes = resumed?.lanes || [];
for (const lane of laneDefinitions) {
  if (completedLanes.some((item) => item.id === lane.id && item.runs.length === settings.limit * settings.iterations)) {
    console.error(`[cross-model] resume skip ${lane.id}`);
    continue;
  }
  const config = laneConfig(lane);
  console.error(`[cross-model] starting ${lane.id}`);
  const report = await runEval(config, {
    ...settings,
    config: "generated:cross-model-code-review-v1",
    strategies: lane.strategy,
    judgeModel: models.judge,
    includeAnswers: true,
    onRunStart: ({ evalCase, iteration }) => {
      console.error(`[cross-model] ${lane.id} case=${evalCase.id} iteration=${iteration}`);
    },
  });
  const summary = report.summary[0];
  completedLanes.push({
    ...lane,
    callsPerRun: summary.avgCalls,
    summary,
    evaluation: report.evaluation,
    runs: report.runs,
  });
  await writeFile(checkpointPath, JSON.stringify(buildReceipt(false), null, 2) + "\n", "utf8");
  console.error(`[cross-model] completed ${lane.id}`);
}

const receipt = buildReceipt(true);
await writeFile(outputPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
console.log(`Wrote ${outputPath}`);

function laneConfig(lane) {
  return {
    name: `Dot Loom cross-model benchmark: ${lane.label}`,
    providers: {
      dot: {
        type: "dot",
        baseUrl: "https://api.usedot.xyz/agent/v1",
        apiKey,
      },
    },
    models: {
      router: models.router,
      drafter: lane.writer,
      critic: lane.reviewer || lane.writer,
      finalizer: lane.finalizer,
      judge: models.judge,
    },
    adaptive: {
      estimatedCreditsPerCall: 1,
      estimatedCreditsByModel: {
        [models.openai]: 14,
        [models.claude]: 4,
        [models.dot]: 1,
      },
      maxLatencyMs: 180000,
    },
    workers: {
      router: worker("router", models.router),
      drafter: worker("writer", lane.writer),
      critic: worker("reviewer", lane.reviewer || lane.writer),
      finalizer: worker("finalizer", lane.finalizer),
      judge: worker("judge", models.judge),
    },
  };
}

function worker(label, model) {
  return { label, model, capabilities: [label], cost: "provider-receipt", latency: "measured" };
}

function buildReceipt(complete) {
  const allRuns = completedLanes.flatMap((lane) => lane.runs);
  return {
    version: 1,
    benchmark: "cross-model-code-review-v1",
    complete,
    startedAt,
    generatedAt: new Date().toISOString(),
    dataset: settings.dataset,
    datasetCaseCount: 15,
    caseCount: settings.limit,
    iterations: settings.iterations,
    concurrency: settings.concurrency,
    settings: {
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      judgeMaxTokens: settings.judgeMaxTokens,
      judgeModel: models.judge,
      modelSnapshot: models,
      answerDisclosure: "included",
    },
    methodology: {
      quality: "strategy-blinded model judge score",
      passRate: "judge pass and all deterministic checks",
      cost: "native provider credits for workflow calls; judge credits reported separately",
      latency: "end-to-end workflow latency; judge latency excluded",
      limitations: [
        "Six synthetic high-risk backend cases from a frozen 15-case suite.",
        "One iteration per case and lane.",
        "One independent model judge and no human review.",
        "All models were accessed through the same Dot API gateway.",
        "Provider credits are native units, not USD prices.",
      ],
    },
    totalWorkflowCredits: sum(allRuns.map((run) => run.spentCredits)),
    totalJudgeCredits: sum(allRuns.map((run) => run.judge?.spentCredits)),
    lanes: completedLanes,
  };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

async function loadCheckpoint() {
  if (process.env.LOOM_BENCH_RESUME === "0") return null;
  try {
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
    const sameModels = JSON.stringify(checkpoint.settings?.modelSnapshot) === JSON.stringify(models);
    const sameRun = checkpoint.dataset === settings.dataset && checkpoint.caseCount === settings.limit && checkpoint.iterations === settings.iterations;
    return sameModels && sameRun ? checkpoint : null;
  } catch {
    return null;
  }
}
