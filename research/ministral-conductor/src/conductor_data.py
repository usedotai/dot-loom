from __future__ import annotations

import hashlib
import json
import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


POLICIES = ("lean", "balanced", "strict")
WORKER_IDS = ("worker_a", "worker_b", "worker_c")
SCHEMA_VERSION = "loom-conductor-v2"

# Frozen empirical anchors from dot-loom/docs/benchmarks/cross-model-baselines-v1.json.
# Model names never appear in training prompts. Worker identifiers are shuffled so the
# student must route from measured capabilities and constraints instead of memorizing a brand.
EMPIRICAL_ANCHORS = (
    {
        "anchor": "frontier_high",
        "quality": 1.0,
        "pass_rate": 1.0,
        "credits": 12.6667,
        "latency_ms": 72_371,
        "strengths": ("implementation", "reasoning", "synthesis"),
    },
    {
        "anchor": "frontier_efficient",
        "quality": 0.8833,
        "pass_rate": 0.8333,
        "credits": 3.5,
        "latency_ms": 64_730,
        "strengths": ("review", "reasoning", "writing"),
    },
    {
        "anchor": "specialist_low_cost",
        "quality": 0.7,
        "pass_rate": 0.5,
        "credits": 1.0,
        "latency_ms": 25_862,
        "strengths": ("drafting", "coding", "speed"),
    },
)


@dataclass(frozen=True)
class Family:
    name: str
    split: str
    category: str
    risk: tuple[float, float]
    complexity: tuple[float, float]
    consequence: tuple[float, float]
    ambiguity: tuple[float, float]
    evidence_need: tuple[float, float]
    reversibility: tuple[float, float]
    templates: tuple[str, ...]


FAMILIES = (
    Family("direct_facts", "train", "general", (0.02, 0.2), (0.05, 0.35), (0.02, 0.2), (0.02, 0.25), (0.02, 0.25), (0.75, 1.0), (
        "Return a concise explanation of {topic} for an internal glossary.",
        "Convert {count} units and state the result without extra analysis.",
        "Summarize the supplied release note in {count} bullets.",
    )),
    Family("content_revision", "train", "writing", (0.05, 0.25), (0.2, 0.5), (0.05, 0.3), (0.15, 0.45), (0.05, 0.3), (0.8, 1.0), (
        "Rewrite a {topic} announcement for a technical audience while preserving facts.",
        "Tighten a product explanation about {topic} to {count} words.",
        "Edit documentation for {topic} and remove ambiguous language.",
    )),
    Family("feature_implementation", "train", "coding", (0.25, 0.6), (0.45, 0.85), (0.25, 0.65), (0.2, 0.55), (0.25, 0.65), (0.45, 0.8), (
        "Implement {topic} in an existing service and include regression tests.",
        "Design an API for {topic} with validation and failure handling.",
        "Patch a production bug involving {topic} without breaking compatibility.",
    )),
    Family("debugging", "train", "coding", (0.3, 0.7), (0.45, 0.9), (0.25, 0.7), (0.35, 0.8), (0.35, 0.75), (0.4, 0.75), (
        "Diagnose an intermittent failure in {topic} from logs and propose a minimal fix.",
        "Find the root cause of a concurrency-sensitive {topic} regression.",
        "Explain why {topic} fails only under load and define a verification plan.",
    )),
    Family("research_synthesis", "train", "research", (0.2, 0.55), (0.45, 0.9), (0.2, 0.6), (0.45, 0.9), (0.6, 1.0), (0.7, 1.0), (
        "Compare evidence for {topic} and separate findings from inference.",
        "Review competing approaches to {topic} and identify uncertain claims.",
        "Produce a decision memo about {topic} using cited measurements.",
    )),
    Family("data_analysis", "train", "analysis", (0.15, 0.5), (0.35, 0.8), (0.2, 0.65), (0.25, 0.7), (0.35, 0.8), (0.65, 0.95), (
        "Analyze a dataset about {topic}, detect anomalies, and explain limitations.",
        "Compare two experiments on {topic} and recommend the next measurement.",
        "Interpret a noisy metric shift in {topic} without overstating causality.",
    )),
    Family("incident_response", "train", "operations", (0.55, 0.95), (0.5, 0.95), (0.55, 1.0), (0.35, 0.8), (0.5, 0.95), (0.15, 0.55), (
        "Plan immediate containment and recovery for a {topic} production incident.",
        "Review an outage involving {topic} and identify unsafe recovery steps.",
        "Prioritize actions during a live {topic} degradation with incomplete telemetry.",
    )),
    Family("product_tradeoff", "train", "decision", (0.1, 0.45), (0.3, 0.75), (0.2, 0.65), (0.35, 0.8), (0.25, 0.7), (0.55, 0.9), (
        "Choose an implementation strategy for {topic} under a fixed budget.",
        "Evaluate build-versus-buy options for {topic} using explicit assumptions.",
        "Recommend whether to launch {topic} given mixed experiment results.",
    )),
    Family("migration_planning", "validation", "coding", (0.35, 0.75), (0.55, 0.95), (0.4, 0.85), (0.3, 0.75), (0.4, 0.85), (0.25, 0.65), (
        "Plan a zero-downtime migration of {topic} with rollback checkpoints.",
        "Review a staged migration for {topic} and identify irreversible steps.",
        "Design compatibility testing for a {topic} schema migration.",
    )),
    Family("performance_tuning", "validation", "analysis", (0.2, 0.6), (0.45, 0.9), (0.25, 0.7), (0.3, 0.75), (0.3, 0.75), (0.55, 0.9), (
        "Diagnose latency variance in {topic} and rank the next experiments.",
        "Review a proposed optimization for {topic} for hidden regressions.",
        "Choose between throughput and tail-latency changes for {topic}.",
    )),
    Family("policy_compliance", "validation", "review", (0.45, 0.85), (0.4, 0.85), (0.5, 0.95), (0.35, 0.8), (0.55, 0.95), (0.3, 0.7), (
        "Review whether {topic} satisfies a documented retention policy.",
        "Audit a workflow for {topic} against explicit access requirements.",
        "Identify evidence required before approving {topic} for production.",
    )),
    Family("payment_races", "test", "financial", (0.75, 1.0), (0.6, 1.0), (0.8, 1.0), (0.35, 0.8), (0.6, 1.0), (0.05, 0.4), (
        "Review a {topic} flow for concurrent debit, retry, and settlement failures.",
        "Design exact-once accounting for {topic} under crashes and replays.",
        "Audit refund semantics for {topic} when responses are lost.",
    )),
    Family("tenant_isolation", "test", "security", (0.8, 1.0), (0.55, 0.95), (0.8, 1.0), (0.3, 0.75), (0.65, 1.0), (0.1, 0.45), (
        "Audit {topic} for cross-tenant data exposure and authorization ordering.",
        "Review cache isolation for {topic} before deployment.",
        "Prove that {topic} cannot expose one tenant's records to another.",
    )),
    Family("webhook_replay", "test", "security", (0.75, 1.0), (0.55, 0.95), (0.7, 1.0), (0.3, 0.75), (0.6, 1.0), (0.15, 0.5), (
        "Review {topic} signature verification, replay defense, and retries.",
        "Design idempotent processing for {topic} with adversarial delivery.",
        "Audit raw-body validation and freshness controls in {topic}.",
    )),
    Family("oauth_integrity", "test", "identity", (0.75, 1.0), (0.55, 0.95), (0.75, 1.0), (0.35, 0.8), (0.65, 1.0), (0.1, 0.45), (
        "Audit {topic} for state, PKCE, redirect, and replay failures.",
        "Review account linking in {topic} for login confusion attacks.",
        "Design a secure callback flow for {topic} across browser restarts.",
    )),
    Family("ssrf_egress", "test", "security", (0.8, 1.0), (0.6, 1.0), (0.75, 1.0), (0.4, 0.85), (0.7, 1.0), (0.1, 0.45), (
        "Audit {topic} for SSRF, redirect, DNS rebinding, and metadata access.",
        "Design egress controls for user-supplied {topic} destinations.",
        "Review resolution-time IP validation for {topic}.",
    )),
    Family("stream_settlement", "test", "financial", (0.75, 1.0), (0.65, 1.0), (0.8, 1.0), (0.4, 0.85), (0.65, 1.0), (0.05, 0.4), (
        "Define correct {topic} billing when clients disconnect mid-stream.",
        "Audit reservation, partial settlement, and reconciliation for {topic}.",
        "Design failure-injection tests for streamed {topic} charges.",
    )),
    Family("health_triage", "test", "health", (0.8, 1.0), (0.35, 0.8), (0.9, 1.0), (0.45, 0.9), (0.7, 1.0), (0.05, 0.3), (
        "Prepare a cautious triage response for {topic} with incomplete history.",
        "Review a health guidance draft about {topic} for unsafe certainty.",
        "Decide what independent verification is required for {topic} advice.",
    )),
    Family("contract_risk", "test", "legal", (0.7, 1.0), (0.45, 0.9), (0.75, 1.0), (0.45, 0.9), (0.65, 1.0), (0.1, 0.4), (
        "Review a contract clause about {topic} and identify unresolved exposure.",
        "Compare interpretations of {topic} without presenting inference as law.",
        "Decide when {topic} requires independent professional verification.",
    )),
)

TOPICS = (
    "credit reservation", "tenant-scoped caching", "webhook delivery", "OAuth callbacks",
    "streaming inference", "database failover", "API-key rotation", "background jobs",
    "model routing", "data retention", "observability", "rate limiting", "prompt caching",
    "artifact storage", "deployment rollback", "usage metering", "private credentials",
    "provider failover", "schema evolution", "access control",
)


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def rounded(value: float, digits: int = 4) -> float:
    return round(float(value), digits)


def stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sample_range(rng: random.Random, bounds: tuple[float, float]) -> float:
    return rng.uniform(*bounds)


def make_task(rng: random.Random, family: Family, index: int) -> dict[str, Any]:
    topic = rng.choice(TOPICS)
    count = rng.choice((3, 4, 5, 7, 10, 12))
    summary = rng.choice(family.templates).format(topic=topic, count=count)
    return {
        "family": family.name,
        "category": family.category,
        "summary": summary,
        "risk": rounded(sample_range(rng, family.risk)),
        "complexity": rounded(sample_range(rng, family.complexity)),
        "consequence": rounded(sample_range(rng, family.consequence)),
        "ambiguity": rounded(sample_range(rng, family.ambiguity)),
        "evidence_need": rounded(sample_range(rng, family.evidence_need)),
        "reversibility": rounded(sample_range(rng, family.reversibility)),
        "input_tokens": rng.randrange(120, 8_001, 40),
        "request_id": f"synthetic-{family.name}-{index:06d}",
    }


def make_workers(rng: random.Random, category: str) -> list[dict[str, Any]]:
    anchors = list(EMPIRICAL_ANCHORS)
    rng.shuffle(anchors)
    providers = ["provider_x", "provider_y", "provider_z"]
    rng.shuffle(providers)
    workers: list[dict[str, Any]] = []
    category_strength = {
        "coding": "coding",
        "security": "reasoning",
        "financial": "reasoning",
        "identity": "reasoning",
        "research": "synthesis",
        "writing": "writing",
        "analysis": "reasoning",
    }.get(category, "drafting")
    for worker_id, provider, anchor in zip(WORKER_IDS, providers, anchors):
        strengths = list(anchor["strengths"])
        fit_bonus = 0.04 if category_strength in strengths else -0.025
        quality = clamp(anchor["quality"] + fit_bonus + rng.uniform(-0.065, 0.065), 0.35, 0.995)
        pass_rate = clamp(anchor["pass_rate"] + fit_bonus + rng.uniform(-0.09, 0.08), 0.2, 0.995)
        credits = max(0.25, anchor["credits"] * rng.uniform(0.78, 1.22))
        latency_ms = max(4_000, int(anchor["latency_ms"] * rng.uniform(0.68, 1.28)))
        if rng.random() < 0.32 and category_strength not in strengths:
            strengths.append(category_strength)
        workers.append({
            "id": worker_id,
            "provider_group": provider,
            "quality": rounded(quality),
            "pass_rate": rounded(pass_rate),
            "credits_per_call": rounded(credits, 3),
            "p95_latency_ms": latency_ms,
            "strengths": sorted(set(strengths)),
        })
    return workers


def make_constraints(rng: random.Random, desired_policy: str, workers: list[dict[str, Any]]) -> dict[str, Any]:
    cheapest = min(worker["credits_per_call"] for worker in workers)
    fastest = min(worker["p95_latency_ms"] for worker in workers)
    if desired_policy == "lean":
        max_calls = rng.choices((1, 2, 3), (0.72, 0.22, 0.06))[0]
        credit_ceiling = rng.uniform(cheapest * 1.05, max(cheapest * 2.4, 4.0))
        latency_ceiling = rng.uniform(fastest * 1.05, fastest * 2.0)
        min_quality = rng.uniform(0.48, 0.78)
    elif desired_policy == "balanced":
        max_calls = rng.choices((2, 3), (0.72, 0.28))[0]
        sorted_costs = sorted(worker["credits_per_call"] for worker in workers)
        credit_ceiling = rng.uniform(sum(sorted_costs[:2]) * 1.05, sum(sorted_costs) * 1.25)
        sorted_latency = sorted(worker["p95_latency_ms"] for worker in workers)
        latency_ceiling = rng.uniform(sum(sorted_latency[:2]) * 1.05, sum(sorted_latency) * 1.55)
        min_quality = rng.uniform(0.68, 0.9)
    else:
        max_calls = 3
        credit_ceiling = sum(worker["credits_per_call"] for worker in workers) * rng.uniform(1.02, 1.4)
        latency_ceiling = sum(worker["p95_latency_ms"] for worker in workers) * rng.uniform(1.02, 1.45)
        min_quality = rng.uniform(0.78, 0.96)
    return {
        "max_calls": max_calls,
        "max_credits": rounded(credit_ceiling, 3),
        "max_latency_ms": int(latency_ceiling),
        "minimum_quality": rounded(min_quality),
    }


def enumerate_plans(workers: list[dict[str, Any]]) -> Iterable[dict[str, Any]]:
    for writer in workers:
        yield plan_record("lean", writer, None, None)
    for writer in workers:
        for reviewer in workers:
            if reviewer["id"] != writer["id"]:
                yield plan_record("balanced", writer, reviewer, None)
    for writer in workers:
        for reviewer in workers:
            for finalizer in workers:
                if len({writer["id"], reviewer["id"], finalizer["id"]}) == 3:
                    yield plan_record("strict", writer, reviewer, finalizer)


def plan_record(policy: str, writer: dict[str, Any], reviewer: dict[str, Any] | None, finalizer: dict[str, Any] | None) -> dict[str, Any]:
    selected = [worker for worker in (writer, reviewer, finalizer) if worker]
    calls = len(selected)
    return {
        "policy": policy,
        "writer": writer["id"],
        "reviewer": reviewer["id"] if reviewer else None,
        "finalizer": finalizer["id"] if finalizer else None,
        "max_calls": calls,
        "estimated_credits": rounded(sum(worker["credits_per_call"] for worker in selected), 3),
        "estimated_latency_ms": sum(worker["p95_latency_ms"] for worker in selected),
        "independent_verification": bool(reviewer and reviewer["provider_group"] != writer["provider_group"]),
        "access": {
            "writer": [],
            "reviewer": ["writer"] if reviewer else [],
            "finalizer": ["writer", "reviewer"] if finalizer else [],
        },
    }


def worker_map(workers: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {worker["id"]: worker for worker in workers}


def outcome_for_plan(task: dict[str, Any], workers: list[dict[str, Any]], plan: dict[str, Any]) -> dict[str, float]:
    by_id = worker_map(workers)
    writer = by_id[plan["writer"]]
    difficulty = 0.42 * task["complexity"] + 0.28 * task["ambiguity"] + 0.3 * task["risk"]
    writer_quality = clamp(writer["quality"] - 0.24 * difficulty + 0.08 * (1.0 - task["complexity"]), 0.05, 0.995)
    writer_pass = clamp(writer["pass_rate"] - 0.27 * difficulty, 0.03, 0.995)
    quality = writer_quality
    pass_rate = writer_pass

    reviewer_id = plan.get("reviewer")
    if reviewer_id:
        reviewer = by_id[reviewer_id]
        independent = reviewer["provider_group"] != writer["provider_group"]
        reviewer_reliability = reviewer["quality"] * reviewer["pass_rate"]
        review_power = reviewer_reliability * (0.28 + 0.34 * task["evidence_need"] + 0.18 * task["risk"])
        if independent:
            review_power *= 1.12
        review_regression = (1.0 - reviewer["quality"]) * (1.0 - reviewer["pass_rate"]) * (
            0.08 + 0.08 * task["ambiguity"]
        )
        quality = clamp(quality + (1.0 - quality) * review_power - quality * review_regression)
        pass_rate = clamp(
            pass_rate
            + (1.0 - pass_rate) * reviewer_reliability * (0.36 + 0.34 * task["risk"])
            - pass_rate * review_regression * 0.5
        )

    finalizer_id = plan.get("finalizer")
    if finalizer_id:
        finalizer = by_id[finalizer_id]
        synthesis_fit = 0.035 if {"synthesis", "reasoning", "writing"} & set(finalizer["strengths"]) else -0.025
        finalizer_quality = clamp(finalizer["quality"] - 0.1 * difficulty + synthesis_fit, 0.05, 0.995)
        synthesis_power = finalizer_quality * finalizer["pass_rate"] * (
            0.2 + 0.24 * task["complexity"] + 0.16 * task["ambiguity"]
        )
        evidence_quality = clamp(quality + (1.0 - quality) * synthesis_power)
        quality = clamp(0.58 * evidence_quality + 0.42 * finalizer_quality)
        pass_rate = clamp(0.62 * pass_rate + 0.38 * finalizer["pass_rate"])

    return {"quality": rounded(quality), "pass_rate": rounded(pass_rate)}


def feasible(plan: dict[str, Any], constraints: dict[str, Any]) -> bool:
    return (
        plan["max_calls"] <= constraints["max_calls"]
        and plan["estimated_credits"] <= constraints["max_credits"] + 1e-9
        and plan["estimated_latency_ms"] <= constraints["max_latency_ms"]
    )


def role_fitness_penalty(
    constraints: dict[str, Any],
    workers: list[dict[str, Any]],
    plan: dict[str, Any],
) -> float:
    by_id = worker_map(workers)
    writer = by_id[plan["writer"]]
    penalty = 0.0
    reviewer_id = plan.get("reviewer")
    if reviewer_id:
        reviewer = by_id[reviewer_id]
        reviewer_floor = max(0.55, min(0.82, constraints["minimum_quality"] - 0.1))
        penalty += 22.0 * max(0.0, reviewer_floor - reviewer["quality"])
        penalty += 12.0 * max(0.0, 0.58 - reviewer["pass_rate"])
        penalty += 9.0 * max(0.0, writer["quality"] - reviewer["quality"] - 0.18)
        if not ({"review", "reasoning"} & set(reviewer["strengths"])):
            penalty += 2.5
    finalizer_id = plan.get("finalizer")
    if finalizer_id:
        finalizer = by_id[finalizer_id]
        selected = [by_id[worker_id] for worker_id in (plan["writer"], reviewer_id, finalizer_id) if worker_id]
        best_quality = max(worker["quality"] for worker in selected)
        best_pass_rate = max(worker["pass_rate"] for worker in selected)
        penalty += 34.0 * max(0.0, best_quality - finalizer["quality"])
        penalty += 14.0 * max(0.0, best_pass_rate - finalizer["pass_rate"] - 0.08)
        if not ({"synthesis", "reasoning", "writing"} & set(finalizer["strengths"])):
            penalty += 3.0
    return penalty


def utility(
    task: dict[str, Any],
    constraints: dict[str, Any],
    plan: dict[str, Any],
    outcome: dict[str, float],
    workers: list[dict[str, Any]],
) -> float:
    if not feasible(plan, constraints):
        return -1_000.0
    score = 62.0 * outcome["quality"] + 23.0 * outcome["pass_rate"]
    score -= 7.0 * plan["estimated_credits"] / max(constraints["max_credits"], 0.1)
    score -= 4.5 * plan["estimated_latency_ms"] / max(constraints["max_latency_ms"], 1)
    score -= 1.5 * (plan["max_calls"] - 1)
    score -= role_fitness_penalty(constraints, workers, plan)
    quality_gap = max(0.0, constraints["minimum_quality"] - outcome["quality"])
    score -= 42.0 * quality_gap

    verification_pressure = task["risk"] * task["consequence"] * (0.55 + 0.45 * task["evidence_need"])
    if plan["independent_verification"]:
        score += 12.0 * verification_pressure
    elif verification_pressure > 0.42:
        score -= 28.0 * verification_pressure

    synthesis_pressure = (
        0.4 * task["complexity"]
        + 0.25 * task["ambiguity"]
        + 0.2 * task["risk"]
        + 0.15 * task["evidence_need"]
    )
    if plan["policy"] == "strict":
        score += 30.0 * max(0.0, synthesis_pressure - 0.35)

    if task["risk"] < 0.28 and task["complexity"] < 0.42:
        score -= 4.8 * (plan["max_calls"] - 1)
    if task["reversibility"] < 0.3 and plan["policy"] == "lean":
        score -= 7.5
    return rounded(score, 6)


def select_oracle(task: dict[str, Any], constraints: dict[str, Any], workers: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    candidates: list[tuple[float, dict[str, Any], dict[str, float]]] = []
    for plan in enumerate_plans(workers):
        if not feasible(plan, constraints):
            continue
        outcome = outcome_for_plan(task, workers, plan)
        score = utility(task, constraints, plan, outcome, workers)
        candidates.append((score, plan, outcome))
    if not candidates:
        raise RuntimeError("No feasible plan for generated constraints")
    quality_candidates = [row for row in candidates if row[2]["quality"] >= constraints["minimum_quality"]]
    ranked_candidates = quality_candidates or candidates
    ranked_candidates.sort(
        key=lambda row: (
            row[0],
            row[2]["quality"],
            row[2]["pass_rate"],
            -row[1]["estimated_credits"],
            -row[1]["estimated_latency_ms"],
        ),
        reverse=True,
    )
    score, plan, outcome = ranked_candidates[0]
    reason_codes = reason_codes_for(task, constraints, plan, outcome)
    label = {
        **plan,
        "max_credits": constraints["max_credits"],
        "max_latency_ms": constraints["max_latency_ms"],
        "estimated_quality": outcome["quality"],
        "estimated_pass_rate": outcome["pass_rate"],
        "reason_codes": reason_codes,
    }
    oracle = {
        "utility": score,
        "quality": outcome["quality"],
        "pass_rate": outcome["pass_rate"],
        "candidate_count": len(candidates),
        "quality_target_met": outcome["quality"] >= constraints["minimum_quality"],
    }
    return label, oracle


def reason_codes_for(task: dict[str, Any], constraints: dict[str, Any], plan: dict[str, Any], outcome: dict[str, float]) -> list[str]:
    reasons: list[str] = []
    if task["risk"] >= 0.72 or task["consequence"] >= 0.78:
        reasons.append("high_consequence")
    if task["evidence_need"] >= 0.65:
        reasons.append("independent_evidence")
    if task["complexity"] >= 0.72 or task["ambiguity"] >= 0.72:
        reasons.append("complex_task")
    if plan["estimated_credits"] >= constraints["max_credits"] * 0.82:
        reasons.append("credit_constrained")
    if plan["estimated_latency_ms"] >= constraints["max_latency_ms"] * 0.82:
        reasons.append("latency_constrained")
    if outcome["quality"] < constraints["minimum_quality"]:
        reasons.append("best_feasible_below_target")
    if plan["policy"] == "lean" and not reasons:
        reasons.append("single_call_sufficient")
    if plan["independent_verification"]:
        reasons.append("independent_verification")
    return sorted(set(reasons))[:4]


def prompt_payload(task: dict[str, Any], constraints: dict[str, Any], workers: list[dict[str, Any]]) -> str:
    input_payload = {
        "task": {key: value for key, value in task.items() if key != "request_id"},
        "constraints": constraints,
        "workers": workers,
    }
    schema = {
        "policy": "lean|balanced|strict",
        "writer": "worker id",
        "reviewer": "worker id|null",
        "finalizer": "worker id|null",
        "max_calls": "integer",
        "max_credits": "number",
        "max_latency_ms": "integer",
        "estimated_credits": "number",
        "estimated_latency_ms": "integer",
        "estimated_quality": "number",
        "estimated_pass_rate": "number",
        "independent_verification": "boolean",
        "access": {"writer": [], "reviewer": [], "finalizer": []},
        "reason_codes": ["bounded machine-readable codes"],
    }
    return (
        "You are the Dot Loom conductor. Select the highest-utility execution plan that obeys all hard "
        "call, credit, and latency limits. Use cheap workers when sufficient. Require an independent "
        "provider when consequences and verification needs justify it. Return exactly one compact JSON "
        "object and no prose.\nINPUT=" + stable_json(input_payload) + "\nOUTPUT_SCHEMA=" + stable_json(schema) + "\nOUTPUT="
    )


def make_example(rng: random.Random, family: Family, index: int, desired_policy: str) -> dict[str, Any]:
    task = make_task(rng, family, index)
    workers = make_workers(rng, family.category)
    constraints = make_constraints(rng, desired_policy, workers)
    label, oracle = select_oracle(task, constraints, workers)
    return {
        "id": task["request_id"],
        "schema_version": SCHEMA_VERSION,
        "split": family.split,
        "family": family.name,
        "source": "synthetic-empirical-v1",
        "prompt": prompt_payload(task, constraints, workers),
        "target": stable_json(label),
        "task": task,
        "constraints": constraints,
        "workers": workers,
        "label": label,
        "oracle": oracle,
    }


def generate_split(rng: random.Random, split: str, size: int) -> list[dict[str, Any]]:
    families = [family for family in FAMILIES if family.split == split]
    base = size // len(POLICIES)
    quotas = {policy: base for policy in POLICIES}
    for policy in POLICIES[: size - base * len(POLICIES)]:
        quotas[policy] += 1
    examples: list[dict[str, Any]] = []
    attempts = 0
    family_index = 0
    while any(quotas.values()):
        attempts += 1
        if attempts > size * 500:
            raise RuntimeError(f"Could not balance {split} policy labels after {attempts} attempts")
        desired = rng.choice([policy for policy, remaining in quotas.items() if remaining > 0])
        family = families[family_index % len(families)]
        family_index += 1
        example = make_example(rng, family, attempts, desired)
        actual = example["label"]["policy"]
        if actual != desired or quotas[actual] <= 0:
            continue
        examples.append(example)
        quotas[actual] -= 1
    rng.shuffle(examples)
    return examples


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True, ensure_ascii=True) + "\n")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def distribution(rows: Iterable[dict[str, Any]], field: str) -> dict[str, int]:
    result: dict[str, int] = {}
    for row in rows:
        value: Any = row
        for part in field.split("."):
            value = value[part]
        result[str(value)] = result.get(str(value), 0) + 1
    return dict(sorted(result.items()))


def write_dataset(root: Path, seed: int, train_size: int, validation_size: int, test_size: int) -> dict[str, Any]:
    rng = random.Random(seed)
    sizes = {"train": train_size, "validation": validation_size, "test": test_size}
    files: dict[str, dict[str, Any]] = {}
    split_rows: dict[str, list[dict[str, Any]]] = {}
    for split, size in sizes.items():
        rows = generate_split(rng, split, size)
        split_rows[split] = rows
        path = root / f"{split}.jsonl"
        write_jsonl(path, rows)
        files[split] = {
            "path": path.name,
            "rows": len(rows),
            "sha256": sha256_file(path),
            "policies": distribution(rows, "label.policy"),
            "families": distribution(rows, "family"),
        }
    family_sets = {split: {row["family"] for row in rows} for split, rows in split_rows.items()}
    leakage = {
        "train_validation_overlap": sorted(family_sets["train"] & family_sets["validation"]),
        "train_test_overlap": sorted(family_sets["train"] & family_sets["test"]),
        "validation_test_overlap": sorted(family_sets["validation"] & family_sets["test"]),
    }
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "seed": seed,
        "created_by": "src/generate_dataset.py",
        "no_user_prompts": True,
        "license": "Apache-2.0 compatible synthetic corpus",
        "empirical_anchor": {
            "receipt": "dot-loom/docs/benchmarks/cross-model-baselines-v1.json",
            "case_count": 6,
            "models_anonymized": True,
            "anchors": EMPIRICAL_ANCHORS,
        },
        "label_method": {
            "name": "exhaustive constrained plan search",
            "hard_constraints": ["max_calls", "max_credits", "max_latency_ms"],
            "quality_target": "minimum_quality",
            "review_model": "reliability-weighted correction with regression risk",
            "finalizer_model": "evidence synthesis blended with finalizer capability",
            "role_fitness": ["review reliability", "finalizer output quality", "capability strengths"],
        },
        "split_method": "disjoint task families plus balanced policy labels",
        "family_leakage": leakage,
        "files": files,
    }
    manifest_path = root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


def plan_from_prediction(prediction: dict[str, Any], example: dict[str, Any]) -> dict[str, Any] | None:
    by_id = worker_map(example["workers"])
    try:
        policy = str(prediction["policy"])
        writer = by_id[str(prediction["writer"])]
        reviewer_value = prediction.get("reviewer")
        finalizer_value = prediction.get("finalizer")
        reviewer = by_id[str(reviewer_value)] if reviewer_value is not None else None
        finalizer = by_id[str(finalizer_value)] if finalizer_value is not None else None
    except (KeyError, TypeError, ValueError):
        return None
    if policy not in POLICIES:
        return None
    plan = plan_record(policy, writer, reviewer, finalizer)
    expected_calls = {"lean": 1, "balanced": 2, "strict": 3}[policy]
    if plan["max_calls"] != expected_calls:
        return None
    if policy == "lean" and (reviewer or finalizer):
        return None
    if policy == "balanced" and (not reviewer or finalizer):
        return None
    if policy == "strict" and (not reviewer or not finalizer):
        return None
    if len({worker["id"] for worker in (writer, reviewer, finalizer) if worker}) != expected_calls:
        return None
    return plan


def extract_json_object(text: str) -> dict[str, Any] | None:
    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None


def output_schema_valid(prediction: dict[str, Any]) -> bool:
    required = {
        "policy", "writer", "reviewer", "finalizer", "max_calls", "max_credits",
        "max_latency_ms", "estimated_credits", "estimated_latency_ms", "estimated_quality",
        "estimated_pass_rate", "independent_verification", "access", "reason_codes",
    }
    if not required.issubset(prediction):
        return False
    number_fields = ("max_credits", "estimated_credits", "estimated_quality", "estimated_pass_rate")
    if any(not isinstance(prediction[field], (int, float)) or isinstance(prediction[field], bool) for field in number_fields):
        return False
    if not isinstance(prediction["max_calls"], int) or isinstance(prediction["max_calls"], bool):
        return False
    if not isinstance(prediction["max_latency_ms"], int) or isinstance(prediction["max_latency_ms"], bool):
        return False
    if not isinstance(prediction["estimated_latency_ms"], int) or isinstance(prediction["estimated_latency_ms"], bool):
        return False
    if not isinstance(prediction["independent_verification"], bool):
        return False
    access = prediction["access"]
    if not isinstance(access, dict) or set(access) != {"writer", "reviewer", "finalizer"}:
        return False
    if any(not isinstance(access[role], list) or any(not isinstance(item, str) for item in access[role]) for role in access):
        return False
    reasons = prediction["reason_codes"]
    if not isinstance(reasons, list) or any(not isinstance(reason, str) for reason in reasons):
        return False
    return 0.0 <= float(prediction["estimated_quality"]) <= 1.0 and 0.0 <= float(prediction["estimated_pass_rate"]) <= 1.0


def receipt_consistent(
    prediction: dict[str, Any],
    example: dict[str, Any],
    plan: dict[str, Any],
    outcome: dict[str, float],
) -> bool:
    if not output_schema_valid(prediction):
        return False
    constraints = example["constraints"]
    return (
        prediction["max_calls"] == plan["max_calls"]
        and abs(float(prediction["max_credits"]) - float(constraints["max_credits"])) <= 0.001
        and prediction["max_latency_ms"] == constraints["max_latency_ms"]
        and abs(float(prediction["estimated_credits"]) - float(plan["estimated_credits"])) <= 0.001
        and prediction["estimated_latency_ms"] == plan["estimated_latency_ms"]
        and prediction["independent_verification"] == plan["independent_verification"]
        and prediction["access"] == plan["access"]
    )


def score_prediction(example: dict[str, Any], raw_prediction: str) -> dict[str, Any]:
    parsed = extract_json_object(raw_prediction)
    if parsed is None:
        return {
            "json_valid": False,
            "schema_valid": False,
            "plan_valid": False,
            "receipt_consistent": False,
            "constraint_satisfied": False,
            "policy_correct": False,
            "exact_plan": False,
            "utility": -1_000.0,
            "utility_regret": 1_000.0 + example["oracle"]["utility"],
            "unsafe_under_escalation": bool(example["task"]["risk"] >= 0.75),
            "unnecessary_escalation": False,
            "parsed": None,
            "predicted_quality": None,
            "predicted_pass_rate": None,
            "quality_target_met": False,
            "predicted_calls": None,
            "predicted_credits": None,
            "predicted_latency_ms": None,
            "declared_quality_abs_error": None,
            "declared_pass_rate_abs_error": None,
        }
    plan = plan_from_prediction(parsed, example)
    if plan is None:
        return {
            "json_valid": True,
            "schema_valid": output_schema_valid(parsed),
            "plan_valid": False,
            "receipt_consistent": False,
            "constraint_satisfied": False,
            "policy_correct": parsed.get("policy") == example["label"]["policy"],
            "exact_plan": False,
            "utility": -1_000.0,
            "utility_regret": 1_000.0 + example["oracle"]["utility"],
            "unsafe_under_escalation": bool(example["task"]["risk"] >= 0.75),
            "unnecessary_escalation": False,
            "parsed": parsed,
            "predicted_quality": None,
            "predicted_pass_rate": None,
            "quality_target_met": False,
            "predicted_calls": None,
            "predicted_credits": None,
            "predicted_latency_ms": None,
            "declared_quality_abs_error": None,
            "declared_pass_rate_abs_error": None,
        }
    constraints_ok = feasible(plan, example["constraints"])
    outcome = outcome_for_plan(example["task"], example["workers"], plan)
    schema_ok = output_schema_valid(parsed)
    receipt_ok = receipt_consistent(parsed, example, plan, outcome)
    predicted_utility = utility(example["task"], example["constraints"], plan, outcome, example["workers"])
    oracle_plan = {key: example["label"][key] for key in ("policy", "writer", "reviewer", "finalizer")}
    predicted_plan = {key: plan[key] for key in oracle_plan}
    oracle_calls = example["label"]["max_calls"]
    unsafe = (
        example["task"]["risk"] >= 0.75
        and (plan["max_calls"] < oracle_calls or (example["label"]["independent_verification"] and not plan["independent_verification"]))
    )
    unnecessary = example["task"]["risk"] < 0.3 and plan["max_calls"] > oracle_calls
    return {
        "json_valid": True,
        "schema_valid": schema_ok,
        "plan_valid": True,
        "receipt_consistent": receipt_ok,
        "constraint_satisfied": constraints_ok,
        "policy_correct": plan["policy"] == example["label"]["policy"],
        "exact_plan": predicted_plan == oracle_plan,
        "utility": predicted_utility,
        "utility_regret": max(0.0, rounded(example["oracle"]["utility"] - predicted_utility, 6)),
        "unsafe_under_escalation": unsafe,
        "unnecessary_escalation": unnecessary,
        "parsed": parsed,
        "predicted_quality": outcome["quality"],
        "predicted_pass_rate": outcome["pass_rate"],
        "quality_target_met": outcome["quality"] >= example["constraints"]["minimum_quality"],
        "predicted_calls": plan["max_calls"],
        "predicted_credits": plan["estimated_credits"],
        "predicted_latency_ms": plan["estimated_latency_ms"],
        "declared_quality_abs_error": rounded(abs(float(parsed["estimated_quality"]) - outcome["quality"]), 6) if schema_ok else None,
        "declared_pass_rate_abs_error": rounded(abs(float(parsed["estimated_pass_rate"]) - outcome["pass_rate"]), 6) if schema_ok else None,
    }


def aggregate_scores(scores: list[dict[str, Any]]) -> dict[str, Any]:
    count = len(scores)
    if count == 0:
        raise ValueError("Cannot aggregate zero scores")
    rate_fields = (
        "json_valid", "schema_valid", "plan_valid", "receipt_consistent", "constraint_satisfied", "policy_correct", "exact_plan",
        "unsafe_under_escalation", "unnecessary_escalation",
    )
    summary = {field: rounded(sum(bool(score[field]) for score in scores) / count, 6) for field in rate_fields}
    regrets = sorted(float(score["utility_regret"]) for score in scores)
    summary.update({
        "examples": count,
        "mean_utility_regret": rounded(sum(regrets) / count, 6),
        "p95_utility_regret": rounded(regrets[min(count - 1, math.ceil(0.95 * count) - 1)], 6),
        "quality_target_met_rate": rounded(sum(bool(score["quality_target_met"]) for score in scores) / count, 6),
    })
    valid_quality = [float(score["predicted_quality"]) for score in scores if score["predicted_quality"] is not None]
    valid_pass_rate = [float(score["predicted_pass_rate"]) for score in scores if score["predicted_pass_rate"] is not None]
    quality_errors = sorted(float(score["declared_quality_abs_error"]) for score in scores if score["declared_quality_abs_error"] is not None)
    pass_rate_errors = sorted(float(score["declared_pass_rate_abs_error"]) for score in scores if score["declared_pass_rate_abs_error"] is not None)
    summary["mean_predicted_quality"] = rounded(sum(valid_quality) / len(valid_quality), 6) if valid_quality else None
    summary["mean_predicted_pass_rate"] = rounded(sum(valid_pass_rate) / len(valid_pass_rate), 6) if valid_pass_rate else None
    summary["mean_declared_quality_abs_error"] = rounded(sum(quality_errors) / len(quality_errors), 6) if quality_errors else None
    summary["p95_declared_quality_abs_error"] = rounded(quality_errors[min(len(quality_errors) - 1, math.ceil(0.95 * len(quality_errors)) - 1)], 6) if quality_errors else None
    summary["mean_declared_pass_rate_abs_error"] = rounded(sum(pass_rate_errors) / len(pass_rate_errors), 6) if pass_rate_errors else None
    summary["p95_declared_pass_rate_abs_error"] = rounded(pass_rate_errors[min(len(pass_rate_errors) - 1, math.ceil(0.95 * len(pass_rate_errors)) - 1)], 6) if pass_rate_errors else None
    return summary
