# Dot Loom evaluation

Dataset: evals/adaptive-routing-v1.jsonl
Cases: 24 · Iterations: 1

| Strategy | Quality (95% CI) | Avg calls | One-call rate | Escalation | Route accuracy | Avg cost/run | Cost index | P95 latency | Pass rate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Single-model baseline | 5.9% (1.1%–10.7%) | 1.00 | 100.0% | — | — | $0.000000 | — | 0.06s | 0.0% |
| Loom lean | 5.9% (1.1%–10.7%) | 1.00 | 100.0% | 0.0% | 33.3% | $0.000000 | — | 0.06s | 0.0% |
| Loom balanced | 10.1% (2.1%–18.1%) | 1.67 | 33.3% | 66.7% | 100.0% | $0.000000 | — | 0.12s | 0.0% |
| Loom strict | 5.9% (1.1%–10.7%) | 3.00 | 0.0% | 100.0% | 66.7% | $0.000000 | — | 0.19s | 0.0% |
| Loom fixed | 5.9% (1.1%–10.7%) | 4.00 | 0.0% | — | — | $0.000000 | — | 0.25s | 0.0% |

Quality and pass rate come from deterministic dataset checks. Cost uses provider receipts when present; USD requires explicit pricing for every invoked workflow model.
