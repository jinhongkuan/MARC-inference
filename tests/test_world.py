from datetime import date

from marc.world import build_world, render
from marc.world.model import escalated


def test_same_seed_same_world_and_documents():
    assert build_world(3) == build_world(3)
    assert render(build_world(3), 3) == render(build_world(3), 3)


def test_escalator_steps_on_each_anniversary():
    start = date(2024, 3, 1)
    assert escalated(100.0, 0.05, start, date(2025, 2, 28)) == 100.0
    assert escalated(100.0, 0.05, start, date(2025, 3, 1)) == 105.0
    assert escalated(100.0, 0.05, start, date(2026, 3, 1)) == 110.25


def test_every_invoice_and_gl_row_traces_to_an_arrangement():
    world = build_world(1)
    corpus, truth = render(world, 1)
    arrangements = {(a.property_id, a.vendor_id, a.category) for a in world.arrangements}
    invoices = [d for d in corpus.documents if d.kind == "invoice"]
    [gl] = [d for d in corpus.documents if d.kind == "gl_export"]
    assert invoices
    assert all(truth[d.id] in arrangements for d in invoices)
    assert all(truth[f"gl-export:{line}"] in arrangements for line in range(2, len(gl.lines) + 1))


def test_corpus_does_not_leak_hidden_ids():
    world = build_world(1)
    corpus, _ = render(world, 1)
    hidden = [v.id for v in world.vendors] + [a.id for a in world.agreements]
    text = "\n".join(line for d in corpus.documents for line in (d.id, *d.lines))
    assert not [h for h in hidden if h in text]
