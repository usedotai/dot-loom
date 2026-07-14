# Dot Loom evaluation

Dataset: evals/code-review-v1.jsonl
Cases: 3 · Iterations: 1

| Strategy | Quality | Avg cost/run | Cost index | P95 latency | Pass rate |
|---|---:|---:|---:|---:|---:|
| Single-model baseline | 96.7% | 1.00 cr | 100.0 | 22.70s | 66.7% |
| Loom fixed | 100.0% | 4.00 cr | 400.0 | 88.77s | 100.0% |
| Loom adaptive | 98.3% | 4.00 cr | 400.0 | 82.25s | 66.7% |

Quality uses judge dot/dot-gemma-4-uncensored; deterministic checks remain required for pass rate. Cost uses provider receipts when present; USD requires explicit pricing for every invoked workflow model.
