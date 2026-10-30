# Baton benchmark — one lane in sequence vs the conductor in parallel (bench-multi-2026-10-30T06-06-58-121Z)

Model: meta-models/muse-spark-open-1026 on Baseten. Each request is planned once by the conductor; both modes then run the same parts.

| Task | Parts | One lane | Time (s) | Conductor | Time (s) | Speed-up | Plan |
|---|---|---|---|---|---|---|---|
| lisbon-trip-research | 3 | pass | 27 | pass | 46 | 0.6× | flights, hotel, session |
| compare-three-cities | 3 | pass | 27 | pass | 19 | 1.4× | lisbon, london, madrid |
| three-invoice-amounts | 3 | pass | 29 | pass | 22 | 1.3× | saltmarsh, pinecrest, harrow |
| enter-two-bills | 2 | pass | 24 | pass | 20 | 1.2× | bill1, bill2 |
| calendar-and-draft | 2 | pass | 55 | pass | 74 | 0.7× | calendar, email-draft |
| bill-statuses | 3 | pass | 24 | pass | 19 | 1.3× | bill-0418, bill-0419, bill-0420 |
| flights-two-dates | 2 | pass | 24 | pass | 17 | 1.4× | outbound, return |
| speakers-and-hotel | 2 | pass | 11 | pass | 14 | 0.8× | speakers, hotel |
| invoice-to-bill | 2 | **fail** | 17 | pass | 30 | 0.6× | find-invoice, create-bill←find-invoice |
| venue-hotel-flight | 3 | pass | 97 | pass | 57 | 1.7× | venue, hotel←venue, flight |

Totals over 10 tasks: one lane 9/10 passed in 334 s ($0.89); conductor 10/10 passed in 319 s ($1.26).

Failure details are in the JSON run file under bench/runs/.
