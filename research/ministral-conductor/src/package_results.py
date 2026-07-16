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
    parser = argparse.ArgumentParser(description="Hash the reproducible conductor research package")
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, default=Path("artifacts/RESULTS-MANIFEST.json"))
    args = parser.parse_args()
    root = args.root.resolve()
    output = (root / args.output).resolve() if not args.output.is_absolute() else args.output
    include_roots = ("data", "src", "tests", "demo", "docs", "receipts", "reports", "charts")
    records: list[dict[str, Any]] = []
    for name in ("README.md", "MODEL_CARD.md", "requirements.txt"):
        path_value = root / name
        if path_value.exists():
            records.append({
                "path": name,
                "bytes": path_value.stat().st_size,
                "sha256": sha256_file(path_value),
            })
    for directory in include_roots:
        base = root / directory
        if not base.exists():
            continue
        for path_value in sorted(path for path in base.rglob("*") if path.is_file()):
            if "__pycache__" in path_value.parts or path_value.suffix in {".pyc", ".log"}:
                continue
            records.append({
                "path": str(path_value.relative_to(root)),
                "bytes": path_value.stat().st_size,
                "sha256": sha256_file(path_value),
            })
    adapter = root / "artifacts" / "ministral-14b-loom-conductor-v2" / "adapter"
    if adapter.exists():
        for path_value in sorted(path for path in adapter.rglob("*") if path.is_file()):
            records.append({
                "path": str(path_value.relative_to(root)),
                "bytes": path_value.stat().st_size,
                "sha256": sha256_file(path_value),
            })
    manifest = {
        "format": "dot-loom-conductor-results-v1",
        "files": records,
        "file_count": len(records),
        "total_bytes": sum(record["bytes"] for record in records),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "manifest": str(output.relative_to(root)),
        "file_count": manifest["file_count"],
        "total_bytes": manifest["total_bytes"],
        "sha256": sha256_file(output),
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
