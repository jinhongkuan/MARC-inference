# Uniform spend pilot, one station

12 November 2026 · scenario 1, "Ensure uniform spend" · rule: [prolog/rules/uniform_spend.pl](../prolog/rules/uniform_spend.pl)

## Question

When Claude Haiku 5.5 only reads facts and a Prolog rule does the comparing, is accuracy close to having a model read everything and decide?

## Setup

- **Data.** 131 real 2014 political advertising orders at one TV station (KNXV-TV), from the nine media-buying agencies that buy for two or more clients there. Nothing is planted.
- **Rule.** One agency's clients should pay the same rate for the same slot (weekday pattern, time, spot length), week and priority class. A client more than 10% above the best rate is a finding.
- **Truth.** 25 findings. 23 come from a strict pattern over the printed line rows, with no model involved. 2 more were added after reading the order text, where the pattern could not read the best-rate line. Disagreements were reviewed by hand by Claude, not by a person.

## Arms

| Arm | What decides | What the model does |
|---|---|---|
| Proposed | `uniform_spend.pl` | Haiku 5.5 at low effort reads only the facts the rule requests, one order at a time |
| Haiku alone | Haiku 5.5 at low effort | Reads all of one agency's orders with the rule in plain English |
| Opus alone | Opus 5.5 at high effort | Same as Haiku alone |

## Results

| | Proposed | Haiku alone | Opus alone |
|---|---|---|---|
| Lines flagged | 24 | 22 | 26 |
| Correct | 24 | 19 | 25 |
| False findings | 0 | 3 | 1 |
| True findings missed | 1 | 6 | 0 |
| Precision / recall | 100% / 96% | 86% / 76% | 96% / 100% |
| Cost | $0.26 | $0.12 | $2.68 |
| All call times added up | 812 s | 579 s | 294 s |
| Longest single call | 8 s | 154 s | 105 s |
| Wall clock (parallel calls) | 78 s (12) | 210 s (3) | 141 s (3) |
| Model calls | 412 | 9 | 9 |
| Reasoning tokens | 17,487 | 145,518 | 31,657 |

## What the errors were

- **Proposed, 1 miss.** Haiku read a make-good note on the cheapest line as a pricing explanation, so the rule would not use that line as the best rate.
- **Opus alone, 1 false finding.** It compared two football-game lines that print no time and are different games. In the proposed arm Haiku reported the service as not stated and the rule declined to compare.
- **Haiku alone, 3 false findings and 6 misses.** The same football comparison, a 60-second spot compared with a 30-second one, and a weekday night line compared with a Saturday morning one. Five of the six misses are at the largest agency (24 orders).

## Limits

- One station and one document layout. Item matching across differently worded descriptions is not tested.
- One run per arm. A difference of a few findings could change on a rerun.
- The proposed arm swept every line of every order, its most expensive mode, and sent each order to Haiku three or four times with no prompt caching.
- The explanation lookup was barely exercised: no flagged line had a real stated reason.
- A first proposed run scored 15 of 23 because the host stored "the order states no reason" as a reason. The host was fixed to ask for a yes/no plus a quote; the rule was unchanged. The table shows the rerun.

## Reproduce

Needs SWI-Prolog, `ANTHROPIC_API_KEY` in `.env`, and `prolog/out/pilot-input.json` (built from the station's order PDFs; the build step is not yet in the repo).

```
npx tsx prolog/bench/pilot.ts --arms proposed,trivial
PILOT_EFFORT=low npx tsx prolog/bench/pilot.ts --arms haiku-only
```
