# Baton — product spec

## The idea in one sentence

Your computer has always had one cursor doing one thing at a time; Baton lets you point, speak, and conduct several agents working in parallel in your own browser.

## Who it is for

Anyone who spends their day moving information between websites: operations leads, assistants, recruiters, freelancers, founders, students. Also people for whom the mouse and keyboard are hard to use, such as people with RSI or limited hand mobility, because the whole product works by voice with minimal pointing.

## The business

The Startup track is judged by people who think like investors, so the product needs a clear business, not only a clever demo.

- **First customers:** small teams whose work is moving information between websites: operations, recruiting, sales support, bookkeeping, travel and event planning. They feel the pain daily and can buy without a procurement process.
- **Pricing to test:** free with one lane; Pro at $20 a month with four lanes; Teams at $40 per seat a month with eight lanes, shared routines and an admin view of receipts.
- **Why companies will pay more later:** routines learned by one person can be shared across a team, and receipts give managers an audit trail of what agents did. Because the model is open weights, an enterprise can run Baton against its own model servers so screen content never leaves its network. That opens regulated customers that closed-model agents cannot serve.
- **Accessibility:** for people with RSI or limited hand mobility, voice plus minimal pointing replaces thousands of clicks a day. This is a real market and a strong reason the product matters.
- **Proof during the hackathon:** a waitlist on Baton Live's page, and at least five real people who tried it, with their quotes and the number of signups shown in the film.
- **The honest competition:** OpenAI, Google, Anthropic, Perplexity and many startups ship agents that use a browser. Baton's difference is the experience: pointing as context, several agents working at once that you can direct by pointing, learning a task from one rehearsal, and receipts for every step.

## What we learned from earlier winners

| From | Lesson we build in |
|---|---|
| Moonwalk | Force a plan before acting. Verify after every action. Cap the number of steps. Use cheap page data first and vision when needed. Use compound tools instead of single clicks. Ask before risky steps. |
| Wand | Pointing makes "this" and "here" meaningful. Resolve the pointer position locally at the moment of action, not on the server. Annotate screenshots with the pointer. Keep a clean boundary between the brain and the hands. Echo from the agent's own voice into the mic is a real problem. |
| Both | One agent at a time feels slow with a reasoning model. Baton runs several in parallel so the person never sits and waits. |

## Core concepts

| Concept | Meaning |
|---|---|
| Podium | The floating glass bar on the desktop. Shows listening, thinking and working states, the transcript, pointer anchors, lane status and the result card. |
| Cue | One spoken request plus the pointer anchors captured while it was spoken. |
| Anchor | Something the person pointed at during a cue: the element under the pointer, its text, its link or image, the page URL, a cropped screenshot and a timestamp. Shown on screen as a numbered pin while the person speaks. |
| Score | The plan for a cue: a small task graph of parts, with which parts can run in parallel, what each one needs from the others, and what the final answer looks like. |
| Lane | One part of the score running in its own Chrome window, with its own colour and ghost cursor. |
| Receipt | Every step a lane took: screenshot, marks, chosen action, a one-line reason and the verification result. Replayable. |
| Routine | A task learned from one rehearsal, with the parts that change marked as variables. |
| Profile | Facts the person has chosen to give Baton, such as their name, home city, preferred airline or work email. Stored locally and editable. |

## The three moves

### 1. Conduct

The person holds the talk key, points at something and gives a goal ("get me there", "compare these three", "find a dentist near here who's open Saturday").

1. The conductor sends the transcript, the anchors and the profile to the model and asks for a Score.
2. The Score is validated. Parts that do not depend on each other start together, up to the lane limit (default 4, maximum 8).
3. Baton opens one Chrome window per lane and tiles them neatly around the Podium.
4. Each lane works through its step loop. Its ghost cursor moves visibly to each target before acting, and its title bar shows a short line of what it is thinking.
5. When a lane finishes, its result card slides into the Podium. When all are done, the conductor merges them into one answer with any approvals still needed.

### 2. This, there

The person points at one thing and says "this", then at another and says "there" or "her" or "that sheet" in the same sentence. Every place the pointer rests for about 300 milliseconds while the key is held becomes a numbered anchor, in order. The model receives the transcript and the ordered anchors and maps each word like "this" and "there" to an anchor. Examples: "put this there" (a table on a page into a spreadsheet), "send this to her" (a document and a contact), "add this to that list".

### 3. Rehearse, then perform

1. The person says "watch me" and does a task once by hand while narrating it.
2. The extension records what they did: navigations, clicks with descriptions of the element, typed values with the field label, and copies and pastes. Passwords are never recorded.
3. The model turns the recording plus narration into a Routine with variables ("the invoice number from the email goes into the Reference field").
4. The person says "now do the rest" and points at the list of remaining items. Baton binds each item to the routine and runs them across lanes in parallel. A counter on the Podium shows progress.
5. Lanes treat the routine as a strong guide, not a blind replay, so they still look and verify at each step and cope with small differences.

### Redirecting a lane

While lanes run, the person can point at one lane and speak to it: "you, find one under 200", "stop", "show me what you did". Only that lane changes. "Everyone stop" pauses all lanes.

## Safety

- **Approval gates.** Before a click or key press, `packages/core/safety` classifies it. Anything that pays, books, buys, sends, posts, submits, deletes, accepts terms or changes settings pauses the lane and shows an approval card with a screenshot of the exact button. Approve by voice ("yes, book it") or by click.
- **Blocked fields.** Password, one-time code and payment-card fields are never typed into.
- **Injection.** Page text is wrapped and labelled as untrusted in every prompt. A cheap detector flags pages that contain instructions to an AI assistant; the lane pauses and shows the text.
- **Scope.** A lane works only on the goal it was given in the Score. It cannot start new lanes or change the profile.
- **Privacy.** Screenshots stay on the person's computer except when sent to the model. Receipts are stored locally and can be deleted. Because Muse Spark Open is open weights, a company can run the model on its own servers so screen content never leaves its network. That is the enterprise story.

## How a lane sees and acts

Each step:

1. **Look.** The extension marks every visible interactive element with a small numbered label, captures a screenshot of the lane's tab with the labels visible, and returns a compact list of the elements with their numbers, roles, names and values. The marks are drawn only for the screenshot and then hidden, so they do not show in the person's view unless debug mode is on.
2. **Decide.** The model gets the lane's goal, the plan for this lane, the last few steps, the element list and the screenshot, and returns one action as JSON.
3. **Act.** The extension animates the ghost cursor to the target, then performs the action through the DevTools Protocol.
4. **Verify.** A fresh look confirms that the expected change happened (the page changed, the field holds the value, the result appeared). If not, the lane retries differently.

Lane tools: `open_url`, `search_site(query)`, `click(mark)`, `type(mark, text, submit?)`, `select(mark, option)`, `scroll(direction | mark)`, `read(mark | region)` which extracts structured data, `wait_for(text)`, `back`, `extract_list(schema)`, `ask_person(question)`, `finish(result)`.

Use cheap reads (the element list and page text) first and the screenshot when the page is visual or the text is not enough, as Moonwalk did.

## Voice

- **Push to talk.** Hold the talk key (default Alt, either side; Left Alt, Right Alt or Right Ctrl can be chosen in the Podium or the tray menu, because many laptops have no Right Ctrl) to speak. Holding it alone for 200 ms opens the microphone; pressing any other key while it is down (Alt+Tab, Alt+F4, AltGr typing) means it was a shortcut, so nothing is recorded or the recording is discarded. While Alt is held for talking, Baton taps Ctrl once so that releasing Alt does not open the focused app's menu bar. Release to send. Tapping it while Baton is speaking stops the speech. Because the mic is only open while the key is held, Baton never hears itself, which avoids the echo problem Wand had.
- **Understanding.** The recording goes to Muse Spark Open as audio together with the anchors, or is transcribed first if Stage 0 shows that is faster or more accurate. The transcript appears on the Podium as soon as it is available.
- **Speaking.** Short spoken replies through the system's speech voices. Baton speaks rarely: to confirm a cue, ask a question, ask for approval and announce the result.
- **Instant acknowledgement.** The Podium reacts within 100 milliseconds of the key being released (a sound and a state change), so the person never wonders whether it heard them, even while the model is still thinking.

## Optional: the conductor's hand (camera)

If there is time after the core works, add a camera mode in which the person's hand is the baton:

- MediaPipe hand tracking in the renderer, with a 4-point calibration that maps the index fingertip to screen coordinates.
- The fingertip drives the anchor pointer instead of the mouse.
- A pinch drops an anchor. An open palm held up means "everyone stop". Pointing at a lane and speaking addresses that lane.

The mouse remains the default and the demo must work without the camera.

## Screens

1. **Podium.** The floating glass bar: idle, listening (live waveform and anchor pins), thinking (one-line plan), conducting (a coloured chip per lane with its status), result card, approval card.
2. **Lanes.** Real Chrome windows tiled around the Podium, each with a coloured frame, a lane name and the current thinking line, and a ghost cursor in the lane's colour.
3. **Score.** For any finished cue: the task graph, each lane's receipt as a filmstrip of screenshots with actions and reasons, and the time taken compared with an estimated time by hand.
4. **Rehearsal.** While recording: a red dot, the list of captured steps building up live, and the variables Baton found, which the person can rename or correct.
5. **Settings.** Talk key, lane limit, profile, approved sites, receipts storage, camera mode, extension pairing.

## The Baton benchmark

`bench/` holds at least 20 tasks with clear success checks, mostly on the demo sites plus a few on stable real sites. A script runs each task with one lane and with the conductor in parallel and records success, steps, time and cost. The Score page and the film show the real numbers.

## Demo sites

Served locally from `demo-sites/` on `http://localhost:4400` and up. All fictional, and labelled as demo sites in their footers:

- **Inbox** — a simple webmail with an event invitation, several vendor invoice emails and a few other messages.
- **Ledgerly** — a small accounts-payable web app with a "New bill" form, for the rehearse-then-perform move.
- **Roam** — a travel search site with flights and hotels near a venue, including one result that is too expensive and one that fits.
- **Hostile page** — a page with hidden instructions to AI assistants, for safety tests.

Real sites are better on camera where they hold up. Use the demo sites to develop and test, and as the backup if a real site blocks automation on the day.

## Model contract (measured in Stage 0, 2026-10-29)

Measured with `npm run spike` (`scripts/model-spike.ts`) and `npx tsx scripts/audio-repeat.ts` against `meta-models/muse-spark-open-1026`. Raw numbers land in `bench/runs/spike-*.json` (git-ignored). Both `meta-models/muse-spark-open` and `meta-models/muse-spark-open-1026` are listed by `/v1/models` for our key; Baton uses the `-1026` name.

### Request shape

- OpenAI SDK, `baseURL: https://inference.baseten.co/v1`, Chat Completions.
- `reasoning_effort` is a top-level field: `low | medium | high | xhigh` (Baseten's default is `xhigh`, so always set it). The model always reasons.
- Reasoning comes back in `message.reasoning_content`, separate from the answer in `message.content`. `usage.completion_tokens_details.reasoning_tokens` counts it.
- Set `max_tokens` with headroom for reasoning (we use 8000 for spikes); reasoning tokens count toward it.
- `n > 1` returns HTTP 400. Output is not reproducible.

### JSON output

- A system prompt that gives the exact JSON shape plus "Reply with JSON only" produced valid, zod-valid JSON on every call (planning, lane steps, cues, 8 of 8 parallel steps), with no code fences.
- `response_format: {type: "json_object"}` is accepted without error, but Baseten documents it as unsupported for this model and it added nothing. **Do not rely on it.** Parse the first `{…}` in `content`, validate with zod, and retry once with the error.
- **Tool calling works**: `tools` + `tool_choice: "auto"` returned a proper `tool_calls` entry (`click {mark: 5}`) with `finish_reason: tool_calls` in 1.9 s. It is available if a lane prefers it; the lane loop's default is JSON in `content`.

### Planning

| Effort | Time | Tokens out (reasoning) |
|---|---|---|
| low | 2.9–4.5 s | 615–729 (425–448) |
| medium | 4.9–5.6 s | 1331–1434 (1003–1133) |

Both produced sensible parallel parts with empty `dependsOn` for independent work. Use `low` for the first Score; `medium` adds about 1–2 s.

### Images

- Content part: `{type: "image_url", image_url: {url: "data:image/png;base64,…"}}`. Base64 data URLs work (100 MiB request-body limit). PNG, JPEG and WebP are accepted. PDFs are not.
- The 1280×800 Ledgerly screenshot with marks plus the element list: **mark 5 chosen correctly on every call** (2 single, 8 parallel, 8 size runs, 1 streamed).
- Lane step latency at `low`, 1280×800: **4.7–5.4 s** (1561 input tokens, ~80 output). The same step **text-only** (element list, no image): **1.2–1.3 s** (299 input tokens). Most image latency is before the first token (~3.8 s), not generation.
- `image_url.detail` (`auto`/`low`) did not change the token count.

| Screenshot | Input tokens | Latency | Correct |
|---|---|---|---|
| 960×600 | 1071 | 4.1 s | yes |
| 1280×800 | 1561 | 4.7 s | yes |
| 1920×1200 | 3268 | 8.1 s | yes |
| 2560×1600 | 4301 | 5.4–9.1 s | yes |

**Decision:** capture the lane viewport and downscale to at most 1280 px wide. Prefer a text-only step (element list + page text) when it is enough, and add the screenshot when the page is visual or the previous verification failed. This is the cheap-reads-first rule with a measured 4× speed reason.

### Audio

- Content part: `{type: "audio_url", audio_url: {url: "data:audio/wav;base64,…"}}`. The OpenAI SDK types do not know `audio_url`, so cast it. Baseten's documented encodings are WAV, MP3, FLAC, OGG (Vorbis/Opus) and M4A/AAC. Raw `audio/webm` was accepted but was the least reliable. Up to 4 files, 25 MB and 5 minutes each.
- The fixtures are 0.79 s ("Get me there.") and 8.6 s (the hotel request), robotic offline TTS, not the 5 s and 15 s the plan expected.
- **Unpadded audio fails on short commands:** the 0.79 s cue was exact in only 0–2 of 5 runs per format (ogg, wav, webm), often coming back empty or echoing the prompt text, which shows the model was not hearing the audio.
- **Padding fixes it:** decoding to 16 kHz mono WAV with **1 s of silence before and after** gave 31 of 32 exact for the short cue and 13 of 16 exact for the long cue. Every long-cue miss was the robotic voice's "venue" heard as "menu" (plus "3" for "three"); the intent was always right.
- Latency with padded WAV at `low`: **3.9–4.5 s** short, **5.7–6.4 s** long. Unpadded Ogg/Opus was ~3.3 s but unreliable.
- **Decision (chosen at the Stage 0 gate):** Baton sends the push-to-talk recording straight to Muse Spark Open as 16 kHz mono WAV padded with 1 s of silence each side, with the prompt asking for `{transcript, intent}` as JSON. No local speech model. Re-measure with a real human voice once push-to-talk records in Stage 1; if that fails, the fallback is still a small local speech model.
- **Real voice, Stage 1 (HP Envy laptop mic, talk key Alt):** a 2.46 s cue was understood in 6.7 s and a 10.08 s cue in 7.8 s, both transcribed correctly according to the person who spoke them. That is slower than the TTS fixtures (3.9–6.4 s), so the Podium must keep showing "Understanding…" with its animation. The microphone also opens about 1 s after the key goes down (3.60 s held gave 2.46 s of audio; 11.07 s held gave 10.08 s): about 200 ms is the deliberate hold threshold and the rest is opening the microphone and audio graph. Speech in that first second can be clipped.
- **Fix (measured on the same laptop):** the audio graph is built once when the Podium loads and kept suspended, and resumes while the microphone opens, not after. The microphone itself is still opened only while the key is held. First audio now arrives 490–540 ms after the hold threshold (760 ms on the first press after launch), down from 550–900 ms. Almost all of it is Windows opening the device. Turning off echo cancellation, noise suppression and gain control saved only about 50 ms, so they stay on. The Podium shows "Opening microphone…" and plays the listening chime only when the first real samples arrive, so the chime means "speak now" and nothing said after it is lost. Opening the microphone on key-down (before the 200 ms threshold) would save another 200 ms, but it would flash the Windows microphone indicator on every Alt+Tab, so Baton does not do it.

### Lane steps: use native tool calling (measured in Stage 2)

- Asking for a lane step as JSON in the prompt failed about 1 step in 20 over real benchmark runs. The model often answers in its **native tool-call channel format** instead, e.g. `<|start|>assistant to=commentary<|message|>…<|eom|><|start|>assistant to=scroll<|message|>{"direction":"up"}<|eot|>`, sometimes with the whole decision inside, and occasionally in plain prose.
- **Decision:** every lane step goes through the API's tool calling. Each lane tool is a function (`LANE_TOOLS` in `packages/core/src/lane/actions.ts`), and each takes `thinking`, `reason` and `expect` alongside its own arguments. Requests use **`tool_choice: "required"`**, which Baseten enforces: asked explicitly for prose, the model still returned a tool call. The server parses the native format, so Baton gets clean `tool_calls`.
- The JSON path stays as a fallback and also understands the native channel format (`fromNativeToolCall` in `packages/model`). Known variants are mapped deterministically onto the contract (`normalizeDecision`), then validated with zod as before, with one retry.
- The model sometimes sends numbers where text is expected (`"text": 200`); text arguments are coerced to strings.
- Extraction calls (`read`, `extract_list`) and planning stay on JSON-in-prompt; they have not shown the problem.

### Cues with pointing (measured in Stage 3)

- Interpreting a cue (transcript + anchors + profile → answer, task, transfer or clarify) takes 1.6–7 s at `low`, on top of 4.6–6 s to transcribe.
- Real speech is sometimes transcribed badly: "Put this there" once came back as "Yeah", and once as an unrelated sentence. Because the anchors carry the meaning, the interpreter still chose the right transfer. Prefer moves that the anchors make unambiguous, and keep transcripts visible on the Podium so the person can see what was heard.

### Scores and parallel lanes (measured in Stage 4)

- Planning a Score from a cue takes about 3.5 s at `low`. "Get me there" on the invitation plans four parts (flights, hotel, calendar, reply) that run in parallel.
- Lanes are fastest with compound tools: `fill_form` fills a whole form (text, dates, dropdowns) and can press its button in one step. With it the calendar part takes 4 steps instead of 29; the four "get me there" lanes took 4–7 steps each and the whole Score finished in 68 s, including one approval.
- Approvals raised while a Score runs are collected onto one card, shown once no lane is still working; one yes approves them all. Pointing at a lane window and speaking sends the words to that lane alone (its inbox); a lane waiting at the approval card is released and continues in its own window with the new instruction.
- Lanes must never invent personal details: with no traveller in its goal, a lane once filled a booking with a made-up name. Goals now carry the traveller from the profile, and lanes ask instead of inventing.

### Streaming

- `stream: true` works. Reasoning streams in `delta.reasoning_content`, then the answer in `delta.content`.
- For a lane step at `low`, the first reasoning chunk arrived at 3.8–4.1 s and the answer at 3.9–4.2 s, about 0.2 s apart. At `low` there are only 7–10 reasoning chunks. Streaming will feed the lane's "thinking" line, but it will not make a lane step faster; for planning at `medium`, with about 1000 reasoning tokens, it gives a live line to show while the Score forms.

### Parallel throughput

- 8 identical image lane steps sent at once: **wall 5.8–6.3 s**, per request 3.6–6.3 s (mean 4.9–5.7 s), 8 of 8 valid and correct. That is **6.4–7× faster than running them in sequence**, and no 429s. Parallel lanes are real on Baseten.

### Cost and rate

At $1.25 per million input tokens and $4.25 per million output tokens:

- Image lane step (1561 in, ~80 out): **≈ $0.0023**. Text-only step (≈300 in, ~80 out): **≈ $0.0007**.
- Planning call at `low` (270 in, ~700 out, before real profile and anchors): **≈ $0.0033**.
- Cue transcription (≈200–300 in, ~100–350 out): **≈ $0.001**.
- Each image step is ~1650 tokens, so a 2M tokens-per-minute limit would allow about 1200 image steps per minute. Eight lanes at ~5 s per step use about 100 steps per minute, so the lane limit and step latency bound throughput, not TPM. We did not measure the TPM limit; this uses the figure the spec gives.
- **Measured in Stage 5:** a 39-item perform at 8 lanes, with full-page prompts, sent 1.56 M input tokens in a few minutes ($2.29) and 12 lanes got HTTP 429. Baton now caps model calls in flight at 3, retries 429 and 5xx with backoff that honours `Retry-After`, performs routines 4 lanes at a time, trims prompts to 80 elements and 2,500 characters of page text, and stops at a daily spend cap (default $3, `packages/model/src/governor.ts`).

## Baton Live (measured in Stage 7, 2026-10-30)

- **Frames share one session history.** All frames on a page share the browser's back/forward history, so `history.back()` in one lane frame undid another lane's navigation (the hotel lane's "back" pushed the flights lane off its booking page). Each frame now keeps its own trail of pages, and Back goes to the previous page in that trail.
- **Back can restore a page without running its scripts** (back/forward cache). The frame script also announces itself on `pageshow`, and the hands fall back to the page the frame actually shows.
- **Service workers were the first design and were dropped.** The in-app test browser refused to register any service worker, and private windows in some browsers do not run them. Every `/sites/…` address is now a small shell page that asks the Live page for its HTML, and form posts are handed over by the frame script, so no service worker is needed.
- **A deadlock in the approval point** (desktop and Live): a part that depended on a part waiting for approval was counted as "still working", so the single approval card never appeared. `readyForApprovals` in `packages/core/src/score/scheduler.ts` ignores parts that cannot start, with tests.
- **Profile details on every goal.** Planned goals sometimes left out the traveller's email, so lanes stopped to ask. `goalWithProfile` now adds the profile's name, email and home city or airport to every lane goal, on the desktop and in Live.
- **One-line fields drop line breaks.** Typing "…Lisbon\nDetails…" into an `<input>` leaves "…LisbonDetails…", which verification read as a failed step three times. Verification now compares text without whitespace as well, and Live's hands turn line breaks into spaces for one-line fields.
- **Checkout pages say what is being paid for.** Without a summary, lanes at Roam's payment page went back to look for the details they were asked to report. Roam's traveller, payment and trips pages now show the flight or hotel, dates and traveller.
- **Gate run** (production build served by `vite preview` with the proxy, typed "Get me there"): four lanes ran in parallel and the bundled approval card appeared after 41 s. After one "Approve all", all four finished at 107 s: flight and hotel stopped at checkout without paying, the calendar event was saved and checked, and the reply was saved as a draft and not sent. That run cost about $0.30.
- **Limits, against the running server:** with `LIVE_VISITOR_CALLS_PER_HOUR=2`, calls 1 and 2 returned 200 and call 3 returned 403 `visitor-rate`. With `LIVE_DAILY_BUDGET_USD=0.0001`, the first call returned 200, then every call (including from another visitor) returned 403 `daily-budget`. During development the $0.50 visitor share was also hit for real mid-run; the share is now $1.00 because one full "Get me there" costs $0.30–0.50.
- **Key check:** `node scripts/check-live-key.mjs` scanned 8 built files and 11 responses (page, assets, demo shell, budget, a refused model call): the key appears in none. The variable name and Baseten's host appear in the bundle as constants of the shared model client; the browser never calls Baseten.

## The conductor's hand (measured in section 2 of docs/NEXT.md, 2026-10-31)

- MediaPipe Hand Landmarker 1.1.1 runs in the Podium on the laptop camera; only a pose and a pointing point per frame reach the main process. Calibration fits a homography from four corner targets; a One Euro filter smooths the pointer; a click-through overlay draws it.
- **First measured run (person's laptop, dim room):** accuracy 0 of 9 targets within 40 px (errors 156–1126 px, median 639 px); gestures point 9/10, pinch 5/10, select a lane 1/10, open palm 2/10, two fingers 8/10; 1 false "everyone stop" in two minutes; tracking at about 15 frames per second.
- **Causes found and fixed, not yet re-measured:** the pointer followed the fingertip, which a pinch drags toward the thumb (now the index knuckle, with each sample the median of the preceding half second); single-frame pose flicker restarted holds (now a 150 ms majority vote); the pinch rule rejected real pinches (now told from a fist by the index tip's distance from its own knuckle, in 3D); an open hand moving while talking could stop everyone (now the hand must be still for the half-second hold). The Podium and the log now report the processor (GPU or CPU) and the camera's frame rate.
- **The gate has not passed.** The person could not re-run the checks in good light and asked to move on; re-running Calibrate, Check accuracy and Test gestures from the Podium measures it.

## Out of scope

Controlling native desktop apps (read-only "what is this" questions about anything on screen are in scope), mobile apps, purchases without approval, storing payment details, and multiple monitors.
