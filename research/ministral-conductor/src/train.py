from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import torch
from peft import LoraConfig, get_peft_model
from torch.utils.data import Dataset
from transformers import Mistral3ForConditionalGeneration, Trainer, TrainingArguments

from conductor_data import read_jsonl, sha256_file
from model_io import encode_text, load_text_tokenizer, token_id


@dataclass(frozen=True)
class RunConfig:
    model: str
    model_revision: str
    train_data: str
    validation_data: str
    output: str
    max_length: int
    epochs: float
    learning_rate: float
    batch_size: int
    gradient_accumulation: int
    lora_rank: int
    lora_alpha: int
    seed: int
    skip_eval: bool


class CompletionDataset(Dataset):
    def __init__(self, path: Path, tokenizer: Any, max_length: int, eos_id: int):
        self.items: list[dict[str, list[int]]] = []
        self.truncated = 0
        rows = read_jsonl(path)
        for row in rows:
            prompt_ids = encode_text(tokenizer, row["prompt"])
            target_ids = encode_text(tokenizer, row["target"]) + [eos_id]
            available_prompt = max_length - len(target_ids)
            if available_prompt <= 0:
                raise ValueError(f"Target exceeds max length for {row['id']}")
            if len(prompt_ids) > available_prompt:
                self.truncated += 1
                # Keep the conductor instruction at the front and the schema/output cue at the end.
                front = min(160, available_prompt // 3)
                prompt_ids = prompt_ids[:front] + prompt_ids[-(available_prompt - front):]
            input_ids = prompt_ids + target_ids
            labels = [-100] * len(prompt_ids) + target_ids
            self.items.append({"input_ids": input_ids, "labels": labels})

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, index: int) -> dict[str, list[int]]:
        return self.items[index]


class CompletionCollator:
    def __init__(self, pad_id: int, multiple: int = 8):
        self.pad_id = pad_id
        self.multiple = multiple

    def __call__(self, features: list[dict[str, list[int]]]) -> dict[str, torch.Tensor]:
        max_length = max(len(feature["input_ids"]) for feature in features)
        max_length = ((max_length + self.multiple - 1) // self.multiple) * self.multiple
        input_rows: list[list[int]] = []
        label_rows: list[list[int]] = []
        attention_rows: list[list[int]] = []
        for feature in features:
            padding = max_length - len(feature["input_ids"])
            input_rows.append(feature["input_ids"] + [self.pad_id] * padding)
            label_rows.append(feature["labels"] + [-100] * padding)
            attention_rows.append([1] * len(feature["input_ids"]) + [0] * padding)
        return {
            "input_ids": torch.tensor(input_rows, dtype=torch.long),
            "labels": torch.tensor(label_rows, dtype=torch.long),
            "attention_mask": torch.tensor(attention_rows, dtype=torch.long),
        }


def source_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted((root / "src").glob("*.py")):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def git_sha(path: Path) -> str | None:
    try:
        return subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return None


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True, default=str) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the Dot Loom Ministral conductor")
    parser.add_argument("--model", default="models/Ministral-3-14B-Base-2512")
    parser.add_argument("--model-revision", default="5b0ceedbb42dff466ae60b258ba296f32da51384")
    parser.add_argument("--train-data", default="data/train.jsonl")
    parser.add_argument("--validation-data", default="data/validation.jsonl")
    parser.add_argument("--output", default="artifacts/ministral-14b-loom-conductor")
    parser.add_argument("--max-length", type=int, default=1_536)
    parser.add_argument("--epochs", type=float, default=2.0)
    parser.add_argument("--learning-rate", type=float, default=1.5e-4)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--gradient-accumulation", type=int, default=16)
    parser.add_argument("--lora-rank", type=int, default=32)
    parser.add_argument("--lora-alpha", type=int, default=64)
    parser.add_argument("--seed", type=int, default=20260716)
    parser.add_argument("--max-steps", type=int, default=-1)
    parser.add_argument("--skip-eval", action="store_true")
    args = parser.parse_args()

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for this research run")
    if not torch.cuda.is_bf16_supported():
        raise RuntimeError("The selected GPU does not report BF16 support")

    root = Path.cwd()
    model_path = Path(args.model)
    output_path = Path(args.output)
    receipt_path = Path("receipts")
    output_path.mkdir(parents=True, exist_ok=True)
    receipt_path.mkdir(parents=True, exist_ok=True)
    config = RunConfig(
        model=args.model,
        model_revision=args.model_revision,
        train_data=args.train_data,
        validation_data=args.validation_data,
        output=args.output,
        max_length=args.max_length,
        epochs=args.epochs,
        learning_rate=args.learning_rate,
        batch_size=args.batch_size,
        gradient_accumulation=args.gradient_accumulation,
        lora_rank=args.lora_rank,
        lora_alpha=args.lora_alpha,
        seed=args.seed,
        skip_eval=args.skip_eval,
    )

    started = time.time()
    started_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started))
    tokenizer = load_text_tokenizer(model_path)
    eos_id = token_id(tokenizer, "eos_token_id")
    pad_id = token_id(tokenizer, "pad_token_id", eos_id)
    train_dataset = CompletionDataset(Path(args.train_data), tokenizer, args.max_length, eos_id)
    eval_dataset = CompletionDataset(Path(args.validation_data), tokenizer, args.max_length, eos_id)
    optimizer_steps_per_epoch = math.ceil(
        len(train_dataset) / max(1, args.batch_size * args.gradient_accumulation)
    )
    estimated_total_steps = (
        args.max_steps
        if args.max_steps > 0
        else math.ceil(optimizer_steps_per_epoch * args.epochs)
    )
    warmup_steps = max(1, round(estimated_total_steps * 0.05))

    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.cuda.reset_peak_memory_stats()
    model = Mistral3ForConditionalGeneration.from_pretrained(
        model_path,
        dtype=torch.bfloat16,
        low_cpu_mem_usage=True,
        attn_implementation="sdpa",
    )
    model.config.use_cache = False
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.enable_input_require_grads()

    lora = LoraConfig(
        r=args.lora_rank,
        lora_alpha=args.lora_alpha,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora)
    trainable, total = model.get_nb_trainable_parameters()
    print(f"TRAINABLE_PARAMS {trainable}/{total} ({100.0 * trainable / total:.4f}%)", flush=True)
    print(f"DATA train={len(train_dataset)} validation={len(eval_dataset)} truncated_train={train_dataset.truncated} truncated_validation={eval_dataset.truncated}", flush=True)

    checkpoint_steps = min(100, args.max_steps) if args.max_steps > 0 else 100
    training_args = TrainingArguments(
        output_dir=str(output_path / "checkpoints"),
        num_train_epochs=args.epochs,
        max_steps=args.max_steps,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=args.gradient_accumulation,
        learning_rate=args.learning_rate,
        lr_scheduler_type="cosine",
        warmup_steps=warmup_steps,
        weight_decay=0.01,
        max_grad_norm=1.0,
        bf16=True,
        tf32=True,
        gradient_checkpointing=True,
        optim="adamw_torch_fused",
        logging_strategy="steps",
        logging_steps=1,
        eval_strategy="no" if args.skip_eval else "steps",
        eval_steps=checkpoint_steps,
        save_strategy="no" if args.skip_eval else "steps",
        save_steps=checkpoint_steps,
        save_total_limit=3,
        load_best_model_at_end=not args.skip_eval,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        report_to="none",
        remove_unused_columns=False,
        dataloader_num_workers=min(8, os.cpu_count() or 1),
        dataloader_pin_memory=True,
        seed=args.seed,
        data_seed=args.seed,
    )
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        data_collator=CompletionCollator(pad_id),
    )
    result = trainer.train()
    final_adapter = output_path / "adapter"
    trainer.model.save_pretrained(final_adapter, safe_serialization=True)
    trainer.save_state()
    eval_metrics = {} if args.skip_eval else trainer.evaluate()
    ended = time.time()
    receipt = {
        "run": "dot-loom-ministral-14b-conductor-v1",
        "started_at": started_iso,
        "ended_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ended)),
        "duration_seconds": round(ended - started, 3),
        "config": asdict(config),
        "max_steps_override": args.max_steps,
        "estimated_total_steps": estimated_total_steps,
        "warmup_steps": warmup_steps,
        "base_model_commit": args.model_revision,
        "source_sha256": source_digest(root),
        "train_data_sha256": sha256_file(Path(args.train_data)),
        "validation_data_sha256": sha256_file(Path(args.validation_data)),
        "train_examples": len(train_dataset),
        "validation_examples": len(eval_dataset),
        "truncated_train_examples": train_dataset.truncated,
        "truncated_validation_examples": eval_dataset.truncated,
        "trainable_parameters": trainable,
        "total_parameters": total,
        "train_result": result.metrics,
        "evaluation": eval_metrics,
        "peak_gpu_memory_bytes": torch.cuda.max_memory_allocated(),
        "gpu": torch.cuda.get_device_name(0),
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "python": platform.python_version(),
        "source_git_sha": git_sha(root),
    }
    write_json(receipt_path / "training_receipt.json", receipt)
    with (receipt_path / "trainer_log.jsonl").open("w", encoding="utf-8") as handle:
        for item in trainer.state.log_history:
            handle.write(json.dumps(item, sort_keys=True, default=str) + "\n")
    print(json.dumps(receipt, indent=2, sort_keys=True, default=str), flush=True)


if __name__ == "__main__":
    main()
