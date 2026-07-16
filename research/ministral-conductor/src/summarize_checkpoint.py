from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def sha256_file(path_value: Path) -> str:
    digest = hashlib.sha256()
    with path_value.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Record validation-selected checkpoint and adapter hashes")
    parser.add_argument(
        "--state",
        type=Path,
        default=Path("artifacts/ministral-14b-loom-conductor-v2/checkpoints/trainer_state.json"),
    )
    parser.add_argument(
        "--adapter",
        type=Path,
        default=Path("artifacts/ministral-14b-loom-conductor-v2/adapter"),
    )
    parser.add_argument("--output", type=Path, default=Path("receipts/checkpoint-selection.json"))
    args = parser.parse_args()
    state: dict[str, Any] = json.loads(args.state.read_text(encoding="utf-8"))
    best_path = Path(str(state.get("best_model_checkpoint") or ""))
    adapter_files = sorted(path for path in args.adapter.rglob("*") if path.is_file())
    receipt = {
        "selection_method": "lowest validation loss across saved checkpoints",
        "best_checkpoint": best_path.name or None,
        "best_metric": state.get("best_metric"),
        "completed_optimizer_steps": state.get("global_step"),
        "completed_epoch": state.get("epoch"),
        "adapter_files": [
            {
                "path": str(path.relative_to(args.adapter)),
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            }
            for path in adapter_files
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(receipt, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
