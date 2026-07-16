from __future__ import annotations

from pathlib import Path
from typing import Any


def load_text_tokenizer(model_path: str | Path) -> Any:
    """Load the text backend recommended by the Ministral 3 model card."""
    from transformers import MistralCommonBackend

    tokenizer = MistralCommonBackend.from_pretrained(str(model_path))
    return tokenizer


def encode_text(tokenizer: Any, text: str) -> list[int]:
    encoded = tokenizer.encode(text, add_special_tokens=False)
    if hasattr(encoded, "tolist"):
        encoded = encoded.tolist()
    if encoded and isinstance(encoded[0], list):
        encoded = encoded[0]
    return [int(token) for token in encoded]


def decode_text(tokenizer: Any, token_ids: Any) -> str:
    if hasattr(token_ids, "tolist"):
        token_ids = token_ids.tolist()
    try:
        return str(tokenizer.decode(token_ids, skip_special_tokens=True))
    except TypeError:
        return str(tokenizer.decode(token_ids))


def token_id(tokenizer: Any, name: str, fallback: int | None = None) -> int:
    value = getattr(tokenizer, name, None)
    if value is None:
        value = fallback
    if value is None:
        raise ValueError(f"Tokenizer is missing {name}")
    return int(value)
