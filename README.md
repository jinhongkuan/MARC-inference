# MARC-inference

Most procurement software for property management handles the administrative burden: purchase orders, approvals, invoice capture. MARC infers existing owner–vendor relationships from varied source data (invoices, GL exports, pricing sheets) and uses them to drive agent-led negotiation that brings down OpEx for goods and services.

This repo is a spike on MARC's distinct engineering challenge: a proprietary engine that discovers missed savings opportunities, which voice agents can then refine and verify. It also compares ML pipelines on accuracy against what they cost MARC to run, because inference spend is MARC's own OpEx.

## The problem

Most negotiated rates aren't written down anywhere MARC can read. The rate a property really pays is a hidden variable, and the documents are noisy observations of it:

```
                      hidden agreement
          (vendor, rate, escalator, which properties)
                             │
        ┌────────────────────┼─────────────────────┐
        ▼                    ▼                     ▼
     invoices            GL export           pricing sheets
  unit prices; layout   amounts only; some   when the customer
  and wording vary by   bills appear only    has them
  vendor; vendor names  here; some lines
  vary                  in the wrong account
```

The engine has to work back from those observations to the agreement, then find where a property pays more than it should.

## What's here

| Stage | Turns | Into | Kind | Status |
|---|---|---|---|---|
| `ingest` | documents | line items, each tied to its source line | fuzzy | baseline: one invoice layout |
| `resolve` | raw strings | vendors, categories, units | fuzzy | baseline: exact names, keywords |
| `infer` | line items | relationships: current rate, annual volume, evidence | fuzzy | baseline: latest price, volume over the window |
| `discover` | relationships | opportunities: portfolio gap, above market | deterministic | done |
| verify | opportunities | terms confirmed with the vendor | voice agent | not started |

The split is deliberate: a fuzzy periphery around a deterministic core. `discover` runs the same rules on the hidden truth and on whatever an engine infers, so every discovery error traces back to an inference error. [docs/references/aethis.md](docs/references/aethis.md) covers why the deterministic parts should also be frozen.

```
uv sync
uv run marc bench --seeds 1 2 3 4 5   # score the baseline
uv run marc dump --seed 1             # write one world's documents to sample/
uv run pytest
```

## The synthetic world

Recall can't be measured on real data, because nobody knows the full set of agreements. That gap is the reason MARC is valuable. So the generator builds the hidden agreements first and renders documents from them, which makes ground truth exact and free.

Each seed has 4 owners across 3 regions, about 20 properties, 24 months of billing and roughly 2,000 invoices. It plants:

- vendor name variants on 30% of invoices
- two invoice layouts, fixed per vendor
- per-vendor descriptions and unit labels, including trade shorthand ("FEL SVC 4YD", "JAN SVC - MONTHLY")
- annual escalators of 0–5%, on agreements that started up to 2.5 years before the window
- off-contract purchases at a 12–40% premium, for a quarter of property-categories
- bills that exist only as a GL line (8%), and GL lines booked to the wrong account (5%)
- pricing sheets for about half the agreements
- one external market quote per region and category

The weakness is that it's only as realistic as its noise model. The first job with real data is to calibrate the generator against one redacted GL export and a few dozen invoices.

`marc dump` writes a world's documents to `sample/`, with the hidden truth in `sample/_hidden/world.json`.

## Benchmark

| Column | Meaning |
|---|---|
| relationships P / R | Precision and recall against hidden arrangements. A relationship is matched through the lines it cites, not by name, so one with no evidence can't score. |
| duplicates | Arrangements reported more than once, e.g. one vendor under two spellings. Costs precision. |
| never read | Hidden arrangements none of whose documents the engine cited. Costs recall. |
| rate within 2% | Share of matched relationships whose current rate is right. |
| unsourced | Relationships whose reported rate isn't on any line they cite. Must stay 0. |
| opportunities P / R | Against the opportunities the same rules find in the hidden truth. |
| savings found / available | Estimated annual savings: the true value of the opportunities found, against all of them. Estimated, not realized. |
| savings claimed | What the engine itself estimates. The gap from "found" is a calibration error. |
| model spend | From the ledger every model call charges. |

### Baseline

`uv run marc bench --seeds 1 2 3 4 5`

| seed | invoices used | relationships P / R | duplicates | never read | rate within 2% | unsourced | opportunities P / R | savings found / available | savings claimed | model spend |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 500/1764 | 31% / 29% | 51 | 57 | 100% | 0 | 46% / 14% | $20.3k / $61.1k | $11.9k | $0.00 |
| 2 | 535/2123 | 27% / 25% | 65 | 72 | 100% | 0 | 36% / 22% | $21.1k / $62.2k | $15.6k | $0.00 |
| 3 | 644/2131 | 30% / 30% | 67 | 67 | 100% | 0 | 35% / 18% | $15.7k / $102.0k | $13.4k | $0.00 |
| 4 | 917/1759 | 32% / 52% | 90 | 38 | 95% | 0 | 42% / 30% | $10.7k / $38.0k | $8.9k | $0.00 |
| 5 | 789/1927 | 30% / 41% | 85 | 52 | 100% | 0 | 21% / 16% | $13.8k / $80.9k | $12.9k | $0.00 |
| all | 3385/9704 | 30% / 35% | 358 | 286 | 99% | 0 | 34% / 19% | $81.6k / $344.1k | $62.7k | $0.00 |

What it says:

- **Every false positive is a duplicate.** Each one is a vendor showing up under a second spelling of its name. Vendor resolution is the first fix, and the cheapest.
- **Every miss is an arrangement never read.** Of the 286, 157 come from vendors that use the invoice layout the baseline can't parse. Another 86 have a description no keyword catches, and 43 have both problems.
- **Rates are right when found (99%).** The hard part is coverage, which is also where the call landed.
- **It under-claims.** It estimates $62.7k in total, less than the $81.6k its correct finds are actually worth. A vendor split across spellings splits its volume, so annual quantities come out low.

## Keeping MARC's own costs down

Planned tiers, cheapest first:

1. **Deterministic first.** A vendor's invoices share a layout, so a parser per layout costs nothing per invoice.
2. **A small model once per distinct string, not once per document.** Seed 1 has 1,764 invoices, but only 61 distinct vendor names and 10 distinct descriptions.
3. **A large model only for the low-confidence, high-dollar residue.**
4. **Compile and freeze.** When a model handles a new layout or description, it writes the parser or table entry for it. That artifact is tested against labeled invoices and versioned, and from then on it runs without a model. A model upgrade becomes a recompile you can diff, not a silent change in what MARC recommends.

## Roadmap

- [x] synthetic world, renderers, benchmark harness
- [x] deterministic baseline and opportunity rules
- [ ] vendor resolution: normalize, fuzzy match, small model for what's left
- [ ] parser for the second layout; model fallback for unknown layouts, compiled into parsers
- [ ] description → category with a small model, cached per distinct string
- [ ] unit normalization
- [ ] escalator inference from price steps; pricing sheet ingestion
- [ ] spend recovery from GL lines alone (missing invoices, miscoded accounts)
- [ ] "undetermined" as an answer: thin-evidence opportunities return the question that would settle them
- [ ] simulated vendor for the verify loop, answering from the hidden world
- [ ] fence vendor-written text before it reaches any model
- [ ] one traced purchase request, end to end

Out of scope: SSO, real voice calls, UI, payments. Every output stops at a draft a human approves.

## Open questions for real data

- What does a customer's handoff look like: GL exports from their property-management system, invoice PDFs from accounts payable, or both?
- Are contracts in it, or only invoices?
- How often can customers produce pricing sheets?
- Is property master data (owner, region, size) good enough to compare like with like?

## Docs

- [Reference: Aethis](docs/references/aethis.md): what a frozen-ruleset decision engine teaches MARC about keeping accuracy when models change.
