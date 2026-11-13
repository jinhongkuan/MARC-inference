# Reconcile pilot, development station

12 November 2026 · scenario 2, first version: "Ensure agreed and billed reconcile" (rebuild one order's totals)

**Superseded.** The rule this pilot tested, and its runner, have been replaced by a different rule with the same file name, `prolog/rules/reconcile.pl`, which works across a client's documents. The reproduce commands below no longer run this pilot.

## Question

With every dollar total hidden, can each approach rebuild an order's line amounts and gross total from its weekly schedule and its recorded changes (credited spots, make-goods, re-priced spots)?

## Setup

- **Data.** The 131 real orders at KNXV-TV used in the scenario 1 pilot (130 current, 1 superseded). Nothing is planted. This is the development station: the pricing arithmetic was worked out on it, so this is not a held-out result.
- **Hidden.** Each line's printed amount, the totals block, the billing plan and the order-share block.
- **Answer key.** The hidden printed figures, read by a strict pattern with no model: 1,920 line amounts on current orders, 88 of them on lines with credits or make-goods, and 130 stated gross totals.
- **Rule.** A line's amount is the amounts of its make-good and re-priced spots plus the weekly rate for its other current spots. The gross total is the sum of the line amounts. A shortfall is a line whose make-goods are worth more than 10% less than its credited spots.

## Arms

| Arm | What decides | What the model does |
|---|---|---|
| Proposed | `reconcile.pl` | Haiku 5.5 at low effort reads the schedule, current spot count and changes the rule requests |
| Haiku alone | Haiku 5.5 at low effort | Reads one order with the pricing rule in plain English and rebuilds it |
| Opus alone | Opus 5.5 at high effort | Same as Haiku alone |

## Results

| | Proposed | Haiku alone | Opus alone |
|---|---|---|---|
| Order totals rebuilt (within 0.5%) | 130 of 130 | 130 of 130 | 130 of 130 |
| Line amounts rebuilt exactly | 1,918 of 1,920 | 1,920 of 1,920 | 1,920 of 1,920 |
| Of which adjusted lines | 88 of 88 | 88 of 88 | 88 of 88 |
| Shortfall lines found, of 33 in the reference | 31 | 24 | 23 |
| Shortfall lines flagged that are not in the reference | 2 | 0 | 0 |
| Cost | $0.22 | $0.12 | $3.65 |
| All call times added up | 777 s | 573 s | 629 s |
| Wall clock (parallel calls) | 70 s (12) | 99 s (6) | 110 s (6) |
| Model calls | 290 | 130 | 130 |
| Failed or cut-off answers | 0 | 0 | 0 |

## What this shows

- **Rebuilding totals is easy for every approach once the pricing rule is stated.** Both models alone were perfect, and Haiku alone was the cheapest. The proposed arm got two line amounts wrong and cost more than Haiku alone.
- **Why the proposed arm has no edge here.** This task needs one document at a time, so there is no join across documents for the rule to take over. The proposed arm also reads each order twice (once for its line list, once for the details).
- **The proposed arm's four shortfall errors are reading errors.** Haiku misread which kind of row a spot was on two lines and missed a credited row on two others.
- **The shortfall gap is not yet a fair comparison.** Several lines the models alone did not flag have a credited spot and no make-good at all. The plain-English task asked where make-goods are "worth more than 10% less than the credited spots", which does not clearly cover a line with no make-good. The rule counts those as shortfalls. The wording needs fixing before the shortfall rows mean anything.

## Limits

- Development station, one layout, one run per arm.
- The answer key covers only lines the pattern reads, and the reference shortfalls come from the same pattern.
- Whether a credited spot with no make-good is a finding at all is an open definition: the charge was removed, so no money is owed.
- Almost none of the facts this rule needs were read for scenario 1 (which stored each line's slot, week, class, rate and spot count), so reuse of stored facts across the two scenarios would be small as the rules stand.

## Reproduce

```
python3 prolog/bench/build_input.py --stations KNXV-TV --out prolog/out/dev-input.json
python3 prolog/bench/build_reconcile_input.py prolog/out/dev-input.json prolog/out/dev-reconcile-input.json
npx tsx prolog/bench/run_reconcile.ts --input prolog/out/dev-reconcile-input.json --run dev-reconcile
```
