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
- Loom connection: the Ministral conductor research track now tests learned strategy depth and role assignment; production work still needs continual calibration from measured traces.

### BEST-Route

Jitkrittum et al. route both the model and the number of generated samples from query difficulty and a quality threshold. The paper reports up to 60% cost reduction with less than a 1% performance drop in its evaluated settings.

- Paper: [BEST-Route: Adaptive LLM Routing with Test-Time Optimal Compute](https://arxiv.org/abs/2506.22716)
- Loom connection: treat direct, sample-and-select, verify, and strict review as separate computation strategies.

### R2-Router

Xue et al. model output length as a controllable routing variable and jointly select model and length budget.

- Paper: [R2-Router: A New Paradigm for LLM Routing with Reasoning](https://openreview.net/forum?id=S3m1tSp8F4)
- Loom connection: route output-token ceilings alongside strategy depth.

### CONCUR

Chen et al. train modular predictors per computation strategy, supporting constrained routing and adding strategies without full retraining. The ICLR 2026 paper reports higher end-to-end accuracy and lower inference cost than the evaluated single strategies and routing baselines.

- Paper: [CONCUR: A Framework for Continual Constrained and Unconstrained Routing](https://openreview.net/forum?id=gCUY6QIv8r)
- Loom connection: one predictor per Loom strategy, selected under call, cost, and latency constraints.

### Selective Deferred Routing

This ICML 2026 work studies a local small model that answers first and selectively defers to a remote model.

- Paper: [Selective Deferred Routing for Efficient Hybrid Inference](https://openreview.net/forum?id=CEKKZtZtqX)
- Loom connection: hybrid local-first execution without paying a hosted router for every request.

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

### AFlow

Zhang et al. formulate code-represented workflow optimization as a search problem and use execution feedback to refine graph structure. Their reported experiments show an average improvement over evaluated baselines and cases where smaller models outperform GPT-4o at much lower dollar cost.

- Paper: [AFlow: Automating Agentic Workflow Generation](https://arxiv.org/abs/2410.10762)
- Loom connection: optimize workflows offline on a training split, then freeze and evaluate them on held-out cases.

## Evaluation reliability

### Position and self-preference bias

LLM judges can prefer candidates because of prompt position or familiarity with a model family's output style rather than task correctness.

- Paper: [Judging the Judges: A Systematic Study of Position Bias in LLM-as-a-Judge](https://arxiv.org/abs/2406.07791)
- Paper: [Self-Preference Bias in LLM-as-a-Judge](https://arxiv.org/abs/2410.21819)
- Loom connection: randomize pairwise candidate order, keep strategy/model identity hidden, calibrate on a human-reviewed sample, and report uncertainty.

## Agent security

### AgentDojo

Debenedetti et al. introduce an extensible environment with realistic tasks and hundreds of security cases for indirect prompt injection against tool-using agents.

- Paper: [AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents](https://arxiv.org/abs/2406.13352)
- Loom connection: tool access must be explicitly scoped and tested against untrusted retrieved content before Loom grows autonomous tool execution.

## Interpretation boundary

These studies establish that routing, cascades, aggregation, and refinement can improve a cost/quality frontier under particular experimental conditions. They do not establish that adding workers always helps. Extra calls can increase latency, token duplication, and failure surface. Dot Loom exists to make that trade-off visible and reproducible for a user's own workload.

Research findings verified against primary paper and conference pages on 2026-07-14. Reported gains remain benchmark-specific and must not be presented as Dot Loom results until reproduced in this repository.
