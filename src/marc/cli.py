"""`marc bench` scores an engine; `marc dump` writes a sample corpus to disk for inspection."""

from __future__ import annotations

import argparse
from pathlib import Path

from marc.bench import format_table, score
from marc.engines import ENGINES
from marc.world import build_world, render

_EXTENSION = {"invoice": "txt", "pricing_sheet": "txt", "gl_export": "csv"}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="marc")
    commands = parser.add_subparsers(dest="command", required=True)

    bench = commands.add_parser("bench", help="score an engine against hidden worlds")
    bench.add_argument("--engine", choices=sorted(ENGINES), default="baseline")
    bench.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3])

    dump = commands.add_parser("dump", help="write one world's documents (and its hidden truth) to disk")
    dump.add_argument("--seed", type=int, default=1)
    dump.add_argument("--out", type=Path, default=Path("sample"))

    args = parser.parse_args(argv)
    if args.command == "bench":
        engine = ENGINES[args.engine]
        print(f"engine: {engine.name}\n")
        print(format_table([score(engine, seed) for seed in args.seeds]))
    else:
        _dump(args.seed, args.out)


def _dump(seed: int, out: Path) -> None:
    world = build_world(seed)
    corpus, _ = render(world, seed)
    for doc in corpus.documents:
        path = out / doc.kind / f"{doc.id}.{_EXTENSION[doc.kind]}"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(doc.lines) + "\n")
    hidden = out / "_hidden"
    hidden.mkdir(parents=True, exist_ok=True)
    (hidden / "world.json").write_text(world.model_dump_json(indent=2))
    print(f"wrote {len(corpus.documents)} documents to {out}/ (hidden truth in {hidden}/world.json)")


if __name__ == "__main__":
    main()
