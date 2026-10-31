# Baton benchmark — real websites

Each section is one run of `--bench-real` (single lanes) or `--bench-real-multi` (planned requests, one lane against the conductor). Task definitions and checks: bench/real/tasks.ts.

## Everyday tasks on real websites (real-2026-10-31T03-23-59-572Z)

Model: meta-models/muse-spark-open-1026 on Baseten, in the person's own signed-in Chrome. 6 of 7 runs passed. Banners and pop-ups cleared: 0; lanes stopped by one: 0.

| Task | Site | Mode | Run | Result | Steps | Time (s) | Cost (USD) | Needed the person | Cleared | Check |
|---|---|---|---|---|---|---|---|---|---|---|
| reference-fact | reference page | one lane | 1 | pass | 3 | 12 | 0.036 | nothing | 0 | correct |
| weather-now | weather site | one lane | 1 | pass | 2 | 15 | 0.023 | nothing | 0 | correct |
| maps-travel-time | Google Maps | one lane | 1 | pass | 3 | 20 | 0.026 | nothing | 0 | correct |
| museum-hours | museum's own site | one lane | 1 | pass | 7 | 36 | 0.076 | nothing | 0 | correct |
| company-list | public company list | one lane | 1 | pass | 3 | 11 | 0.039 | nothing | 0 | correct |
| product-spec | product page | one lane | 1 | **fail** | 3 | 35 | 0.033 | asked: I tried 3 times and it did not work (still on https://www.fairphone.com/). What should I do? | 0 | lane failed: Stopped after 3 failed attempts: still on https://www.fairphone.com/ |
| review-score | review site | one lane | 1 | pass | 1 | 11 | 0.010 | nothing | 0 | correct |

Totals: 22 steps, 139 s, $0.24.

## Everyday tasks on real websites (real-2026-10-31T03-27-19-702Z)

Model: meta-models/muse-spark-open-1026 on Baseten, in the person's own signed-in Chrome. 0 of 1 runs passed. Banners and pop-ups cleared: 0; lanes stopped by one: 0.

| Task | Site | Mode | Run | Result | Steps | Time (s) | Cost (USD) | Needed the person | Cleared | Check |
|---|---|---|---|---|---|---|---|---|---|---|
| product-spec | product page | one lane | 1 | **fail** | 3 | 29 | 0.032 | asked: I tried 3 times and it did not work (https://www.fairphone.com/fairphone-5 redirected back to https://www.fairphone.com/ | 0 | lane failed: Stopped after 3 failed attempts: https://www.fairphone.com/fairphone-5 redirected back to https://www.fairphone.com/: that address does not exist here. Use this |

Totals: 3 steps, 29 s, $0.03.

## Everyday tasks on real websites (real-2026-10-31T03-28-58-173Z)

Model: meta-models/muse-spark-open-1026 on Baseten, in the person's own signed-in Chrome. 1 of 1 runs passed. Banners and pop-ups cleared: 0; lanes stopped by one: 0.

| Task | Site | Mode | Run | Result | Steps | Time (s) | Cost (USD) | Needed the person | Cleared | Check |
|---|---|---|---|---|---|---|---|---|---|---|
| product-spec | product page | one lane | 1 | pass | 6 | 46 | 0.102 | nothing | 0 | correct |

Totals: 6 steps, 46 s, $0.10.

