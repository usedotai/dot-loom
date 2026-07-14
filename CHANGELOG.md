# Changelog

All notable changes to Dot Loom are documented here. Benchmark results are linked to raw receipts and remain scoped to their stated datasets, models, and run settings.

## 0.2.0 - 2026-07-14

Dot Loom 0.2 replaces the original always-on four-call adaptive workflow with budgeted, routerless execution.

### Added

- `lean`, `balanced`, and `strict` adaptive policies with default ceilings of one, two, and three provider calls.
- Hard pre-step limits for calls, estimated credits, and wall-clock latency.
- Provider request cancellation and benchmark-wide cancellation after a failed concurrent job.
- Selective verifier-editor execution: balanced mode returns the reviewed final answer without paying for a separate finalizer.
- Local risk profiling for security, identity, money, privacy, concurrency, research, and production-code signals.
- Per-run escalation reasons, budget state, model usage, and hashed workflow receipts.
- `adaptive-routing-v1`: 24 frozen low-, medium-, and high-difficulty cases with expected-escalation labels.
- Confidence intervals, average call count, one-call rate, escalation rate, route accuracy, and budget-limit rate in benchmark reports.
- Reproducible research figures and CSV extracts generated from committed JSON receipts.
- A six-case single-model baseline study covering OpenAI GPT-5.5, Claude Sonnet 5, and Dot Qwen Coder 480B, with all answers and judge reasons published.
- Model-specific credit reservations through `adaptive.estimatedCreditsByModel`.
- A reproducible six-lane cross-model benchmark runner for both OpenAI and Claude review directions plus a three-model strict lane.
- Studio policy controls and measured `calls / cap` output.
- Public-package metadata for `@usedot/loom@0.2.0`; the package has not yet been published to npm.

### Changed

- Adaptive mode no longer makes a paid router call.
- Balanced high-risk execution changed from router → drafter → critic → finalizer to direct answer → verifier-editor.
- Studio no longer displays a hard-coded savings percentage.
- Tablet and mobile Studio layouts place the process stream in document flow instead of covering the network graph.
- Benchmark failures now abort remaining in-flight jobs instead of allowing concurrent workers to continue spending.
- Credit preflight now prices the next planned model instead of assuming every provider call has the same native-unit cost.

### Exploratory evidence

The `v0.2` smoke receipt contains three high-risk synthetic code-review cases, one iteration, one provider, and one model judge:

| Strategy | Judge quality | Calls | Provider credits | P95 latency | Pass rate |
|---|---:|---:|---:|---:|---:|
| Baseline | 100.0% | 1 | 1 | 53.56s | 66.7% |
| Balanced | 100.0% | 2 | 2 | 58.11s | 66.7% |
| Fixed | 98.3% | 4 | 4 | 85.19s | 66.7% |

Balanced halved calls and credits relative to fixed review and reduced P95 latency by approximately 32%. It did not outperform the baseline and cost twice as much. Judge calls averaged one additional credit and are excluded from workflow cost.

- [Raw JSON receipt](docs/benchmarks/dot-code-review-smoke-v2.json)
- [Benchmark methodology](docs/BENCHMARKING.md)
- [Research figure](docs/figures/v02-cost-quality.svg)
- [Figure data](docs/figures/v02-smoke-summary.csv)

### Limitations

- The smoke result is exploratory, not a general performance claim.
- The judge model also served as the critic in orchestrated strategies, creating a possible self-preference dependency despite strategy blinding.
- Current multi-model execution is sequential; parallel independent critics are not implemented.
- Routing is deterministic and local; a learned continual router remains future work.
- Claude currently connects through OpenRouter or another OpenAI-compatible gateway; a native Anthropic adapter is not included.

## 0.1.0 - 2026-07-14

- Initial fixed and adaptive orchestration scaffold.
- Dot, OpenAI-compatible, Ollama, and deterministic mock providers.
- CLI and Studio traces.
- Baseline, fixed, and adaptive evaluation harness.
- Historical three-case smoke receipt showing that the original adaptive strategy still used four calls.
