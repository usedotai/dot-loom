# Dot Loom

[![GitHub stars](https://img.shields.io/github/stars/usedotai/dot-loom?style=social)](https://github.com/usedotai/dot-loom/stargazers)

Dot Loom is a provider-pluggable orchestration runtime for multi-model inference.

It is not a new foundation model and it does not pretend to be one. It is a research and developer framework for composing existing models into role-based pipelines:

```txt
router -> drafter -> critic/verifier -> finalizer
```

The goal is to make the orchestration layer observable, configurable, and portable. A user can run the same workflow with Dot, OpenRouter, OpenAI-compatible endpoints, Ollama, LM Studio-compatible local servers, or deterministic mocks.

Dot Loom is the open R&D surface behind the same systems philosophy as Dot Supercharged: do not assume one giant model is always the right inference primitive. Route, draft, verify, synthesize, and measure.

## Status

This repository is an early technical scaffold. It is suitable for experimentation, demos, local provider tests, and architecture review. It is not yet a benchmarked replacement for commercial multi-agent systems.

Current maturity: strong prototype.

What works now:

- Fixed orchestration pipeline.
- Adaptive workflow mode with a small planner.
- Provider abstraction for Dot, OpenAI-compatible APIs, Ollama, and mock runs.
- Streaming CLI traces.
- Per-role token and timing summaries.
- Studio UI for visualizing model interaction and live process traces.
- BYOK Studio bridge that can run arbitrary role maps without persisting provider keys.
- Access-list based context gating in adaptive mode.

What is not done yet:

- Formal eval harness across task suites.
- Learned or evolved routing policies.
- Parallel branch execution.
- Tool-call isolation per worker.
- Long-term trace corpus and regression dashboard.
- Reproducible benchmark claims against Fugu, MoA, or frontier single-model baselines.

## Repository Layout

```txt
dot-loom/
  src/
    cli.mjs                         CLI entrypoint
    config.mjs                      provider/model config parsing
    fusion.mjs                      fixed pipeline runtime
    adaptive.mjs                    adaptive planner/runtime
    providers/                      provider adapters
    pipelines/                      pipeline profiles
  examples/
    mock.config.json                offline deterministic demo
    dot.config.json                 Dot API example
    dot-code.config.json            Dot API code-review lane
    openrouter.config.json          OpenRouter compatible example
    ollama.config.json              local Ollama example
  studio/
    server.mjs                      local Studio bridge
    src/                            React visualization surface
```

## Installation

Requirements:

- Node.js 20 or newer.
- Optional provider API keys.
- Optional Ollama if running local models.

Install Studio dependencies only if you want the UI:

```bash
cd dot-loom
npm run studio:install
```

The CLI itself has no runtime dependencies.

## CLI Quick Start

Run the deterministic mock pipeline:

```bash
npm run demo
```

Inspect a config:

```bash
npm run doctor
```

List pipeline profiles:

```bash
node src/cli.mjs pipelines
```

Run fixed orchestration:

```bash
node src/cli.mjs run "Review this API design for billing and privacy bugs." \
  --pipeline code-review \
  --config examples/mock.config.json
```

Run adaptive orchestration:

```bash
node src/cli.mjs run "Review this API design for billing and privacy bugs." \
  --adaptive \
  --pipeline code-review \
  --config examples/mock.config.json
```

Run baseline only:

```bash
node src/cli.mjs run "Review this API design for billing and privacy bugs." \
  --baseline \
  --config examples/mock.config.json
```

Emit JSON:

```bash
node src/cli.mjs run "Find edge cases in a credits API." \
  --pipeline code-review \
  --config examples/mock.config.json \
  --json
```

## Studio

Start the local Studio:

```bash
npm run studio
```

Default URL:

```txt
http://localhost:3955
```

The Studio exposes four modes:

- `DEMO`: visual deterministic simulation, no provider call.
- `CLI-MOCK`: real CLI execution with the mock provider.
- `CLI-DOT`: real CLI execution using `DOT_API_KEY`.
- `CLI-BYOK`: real CLI execution using a provider selected in the UI.

The BYOK bridge writes a temporary config to the OS temp directory, executes the CLI, then deletes the config. API keys pasted into the Studio are not written into this repository.

## Provider Model

Model references use this format:

```txt
provider/model-id
```

Minimal provider config:

```json
{
  "providers": {
    "dot": {
      "type": "dot",
      "baseUrl": "https://api.usedot.xyz/agent/v1",
      "apiKey": "env:DOT_API_KEY"
    }
  },
  "models": {
    "router": "dot/dot-nemotron-nano",
    "drafter": "dot/dot-deepseek-v4-flash",
    "critic": "dot/dot-gemma-4-uncensored",
    "finalizer": "dot/dot-qwen-coder-480b"
  }
}
```

OpenAI-compatible provider:

```json
{
  "providers": {
    "gateway": {
      "type": "openai-compatible",
      "baseUrl": "https://provider.example/v1",
      "apiKey": "env:PROVIDER_API_KEY"
    }
  },
  "models": {
    "router": "gateway/small-router-model",
    "drafter": "gateway/cheap-draft-model",
    "critic": "gateway/strong-verifier-model",
    "finalizer": "gateway/best-final-model"
  }
}
```

Local Ollama provider:

```bash
ollama pull gemma3:4b
ollama pull qwen2.5-coder:7b
node src/cli.mjs run "Find edge cases in this architecture." \
  --config examples/ollama.config.json
```

## Execution Modes

### Fixed

Fixed mode is deterministic at the orchestration layer:

```txt
router -> drafter -> critic -> finalizer
```

It is useful for debugging and direct comparisons against a single-model baseline.

### Adaptive

Adaptive mode asks the router to produce a task plan. Each planned step selects a worker and receives only the context admitted by its access list.

The planner output is intentionally constrained:

```txt
step id
worker id
objective
allowed context ids
expected artifact type
```

This is not a full autonomous agent loop yet. It is a bounded orchestration scaffold that makes model collaboration inspectable.

### Baseline

Baseline mode sends the prompt to the finalizer model only. Use it to compare:

- latency
- token volume
- answer quality
- failure modes
- cost or credit consumption

## Context Gating

Dot Loom treats context as an orchestration input, not a global blob.

In adaptive mode, each worker receives:

- the original task if allowed
- prior outputs if listed by the planner
- role-specific instructions
- no hidden global memory

This matters because multi-model systems can leak task state between components if every worker sees everything. Loom makes those boundaries explicit so they can later become enforceable policies.

## Streaming and Observability

The CLI streams role activity by default:

```txt
[router] provider/model
[drafter] provider/model
[critic] provider/model
[finalizer] provider/model
```

For providers that expose token chunks, the CLI prints tokens live. For providers that expose structured events, such as Dot privacy or billing frames, Loom prints those frames in the trace.

The Studio keeps the live process trace fixed at the bottom so users can watch the orchestration without scrolling through the full response.

## Design Lineage

Dot Loom is closest to a practical, hackable orchestration layer. It takes inspiration from several research directions without claiming to reproduce their full results.

Sakana Fugu is the closest product-level reference: a multi-agent orchestration system exposed through standard OpenAI-format APIs, with the orchestration hidden behind a normal model interface.

Mixture-of-Agents shows that multiple LLM agents can outperform a single model by layering candidate responses and passing prior layer outputs forward.

FrugalGPT shows that cascades and routing can reduce inference cost while preserving or improving quality for selected tasks.

Self-Refine and Reflexion show the value of feedback and critique loops at inference time without weight updates.

Tree of Thoughts formalizes deliberate search over intermediate reasoning states rather than a single left-to-right output path.

Speculative decoding is a different layer of the stack, but it motivates the broader principle that a smaller draft model plus a stronger verifier can improve latency. Loom applies that principle at the workflow level, not at token-level decoding.

Sakana's Evolutionary Model Merge and CycleQD work are relevant to future Loom directions: automatically discovering better mixtures, workers, and policies instead of hand-picking role maps.

## References

- Sakana Fugu: https://sakana.ai/fugu-beta/
- Sakana Fugu API docs: https://console.sakana.ai/get-started
- Mixture-of-Agents Enhances Large Language Model Capabilities: https://arxiv.org/abs/2406.04692
- FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance: https://arxiv.org/abs/2305.05176
- Fast Inference from Transformers via Speculative Decoding: https://arxiv.org/abs/2211.17192
- Self-Refine: Iterative Refinement with Self-Feedback: https://arxiv.org/abs/2303.17651
- Reflexion: Language Agents with Verbal Reinforcement Learning: https://arxiv.org/abs/2303.11366
- Tree of Thoughts: Deliberate Problem Solving with Large Language Models: https://arxiv.org/abs/2305.10601
- Evolutionary Optimization of Model Merging Recipes: https://arxiv.org/abs/2403.13187
- CycleQD: Population-based Model Merging via Quality Diversity: https://sakana.ai/cycleqd/
- The AI Scientist: Towards Fully Automated Open-Ended Scientific Discovery: https://arxiv.org/abs/2408.06292

## How Close Is This To Fugu/Sakana?

Dot Loom is not Fugu. Fugu is a hosted orchestration model interface with hidden internal coordination and production infrastructure.

Dot Loom gets close on these primitives:

- Standard model-like entrypoint.
- Multiple workers behind one user-facing run.
- Routing before execution.
- Role assignment.
- Context partitioning.
- Verifier/critic pass.
- Provider abstraction.
- Streaming trace and receipts.
- UI that exposes orchestration instead of hiding it.

Dot Loom is still behind on:

- Learned conductor policy.
- Production-grade benchmark suite.
- Automatically evolved worker selection.
- Parallel execution scheduler.
- Built-in tool sandboxing.
- Long-run memory and trace learning.
- Public performance claims.

The honest framing is: Loom is an open, inspectable scaffold for Fugu-style orchestration experiments. It is not a solved orchestration model.

## Security Notes

- Do not commit API keys.
- Use `env:NAME` references in config files.
- The Studio BYOK mode creates temporary config files outside the repository and deletes them when the run exits.
- `.env` and `.env.*` are ignored.
- `node_modules` and build artifacts are ignored.
- The mock provider is recommended for screenshots, CI, and public demos.

If a real API key was ever pasted in terminal history or a chat transcript, rotate it before publishing a public repository.

## Verification

Run the CLI smoke test:

```bash
npm run test
```

Build the Studio:

```bash
npm run studio:install
npm run studio:build
```

Run both:

```bash
npm run verify
```

## Roadmap

Near term:

- Add a formal eval harness.
- Add batch comparison: baseline vs fixed vs adaptive.
- Persist anonymized local traces for regression tests.
- Add LM Studio examples.
- Add tool-call isolation and explicit tool permissions.
- Add parallel worker branches.

Medium term:

- Learn routing policies from trace outcomes.
- Add model-pair calibration for drafter/verifier compatibility.
- Add cost-aware planner objectives.
- Add benchmark dashboards.
- Add local-only privacy mode for sensitive runs.

Long term:

- Evolve role maps automatically.
- Evolve prompt policies automatically.
- Train a conductor model for task decomposition.
- Support hybrid local plus hosted execution.
- Publish reproducible benchmarks for orchestration strategies.
