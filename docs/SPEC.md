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

- **Push to talk.** Hold the talk key (default Right Ctrl, configurable) to speak. Release to send. Tapping it while Baton is speaking stops the speech. Because the mic is only open while the key is held, Baton never hears itself, which avoids the echo problem Wand had.
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

## Model contract (fill in during Stage 0)

Record here exactly what worked against `meta-models/muse-spark-open-1026`:

- JSON-only output: request shape, where the reasoning appears, whether a JSON response format or tool calling is supported.
- Images: content part format, the largest screenshot size that works well, latency for a 1280×800 screenshot with marks.
- Audio: content part format, accepted encodings, latency and transcription quality for a 5-second and a 15-second recording.
- Streaming: whether reasoning and answer can be streamed, and how.
- Cost per typical lane step and per planning call, and how many lane steps per minute the 2M TPM limit allows.

## Out of scope

Controlling native desktop apps (read-only "what is this" questions about anything on screen are in scope), mobile apps, purchases without approval, storing payment details, and multiple monitors.
