"""Render the hidden world into the documents MARC would actually receive."""

from __future__ import annotations

import random
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date

from marc.schema import Category, Corpus, Document, Property
from marc.world.model import Arrangement, Vendor, World

TruthKey = tuple[str, str, Category]  # (property_id, vendor_id, category)

GL_ACCOUNT = {
    Category.PEST_CONTROL: "6410 Pest Control",
    Category.LANDSCAPING: "6420 Landscaping",
    Category.WASTE_REMOVAL: "6430 Trash Removal",
    Category.JANITORIAL: "6440 Janitorial",
}
MISCODED_ACCOUNT = "6500 Repairs & Maintenance"


@dataclass(frozen=True)
class RenderConfig:
    alias_rate: float = 0.3  # invoices that print a variant of the vendor's name
    missed_visit_rate: float = 0.08  # months billed for one visit fewer than contracted
    missing_invoice_rate: float = 0.08  # bills that exist only as a GL line
    miscoded_gl_rate: float = 0.05  # GL lines booked to the wrong account


@dataclass(frozen=True)
class _Bill:
    day: date
    arrangement: Arrangement
    vendor_name: str
    qty: int
    rate: float
    has_invoice: bool
    account: str


def render(world: World, seed: int, cfg: RenderConfig = RenderConfig()) -> tuple[Corpus, dict[str, TruthKey]]:
    """Return what an engine sees, plus where each source location really came from.

    The truth map is keyed by `doc_id` for invoices and `doc_id:line` for GL rows. Only the
    benchmark reads it.
    """
    rng = random.Random(seed + 1_000_003)
    vendors = {v.id: v for v in world.vendors}
    properties = {p.id: p for p in world.properties}

    bills: list[_Bill] = []
    for arr in world.arrangements:
        vendor = vendors[arr.vendor_id]
        for month in _months(world.window_start, world.as_of):
            day = month.replace(day=vendor.billing_day)
            missed = arr.monthly_qty > 1 and rng.random() < cfg.missed_visit_rate
            name = rng.choice(vendor.aliases[1:]) if rng.random() < cfg.alias_rate else vendor.legal_name
            bills.append(_Bill(
                day=day,
                arrangement=arr,
                vendor_name=name,
                qty=arr.monthly_qty - int(missed),
                rate=arr.rate_on(day),
                has_invoice=rng.random() >= cfg.missing_invoice_rate,
                account=MISCODED_ACCOUNT if rng.random() < cfg.miscoded_gl_rate else GL_ACCOUNT[arr.category],
            ))
    bills.sort(key=lambda b: (b.day, b.arrangement.vendor_id, b.arrangement.property_id))

    documents: list[Document] = []
    truth: dict[str, TruthKey] = {}
    sequence: dict[str, int] = {}
    gl = ["date,property_id,gl_account,vendor,memo,amount"]
    for bill in bills:
        arr = bill.arrangement
        vendor = vendors[arr.vendor_id]
        prop = properties[arr.property_id]
        key: TruthKey = (arr.property_id, arr.vendor_id, arr.category)
        sequence[vendor.id] = sequence.get(vendor.id, 0) + 1
        number = f"{vendor.invoice_prefix}-{sequence[vendor.id]:04d}"
        amount = round(bill.qty * bill.rate, 2)
        if bill.has_invoice:
            doc_id = f"inv-{len(documents) + 1:05d}"
            layout = _table if vendor.layout == "table" else _inline
            lines = layout(bill.vendor_name, vendor, number, bill.day, prop, bill.qty, bill.rate, amount)
            documents.append(Document(id=doc_id, kind="invoice", lines=lines))
            truth[doc_id] = key
        gl.append(",".join((
            bill.day.isoformat(), prop.id, bill.account,
            bill.vendor_name.upper()[:20].rstrip(), number, f"{amount:.2f}",
        )))
        truth[f"gl-export:{len(gl)}"] = key

    documents.append(Document(id="gl-export", kind="gl_export", lines=tuple(gl)))
    documents.extend(_pricing_sheets(world, vendors))
    corpus = Corpus(as_of=world.as_of, properties=world.properties, quotes=world.quotes, documents=tuple(documents))
    return corpus, truth


def _table(name: str, vendor: Vendor, number: str, day: date, prop: Property, qty: int, rate: float, amount: float) -> tuple[str, ...]:
    return (
        "INVOICE",
        name,
        f"Invoice No: {number}",
        f"Invoice Date: {day.isoformat()}",
        f"Bill To: {prop.name} ({prop.id})",
        "",
        f"{'Description':<34}{'Qty':>5}  {'Unit':<7}{'Rate':>10}{'Amount':>12}",
        f"{vendor.description:<34}{qty:>5}  {vendor.unit_label:<7}{rate:>10.2f}{amount:>12.2f}",
        "",
        f"{'TOTAL DUE':<58}{amount:>12.2f}",
    )


def _inline(name: str, vendor: Vendor, number: str, day: date, prop: Property, qty: int, rate: float, amount: float) -> tuple[str, ...]:
    return (
        f"{name} | Inv {number} | {day:%m/%d/%Y}",
        f"Service location: {prop.id} {prop.name}",
        f"{qty} x {vendor.description} @ {rate:.2f}/{vendor.unit_label} = {amount:.2f}",
        f"Amount due: {amount:.2f}",
    )


def _pricing_sheets(world: World, vendors: dict[str, Vendor]) -> list[Document]:
    owners = {o.id: o for o in world.owners}
    sheets: list[Document] = []
    for ag in world.agreements:
        if not ag.has_pricing_sheet:
            continue
        vendor = vendors[ag.vendor_id]
        sheets.append(Document(id=f"ps-{len(sheets) + 1:03d}", kind="pricing_sheet", lines=(
            vendor.legal_name,
            "RATE SCHEDULE",
            f"Prepared for: {owners[ag.owner_id].name}",
            f"Effective: {ag.start:%B} {ag.start.day}, {ag.start.year}",
            f"Service: {vendor.description}",
            f"Rate: ${ag.base_rate:.2f} per {vendor.unit_label}",
            f"Annual adjustment: {ag.escalator_pct:.0%} on each anniversary",
            f"Locations: {', '.join(ag.property_ids)}",
        )))
    return sheets


def _months(start: date, end: date) -> Iterator[date]:
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        yield date(year, month, 1)
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
