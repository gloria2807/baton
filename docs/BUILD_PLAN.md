# Baton — build plan in stages

Build Baton in one continuous run with Claude Code. Each stage ends with a gate: checks that must pass before the next stage starts. Move as fast as the gates allow. The riskiest things come first, so if something fundamental does not work, you find out in the first hours, not on the last day.

Hard deadline: Wednesday November 4, 9:00 PM Eastern, which is 3:00 AM Thursday November 5 in Lagos.

---

## The master prompt

Paste this into Claude Code once. It works through the stages in order and stops only at a failed gate or when it needs you.

> Read CLAUDE.md, docs/SPEC.md, docs/BUILD_PLAN.md and docs/DEMO_SCRIPT.md in full. Build Baton by working through every stage in docs/BUILD_PLAN.md in order. For each stage: implement everything listed, write the tests listed, then run every check in that stage's gate and show me the real output. When a gate check needs me to do something by hand, such as loading the extension, holding the talk key or watching a lane, tell me exactly what to do and wait for my answer. Commit at the end of each stage with a plain message. Only start the next stage when every gate check passes. If a gate fails, fix it before moving on. If you need something only I can provide, stop and ask for exactly that. Never fake a result, a test outcome or a working feature. Stage 0 decides the formats every later stage uses, so finish it first and record what you learn in docs/SPEC.md.

If the run is interrupted, restart with: "Continue the build from the first stage whose gate has not passed."

---

## Stage 0 — Prove the model

Write `scripts/model-spike.ts`, which calls Muse Spark Open on Baseten and prints timing, final answer and reasoning separately for:

1. JSON-only output for a small planning request.
2. A screenshot of a demo site page with numbered marks, asking which mark to click for a given goal.
3. A 5-second and a 15-second recording from `fixtures/spike/` asking for a transcript and intent as JSON.
4. Streaming, to see whether reasoning and answer arrive incrementally.
5. Eight identical lane-step requests sent at the same moment, to measure real parallel throughput.

Read the Baseten docs for vision, audio and reasoning before writing the requests. Record what worked in the "Model contract" section of docs/SPEC.md.

**Gate**
- Valid JSON from every request type, and the right mark chosen on the screenshot test.
- Measured latency for a lane step and for a planning call, and measured parallel throughput.
- If audio is too slow or inaccurate, Claude Code stops and asks. The fallback is transcribing with a small local speech model before calling Muse Spark Open.

## Stage 1 — Hands and bridge

- Monorepo: `apps/desktop`, `apps/extension`, `packages/core`, `packages/model`, `demo-sites`.
- Demo sites (Inbox, Ledgerly, Roam, Hostile page) as described in SPEC.md, with realistic but fictional content, served by one command.
- Electron app with a tray icon and the Podium window (transparent, always on top, draggable).
- Local WebSocket bridge in the Electron main process on `127.0.0.1`, with a pairing token the person pastes into the extension's options page once.
- Extension service worker: create lane windows, attach `chrome.debugger`, capture screenshots, send mouse and keyboard input, read the element list with numbered marks.
- Content script: ghost cursor that animates smoothly to a target in the lane's colour, numbered marks for screenshots, lane frame and title.
- Global push-to-talk: hold the key to record, release to stop, using a library that can see key down and key up on Windows, such as `uiohook-napi`.

**Gate**
- From a test script in the desktop app, Baton opens a lane window, navigates to the Ledgerly demo site, moves the ghost cursor visibly to the "New bill" button, clicks it, and returns a screenshot with marks. Claude Code asks you to confirm you saw it.
- Holding the talk key records audio and releasing it saves the recording. You confirm it.
- Unit tests for the bridge's message schemas and pairing.

## Stage 2 — One lane that works

- Lane step loop from SPEC.md (look, decide, act, verify) with the full tool set, step cap, retry rules and receipts written to disk.
- `packages/core/safety`: approval classification and blocked-field detection, with thorough unit tests.
- Approval card on the Podium, answerable by click or by voice.
- Injection detection: the Hostile page must pause the lane.
- Benchmark harness in `bench/` with the first 10 single-lane tasks.

**Gate**
- 9 of the 10 single-lane benchmark tasks succeed. Show the table.
- A booking on Roam stops at an approval card and does nothing until approved.
- A password field is never typed into (test with Ledgerly's sign-in page).
- The Hostile page pauses the lane and shows the hidden instruction.
- One real-site task works in your signed-in Chrome, such as searching for something on a real map or travel site and reading back the first three results. If real sites block automation, Claude Code reports exactly what happened.

## Stage 3 — Point and speak

- Cues: transcript plus ordered anchors captured while the key is held. Anchor pins appear on screen as the pointer rests.
- Anchors work in any Chrome tab through the content script. Outside Chrome, a desktop screenshot with a pointer marker supports read-only questions.
- "What is this?" answered aloud for any anchor.
- Single-lane cues that use anchors, such as "add this to my calendar" or "find this cheaper".
- "This, there" with two or more anchors in one sentence.
- Profile settings.

**Gate**
- On Inbox, pointing at the invitation and saying "what is this?" gets a correct spoken summary.
- Pointing at a table on Roam, then at a sheet in Ledgerly's import page, and saying "put this there" moves the data correctly.
- Anchor mapping unit tests with recorded cues.

## Stage 4 — The conductor

This is the heart of the film. Give it the most care.

- Score planning: a validated task graph with parallel parts and dependencies.
- Scheduler: run independent lanes together up to the lane limit, pass results to dependent parts, and merge everything into one result card.
- Tiling: lane windows arranged neatly around the Podium at 1920×1080 and 2560×1440, with smooth placement.
- Redirect by pointing: point at a lane window and speak to change only that lane. "Everyone stop" pauses all.
- Score view: task graph and each lane's receipt as a filmstrip, with time taken against an estimated manual time.
- Benchmark: 10 more tasks that need several lanes, each run with one lane in sequence and with the conductor in parallel.

**Gate**
- "Get me there" while pointing at the Inbox invitation runs four lanes at once (flights, hotel near the venue, calendar block, reply draft) and ends with one result card and one approval. Claude Code asks you to watch it and confirm.
- Redirecting one lane by pointing changes only that lane.
- On the parallel benchmark, the conductor is faster than one lane in sequence and at least as accurate. Show the table with real numbers.

## Stage 5 — Rehearse, then perform

- Rehearsal recording in the extension (navigation, clicks with element descriptions, typed values with field labels, copy and paste; never passwords) plus narration audio.
- Routine compilation into steps with variables, shown on the Rehearsal screen for correction.
- Perform: bind each remaining item to the routine and run across lanes, with a progress counter.

**Gate**
- You rehearse entering one invoice email from Inbox into Ledgerly. "Now do the rest" enters the other invoices correctly across lanes, with no duplicates. Ledgerly's own list proves it.
- Routine compilation unit tests with recorded rehearsals.

## Stage 6 — Film-ready and shipped

- Demo mode: `npm run demo:reset` puts the demo sites, the profile and the Podium into the exact starting state of docs/DEMO_SCRIPT.md.
- Polish everything the camera will see: Podium transitions, lane colours, ghost cursor motion, result and approval cards, sounds for listening, thinking, lane finished and all done.
- Windows installer with `electron-builder`, and the extension packed as a zip with install instructions.
- README: what Baton is, a short GIF, how to install and run, the architecture diagram, the model contract, safety rules, benchmark results, and a section "Built during the hackathon" listing every part.
- Optional, only if everything above is done: the conductor's hand camera mode from SPEC.md.

**Gate**
- A clean install from the README on a fresh Windows user account works end to end.
- Every scene in docs/DEMO_SCRIPT.md can be performed live after one reset.
- All tests pass, the repo is public, and the README renders correctly.

## Stage 7 — Try it live (for judges)

Judges look at "your code and live product". Most will not install a desktop app and a Chrome extension with debugging permission, so Baton needs a version they can open from a link.

- **Baton Live:** a web app deployed to Vercel together with the demo sites, on the same domain. Lanes are same-origin frames of the demo sites, driven by a second "hands" adapter that uses DOM events and in-page screenshots instead of the Chrome debugger. It reuses `packages/core` unchanged: same planner, lane loop, safety rules and receipts.
- **Push to talk in the browser** (hold the space bar or a button), plus a text box for judges without a microphone.
- **Model proxy:** a Vercel serverless function holds the Baseten key and forwards calls. It is rate-limited per visitor and has a hard daily budget so the credits cannot be drained. The key never reaches the browser.
- **Guided tour:** three suggested cues on screen ("Get me there" on the invitation, "Put this there", "Watch me" then "Do the rest"), so a judge sees the orchestra within 30 seconds of opening the link.
- The README and the video description link to Baton Live first, and to the desktop download second.

**Gate**
- Opening the deployed link in a private window, with no install, a first-time visitor can run "Get me there" and watch four lanes work in parallel.
- The proxy refuses requests beyond the per-visitor limit and the daily budget. Show the test.
- The Baseten key does not appear anywhere in the browser's network responses or bundled files. Show the check.

---

## If time runs short, cut in this order

1. Camera mode
2. Pointing outside Chrome
3. Rehearse, then perform (keep Conduct and This, there)
4. Redirecting a lane by pointing (keep "everyone stop")

Never cut: approval gates, blocked fields, receipts, parallel lanes with ghost cursors, the "get me there" scene, and Baton Live. If time is very short, build Baton Live before Stage 5.
