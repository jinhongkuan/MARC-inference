"""An engine turns a corpus into relationships. Engines differ in which stages they use and what those cost."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from marc.cost import Ledger
from marc.infer import infer_relationships
from marc.ingest import parse_table_invoice
from marc.resolve import category_by_keyword, unit_as_written, vendor_key_exact
from marc.schema import Corpus, Relationship


class Engine(Protocol):
    name: str

    def run(self, corpus: Corpus, ledger: Ledger) -> list[Relationship]: ...


@dataclass(frozen=True)
class Baseline:
    """Free and naive: one known invoice layout, exact vendor names, keyword categories, units as written.

    Ignores GL lines and pricing sheets entirely.
    """

    name: str = "baseline"

    def run(self, corpus: Corpus, ledger: Ledger) -> list[Relationship]:
        items = [item for doc in corpus.documents for item in parse_table_invoice(doc)]
        return infer_relationships(
            items,
            category_of=category_by_keyword,
            vendor_key=vendor_key_exact,
            unit_of=unit_as_written,
        )


ENGINES: dict[str, Engine] = {"baseline": Baseline()}
