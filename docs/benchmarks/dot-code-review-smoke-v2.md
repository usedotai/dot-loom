# Dot Loom evaluation

Dataset: evals/code-review-v1.jsonl
Cases: 3 · Iterations: 1

| Strategy | Quality (95% CI) | Avg calls | One-call rate | Escalation | Route accuracy | Avg cost/run | Cost index | P95 latency | Pass rate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Single-model baseline | 100.0% (100.0%–100.0%) | 1.00 | 100.0% | — | — | 1.00 cr | 100.0 | 53.56s | 66.7% |
| Loom balanced | 100.0% (100.0%–100.0%) | 2.00 | 0.0% | 100.0% | — | 2.00 cr | 200.0 | 58.11s | 66.7% |
| Loom fixed | 98.3% (95.1%–100.0%) | 4.00 | 0.0% | — | — | 4.00 cr | 400.0 | 85.19s | 66.7% |

Quality uses judge dot/dot-gemma-4-uncensored; deterministic checks remain required for pass rate. Cost uses provider receipts when present; USD requires explicit pricing for every invoked workflow model.
