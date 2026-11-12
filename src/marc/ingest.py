"""Documents -> line items, each tied to the exact line it was read from."""

from __future__ import annotations

import re
from datetime import date

from marc.schema import Document, Frozen, SourceSpan


class LineItem(Frozen):
    span: SourceSpan
    vendor_raw: str
    property_id: str
    invoiced_on: date
    description: str
    qty: float
    unit: str
    rate: float


_DATE = re.compile(r"^Invoice Date: (\d{4}-\d{2}-\d{2})$")
_BILL_TO = re.compile(r"^Bill To: .*\(([A-Z]{3}-\d{2})\)$")
_ITEM = re.compile(
    r"^(?P<desc>\S.*?)\s{2,}(?P<qty>\d+)\s{2,}(?P<unit>\S+)\s+(?P<rate>\d+\.\d{2})\s+(?P<amount>\d+\.\d{2})$"
)


def parse_table_invoice(doc: Document) -> list[LineItem]:
    """Parse the one invoice layout the baseline knows. Any other layout yields nothing."""
    if doc.kind != "invoice" or len(doc.lines) < 2 or doc.lines[0] != "INVOICE":
        return []
    invoiced_on: date | None = None
    property_id: str | None = None
    for text in doc.lines:
        if m := _DATE.match(text):
            invoiced_on = date.fromisoformat(m[1])
        elif m := _BILL_TO.match(text):
            property_id = m[1]
    if invoiced_on is None or property_id is None:
        return []
    return [
        LineItem(
            span=SourceSpan(doc_id=doc.id, line=number),
            vendor_raw=doc.lines[1].strip(),
            property_id=property_id,
            invoiced_on=invoiced_on,
            description=m["desc"].strip(),
            qty=float(m["qty"]),
            unit=m["unit"],
            rate=float(m["rate"]),
        )
        for number, text in enumerate(doc.lines, start=1)
        if (m := _ITEM.match(text))
    ]
