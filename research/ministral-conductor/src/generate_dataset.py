from __future__ import annotations

import argparse
import json
from pathlib import Path

from conductor_data import write_dataset


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the Dot Loom conductor corpus")
    parser.add_argument("--output", type=Path, default=Path("data"))
    parser.add_argument("--seed", type=int, default=20260716)
    parser.add_argument("--train", type=int, default=9_000)
    parser.add_argument("--validation", type=int, default=900)
    parser.add_argument("--test", type=int, default=1_200)
    args = parser.parse_args()
    manifest = write_dataset(args.output, args.seed, args.train, args.validation, args.test)
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
