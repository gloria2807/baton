# Baton — three things, nothing else

Work only on these three, in this order. Each has a gate measured on real websites in my own signed-in Chrome. Keep every rule in CLAUDE.md. Don't touch the camera, voice or styling unless one of these needs it.

---

## 1. Parallel lanes that are visibly faster

**Where we are.** The model handles parallel calls well (8 at once came back in about 6 s, 6–7× faster than one after another), but Baton's parallel benchmark was only about 5% faster than one lane overall, and some requests were slower (0.6×). Since then a cap of 3 model calls at a time was added, so a four-lane plan now waits on itself. The slowness is in Baton, not the model.

**Measure first.** Add timing to every lane step and log it per lane: waiting on the governor, building the page view (DOM read, marks), screenshot, model call (time to first token and total), the action, and verification. Run the multi-part real-site requests in one-lane and conductor mode and write the breakdown to `bench/results-speed.md`. Fix what the numbers show, not what we guess.

**Likely causes to check**
- **The cap.** `BATON_MAX_CALLS` defaults to 3. For Scores it must be at least the number of running lanes (default 4, up to 8). Keep the daily budget and the 429 backoff that honours `Retry-After`.
- **Chrome throttling lanes it thinks are hidden.** Chrome slows down windows that are in the background or covered by other windows: timers, rendering and screenshots. With four tiled windows, most are not focused. Try, per lane tab: `Emulation.setFocusEmulationEnabled({enabled: true})`, `Page.setWebLifecycleState({state: 'active'})`, and making sure lane windows don't overlap each other or the Podium. Measure screenshot time before and after.
- **Waiting for pages to settle.** The new quiet-page wait (500 ms quiet, up to 4 s) runs on every step. Check how much of each step it takes, and skip it when the action didn't navigate.
- **Screenshots when text would do.** A text-only step takes about 1.2 s and an image step about 4.7 s. Make sure lanes only add the screenshot when the page is visual or the last verification failed.
- **One-at-a-time paths.** Check the bridge, the extension's message handling and anything that awaits lanes in turn, such as focusing windows, `captureVisibleTab` (which only works on the focused window) or a single shared queue.
- **Planning time counted only in conductor mode.** Compare like with like, and report planning time separately.
- **Lanes taking more steps in parallel than alone.** If they do, find out why.

**Gate**
- `bench/results-speed.md` shows the per-step breakdown before and after the fixes.
- On the real-site multi-part benchmark, the conductor finishes at least 2× faster than one lane in sequence on requests with 3 or more independent parts, with the same or better success. Show the before and after tables.
- The Lisbon request from Demo 1 ("Plan a weekend in Lisbon for two: weather, three places to eat near the old town, one museum that's open Sunday, then write it up in this doc") runs three times on real sites. Report the time for each run with one lane and with the conductor.

---

## 2. Lanes that talk to each other

Lanes share what they find while they work, so one lane's discovery can change another lane's plan, the way a real team works. This is a key moment in the demo, so it has to be real and visible.

**How it works**
- A **shared channel per Score**. Any lane can post a short finding with the `post_finding` tool: one sentence, plus optional structured facts (a date, a place, a price, a time).
- At every step, each lane receives the **recent posts from other lanes** (the last 10, newest first) as untrusted data, clearly separated from its goal.
- A lane may **change its own plan** in response, and when it does, it posts a short reply saying what it changed and why ("Moving the museum to Saturday afternoon: it's indoors").
- Lanes can only change their own work. They cannot stop, start or redirect another lane, change the Score, or change the profile. Approval rules apply exactly as before.
- Prompt the lanes to post only findings that matter to other parts of the plan (dates, times, places, prices, constraints), not progress updates, so the channel stays short.
- The final writing part reads the whole channel, so the plan reflects the adjustments.
- Page text can never be posted to the channel as an instruction. A post is the lane's own summary.

**On screen**
- In the lane log, posts appear in the lane's colour with a small arrow marker: `12:04:31  blue → all  Rain likely Saturday afternoon`.
- On the Podium, a compact thread of the last three posts while a Score runs.
- In the Score view and receipts, each adjustment links to the post that caused it.

**Gate**
- Unit tests: posts reach other lanes, lanes cannot act on other lanes, posts are capped in length and count, and an instruction found on a web page does not travel through the channel.
- On real sites, the Lisbon request runs three times, and in each run at least one lane changes its plan because of another lane's post, and the final Doc reflects it. Show the channel log for each run.

---

## 3. Memory

Baton remembers what the person tells it and what it learns from tasks, and uses that in future plans, like Moonwalk's memory.

**What it remembers**
- **Facts the person states:** "Remember that my home airport is Lagos", "I like aisle seats", "Maya's email is maya@…", "My hotel budget is usually under 150 a night".
- **Preferences from past tasks**, but only after asking: when the person corrects a lane ("you, under 150"), Baton asks once, "Should I remember that your hotel budget is under 150?" and saves it only on yes.
- **Past tasks:** a short record of each finished Score (what was asked, the result, links to the files it made), so the person can say "do the same as last weekend's plan, but for Porto" or "send Maya the plan from yesterday".
- **Site notes,** which already exist, become part of memory.

**How it works**
- Stored locally in a readable JSON file in the app's data folder. Never sent anywhere except as part of a model prompt when relevant.
- When planning, the conductor includes only the memories relevant to the request: match on keywords and entities first, and include at most 10 items.
- Voice commands: "remember that…", "forget that…", "what do you remember about me?" (spoken answer plus a list on the Podium).
- A Memory section in the Podium settings to view, edit and delete every item.
- Each plan shows which memories it used, as small chips ("used: home airport, hotel budget"), so the person can see why it chose what it did.
- Never store passwords, card numbers, one-time codes or anything typed into a blocked field.

**Gate**
- Unit tests: save, recall by relevance, forget, the ask-before-saving rule, and that blocked-field values are never stored.
- On real sites: say "Remember that my hotel budget is under 150 a night." Then run the Lisbon request without mentioning a budget, and the hotel part uses the limit, with the "used" chip shown. Then say "Forget my hotel budget" and confirm it's gone.
- "Do the same for Porto" after a Lisbon run produces a matching plan for Porto.
