#!/usr/bin/env node
import { loadConfig } from "./config.mjs";
import { createLiveReporter, printDoctor, printHuman } from "./format.mjs";
import { runAdaptive } from "./adaptive.mjs";
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
  node src/cli.mjs run "review this API" --pipeline code-review --config examples/dot.config.json
  node src/cli.mjs run "review this API" --adaptive --pipeline code-review --config examples/dot.config.json
  node src/cli.mjs run "review this API" --baseline --config examples/dot.config.json
  node src/cli.mjs run "review this API" --max-tokens 2000 --config examples/dot.config.json
  node src/cli.mjs run "review this API" --no-stream --config examples/dot.config.json

Providers:
  dot/openai-compatible, ollama, mock
`);
}
