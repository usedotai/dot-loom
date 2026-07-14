# Research behind Dot Loom

Dot Loom applies ideas from model routing, cascades, multi-model aggregation, critique, and graph optimization. The results below are reported by the cited authors on their own tasks and model sets. They are not Dot Loom benchmark results and are not directly comparable with one another.

## Routing and cost-aware cascades

### FrugalGPT

Chen, Zaharia, and Zou describe prompt adaptation, model approximation, and learned LLM cascades. Their experiments report matching the best individual LLM with up to 98% lower cost, or improving accuracy over GPT-4 by 4% at the same cost.

- Paper: [FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance](https://arxiv.org/abs/2305.05176)
- Loom connection: adaptive escalation and explicit cost/quality evaluation.

### RouteLLM

Ong et al. train routers from preference data to select between stronger and weaker models. Their ICLR 2025 paper reports more than 2× cost reduction in some settings without sacrificing response quality.

- Paper: [RouteLLM: Learning to Route LLMs with Preference Data](https://arxiv.org/abs/2406.18665)
- Code: [lm-sys/RouteLLM](https://github.com/lm-sys/RouteLLM)
- Loom connection: future learned routing policies calibrated from benchmark traces.

## Multi-model aggregation

### Mixture-of-Agents

Wang et al. pass outputs from multiple agents into subsequent aggregation layers. The paper reports an AlpacaEval 2.0 score of 65.1 for its open-source MoA configuration versus 57.5 for GPT-4 Omni in that evaluation.

- Paper: [Mixture-of-Agents Enhances Large Language Model Capabilities](https://arxiv.org/abs/2406.04692)
- Loom connection: specialist drafts, verification, and synthesis across providers.

### LLM-Blender

Jiang, Ren, and Lin combine pairwise ranking with generative fusion and report gains over individual LLMs and baseline ensemble methods on their MixInstruct evaluation.

- Paper: [LLM-Blender: Ensembling Large Language Models with Pairwise Ranking and Generative Fusion](https://arxiv.org/abs/2306.02561)
- Loom connection: candidate ranking and evidence-aware finalization are plausible future pipeline types.

## Feedback and refinement

### Self-Refine

Madaan et al. alternate generation, feedback, and refinement without weight updates. Across seven evaluated tasks, the paper reports roughly 20 percentage points of absolute improvement on average using human preference and automatic metrics.

- Paper: [Self-Refine: Iterative Refinement with Self-Feedback](https://arxiv.org/abs/2303.17651)
- Loom connection: explicit drafter → critic → finalizer structure.

### Reflexion

Shinn et al. use verbal feedback and episodic memory to improve agent behavior across sequential decision-making, reasoning, and programming tasks.

- Paper: [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)
- Loom connection: future trace learning and regression memory.

## Optimizable orchestration graphs

### Language Agents as Optimizable Graphs

Zhuge et al. represent language-agent systems as computational graphs and optimize both node prompts and graph connectivity.

- Paper: [Language Agents as Optimizable Graphs](https://arxiv.org/abs/2402.16823)
- Loom connection: evolving role maps and prompt policies from measured outcomes.

## Interpretation boundary

These studies establish that routing, cascades, aggregation, and refinement can improve a cost/quality frontier under particular experimental conditions. They do not establish that adding workers always helps. Extra calls can increase latency, token duplication, and failure surface. Dot Loom exists to make that trade-off visible and reproducible for a user's own workload.

Research findings verified against primary paper abstracts/pages on 2026-07-14.
