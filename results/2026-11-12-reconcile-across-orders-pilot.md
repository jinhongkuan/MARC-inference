# Reconcile across orders, development station

12 November 2026 · scenario 2, "Ensure credits and replacements reconcile" · rule: [prolog/rules/reconcile.pl](../prolog/rules/reconcile.pl)

## Question

For each client of an agency at a station, across all the client's current orders: how much was credited, how much was supplied in replacement, and is the client under-delivered (replacements worth more than 10% less than credits)? And how much of the work does scenario 1's stored facts save?

## Setup

- **Data.** The 131 real orders at KNXV-TV used in the scenario 1 pilot, covering 27 clients. Nothing is planted. This is the development station, so this is not a held-out result.
- **Reference.** Credited and replacement value per client, summed from adjustment rows read by a strict pattern with no model: 15 clients have a credit, 8 are under-delivered.
- **Rule.** Takes three parameters (owner, vendor, account) and three facts per document. Two of them, `superseded_by` and `account`, are the same facts scenario 1 stores. The third, `adjustments`, is the only new read: one list per document.

## Arms

| Arm | What decides | What the model does |
|---|---|---|
| Proposed, cold | `reconcile.pl` | Haiku 5.5 at low effort reads every fact the rule requests, starting from nothing |
| Proposed, warm | `reconcile.pl` | The same, starting from the facts scenario 1 stored for these orders |
| Haiku alone | Haiku 5.5 at low effort | Reads every order one agency placed at the station, for all its clients, with the rule in plain English. It groups the orders by client itself. |
| Opus alone | Opus 5.5 at high effort | Same as Haiku alone |

## Results

| | Proposed, cold | Proposed, warm | Haiku alone | Opus alone |
|---|---|---|---|---|
| Verdict right (under-delivered or not) | 26 of 27 | 27 of 27 | 27 of 27 | 27 of 27 |
| Under-delivered clients found, of 8 | 8 | 8 | 8 | 8 |
| False findings | 1 | 0 | 0 | 0 |
| Credited value right (within 1%) | 24 of 27 | 24 of 27 | 27 of 27 | 27 of 27 |
| Replacement value right (within 1%) | 26 of 27 | 27 of 27 | 27 of 27 | 27 of 27 |
| Cost | $0.120 | $0.063 | $0.061 | $2.075 |
| Model calls | 260 | 130 | 9 | 9 |
| Input tokens | 1,072,032 | 555,516 | 492,759 | 492,759 |
| All call times added up | 321 s | 161 s | 105 s | 55 s |

## What this shows

- **Stored facts halve the proposed arm's work.** Starting from scenario 1's store, the rule asked for 130 facts instead of 391, made 130 model reads instead of 260, and cost $0.063 instead of $0.120.
- **At this size a model alone is enough.** Haiku alone got every verdict and every amount right and cost about the same as the warm run. The largest agency here has 26 orders at the station, which one request holds easily.
- **The proposed arm's amount errors are reading errors.** On three clients Haiku's list of adjustment rows differed from the pattern's (for example $3,600 credited against a reference of $2,000). The cold run's one false finding came from a replacement read as $14,850 instead of $16,850. The reference is itself a pattern read, so some of these may be the reference's error; none was checked by a person.

## Limits

- A first run of the two model-alone arms handed each model one client's orders at a time, grouped by this benchmark's own pattern read of the advertiser name. That gave them the cross-document grouping for free. They were rerun with a whole agency's orders per request, and the table shows the rerun. The first run scored 27 of 27 verdicts for both, with Haiku at 26 of 27 on credited value.

- Development station, one layout, one run per arm, 27 clients.
- The cold and warm runs read adjustments separately, so the one-verdict difference between them is run-to-run variation, not an effect of the cache.
- Credits and replacements at this station pair up inside a single order, so the cross-order case the rule exists for (a credit on one order made good on another) is covered by the rule's tests but rarely occurs in this data.
- Matching an overcharge on one invoice to a credit on a later invoice needs invoice data, which this dataset does not have.

## Reproduce

```
python3 prolog/bench/build_input.py --stations KNXV-TV --out prolog/out/dev-input.json
npx tsx prolog/bench/run.ts --input prolog/out/dev-input.json --run dev --arms proposed      # writes the scenario 1 store
python3 prolog/bench/build_reconcile_input.py prolog/out/dev-input.json prolog/out/dev-reconcile-input.json
npx tsx prolog/bench/run_reconcile.ts --input prolog/out/dev-reconcile-input.json --run dev-reconcile --warm-from prolog/out/dev-proposed-store.pl
```
