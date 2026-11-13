# MARC-inference

Most procurement software for property management handles the administrative burden. MARC infers existing owner–vendor relationships from varied source data (invoices, GL exports, pricing sheets) and uses them to drive agent-led negotiation that brings down OpEx for goods and services.

This repo is a spike on MARC's distinct engineering challenge: **how to accurately discover missed savings opportunities at scale when the source data may only have incomplete traces of pre-negotiated deals?**

It also compares ML pipelines on accuracy against what they cost MARC to run, because inference spend is MARC's own OpEx.

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

## The approach

One global judgment you can't measure becomes thousands of local ones you can.

![One prompt with implicit math, against encoded Prolog strategies with explicit math](docs/img/overview.svg)

On 1,164 real advertising orders from 19 held-out TV stations, checking that one agency's clients pay the same rate for the same slot:

| | Haiku 5.5 alone | Haiku 5.5 + Prolog rule | Opus 5.5 alone |
|---|---|---|---|
| Precision (95% interval) | 75% [62, 85] | 96% [87, 99] | **97% [88, 99]** |
| Recall (95% interval) | 68% [56, 79] | 86% [75, 93] | **100% [94, 100]** |
| Cost | $3.58 | **$2.69** | $32.66 |
| Cost per correct finding | $0.09 | **$0.05** | $0.57 |

One run per approach, with findings judged by Claude Fable 5.2 rather than a person. The setup, the errors and the limits are in [results/2026-11-12-uniform-spend-19-stations.md](results/2026-11-12-uniform-spend-19-stations.md).

There are three ways to answer a question like "does this invoice match what was agreed?"

|              | How it works                                                                                                                             | What it costs                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trivial**  | Give a frontier model the documents for every question, and cache answers by question.                                                   | Accurate, but costly and slow. Every new question re-reads the documents, and a cached answer only helps the identical question.                            |
| **Baseline** | Decide the fields up front (item, quantity, price), parse every document into them, store them in a database, and query it.              | Cheap and fast per query, until a question needs a field nobody extracted. Then the schema has to be migrated and every document read again to backfill it. |
| **Proposed** | Write the question as a Prolog rule. The rule asks for the facts it needs, and each fact is read from its document on demand and cached. | Work grows with what the questions touch, not with the corpus. A new question reads only the facts no earlier question asked for.                           |

The baseline's weak point is that someone has to guess the fields before knowing the questions. The proposed design works backwards from the question, so nothing is extracted on a guess, and the cache is built from facts that a real question needed.

**Why Prolog?** Every strategy is a join across documents. It takes the rate on an invoice line, the door count on a rent roll and the cap in a contract, and matches them on property, vendor and item. In Prolog that join is the rule itself. Shared variables like `Prop` and `Item` do the matching and backtracking searches the combinations, so a rule states what must hold without spelling out how to find it. Prolog also handles caching: tabling stores each subgoal it proves, so a `rate(_, oak03, valet_trash, _)` worked out for one rule is reused by every rule that asks the same question.

What Prolog doesn't decide is which documents it searches. That set is fixed ahead of time from **owner–vendor metadata**, before any rule runs (see [Routing decides what a query may touch](#routing-decides-what-a-query-may-touch)). The diagram shows the design this spike builds toward, and its figures are illustrative.

## The architecture

A Prolog engine runs rulesets over a sparse Postgres fact table, and a message queue feeds the facts it's missing to batched extraction workers that read them from the source documents.

![A pending spend decision (out of scope, the motivating use case) queries the Prolog engine. The engine loads facts from a sparse Postgres fact table. Missing facts go onto a message queue, extraction workers drain it in batches, read the documents and write the facts back, and the engine reruns. Findings go to a voice agent (also out of scope) and a human approves](docs/img/system.svg)

This is to support lazy compute: nothing is extracted until a rule asks for it, and anything extracted once is reused by every rule after. The test is amending a ruleset. Parse at ingestion pays for a new column on every document. The lazy design pays for one more batched model call, and only for the leaves the new rule reaches.

![Side by side: parse at ingestion fills every field of every document, including fields no rule uses, and backfills a new column when the ruleset is amended. The lazy design computes only the leaves the rules reach, in batched model calls, and the amended ruleset adds one batch on top of cached work](docs/img/architecture.svg)

In short:

- **Lazy compute.** Rulesets run as a query when a spend decision is pending, not on a schedule. Each fact is read from its document the first time a rule asks for it.
- **Deterministic routing.** Owner–vendor metadata, not a model, decides which documents a query may touch. Evidence a rule negates is routed more broadly than evidence it asserts.
- **Persist facts, not answers.** Facts cost a model call, so they live in Postgres, keyed so they invalidate themselves. Derived answers cost milliseconds of Prolog, so they stay in memory.
- **Batch the misses.** The engine queues every fact it's missing, workers extract them in batches, and the query reruns until nothing is missing.
- **The cost:** latency on cold data, and no standing list of every opportunity.

The spike's code is still a staged pipeline (ingest, resolve, infer, discover). The rest of this section describes where it's headed.

### Requirements

1. **General across formats.** One ruleset holds across invoice layouts, vendor spellings, units and document kinds. A new format must not need a new ruleset.
2. **Precise enough to place a call.** A finding has to justify a voice agent phoning a vendor. A false call spends vendor goodwill and reads as spam. A missed one can be caught later by another ruleset. When the two conflict, precision wins.
3. **Scales to millions of raw sources.** The assumption is that volume grows mostly with the number of customers, not the size of one, so each customer's corpus stays small enough to query on its own. That holds for owner-operators. Revisit it when MARC sells to third-party managers, whose portfolios span many owners.

### Lazy compute: run rulesets when money is about to move

Rulesets don't sweep the corpus on a schedule. They run as a query when a spend decision is pending: a purchase order about to be placed, or a recurring contract coming up for renewal. `?- ensure_uniform_spend(V, oak03, valet_trash, Gap).` asks only about that property and category, so work grows with decisions rather than documents, and a finding is fresh when someone can act on it.

Nothing is extracted ahead of the questions. The leaves of every ruleset, such as `rate/4`, `doors/2` and `explained/3`, are facts in a fixed vocabulary, and Prolog never touches a raw document. A model reads each fact from its source when a rule first asks for it, quoting the words it read. Prolog's evaluation order makes this sparse: in `portfolio_gap(P), \+ explained(P)`, the contract is only read for a property whose gap already fired.

This is also what keeps extraction honest. Every value in a finding was requested by the proof that uses it, so an end-to-end test from raw document to finding covers extraction too. A separate parse stage, run on a guess about which fields will matter, would be a second place to hallucinate that those tests never see. And it keeps rulesets general: they're written against the shared vocabulary of leaf predicates, and formats are handled beneath it. A new layout adds clauses, and no ruleset changes. A layout the model has handled can be compiled into a tested parser that answers the same request without a model (see [Keeping MARC's own costs down](#keeping-marcs-own-costs-down)).

### Routing decides what a query may touch

The query reaches its documents through deterministic routing, not a model. Each ruleset is tagged with the goods and service categories it covers. Owner–vendor metadata, indexed in an ordinary table of owner, vendor, category and period, gives the vendors in those categories, and only their documents are read. That index is the one thing filled up front, and it's cheap because it holds metadata, not extracted values.

Routing is where the costliest inaccuracy lives, because a document that's never read can't be cited. A routing miss can also cause a false call. `\+ explained(...)` succeeds when no explaining document was read, so a contract the router skipped looks the same as no explanation. The same holds for rules that take a minimum or a latest value. Two guards follow:

- Route the evidence a rule negates more broadly than the evidence it asserts: every contract between the owner and the vendor, whatever its category.
- Answer "undetermined" instead of calling when the documents for the period are incomplete, such as a month with no invoice.

### Reuse: persist facts, not answers

Rulesets that share terms share work. A `rate(_, oak03, valet_trash, _)` read for one ruleset or an earlier purchase order is reused by the next one, so the more of the vocabulary rulesets share, the more of each query is a cache hit. Two things get cached, in different places:

- A **fact** is what a model read from a document, such as "the rate on line 8 is $22.00". It costs a model call, so it's stored in Postgres.
- A **derived answer** is what rules conclude from facts, such as "OAK-03 is $3.50 over". It costs milliseconds of Prolog, so it stays in memory (tabling) and can be recomputed from stored facts at any time.

Facts go in one narrow table, with a row only for facts some query has asked for:

```
fact(document_hash, predicate, arguments, value, evidence, extractor_version, created_at)
```

- **No migration.** A new kind of fact is a new value in `predicate`, not a new column.
- **No backfill.** A missing row means nobody has asked yet. It's computed the first time a rule needs it.
- **The key does the invalidation.** A changed document has a new hash, and a changed prompt or model bumps the extractor version. Either way the old row stops matching and the fact is read again when next needed.
- **"Asked, and the document doesn't say" is a row too.** Without it the system asks again on every query. It also keeps "not stated" apart from "not yet read", which a rule like `\+ explained(...)` must not confuse.

Prolog stays pure, and the host program runs a loop: load the stored facts for the documents routing selects, run the query, put the facts it found missing on the queue, let workers extract them in batches and store the results, and run again until nothing is missing.

### What this gives up

- **Latency on cold data.** Extraction happens when a query runs, so the first query on a document waits on model calls. Background warming of likely queries can soften it.
- **No standing inventory.** There's no list of every opportunity in a portfolio, and a sparse table can't answer "show me everything" without first computing everything, which is the baseline's cost again. The benchmark will have to replay purchase decisions instead of scoring one sweep.

## Run

```
npm install
npm run marc -- bench --seeds 1 2 3 4 5   # score the baseline
npm run marc -- dump --seed 1             # write one world's documents to sample/
npm test
```

TypeScript on Node 22.12+, with no runtime dependencies.

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

| Column                    | Meaning                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| relationships P / R       | Precision and recall against hidden arrangements. A relationship is matched through the lines it cites, not by name, so one with no evidence can't score. |
| duplicates                | Arrangements reported more than once, e.g. one vendor under two spellings. Costs precision.                                                               |
| never read                | Hidden arrangements none of whose documents the engine cited. Costs recall.                                                                               |
| rate within 2%            | Share of matched relationships whose current rate is right.                                                                                               |
| unsourced                 | Relationships whose reported rate isn't on any line they cite. Must stay 0.                                                                               |
| opportunities P / R       | Against the opportunities the same rules find in the hidden truth.                                                                                        |
| savings found / available | Estimated annual savings: the true value of the opportunities found, against all of them. Estimated, not realized.                                        |
| savings claimed           | What the engine itself estimates. The gap from "found" is a calibration error.                                                                            |
| model spend               | From the ledger every model call charges.                                                                                                                 |

### Baseline

`npm run marc -- bench --seeds 1 2 3 4 5`. A test fails if this table stops matching what the code produces.

| seed | invoices used | relationships P / R | duplicates | never read | rate within 2% | unsourced | opportunities P / R | savings found / available | savings claimed | model spend |
| ---- | ------------- | ------------------- | ---------- | ---------- | -------------- | --------- | ------------------- | ------------------------- | --------------- | ----------- |
| 1    | 500/1764      | 31% / 29%           | 51         | 57         | 100%           | 0         | 46% / 14%           | $20.3k / $61.1k           | $11.9k          | $0.00       |
| 2    | 535/2123      | 27% / 25%           | 65         | 72         | 100%           | 0         | 36% / 22%           | $21.1k / $62.2k           | $15.6k          | $0.00       |
| 3    | 644/2131      | 30% / 30%           | 67         | 67         | 100%           | 0         | 35% / 18%           | $15.7k / $102.0k          | $13.4k          | $0.00       |
| 4    | 917/1759      | 32% / 52%           | 90         | 38         | 95%            | 0         | 42% / 30%           | $10.7k / $38.0k           | $8.9k           | $0.00       |
| 5    | 789/1927      | 30% / 41%           | 85         | 52         | 100%           | 0         | 21% / 16%           | $13.8k / $80.9k           | $12.9k          | $0.00       |
| all  | 3385/9704     | 30% / 35%           | 358        | 286        | 99%            | 0         | 34% / 19%           | $81.6k / $344.1k          | $62.7k          | $0.00       |

What it says:

- **Every false positive is a duplicate.** Each one is a vendor showing up under a second spelling of its name. Vendor resolution is the first fix, and the cheapest.
- **Every miss is an arrangement never read.** Of the 286, 157 come from vendors that use the invoice layout the baseline can't parse. Another 86 have a description no keyword catches, and 43 have both problems.
- **Rates are right when found (99%).** The hard part is coverage, which is also where the call landed.
- **It under-claims.** It estimates $62.7k in total, less than the $81.6k its correct finds are actually worth. A vendor split across spellings splits its volume, so annual quantities come out low.

### Experimental setup

The synthetic world gives exact ground truth but invented noise. The next benchmark runs on real documents: TV stations' political advertising orders from 2014, which US broadcasters must publish.

Why this dataset:

- **Real documents.** 10,985 labeled orders, of which 5,467 from 87 stations have a downloadable PDF, in a public folder linked by the [DeepForm](https://github.com/project-deepform/deepform) project. All 144 orders sampled from 24 stations have a text layer and share one layout, so this dataset does not test requirement 1 (many formats).
- **Real pre-negotiated terms.** Each order states the agreed rate for every line: a time slot, a week, a rate per spot and a priority class.
- **Open labels.** Contract number, advertiser, dates and total for each order come from [Alex Byrnes's dataset](https://github.com/alexbyrnes/FCC-Political-Ads), released as public domain (CC0).
- **Nothing planted.** Every discrepancy scored is one that exists in the documents.

How it maps to MARC:

| MARC                                      | Advertising orders                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| Property-management company               | Media-buying agency                                                         |
| Property, billed separately               | Each campaign the agency buys for                                           |
| Vendor                                    | TV station                                                                  |
| Service category                          | Time slot (days, hours and spot length)                                     |
| Price per unit                            | Rate per spot                                                               |
| A clause that explains a price difference | The line's priority class, which sets whether the station may bump the spot |

So "Ensure uniform spend" asks: when one agency buys the same slot on the same station in the same week for two campaigns, do they pay the same rate?

A check on one station (KNXV-TV, 215 orders, 3,030 lines read by Claude Haiku 5.5 for $0.39) found the comparison is there to make. Haiku's rate and spot count matched the printed row on all 2,803 lines a strict pattern could also read. Five agencies bought the same slot in the same week for two or more campaigns 48 times. The rates matched 34 times and differed by more than 10% the other 14, for example $1,200 against $2,000 for the 10pm news. Every line carries a priority class, so each gap can be tested for an explanation.

Limits: ad rates move by design, so many gaps are legitimate. The dataset has orders but no invoices, so it measures consistency between deals, not billing errors. And line-level truth has to be built by having a stronger model read the lines and a person check a sample.

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
- [ ] vendor reasons recorded as rule exceptions, so an explained gap isn't called twice
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
