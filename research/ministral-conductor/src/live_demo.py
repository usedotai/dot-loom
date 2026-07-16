from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

import torch
from peft import PeftModel
from transformers import Mistral3ForConditionalGeneration

from conductor_data import (
    extract_json_object,
    feasible,
    outcome_for_plan,
    plan_from_prediction,
    prompt_payload,
)
from model_io import decode_text, encode_text, load_text_tokenizer, token_id


WORKERS = [
    {
        "id": "worker_a",
        "provider_group": "local",
        "quality": 0.72,
        "pass_rate": 0.56,
        "credits_per_call": 0.15,
        "p95_latency_ms": 6_500,
        "strengths": ["coding", "drafting", "speed"],
    },
    {
        "id": "worker_b",
        "provider_group": "anthropic",
        "quality": 0.89,
        "pass_rate": 0.85,
        "credits_per_call": 3.5,
        "p95_latency_ms": 35_000,
        "strengths": ["reasoning", "review", "writing"],
    },
    {
        "id": "worker_c",
        "provider_group": "openai",
        "quality": 0.97,
        "pass_rate": 0.96,
        "credits_per_call": 12.5,
        "p95_latency_ms": 42_000,
        "strengths": ["implementation", "reasoning", "synthesis"],
    },
]

DISPLAY_NAMES = {
    "worker_a": "Local Ministral via Ollama",
    "worker_b": "Claude review lane",
    "worker_c": "OpenAI frontier lane",
}

PRESETS: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {
    "low-risk": (
        {
            "family": "documentation",
            "category": "writing",
            "summary": "Rewrite a short internal release note without changing facts.",
            "risk": 0.08,
            "complexity": 0.22,
            "consequence": 0.1,
            "ambiguity": 0.18,
            "evidence_need": 0.12,
            "reversibility": 0.95,
            "input_tokens": 500,
            "request_id": "live-low-risk",
        },
        {"max_calls": 1, "max_credits": 0.5, "max_latency_ms": 10_000, "minimum_quality": 0.55},
    ),
    "payment-race": (
        {
            "family": "payment_races",
            "category": "financial",
            "summary": "Audit a USDC credit claim for concurrent debit, retry, settlement, and recovery failures.",
            "risk": 0.99,
            "complexity": 0.99,
            "consequence": 0.99,
            "ambiguity": 0.99,
            "evidence_need": 0.99,
            "reversibility": 0.12,
            "input_tokens": 2_400,
            "request_id": "live-payment-race",
        },
        {"max_calls": 3, "max_credits": 16.5, "max_latency_ms": 95_000, "minimum_quality": 0.96},
    ),
    "ssrf": (
        {
            "family": "ssrf_egress",
            "category": "security",
            "summary": "Audit a user-controlled fetcher for redirect, DNS rebinding, and metadata endpoint access.",
            "risk": 0.99,
            "complexity": 0.99,
            "consequence": 0.99,
            "ambiguity": 0.99,
            "evidence_need": 0.99,
            "reversibility": 0.18,
            "input_tokens": 2_100,
            "request_id": "live-ssrf",
        },
        {"max_calls": 3, "max_credits": 16.5, "max_latency_ms": 95_000, "minimum_quality": 0.96},
    ),
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a named live Dot Loom conductor decision")
    parser.add_argument("--preset", choices=["all", *sorted(PRESETS)], default="payment-race")
    parser.add_argument("--model", default="models/Ministral-3-14B-Base-2512")
    parser.add_argument("--adapter", default="artifacts/ministral-14b-loom-conductor-v2/adapter")
    parser.add_argument("--max-new-tokens", type=int, default=260)
    args = parser.parse_args()

    tokenizer = load_text_tokenizer(args.model)
    eos_id = token_id(tokenizer, "eos_token_id")
    model = Mistral3ForConditionalGeneration.from_pretrained(
        Path(args.model),
        dtype=torch.bfloat16,
        low_cpu_mem_usage=True,
        attn_implementation="sdpa",
    )
    model = PeftModel.from_pretrained(model, args.adapter).to("cuda").eval()
    results: list[dict[str, Any]] = []
    presets = sorted(PRESETS) if args.preset == "all" else [args.preset]
    for preset in presets:
        task, constraints = PRESETS[preset]
        prompt = prompt_payload(task, constraints, WORKERS)
        input_ids = torch.tensor([encode_text(tokenizer, prompt)], dtype=torch.long, device="cuda")
        torch.cuda.synchronize()
        started = time.perf_counter()
        with torch.inference_mode():
            output = model.generate(
                input_ids=input_ids,
                attention_mask=torch.ones_like(input_ids),
                max_length=input_ids.shape[1] + args.max_new_tokens,
                do_sample=False,
                eos_token_id=eos_id,
                pad_token_id=eos_id,
                use_cache=True,
            )
        torch.cuda.synchronize()
        latency_ms = round((time.perf_counter() - started) * 1000, 3)
        raw = decode_text(tokenizer, output[0, input_ids.shape[1]:]).strip()
        plan = extract_json_object(raw)
        if not plan:
            raise RuntimeError("The conductor did not return a JSON plan: " + raw[:500])
        validated_plan = plan_from_prediction(plan, {"workers": WORKERS})
        if validated_plan is None:
            raise RuntimeError("The conductor returned an invalid role plan: " + raw[:500])
        if not feasible(validated_plan, constraints):
            raise RuntimeError("The conductor returned a plan outside the hard runtime budget")
        outcome = outcome_for_plan(task, WORKERS, validated_plan)
        named_roles = {
            role: DISPLAY_NAMES.get(str(plan.get(role)), plan.get(role)) if plan.get(role) else None
            for role in ("writer", "reviewer", "finalizer")
        }
        results.append({
            "preset": preset,
            "task": task["summary"],
            "limits": constraints,
            "plan": plan,
            "named_roles": named_roles,
            "runtime_validation": {
                "json_valid": True,
                "plan_valid": True,
                "hard_constraints_met": True,
                "recomputed_calls": validated_plan["max_calls"],
                "recomputed_credits": validated_plan["estimated_credits"],
                "recomputed_latency_ms": validated_plan["estimated_latency_ms"],
                "recomputed_quality": outcome["quality"],
                "recomputed_pass_rate": outcome["pass_rate"],
                "independent_verification": validated_plan["independent_verification"],
            },
            "conductor_latency_ms": latency_ms,
            "gpu": torch.cuda.get_device_name(0),
        })
    print(json.dumps(results if args.preset == "all" else results[0], indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
