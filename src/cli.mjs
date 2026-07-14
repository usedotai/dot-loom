#!/usr/bin/env node
import { loadConfig } from "./config.mjs";
import { createLiveReporter, printDoctor, printHuman } from "./format.mjs";
import { runAdaptive } from "./adaptive.mjs";
import { renderEvalMarkdown, runEval } from "./eval.mjs";
import { runBaseline, runFusion } from "./fusion.mjs";
import { listPipelines } from "./pipelines/index.mjs";

const args = parseArgs(process.argv.slice(2));

try {
  if (args.command === "doctor") {
    const config = await loadConfig(args.config);
    printDoctor(config);
  } else if (args.command === "pipelines") {
    for (const pipeline of listPipelines()) {
      console.log(`${pipeline.name}\n  ${pipeline.instruction}`);
    }
  } else if (args.command === "eval") {
    const config = await loadConfig(args.config);
    const report = await runEval(config, {
      ...args,
      onRunStart: args.json
        ? undefined
        : ({ evalCase, strategy, iteration, iterations }) => {
            const pass = iterations > 1 ? ` iteration=${iteration}/${iterations}` : "";
            console.error(`[eval] ${evalCase.id} strategy=${strategy}${pass}`);
          },
    });
    console.log(args.json ? JSON.stringify(report, null, 2) : renderEvalMarkdown(report));
    if (!args.json && report.output) console.error(`\nWrote ${report.output}`);
    if (!args.json && report.artifacts) console.error(`\nWrote ${Object.values(report.artifacts).join(", ")}`);
  } else if (args.command === "run") {
    const config = await loadConfig(args.config);
    const input = args.prompt || args._.join(" ").trim();
    if (!input) throw new Error("Missing prompt. Example: dot-loom run \"review this API\"");
    const live = createLiveReporter(args.stream && !args.json);
    const result = args.adaptive
      ? await runAdaptive(config, input, { ...args, ...live })
      : args.baseline
        ? await runBaseline(config, input, { ...args, ...live })
        : await runFusion(config, input, { ...args, ...live });
    printHuman(result, args);
  } else {
    printHelp();
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = {
    command: argv[0] || "help",
    _: [],
    config: "examples/dot.config.json",
    pipeline: "general",
    temperature: 0.2,
    maxTokens: undefined,
    json: false,
    baseline: false,
    adaptive: false,
    stream: true,
    dataset: "evals/mock-code-review.jsonl",
    strategies: "baseline,fixed,adaptive",
    iterations: 1,
    output: undefined,
    includeAnswers: false,
    concurrency: 1,
    judgeModel: undefined,
    judgeMaxTokens: 300,
    limit: undefined,
    artifacts: undefined,
  };

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") parsed.config = argv[++i];
    else if (arg === "--pipeline") parsed.pipeline = argv[++i];
    else if (arg === "--temperature") parsed.temperature = Number(argv[++i]);
    else if (arg === "--max-tokens") parsed.maxTokens = Number(argv[++i]);
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--baseline") parsed.baseline = true;
    else if (arg === "--adaptive") parsed.adaptive = true;
    else if (arg === "--no-stream") parsed.stream = false;
    else if (arg === "--dataset") parsed.dataset = argv[++i];
    else if (arg === "--strategies") parsed.strategies = argv[++i];
    else if (arg === "--iterations") parsed.iterations = Number(argv[++i]);
    else if (arg === "--output") parsed.output = argv[++i];
    else if (arg === "--include-answers") parsed.includeAnswers = true;
    else if (arg === "--concurrency") parsed.concurrency = Number(argv[++i]);
    else if (arg === "--judge-model") parsed.judgeModel = argv[++i];
    else if (arg === "--judge-max-tokens") parsed.judgeMaxTokens = Number(argv[++i]);
    else if (arg === "--limit") parsed.limit = Number(argv[++i]);
    else if (arg === "--artifacts") parsed.artifacts = argv[++i];
    else parsed._.push(arg);
  }
  if (parsed.json) parsed.stream = false;
  parsed.prompt = parsed._.join(" ").trim();
  return parsed;
}

function printHelp() {
  console.log(`Dot Loom

Usage:
  node src/cli.mjs doctor --config examples/dot.config.json
  node src/cli.mjs pipelines
  node src/cli.mjs eval --dataset evals/mock-code-review.jsonl --config examples/mock.config.json
  node src/cli.mjs eval --dataset evals/code-review-v1.jsonl --strategies baseline,fixed,adaptive --output reports/eval.html
  node src/cli.mjs eval --dataset evals/code-review-v1.jsonl --judge-model provider/judge-model --concurrency 3
  node src/cli.mjs eval --dataset evals/code-review-v1.jsonl --limit 3 --artifacts reports/smoke
  node src/cli.mjs run "review this API" --pipeline code-review --config examples/dot.config.json
  node src/cli.mjs run "review this API" --adaptive --pipeline code-review --config examples/dot.config.json
  node src/cli.mjs run "review this API" --baseline --config examples/dot.config.json
  node src/cli.mjs run "review this API" --max-tokens 2000 --config examples/dot.config.json
  node src/cli.mjs run "review this API" --no-stream --config examples/dot.config.json

Providers:
  dot/openai-compatible, ollama, mock
`);
}
