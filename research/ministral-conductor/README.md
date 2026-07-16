# Dot Loom Conductor Research Run

We trained `mistralai/Ministral-3-14B-Base-2512` to decide when one AI model is enough
and when a task needs independent verification.

Given a task, measured worker profiles, and hard call, credit, and latency limits,
the conductor emits a constrained JSON execution plan:

- `lean`: one writer call
- `balanced`: writer plus independent reviewer
- `strict`: writer, critic, and finalizer

The output names the writer, reviewer, and finalizer, sets per-request budgets,
estimates quality and pass rate, states whether verification is independent, and
limits which prior outputs each role may access.

## Research design

- Base model: Ministral 3 14B Base at pinned revision `5b0ceedbb42dff466ae60b258ba296f32da51384`
- Corpus: 9,000 train, 900 validation, and 1,200 held-out test examples
- Privacy: no user prompts, wallets, API keys, or production conversations
- Labels: exhaustive constrained search over every valid one, two, and three-call plan
- Calibration: frozen Dot Loom cross-model quality, pass-rate, credit, and latency receipts
- Generalization: all eight test families are absent from train and validation
- Training: rank-32 LoRA in BF16 on one NVIDIA H200

An initial independent label audit exposed an optimistic reviewer and finalizer model.
We fixed the oracle before training, regenerated the full corpus, and repeated the
audit. The final 90-label blinded OpenAI audit agreed with 76 labels. It proposed 14
alternatives; deterministic validation found 3 feasible and 11 invalid or over-budget.
None of the three feasible alternatives improved the disclosed oracle utility. The raw
judge output and validation results are preserved.

The comparison has four lanes:

1. Current deterministic Loom router
2. Base Ministral 14B
3. Dot-trained Ministral 14B conductor
4. Dot-trained conductor with local validation and deterministic fallback

The benchmark uses all 1,200 held-out examples and reports JSON and schema validity,
runtime-recomputed execution-receipt consistency, quality and pass-rate estimate error,
hard-constraint compliance, policy accuracy, exact plan match, quality-target attainment,
utility regret, unsafe under-escalation, latency, and results for every held-out family.

## Verify it on the rented server

```bash
cd /home/sesterce/dot-loom-conductor
demo/00_show_machine.sh
demo/01_show_corpus.sh
demo/02_show_training.sh
demo/03_show_benchmark.sh
demo/04_live_route.sh payment-race
demo/05_verify_artifacts.sh
```

`demo/04_live_route.sh` also accepts `low-risk`, `ssrf`, and `all`. The live preset maps
anonymous training roles to recognizable example lanes: local Ministral, Claude, and
OpenAI. The conductor itself remains model and provider agnostic.

The retained live receipt makes the routing contrast concrete:

- Low-risk rewrite: Lean, one local Ministral call, 0.15 estimated credits
- Payment race: Strict, local Ministral writes, Claude reviews, OpenAI finalizes
- SSRF audit: Strict, local Ministral writes, Claude reviews, OpenAI finalizes

The runtime independently recomputes every call, credit, latency, and access-list field
before accepting the proposal.

Artifacts include raw JSONL predictions, per-family scores, GPU telemetry, training
logs, adapter hashes, charts, source snapshots, and copy-paste demo scripts. See
[`docs/METHODS.md`](docs/METHODS.md) for the full protocol and limitations.
