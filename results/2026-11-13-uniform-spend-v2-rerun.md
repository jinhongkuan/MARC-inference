# Uniform spend, version 2 of the rule on the 19 test stations

Run 13 November 2026 · judged by Claude Fable 5.2 in place of a person · scenario 1, "Ensure uniform spend" · rule: [prolog/rules/uniform_spend_v2.pl](../prolog/rules/uniform_spend_v2.pl) with [prolog/lib/slot.pl](../prolog/lib/slot.pl)

This is a development rerun, not a held-out test. Version 2 was written after studying version 1's misses on two groups at these same stations ([first run](2026-11-12-uniform-spend-19-stations.md)).

## What changed in version 2

- **Typed slot.** Haiku returns dates, weekdays and times as values (a 24-hour time, a weekday list); `slot.pl` derives the service and week keys. Version 1 compared the printed text.
- **Derived versions.** Haiku reads each order's number; the rule keeps the latest-filed document per number. Version 1 took version links from a script that mis-parsed the number.

## Results

Truth is the 57 lines judged true in the first run plus 1 new line version 2 found, 58 in all. Intervals are 95% Wilson.

| | Haiku 5.5 + rule v1 | Haiku 5.5 + rule v2 |
|---|---|---|
| Lines flagged | 51 | 54 |
| Correct | 49 | 49 |
| False | 2 | 5 |
| Missed (of 58) | 9 | 9 |
| Precision | 96% [87, 99] | 91% [80, 96] |
| Recall | 84% [73, 92] | 84% [73, 92] |
| Cost | $2.69 | $3.30 |
| Model calls | n/a | 2,861 |

Version 2 is not an improvement. It recovers all 8 of version 1's misses and finds 1 new true line, and loses 8 lines version 1 had.

## Errors

**Recovered (8).** 4 at KPTV through derived versions, 4 at WCAX-TV through the typed slot.

**Lost (8), all from readings.**
- 4 at WFIE: an end time printed as "1202a" or "7P" was read as a value on one order and as not stated on the other, so the two lines no longer share a slot.
- 2 at WFMY-TV: "1135-1235a" was converted to an end of 00:35 on one order and 01:35 on the other.
- 2 at WFMY-TV: a "[NA/Oversold]" note was read as a stated reason for the rate. Not specific to version 2.

**Still missed (1).** WCAX-TV: the scan prints the days as "TWTF--" with the leading M dropped.

**False (5).** 2 shared with version 1 (a missed "BELOW LUR" note). 1 at KSTP-TV (Thursday compared with Wednesday). 1 at KPTV (class read from the header, not the line). 1 at KPTV that depends on the definition: the Days cells print "11111--" and "22222--", the same weekdays with different spot counts, which the judge treats as different services.

## Limits

- One run. Three repeats on two groups gave 8, 10 and 10 of 11 true findings from identical settings, so single-run figures here move by a few findings either way.
- These stations are now development data for both versions. The 19 reserve stations remain sealed.
- Only the 4 newly flagged lines were judged in this run; the other verdicts are carried over from the first run. Judge cost $7.19.
