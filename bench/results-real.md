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

## Multi-part requests on real websites (real-multi-2026-10-31T05-44-02-580Z)

Model: meta-models/muse-spark-open-1026 on Baseten, in the person's own signed-in Chrome. 6 of 6 runs passed. Banners and pop-ups cleared: 1; lanes stopped by one: 0.

| Task | Site | Mode | Run | Result | Steps | Time (s) | Cost (USD) | Needed the person | Cleared | Check |
|---|---|---|---|---|---|---|---|---|---|---|
| museum-visit | museum, weather, maps | one lane, all parts | 1 | pass | 14 | 80 | 0.185 | nothing | 0 | correct |
| museum-visit | museum, weather, maps | conductor | 1 | pass | 44 | 171 | 0.500 | nothing | 0 | correct |
| weather-three-cities | weather site | one lane, all parts | 1 | pass | 40 | 265 | 0.415 | nothing | 0 | 24 temperatures for all three cities |
| weather-three-cities | weather site | conductor | 1 | pass | 13 | 47 | 0.155 | nothing | 0 | 47 temperatures for all three cities |
| three-museums | museums' own sites | one lane, all parts | 1 | pass | 13 | 70 | 0.144 | nothing | 1 | 33 opening-hour ranges for all three |
| three-museums | museums' own sites | conductor | 1 | pass | 21 | 35 | 0.219 | nothing | 0 | 32 opening-hour ranges for all three |

Totals: 145 steps, 668 s, $1.62.

## Multi-part requests on real websites (real-multi-2026-10-31T05-58-11-025Z)

Model: meta-models/muse-spark-open-1026 on Baseten, in the person's own signed-in Chrome. 5 of 6 runs passed. Banners and pop-ups cleared: 0; lanes stopped by one: 0.

| Task | Site | Mode | Run | Result | Steps | Time (s) | Cost (USD) | Needed the person | Cleared | Check |
|---|---|---|---|---|---|---|---|---|---|---|
| museum-visit | museum, weather, maps | one lane, all parts | 1 | pass | 11 | 54 | 0.127 | nothing | 0 | correct |
| museum-visit | museum, weather, maps | conductor | 1 | pass | 17 | 34 | 0.177 | nothing | 0 | correct |
| weather-three-cities | weather site | one lane, all parts | 1 | **fail** | 40 | 275 | 0.400 | asked: I have taken 40 steps without finishing. Should I keep going? | 0 | lane failed: Stopped after 40 steps without finishing. |
| weather-three-cities | weather site | conductor | 1 | pass | 61 | 250 | 0.621 | nothing | 0 | 102 temperatures for all three cities |
| three-museums | museums' own sites | one lane, all parts | 1 | pass | 11 | 66 | 0.136 | nothing | 0 | 20 opening-hour ranges for all three |
| three-museums | museums' own sites | conductor | 1 | pass | 15 | 23 | 0.159 | nothing | 0 | 34 opening-hour ranges for all three |

Totals: 155 steps, 702 s, $1.62.

## Multi-part requests on real websites (real-multi-2026-10-31T06-12-14-395Z)

Model: meta-models/muse-spark-open-1026 on Baseten, in the person's own signed-in Chrome. 6 of 6 runs passed. Banners and pop-ups cleared: 0; lanes stopped by one: 0.

| Task | Site | Mode | Run | Result | Steps | Time (s) | Cost (USD) | Needed the person | Cleared | Check |
|---|---|---|---|---|---|---|---|---|---|---|
| museum-visit | museum, weather, maps | one lane, all parts | 1 | pass | 11 | 73 | 0.130 | nothing | 0 | correct |
| museum-visit | museum, weather, maps | conductor | 1 | pass | 23 | 54 | 0.270 | nothing | 0 | correct |
| weather-three-cities | weather site | one lane, all parts | 1 | pass | 12 | 128 | 0.141 | nothing | 0 | 27 temperatures for all three cities |
| weather-three-cities | weather site | conductor | 1 | pass | 12 | 46 | 0.125 | nothing | 0 | 35 temperatures for all three cities |
| three-museums | museums' own sites | one lane, all parts | 1 | pass | 10 | 63 | 0.114 | nothing | 0 | 25 opening-hour ranges for all three |
| three-museums | museums' own sites | conductor | 1 | pass | 18 | 38 | 0.192 | nothing | 0 | 49 opening-hour ranges for all three |

Totals: 86 steps, 403 s, $0.97.

## Multi-part requests on real websites (real-multi-2026-10-31T06-20-58-444Z)

Model: meta-models/muse-spark-open-1026 on Baseten, in the person's own signed-in Chrome. 5 of 6 runs passed. Banners and pop-ups cleared: 0; lanes stopped by one: 0.

| Task | Site | Mode | Run | Result | Steps | Time (s) | Cost (USD) | Needed the person | Cleared | Check |
|---|---|---|---|---|---|---|---|---|---|---|
| museum-visit | museum, weather, maps | one lane, all parts | 1 | pass | 10 | 72 | 0.118 | nothing | 0 | correct |
| museum-visit | museum, weather, maps | conductor | 1 | **fail** | 31 | 64 | 0.359 | asked: I tried 3 times and it did not work (nothing on the page changed). What should I do? | 0 | correct |
| weather-three-cities | weather site | one lane, all parts | 1 | pass | 18 | 132 | 0.183 | nothing | 0 | 23 temperatures for all three cities |
| weather-three-cities | weather site | conductor | 1 | pass | 19 | 72 | 0.193 | nothing | 0 | 57 temperatures for all three cities |
| three-museums | museums' own sites | one lane, all parts | 1 | pass | 16 | 94 | 0.174 | nothing | 0 | 24 opening-hour ranges for all three |
| three-museums | museums' own sites | conductor | 1 | pass | 14 | 24 | 0.145 | nothing | 0 | 29 opening-hour ranges for all three |

Totals: 108 steps, 458 s, $1.17.

## Multi-part requests on real websites (real-multi-2026-10-31T06-32-51-057Z)

Model: meta-models/muse-spark-open-1026 on Baseten, in the person's own signed-in Chrome. 4 of 6 runs passed. Banners and pop-ups cleared: 0; lanes stopped by one: 0.

| Task | Site | Mode | Run | Result | Steps | Time (s) | Cost (USD) | Needed the person | Cleared | Check |
|---|---|---|---|---|---|---|---|---|---|---|
| museum-visit | museum, weather, maps | one lane, all parts | 1 | **fail** | 12 | 92 | 0.152 | nothing | 0 | missing /-?\d{1,2}(\.\d)?\s*°\s*[CF]?/-?\d{1,2}\s*degrees/i |
| museum-visit | museum, weather, maps | conductor | 1 | pass | 17 | 68 | 0.182 | nothing | 0 | correct |
| weather-three-cities | weather site | one lane, all parts | 1 | pass | 14 | 114 | 0.182 | nothing | 0 | 59 temperatures for all three cities |
| weather-three-cities | weather site | conductor | 1 | **fail** | 19 | 118 | 0.202 | asked: I tried 3 times and it did not work (page did not load in 15 s). What should I do? | 0 | 35 temperatures; cities named: London, Lagos |
| three-museums | museums' own sites | one lane, all parts | 1 | pass | 10 | 58 | 0.111 | nothing | 0 | 28 opening-hour ranges for all three |
| three-museums | museums' own sites | conductor | 1 | pass | 13 | 24 | 0.151 | nothing | 0 | 35 opening-hour ranges for all three |

Totals: 85 steps, 475 s, $0.98.

## Multi-part requests on real websites (real-multi-2026-10-31T09-10-16-285Z)

Model: meta-models/muse-spark-open-1026 on Baseten, in the person's own signed-in Chrome. 0 of 3 runs passed. Banners and pop-ups cleared: 3; lanes stopped by one: 1.

| Task | Site | Mode | Run | Result | Steps | Time (s) | Cost (USD) | Needed the person | Cleared | Check |
|---|---|---|---|---|---|---|---|---|---|---|
| lisbon-weekend | weather, food, museum → Docs | conductor | 1 | **fail** | 20 | 135 | 0.199 | asked: This site wants to check you're human. Please do the check in this lane's window, then answer “done”. | 2 | check failed: the file could not be read |
| lisbon-weekend | weather, food, museum → Docs | conductor | 2 | **fail** | 54 | 253 | 0.553 | asked: I have taken 40 steps without finishing. Should I keep going? | 1 | check failed: the file could not be read |
| lisbon-weekend | weather, food, museum → Docs | conductor | 3 | **fail** | 20 | 68 | 0.218 | asked: I tried 3 times and it did not work ([   {     "origin": "string",     "code": "too_big",     "maximum": 120,     "inclu | 0 | check failed: the file could not be read |

Totals: 94 steps, 457 s, $0.97.

## Multi-part requests on real websites (real-multi-2026-10-31T09-20-57-784Z)

Model: meta-models/muse-spark-open-1026 on Baseten, in the person's own signed-in Chrome. 0 of 3 runs passed. Banners and pop-ups cleared: 0; lanes stopped by one: 0.

| Task | Site | Mode | Run | Result | Steps | Time (s) | Cost (USD) | Needed the person | Cleared | Check |
|---|---|---|---|---|---|---|---|---|---|---|
| lisbon-weekend | weather, food, museum → Docs | conductor | 1 | **fail** | 71 | 272 | 0.785 | asked: I have taken 40 steps without finishing. Should I keep going? | 0 | the write-up is not in the doc |
| lisbon-weekend | weather, food, museum → Docs | conductor | 2 | **fail** | 22 | 96 | 0.276 | asked: I tried 3 times and it did not work (mark 8 is not on the page any more; look again). What should I do? | 0 | the write-up is not in the doc |
| lisbon-weekend | weather, food, museum → Docs | conductor | 3 | **fail** | 8 | 25 | 0.046 | asked: I could not decide what to do next (Baton's daily model budget ($10.00) is used up ($10.02 spent today). Raise BATON_DAI; asked: I could not decide what to do next (Baton's daily model budget ($10.00) is used up ($10.03 spent today). Raise BATON_DAI; asked: I could not decide what to do next (Baton's daily model budget ($10.00) is used up ($10.03 spent today). Raise BATON_DAI | 0 | check failed: Failed to fetch |

Totals: 101 steps, 392 s, $1.11.

## Multi-part requests on real websites (real-multi-2026-10-31T09-30-38-491Z)

Model: meta-models/muse-spark-open-1026 on Baseten, in the person's own signed-in Chrome. 0 of 3 runs passed. Banners and pop-ups cleared: 0; lanes stopped by one: 0.

| Task | Site | Mode | Run | Result | Steps | Time (s) | Cost (USD) | Needed the person | Cleared | Check |
|---|---|---|---|---|---|---|---|---|---|---|
| lisbon-weekend | weather, food, museum → Docs | conductor | 1 | **fail** | 80 | 263 | 0.951 | asked: I tried 3 times and it did not work (nothing on the page changed). What should I do?; asked: I tried 3 times and it did not work (23 value(s) not found when read back, e.g. “Lisbon weekend BB7AQL7”). What should I | 0 | the write-up is not in the doc |
| lisbon-weekend | weather, food, museum → Docs | conductor | 2 | **fail** | 60 | 197 | 0.737 | asked: I could not decide what to do next (model output invalid after retry: ✖ Invalid input: expected object, received undefin; asked: I could not decide what to do next (model output invalid after retry: no JSON object in the answer). How should I contin; asked: I tried 3 times and it did not work (14 value(s) not found when read back, e.g. “Lisbon weekend BB7AQL7”). What should I | 0 | the write-up is not in the doc |
| lisbon-weekend | weather, food, museum → Docs | conductor | 3 | **fail** | 0 | 0 | 0.000 | nothing | 0 | check failed: Chrome extension is not connected |

Totals: 140 steps, 460 s, $1.69.

## Multi-part requests on real websites (real-multi-2026-10-31T12-44-42-122Z)

Model: meta-models/muse-spark-open-1026 on Baseten, in the person's own signed-in Chrome. 0 of 3 runs passed. Banners and pop-ups cleared: 0; lanes stopped by one: 0.

| Task | Site | Mode | Run | Result | Steps | Time (s) | Cost (USD) | Needed the person | Cleared | Check |
|---|---|---|---|---|---|---|---|---|---|---|
| lisbon-weekend | weather, food, museum → Docs | conductor | 1 | **fail** | 44 | 170 | 0.475 | asked: I tried 3 times and it did not work (nothing on the page changed). What should I do?; asked: I tried 3 times and it did not work (there is no search box on this page; navigate or use click and type instead). What  | 0 | correct |
| lisbon-weekend | weather, food, museum → Docs | conductor | 2 | **fail** | 54 | 223 | 0.765 | asked: I tried 3 times and it did not work (nothing on the page changed). What should I do? | 0 | correct |
| lisbon-weekend | weather, food, museum → Docs | conductor | 3 | **fail** | 29 | 76 | 0.369 | asked: I tried 3 times and it did not work (nothing on the page changed). What should I do? | 0 | correct |

Totals: 127 steps, 469 s, $1.61.

