# Baton — where the time goes in parallel lanes

Measured on real websites in the person's own Chrome (docs/FOCUS.md section 1). Runner: `--bench-real-multi --label=…`.

## before: real-multi-2026-10-31T05-44-02-580Z

Average seconds per lane step, from every lane receipt in the run. "decide" includes the governor wait and the model call; "look" is the look after the action and includes settle, tidy, collect and screenshot.

| Mode | Steps | decide | wait | model | action | look | settle | tidy | collect | screenshot | verify | total | Steps with a screenshot sent |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| one lane, all parts | 67 | 2.82 | 0.00 | 2.82 | 1.41 | 1.10 | 0.92 | 0.02 | 0.04 | 0.12 | 0.00 | 5.82 | 25% |
| conductor | 78 | 2.21 | 0.00 | 2.21 | 1.22 | 0.67 | 0.53 | 0.02 | 0.03 | 0.08 | 0.00 | 4.59 | 14% |

Wall time per request. Planning is reported apart; the conductor time excludes it, and one lane runs the same planned parts.

| Request | Lanes | One lane, all parts | Conductor | Planning (s) | Speed-up |
|---|---|---|---|---|---|
| museum-visit | 3 | pass 80 s, 14 steps | pass 171 s, 44 steps | 3.10 | 0.5× |
| weather-three-cities | 3 | pass 265 s, 40 steps | pass 47 s, 13 steps | 2.00 | 5.6× |
| three-museums | 3 | pass 70 s, 13 steps | pass 35 s, 21 steps | 2.50 | 2.0× |

## after: real-multi-2026-10-31T05-58-11-025Z

Average seconds per lane step, from every lane receipt in the run. "decide" includes the governor wait and the model call; "look" is the look after the action and includes settle, tidy, collect and screenshot.

| Mode | Steps | decide | wait | model | action | look | settle | tidy | collect | screenshot | verify | total | Steps with a screenshot sent |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| one lane, all parts | 62 | 2.73 | 0.00 | 2.73 | 1.61 | 1.51 | 1.34 | 0.01 | 0.03 | 0.11 | 0.00 | 6.11 | 18% |
| conductor | 93 | 2.68 | 0.00 | 2.68 | 1.47 | 1.44 | 1.28 | 0.03 | 0.05 | 0.09 | 0.00 | 5.88 | 19% |

Wall time per request. Planning is reported apart; the conductor time excludes it, and one lane runs the same planned parts.

| Request | Lanes | One lane, all parts | Conductor | Planning (s) | Speed-up |
|---|---|---|---|---|---|
| museum-visit | 3 | pass 54 s, 11 steps | pass 34 s, 17 steps | 3.21 | 1.6× |
| weather-three-cities | 3 | **fail** 275 s, 40 steps | pass 250 s, 61 steps | 1.90 | 1.1× |
| three-museums | 3 | pass 66 s, 11 steps | pass 23 s, 15 steps | 1.82 | 2.8× |

## after (guessing guard): real-multi-2026-10-31T06-12-14-395Z

Average seconds per lane step, from every lane receipt in the run. "decide" includes the governor wait and the model call; "look" is the look after the action and includes settle, tidy, collect and screenshot.

| Mode | Steps | decide | wait | model | action | look | settle | tidy | collect | screenshot | verify | total | settle after navigating (steps) | settle otherwise | Steps with a screenshot sent |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| one lane, all parts | 33 | 2.93 | 0.00 | 2.93 | 2.28 | 1.36 | 1.20 | 0.04 | 0.03 | 0.09 | 0.00 | 7.44 | 2.60 (12) | 1.18 | 6% |
| conductor | 53 | 2.78 | 0.00 | 2.78 | 0.98 | 0.56 | 0.50 | 0.00 | 0.02 | 0.04 | 0.00 | 5.09 | 1.70 (11) | 0.76 | 17% |

Wall time per request. Planning is reported apart; the conductor time excludes it, and one lane runs the same planned parts.

| Request | Lanes | One lane, all parts | Conductor | Planning (s) | Speed-up |
|---|---|---|---|---|---|
| museum-visit | 3 | pass 73 s, 11 steps | pass 54 s, 23 steps | 3.48 | 1.3× |
| weather-three-cities | 3 | pass 128 s, 12 steps | pass 46 s, 12 steps | 2.38 | 2.8× |
| three-museums | 3 | pass 63 s, 10 steps | pass 38 s, 18 steps | 2.50 | 1.7× |

## after (one read per page): real-multi-2026-10-31T06-20-58-444Z

Average seconds per lane step, from every lane receipt in the run. "decide" includes the governor wait and the model call; "look" is the look after the action and includes settle, tidy, collect and screenshot.

| Mode | Steps | decide | wait | model | action | look | settle | tidy | collect | screenshot | verify | total | settle after navigating (steps) | settle otherwise | Steps with a screenshot sent |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| one lane, all parts | 44 | 3.24 | 0.00 | 3.24 | 1.81 | 0.83 | 0.65 | 0.01 | 0.03 | 0.13 | 0.00 | 6.34 | 1.19 (24) | 0.00 | 27% |
| conductor | 64 | 2.96 | 0.00 | 2.96 | 0.79 | 0.65 | 0.48 | 0.05 | 0.05 | 0.07 | 0.00 | 4.94 | 1.58 (14) | 0.44 | 36% |

Wall time per request. Planning is reported apart; the conductor time excludes it, and one lane runs the same planned parts.

| Request | Lanes | One lane, all parts | Conductor | Planning (s) | Speed-up |
|---|---|---|---|---|---|
| museum-visit | 3 | pass 72 s, 10 steps | **fail** 64 s, 31 steps | 5.11 | 1.1× |
| weather-three-cities | 3 | pass 132 s, 18 steps | pass 72 s, 19 steps | 2.19 | 1.8× |
| three-museums | 3 | pass 94 s, 16 steps | pass 24 s, 14 steps | 2.05 | 3.9× |

## after (one part each, state-aware check): real-multi-2026-10-31T06-32-51-057Z

Average seconds per lane step, from every lane receipt in the run. "decide" includes the governor wait and the model call; "look" is the look after the action and includes settle, tidy, collect and screenshot.

| Mode | Steps | decide | wait | model | action | look | settle | tidy | collect | screenshot | verify | total | settle after navigating (steps) | settle otherwise | Steps with a screenshot sent |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| one lane, all parts | 36 | 2.90 | 0.00 | 2.90 | 1.94 | 1.06 | 0.95 | 0.01 | 0.02 | 0.08 | 0.00 | 6.77 | 2.09 (13) | 0.87 | 11% |
| conductor | 49 | 2.79 | 0.00 | 2.79 | 1.34 | 0.82 | 0.70 | 0.02 | 0.05 | 0.05 | 0.00 | 6.50 | 1.55 (22) | 0.00 | 22% |

Wall time per request. Planning is reported apart; the conductor time excludes it, and one lane runs the same planned parts.

| Request | Lanes | One lane, all parts | Conductor | Planning (s) | Speed-up |
|---|---|---|---|---|---|
| museum-visit | 3 | **fail** 92 s, 12 steps | pass 68 s, 17 steps | 2.76 | 1.4× |
| weather-three-cities | 3 | pass 114 s, 14 steps | **fail** 118 s, 19 steps | 2.60 | 1.0× |
| three-museums | 3 | pass 58 s, 10 steps | pass 24 s, 13 steps | 2.10 | 2.4× |

