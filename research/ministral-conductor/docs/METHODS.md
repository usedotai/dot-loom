# Methods

## Research question

Can a locally hosted 14B model learn to allocate inference depth across Lean, Balanced,
and Strict plans while respecting call, credit, and latency limits?

This benchmark measures routing-plan quality. It does not claim that a synthetic quality
estimate is a substitute for end-to-end production evaluation.

## Model and machine

- `mistralai/Ministral-3-14B-Base-2512`
- Pinned Hugging Face revision: `5b0ceedbb42dff466ae60b258ba296f32da51384`
- Apache-2.0 model license
- One NVIDIA H200 SXM5 with 143,771 MiB reported VRAM
- BF16 LoRA applied to attention and MLP projection layers
- Rank 32, alpha 64, dropout 0.05
- Seed `20260716`
- Final adapter selected by lowest validation loss among saved checkpoints

The machine, model shard, source, dataset, adapter, and benchmark outputs have SHA-256
receipts. GPU utilization, memory, power, and temperature are sampled every two seconds.

## Corpus

The v2 corpus contains 11,100 examples:

- Train: 9,000
- Validation: 900
- Test: 1,200

Each split is balanced across Lean, Balanced, and Strict labels. Task families are
disjoint across splits. The held-out test families are payment races, tenant isolation,
webhook replay, OAuth integrity, SSRF egress, streaming settlement, health triage, and
contract risk.

The corpus contains no user prompts. Task descriptions are synthetic. Worker identities
are anonymized and shuffled so the model must route using measured capability, pass-rate,
cost, latency, provider independence, and task-risk fields.

## Empirical anchors

Worker profiles are sampled around three frozen Dot Loom benchmark anchors:

- Frontier high-quality lane: quality 1.00, pass rate 1.00, 12.6667 credits
- Efficient frontier lane: quality 0.8833, pass rate 0.8333, 3.5 credits
- Low-cost specialist lane: quality 0.70, pass rate 0.50, 1.0 credit

These anchors come from six frozen backend cases. The benchmark does not present them as
universal model rankings.

## Label oracle

For every example, the generator enumerates every valid role assignment:

- Lean: three possible one-writer plans
- Balanced: six ordered writer-reviewer plans
- Strict: six ordered writer-reviewer-finalizer plans

Hard feasibility checks apply to calls, credits, and latency. `minimum_quality` is an
optimization target because it can be unattainable under a hard budget.

The v2 outcome model includes:

- Difficulty-adjusted writer quality and pass rate
- Reliability-weighted review benefit
- Reviewer regression risk
- Independent-provider verification benefit
- Final-answer synthesis blended with finalizer capability
- Penalties for weak reviewer reliability and weak finalizer output quality
- Cost, latency, call-depth, reversibility, evidence, risk, and consequence terms

The highest-utility feasible plan becomes the training label. If any feasible plan meets
the quality target, below-target candidates are excluded.

## Independent label audit

The audit samples 90 stratified train and validation labels. Test labels are never sent to
the judge. Worker and provider brands remain hidden.

The judge must return a structured function call. A disagreement must name a complete
alternative policy, writer, reviewer, and finalizer. A deterministic validator then checks
role uniqueness plus call, credit, and latency feasibility.

Final audit result:

- Raw agreement: 76 of 90, 84.44%
- Judge disagreements: 14
- Feasible alternative plans: 3
- Invalid or over-budget alternatives: 11
- Alternatives that improved the disclosed oracle utility: 0

The audit model is an independent critic, not ground truth. Raw responses are retained so
the audit can be challenged.

## Evaluation

The same 1,200 held-out examples are evaluated in four lanes:

1. Current deterministic Loom-style router
2. Raw base Ministral 14B
3. Dot-trained Ministral 14B conductor
4. Dot-trained conductor with local hard-budget validation and deterministic fallback

The deterministic lane cannot inspect the oracle. It selects execution depth from static
risk and evidence thresholds, then assigns roles from capability tags. The learned model
receives the same task, constraints, and worker profiles as text and must emit one JSON
plan.

Generation uses greedy decoding, batch size 96, and a 180-token output ceiling. The longest
canonical target in the held-out set is 159 tokens, so the ceiling leaves headroom without
paying for unlimited continuation from the raw Base checkpoint.

Primary metrics:

- JSON validity
- Complete output-schema validity
- Plan validity
- Agreement between declared receipt fields and runtime-recomputed calls, credits, latency, verification, and access lists
- Mean and p95 absolute error for declared quality and pass-rate estimates
- Hard-constraint compliance
- Policy accuracy
- Exact role-plan match
- Quality-target attainment
- Mean and p95 utility regret
- Unsafe under-escalation
- P50 and p95 batched inference latency

All raw predictions are scored after generation. Invalid output receives a large fixed
utility penalty and cannot pass constraints.

The guarded lane preserves every raw proposal in its receipt. It falls back only when JSON
or role validation fails, or when runtime-recomputed calls, credits, or latency exceed a
hard limit. This is the deployment boundary: a learned policy proposes, deterministic code
enforces.

## Limitations

- Labels come from a disclosed simulator rather than measured execution of all 15 plans.
- The empirical anchor has six cases and should be expanded.
- Synthetic task descriptors are simpler than full production prompts.
- Estimated quality and pass rate depend on the stated oracle assumptions.
- The held-out benchmark measures routing-plan generation, not final code correctness.
- One seed, one base checkpoint, and one H200 training run do not establish broad scaling
  laws.

The repository includes enough raw data, source, and receipts to reproduce or replace any
of these assumptions.
