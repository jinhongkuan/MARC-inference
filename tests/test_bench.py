from collections import defaultdict
from dataclasses import dataclass

from marc.bench import score
from marc.cost import Ledger
from marc.engines import ENGINES
from marc.ingest import parse_table_invoice
from marc.schema import Corpus, Relationship, SourceSpan
from marc.world import build_world, render, true_relationships


@dataclass(frozen=True)
class Oracle:
    """Reports the hidden relationships, citing every invoice behind each. Tests the harness, not an engine."""

    seed: int
    name: str = "oracle"

    def run(self, corpus: Corpus, ledger: Ledger) -> list[Relationship]:
        world = build_world(self.seed)
        _, truth = render(world, self.seed)
        evidence = defaultdict(list)
        for location, key in truth.items():
            if ":" not in location:
                evidence[key].append(SourceSpan(doc_id=location, line=1))
        return [
            r.model_copy(update={"evidence": tuple(evidence[(r.property_id, r.vendor_key, r.category)])})
            for r in true_relationships(world)
        ]


def test_harness_gives_a_perfect_engine_a_perfect_score():
    s = score(Oracle(seed=3), seed=3)
    assert s.opp_true > 0
    assert s.rel_matched == s.rel_true == s.rel_pred
    assert s.rate_ok == s.rel_true
    assert s.opp_matched == s.opp_true == s.opp_pred
    assert s.savings_found == s.savings_available


def test_table_parser_reads_back_the_hidden_rate():
    world = build_world(2)
    corpus, truth = render(world, 2)
    arrangements = {(a.property_id, a.vendor_id, a.category): a for a in world.arrangements}
    invoices = [d for d in corpus.documents if d.kind == "invoice"]
    tables = [d for d in invoices if d.lines[0] == "INVOICE"]
    assert tables
    for doc in tables:
        [item] = parse_table_invoice(doc)
        assert item.property_id == truth[doc.id][0]
        assert item.rate == arrangements[truth[doc.id]].rate_on(item.invoiced_on)
    assert all(parse_table_invoice(d) == [] for d in invoices if d.lines[0] != "INVOICE")


def test_baseline_only_reports_rates_it_can_point_to():
    s = score(ENGINES["baseline"], seed=1)
    assert s.rel_matched > 0
    assert s.unsourced == 0
    assert s.model_usd == 0
