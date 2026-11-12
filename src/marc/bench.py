"""Score an engine against the hidden world it never saw.

Predicted relationships are matched to hidden arrangements through their evidence: a
relationship counts only if most of the lines it cites really came from the arrangement it
claims. A relationship with no evidence can't score.
"""

from __future__ import annotations

import dataclasses
from collections import Counter
from dataclasses import dataclass

from marc.cost import Ledger
from marc.discover import find_opportunities
from marc.engines import Engine
from marc.schema import Document, Relationship, SourceSpan
from marc.world import TruthKey, build_world, render, true_relationships

RATE_TOLERANCE = 0.02


@dataclass(frozen=True)
class Score:
    seed: int
    engine: str
    invoices: int
    invoices_used: int
    rel_true: int
    rel_pred: int
    rel_matched: int
    rel_duplicates: int
    rel_unread: int
    rate_ok: int
    unsourced: int
    opp_true: int
    opp_pred: int
    opp_matched: int
    savings_available: float
    savings_found: float
    savings_claimed: float
    model_usd: float
    model_calls: int


def score(engine: Engine, seed: int) -> Score:
    world = build_world(seed)
    corpus, truth = render(world, seed)
    ledger = Ledger()
    predicted = engine.run(corpus, ledger)

    docs = {d.id: d for d in corpus.documents}
    actual = {(r.property_id, r.vendor_key, r.category): r for r in true_relationships(world)}
    matched, duplicates = match_relationships(predicted, truth)
    cited = {k for r in predicted for span in r.evidence if (k := truth_of(span, truth))}

    true_opps = {
        (o.relationship.property_id, o.relationship.category): o
        for o in find_opportunities(actual.values(), corpus.properties, corpus.quotes)
    }
    predicted_opps = find_opportunities(predicted, corpus.properties, corpus.quotes)
    claimed: set[tuple[str, str]] = set()
    for opp in sorted(predicted_opps, key=lambda o: -o.annual_savings):
        key = (opp.relationship.property_id, opp.relationship.category)
        if key in true_opps:
            claimed.add(key)

    return Score(
        seed=seed,
        engine=engine.name,
        invoices=sum(d.kind == "invoice" for d in corpus.documents),
        invoices_used=len({s.doc_id for r in predicted for s in r.evidence if s.doc_id in docs and docs[s.doc_id].kind == "invoice"}),
        rel_true=len(actual),
        rel_pred=len(predicted),
        rel_matched=len(matched),
        rel_duplicates=duplicates,
        rel_unread=sum(k not in cited for k in actual),
        rate_ok=sum(
            abs(predicted[i].current_rate - actual[k].current_rate) <= RATE_TOLERANCE * actual[k].current_rate
            for i, k in matched.items()
        ),
        unsourced=sum(not is_sourced(r, docs) for r in predicted),
        opp_true=len(true_opps),
        opp_pred=len(predicted_opps),
        opp_matched=len(claimed),
        savings_available=round(sum(o.annual_savings for o in true_opps.values()), 2),
        savings_found=round(sum(true_opps[k].annual_savings for k in claimed), 2),
        savings_claimed=round(sum(o.annual_savings for o in predicted_opps), 2),
        model_usd=ledger.usd,
        model_calls=ledger.calls,
    )


def truth_of(span: SourceSpan, truth: dict[str, TruthKey]) -> TruthKey | None:
    return truth.get(f"{span.doc_id}:{span.line}") or truth.get(span.doc_id)


def match_relationships(predicted: list[Relationship], truth: dict[str, TruthKey]) -> tuple[dict[int, TruthKey], int]:
    """Map predicted relationships (by index) to hidden arrangements, and count duplicates.

    Each arrangement matches once. A duplicate, such as one vendor split across two spellings
    of its name, is a correct-looking relationship whose arrangement was already taken; it
    counts against precision.
    """
    claims = []
    for index, rel in enumerate(predicted):
        votes = Counter(k for span in rel.evidence if (k := truth_of(span, truth)))
        if not votes:
            continue
        key, count = votes.most_common(1)[0]
        if key[0] == rel.property_id and key[2] == rel.category:
            claims.append((count, -index, key))
    matched: dict[int, TruthKey] = {}
    taken: set[TruthKey] = set()
    for _, neg_index, key in sorted(claims, reverse=True):
        if key not in taken:
            taken.add(key)
            matched[-neg_index] = key
    return matched, len(claims) - len(matched)


def is_sourced(rel: Relationship, docs: dict[str, Document]) -> bool:
    """True if the reported rate appears on at least one line the relationship cites."""
    needle = f"{rel.current_rate:.2f}"
    for span in rel.evidence:
        doc = docs.get(span.doc_id)
        if doc and 0 < span.line <= len(doc.lines) and needle in doc.lines[span.line - 1]:
            return True
    return False


def format_table(scores: list[Score]) -> str:
    header = (
        "| seed | invoices used | relationships P / R | duplicates | never read | rate within 2% | unsourced "
        "| opportunities P / R | savings found / available | savings claimed | model spend |"
    )
    rows = [header, "|" + "---|" * 11]
    rows += [_row(str(s.seed), s) for s in scores]
    if len(scores) > 1:
        totals = {
            f.name: sum(getattr(s, f.name) for s in scores)
            for f in dataclasses.fields(Score)
            if f.name not in ("seed", "engine")
        }
        rows.append(_row("all", Score(seed=0, engine=scores[0].engine, **totals)))
    return "\n".join(rows)


def _row(label: str, s: Score) -> str:
    return (
        f"| {label} | {s.invoices_used}/{s.invoices} "
        f"| {_pct(s.rel_matched, s.rel_pred)} / {_pct(s.rel_matched, s.rel_true)} "
        f"| {s.rel_duplicates} | {s.rel_unread} | {_pct(s.rate_ok, s.rel_matched)} | {s.unsourced} "
        f"| {_pct(s.opp_matched, s.opp_pred)} / {_pct(s.opp_matched, s.opp_true)} "
        f"| {_usd(s.savings_found)} / {_usd(s.savings_available)} | {_usd(s.savings_claimed)} "
        f"| ${s.model_usd:.2f} |"
    )


def _pct(n: int, d: int) -> str:
    return f"{n / d:.0%}" if d else "n/a"


def _usd(x: float) -> str:
    return f"${x / 1000:,.1f}k"
