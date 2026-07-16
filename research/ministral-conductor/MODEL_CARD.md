# Dot Loom Ministral 14B Conductor

## Model description

This is a rank-32 LoRA adapter for `mistralai/Ministral-3-14B-Base-2512`. It emits
structured Dot Loom execution plans. It does not answer the underlying user task.

Inputs describe:

- Task risk, complexity, consequence, ambiguity, evidence need, and reversibility
- Candidate worker quality, pass rate, provider group, strengths, credit cost, and p95 latency
- Hard maximums for calls, credits, and latency
- A target minimum quality

Outputs describe:

- Lean, Balanced, or Strict execution depth
- Writer, reviewer, and finalizer role assignments
- Estimated credits, latency, combined quality, and pass rate
- Independent verification state
- Per-role access to prior outputs
- Machine-readable routing reason codes

## Intended use

- Research on model-agnostic inference orchestration
- Offline comparison with deterministic routers
- Local demonstrations of cost, quality, latency, and verification trade-offs
- Experimental policy proposals that remain subject to runtime budget enforcement

## Out-of-scope use

- Treating predicted quality as a production guarantee
- Executing financial, health, legal, security, or infrastructure changes without review
- Selecting tools or granting permissions without a separate authorization layer
- Reconstructing worker brand identity from anonymous capability profiles

## Training data

The adapter was trained on 9,000 deterministic synthetic examples and validated on 900
examples from disjoint task families. No user prompts, wallets, API keys, private code, or
production conversations were used.

Labels come from an exhaustive constrained plan search calibrated to a frozen six-case
Dot Loom cross-model receipt. The full generator, manifest, label audit, and limitations
are in `docs/METHODS.md`.

## Training procedure

- Base revision: `5b0ceedbb42dff466ae60b258ba296f32da51384`
- BF16 LoRA on one NVIDIA H200
- Rank 32, alpha 64, dropout 0.05
- Attention and MLP projection targets
- Two epochs, cosine schedule, five percent warmup
- Seed `20260716`
- Final adapter selected by lowest validation loss among saved checkpoints

Exact parameters, losses, hashes, GPU telemetry, and adapter receipts are stored under
`receipts/`.

## Evaluation

The adapter is evaluated against the raw base checkpoint and a deterministic Loom-style
router on 1,200 held-out examples across eight unseen task families. Raw predictions,
per-family metrics, paired confidence intervals, charts, and the benchmark report are
stored under `reports/` and `charts/`.

## Limitations

This model learns a disclosed synthetic oracle. It may reproduce that oracle's assumptions
and errors. The worker profiles are numerical abstractions, and their quality estimates
can drift. A runtime must enforce hard budgets independently of model output and fall back
when JSON or role validation fails.

## License

The base model and this research code use Apache-2.0-compatible terms. Verify the base
model license and any downstream provider terms before redistribution.
