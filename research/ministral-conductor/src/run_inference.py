from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import torch
from peft import PeftModel
from transformers import Mistral3ForConditionalGeneration

from conductor_data import read_jsonl
from model_io import decode_text, encode_text, load_text_tokenizer, token_id


def main() -> None:
    parser = argparse.ArgumentParser(description="Run base or trained Ministral conductor inference")
    parser.add_argument("--model", default="models/Ministral-3-14B-Base-2512")
    parser.add_argument("--adapter", default=None)
    parser.add_argument("--data", default="data/test.jsonl")
    parser.add_argument("--output", required=True)
    parser.add_argument("--limit", type=int, default=300)
    parser.add_argument("--max-new-tokens", type=int, default=220)
    parser.add_argument("--batch-size", type=int, default=4)
    args = parser.parse_args()

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required")
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    rows = read_jsonl(Path(args.data))[: args.limit]
    tokenizer = load_text_tokenizer(args.model)
    eos_id = token_id(tokenizer, "eos_token_id")
    pad_id = token_id(tokenizer, "pad_token_id", eos_id)
    model = Mistral3ForConditionalGeneration.from_pretrained(
        args.model,
        dtype=torch.bfloat16,
        low_cpu_mem_usage=True,
        attn_implementation="sdpa",
    )
    if args.adapter:
        model = PeftModel.from_pretrained(model, args.adapter)
    model.to("cuda")
    model.eval()
    torch.cuda.reset_peak_memory_stats()
    started = time.time()
    completed = 0
    with output.open("w", encoding="utf-8") as handle, torch.inference_mode():
        for offset in range(0, len(rows), args.batch_size):
            batch = rows[offset: offset + args.batch_size]
            encoded = [encode_text(tokenizer, row["prompt"]) for row in batch]
            input_width = max(len(ids) for ids in encoded)
            padded = [[pad_id] * (input_width - len(ids)) + ids for ids in encoded]
            masks = [[0] * (input_width - len(ids)) + [1] * len(ids) for ids in encoded]
            input_ids = torch.tensor(padded, dtype=torch.long, device="cuda")
            attention_mask = torch.tensor(masks, dtype=torch.long, device="cuda")
            torch.cuda.synchronize()
            before = time.perf_counter()
            generated = model.generate(
                input_ids=input_ids,
                attention_mask=attention_mask,
                max_length=input_width + args.max_new_tokens,
                do_sample=False,
                eos_token_id=eos_id,
                pad_token_id=pad_id,
                use_cache=True,
            )
            torch.cuda.synchronize()
            elapsed_ms = round((time.perf_counter() - before) * 1000.0, 3)
            for row, source_ids, output_ids in zip(batch, encoded, generated):
                new_tokens = output_ids[input_width:]
                prediction = decode_text(tokenizer, new_tokens).strip()
                generated_ids = new_tokens.tolist()
                if eos_id in generated_ids:
                    generated_ids = generated_ids[: generated_ids.index(eos_id) + 1]
                record = {
                    "id": row["id"],
                    "prediction": prediction,
                    "elapsed_ms": elapsed_ms,
                    "batch_size": len(batch),
                    "input_tokens": len(source_ids),
                    "output_tokens": len(generated_ids),
                }
                handle.write(json.dumps(record, sort_keys=True, ensure_ascii=True) + "\n")
            handle.flush()
            completed += len(batch)
            if completed % 20 == 0 or completed == len(rows):
                print(f"INFERENCE {completed}/{len(rows)}", flush=True)
    metadata = {
        "lane": "trained_conductor" if args.adapter else "base_ministral",
        "model": args.model,
        "adapter": args.adapter,
        "examples": len(rows),
        "duration_seconds": round(time.time() - started, 3),
        "examples_per_second": round(len(rows) / max(time.time() - started, 1e-9), 6),
        "peak_gpu_memory_bytes": torch.cuda.max_memory_allocated(),
        "gpu": torch.cuda.get_device_name(0),
    }
    output.with_suffix(".meta.json").write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
