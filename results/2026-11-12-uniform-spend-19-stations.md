# Uniform spend, 19 held-out stations

Run 12 November 2026 · judged by Claude Fable 5.2 in place of a person · scenario 1, "Ensure uniform spend" · rule: [prolog/rules/uniform_spend.pl](../prolog/rules/uniform_spend.pl)

Everything above "Results" was written before the run. Blank cells are filled in once, after it.

## Claim

Claude Haiku 5.5 reading facts for `uniform_spend.pl` reaches at least 90% precision on findings, with recall within 5 points of Claude Opus 5.5 reading everything, at under 20% of Opus's cost.

- **Decision it informs.** Whether a cheap model plus a rule can replace a frontier model for this check.
- **Primary metric.** Precision of flagged lines. Recall is the guardrail. Cost per correct finding is reported beside both.
- **Falsifier.** The lower end of the precision interval is below 90%, or recall trails Opus by more than 5 points, or the pattern-only arm matches the proposed arm.
- **Stop rule.** One pass over the test stations. Any change to the rule, the prompts or the settings after that makes these stations development data.

## Setup

- **Data.** Real 2014 political advertising orders. Nothing is planted.
- **Development station.** KNXV-TV, used for the [pilot](2026-11-12-uniform-spend-pilot.md). Prompts and settings were tuned there and are now frozen.
- **Test stations.** 19 drawn at random (seed 20261112) from the 38 other stations with 40 or more downloadable orders, with orders listed in brackets: K19GH-D (89), KEVN-TV (73), KFSN-TV (137), KGO-TV (59), KJRH-TV (66), KLKN (52), KLTV (43), KOB (358), KPTV (124), KSTC-TV (123), KSTP-TV (205), KTRE (40), WAFB (257), WBTV (115), WCAX-TV (57), WCPO-TV (123), WEWS-TV (49), WFIE (135), WFMY-TV (131). 2,236 orders in all.
- **Reserve.** The other 19 eligible stations are not downloaded or scored, and stay sealed for later work: KAAL, KABC-TV, KARE, KCTV, KGTV, KIMT, KIVV-TV, KKTV, KLSR-TV, KMOV, KPDX, KPNX, KPRC-TV, KSAT-TV, KSDK, KTVK, KVVU-TV, KXTV, WDIV-TV.
- **Scope per station.** Agencies that buy for two or more clients there, as in the pilot.
- **Rule.** One agency's clients should pay the same rate for the same slot (weekday pattern, time, spot length), week and priority class. A client more than 10% above the best rate is a finding.
- **Truth.** A reference computed from the printed line rows by a strict pattern, with no model. Every line where the arms or the reference disagree is reviewed by a person against the order text.
- **Runs.** One per arm. Documents are shuffled with a fixed seed. A failed or cut-off answer counts as wrong.

## Arms

| Arm | What decides | What the model does | Settings |
|---|---|---|---|
| Pattern + rule | `uniform_spend.pl` | Nothing. A strict pattern reads the line rows. | No model |
| Proposed | `uniform_spend.pl` | Haiku 5.5 reads only the facts the rule requests, one order at a time | Low effort, 12 parallel calls |
| Haiku alone | Haiku 5.5 | Reads all of one agency's orders at a station with the rule in plain English | Low effort, 64,000 output tokens, 3 parallel calls |
| Opus alone | Opus 5.5 | Same as Haiku alone | High effort, 64,000 output tokens, 3 parallel calls |

## Results

True findings across the 19 stations, as judged: 57 lines (54 distinct client-and-group findings), out of 80 lines flagged by any arm.

| | Pattern + rule | Proposed | Haiku alone | Opus alone |
|---|---|---|---|---|
| Lines flagged | 12 | 51 | 52 | 59 |
| Correct | 2 | 49 | 39 | 57 |
| False findings | 10 | 2 | 13 | 2 |
| True findings missed | 55 | 8 | 18 | 0 |
| Precision (95% interval) | 17% [5, 45] | 96% [87, 99] | 75% [62, 85] | 97% [88, 99] |
| Recall (95% interval) | 4% [1, 12] | 86% [75, 93] | 68% [56, 79] | 100% [94, 100] |
| Failed or cut-off answers | n/a | 0 | 1 of 81 | 1 of 81 |
| Cost | $0 | $2.69 | $3.58 | $32.66 |
| Cost per correct finding | $0 | $0.05 | $0.09 | $0.57 |
| All call times added up | n/a | 7,738 s | 3,568 s | 1,946 s |
| Longest single call | n/a | 26 s | 165 s | 188 s |
| Model calls | 0 | 2,533 | 81 | 81 |
| Rate-limit responses | n/a | 0 | 0 | 0 |

Claim held? **No.** Cost held (the proposed arm cost 8% of Opus). Recall did not: 86% against Opus's 100%, a 14-point gap where the claim allowed 5. Precision was 96%, but the lower end of its interval is 87%, under the 90% bar. The pattern-only arm did not match the proposed arm.

Filled in so far: counts, costs and timings, which need no review. The build kept 1,164 orders in 81 agency-and-station groups, 318 of them superseded versions. The three model arms flagged 70 distinct lines between them and agree on 38. The 42 lines where any arm or the pattern stands alone, plus 10 sampled from the 38, are in [the review file](2026-11-12-uniform-spend-19-stations-review.csv). The user chose to have Claude Fable 5.2 judge all 80 flagged lines instead of reviewing them by hand (`prolog/bench/judge.ts`, $20.47). The judge read every order in each agency-and-station group and was not told which arm flagged what.

## What the errors were

- **Proposed, 8 misses.** Four are at one station (KPTV), where the input builder misread a spaced order number ("0 341 61" as "61"), chained 17 unrelated documents as versions of one order and marked 16 of them superseded. That is a bug in this benchmark's metadata step, not in the rule or in Haiku. The other four are at WCAX-TV, where Haiku copied the weekday pattern differently on two orders ("M------" on one, "M" on the other), so the rule never saw them as the same slot.
- **Proposed and Opus alone, the same 2 false findings.** The cheaper line they compared against carries the printed note "BELOW LUR". The judge counted that as a stated reason for a special rate, which bars it from being the best rate. Neither arm picked the note up.
- **Haiku alone, 13 false and 18 missed.** False findings include a line that is alone in its group and two clients at the same rate.
- **Pattern + rule, 10 false.** The pattern reads only the first digit of a priority code, so it compared lines in different classes such as P-01 and P-04.
- **Both model-alone arms returned nothing for one group** (one agency at KOB): its orders were too large for a single request. The proposed arm read it.

## Limits, stated before the run (the last four were added after)

- One run per arm, so run-to-run variation is not measured.
- One document layout and one domain. Matching differently worded items is not tested.
- No random-sample audit of lines the pattern cannot read, so extraction accuracy on those lines is not measured. The pattern + rule arm is scored against a reference built from the same pattern, so its recall is flattered.
- Intervals are computed on pooled counts and ignore that findings cluster by station, so they are somewhat too narrow.
- The orders and their labels are public. No check was run for a model having seen them in training.
- The explanation lookup is expected to be barely exercised, as in the pilot.
- The proposed arm runs as a full sweep. Reuse of stored facts and single-query cost are not measured.
- The run uses a script with facts in a file, not the Postgres fact store the README describes.
- Found after launch, before any results were read: the strict pattern only recognises order lines that are unmarked or marked "N" (new). Lines marked "E" (edited) are skipped, about 7.5% of lines at the development station. The pattern + rule arm therefore reads fewer lines than the model arms, and the run was not restarted to fix it.
- Before the draw, a handful of orders from some test and reserve stations were opened to check that the text was readable and the layout matched. Nothing was scored or tuned on them.
- The judge is a model from the same family as every arm, not a person. Shared blind spots would show as agreement.
- Truth is pooled: only lines some arm flagged were judged. A finding every arm missed is not counted, so recall is relative to that pool, and Opus alone found everything in it.
- The supersession bug above also inflates the count of superseded orders (318) and cost the proposed arm recall. The run was not repeated after finding it, because that would make these stations development data.
- Nothing was reviewed by a person.

## Reproduce

Needs SWI-Prolog, pdftotext, Node 22.12+ and `ANTHROPIC_API_KEY` in `.env`.

```
npm install
python3 prolog/bench/build_input.py --draw 19 --seed 20261112 --exclude KNXV-TV --out prolog/out/test-input.json
PILOT_BUDGET_USD=120 npx tsx prolog/bench/run.ts --input prolog/out/test-input.json --run test
PILOT_BUDGET_USD=40 npx tsx prolog/bench/judge.ts --input prolog/out/test-input.json --run test
```
