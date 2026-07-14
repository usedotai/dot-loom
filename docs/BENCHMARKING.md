# Benchmarking Dot Loom

Dot Loom benchmarks answer a narrow question:

> On this frozen task suite, model map, pricing snapshot, and evaluation policy, does orchestration improve the quality/cost/latency trade-off over the configured finalizer alone?

They do not establish that one strategy is universally superior.

## Strategies

- `baseline`: one call to the configured finalizer.
- `fixed`: router → drafter → critic → finalizer.
- `adaptive`: router plus the bounded workflow selected by Loom's current planner.

All strategies receive the same task text. The baseline uses the same finalizer model that finishes the orchestrated workflows.

## Quality

Every JSONL case can contain:

- deterministic `checks` for required concepts and forbidden failure phrases;
- a task-specific `rubric` for independent model judging.

Without `--judge-model`, quality is the fraction of deterministic checks passed. With a judge, quality is the judge score and a run passes only when both the judge and deterministic checks pass.

The judge sees the task, rubric, and candidate answer. It does not see the strategy name, model identities, cost, or latency. Judge calls are tracked separately and excluded from workflow cost.

Model judging is still a proxy. For publishable results, manually review a stratified sample and report judge/human agreement.

## Cost

Workflow cost is computed from provider-reported input/output token usage and explicit per-million-token prices in the benchmark config. Loom never fills unknown prices. If any invoked model lacks pricing, dollar cost and cost index remain unavailable.

The JSON report contains every model reference, input token count, output token count, and derived call cost. Pricing should be timestamped because provider prices change.

Dot credit receipts may also be present in runtime traces, but credits are not silently converted to USD.

If all runs return native provider payment receipts, Loom reports average provider-unit cost and derives the cost index from that unit. Judge receipts are reported separately and never included in workflow cost.

## Latency

P95 latency is calculated over end-to-end workflow duration. Fixed and adaptive worker steps are currently sequential, so orchestration can improve quality or cost while increasing latency. Parallel benchmark execution (`--concurrency`) shortens the benchmark wall clock; it does not change a workflow's internal scheduler.

Provider load, network location, cold starts, rate limits, and cache state affect latency. Use multiple iterations and publish the execution environment.

## Publication checklist

Before making a performance claim:

1. Freeze the dataset revision and publish it.
2. Record exact provider/model identifiers and the run date.
3. Record the pricing source and snapshot date.
4. Use at least three iterations for stochastic providers.
5. Use temperature zero where supported, or disclose it.
6. Use an independent, blinded judge and manually audit a sample.
7. Publish raw JSON, not only a screenshot.
8. Include cases where the baseline wins.
9. Separate exploratory smoke results from confirmatory benchmarks.
10. Avoid transferring results to other task distributions.

## Public suites

### `code-review-v1`

Fifteen adversarial API/backend review scenarios covering:

- billing and ledger correctness;
- authorization and tenant isolation;
- retries, replay, and idempotency;
- privacy and observability;
- OAuth, webhooks, uploads, and SSRF;
- prompt injection and tool permissions;
- audit-log integrity.

The suite contains synthetic specifications, not production secrets. Its deterministic checks measure concept coverage, not exploit correctness by themselves. Use the included rubrics and an independent judge for stronger evidence.

## Commands

Deterministic local validation:

```bash
npm run eval:mock
```

Shareable report:

```bash
node src/cli.mjs eval \
  --dataset evals/code-review-v1.jsonl \
  --config examples/dot-code.config.json \
  --strategies baseline,fixed,adaptive \
  --iterations 3 \
  --concurrency 3 \
  --judge-model dot/your-independent-judge \
  --output reports/code-review-v1.html
```

Generate JSON, Markdown, HTML, and SVG together:

```bash
node src/cli.mjs eval \
  --dataset evals/code-review-v1.jsonl \
  --config examples/dot-code.config.json \
  --limit 3 \
  --artifacts reports/code-review-smoke
```

Raw evidence:

```bash
node src/cli.mjs eval \
  --dataset evals/code-review-v1.jsonl \
  --config examples/dot-code.config.json \
  --judge-model dot/your-independent-judge \
  --include-answers \
  --json > reports/code-review-v1.json
```
