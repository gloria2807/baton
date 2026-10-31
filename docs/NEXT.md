# Baton — next build: real sites, the conductor's hand, and a fast-feeling voice

Three pieces of work, in this order. Each has a gate. Keep every rule in CLAUDE.md.

---

## 1. Real websites

Everything so far has been proven on the fictional demo sites. The demo now runs on real sites in the person's own signed-in Chrome.

**Sites to support for the demo** (swap any that refuse automation for another real site of the same kind):
- Product pages on brand or retailer sites, plus an independent review site
- A weather site
- Google Maps
- A museum's own website
- A public company directory or list page
- Google Docs, Google Sheets, Google Calendar and Gmail

**What will go wrong and how to handle it**
- **Cookie and consent banners.** A shared handler runs before each lane's first step on a new site. It looks for a consent dialog and chooses the most privacy-preserving option ("Reject all", "Necessary only"); if it can't tell, it asks the lane model with the dialog cropped.
- **Pop-ups, sign-up modals and chat widgets.** Detect large overlays covering the page and close them by their close button or Escape, then verify the page underneath is reachable.
- **CAPTCHAs and bot checks.** Never try to solve them. The lane pauses, says "This site wants to check you're human", brings its window to the front, and continues once the person has done it.
- **Google Docs and Sheets draw on a canvas,** so the element list does not show cell or text contents.
  - Sheets: move with the Name Box (type `B4`, press Enter) and type values with the keyboard; read results by selecting a range and reading the formula bar, or by reading the published HTML of the sheet the person owns.
  - Docs: type with the keyboard at the cursor; insert tables through the menu; read back with the document's accessibility mode (Docs offers screen-reader support) or by selecting text.
- **Heavy, slow pages.** Wait for the page to settle (network quiet and no layout shifts for 500 ms) rather than fixed delays, with a cap.
- **Site notes.** Keep a small file of per-site tips that lanes receive when they open that site (for example "Sheets: use the Name Box to move"). Lanes can add a note when they discover a reliable trick, and the person can review the notes. This is part of Baton's memory.

**Benchmark.** Add `bench/real/` with one task per demo example and at least 10 more everyday tasks across the sites above, each with a clear success check. Run them with one lane and with the conductor.

**Gate**
- All four demo examples complete on real sites, three runs each, with results in a table: success, steps, time, cost, and anything that needed the person.
- At least 8 of 10 extra real-site tasks succeed.
- No consent banner or pop-up stops a lane in the recorded runs.

---

## 2. The conductor's hand (camera gestures)

The person can conduct with their hand instead of the mouse, as in Wand, but across the whole desktop and with gestures for directing agents.

**How it works**
- MediaPipe Hand Landmarker (Tasks Vision, running in the renderer through WebAssembly and the GPU) on the laptop camera at 30 frames per second or more. Camera frames never leave the computer and are never sent to the model.
- **Calibration** once per setup: the person points at four targets in the corners of the screen; Baton fits a mapping from fingertip position to screen position and stores it. A quick re-check from the Podium.
- **Smoothing** with a One Euro filter so the pointer is steady when the hand is still and responsive when it moves fast.
- **The hand pointer** is drawn in a transparent, click-through, always-on-top window across the whole screen: a small brass ring that tightens when it rests.
- Like Wand, the pointer position is read locally at the moment an action needs it, never from a delayed copy.

**Gestures** (each needs to be held briefly to count, so normal hand movement doesn't trigger anything)
| Gesture | Meaning |
|---|---|
| Point with the index finger | Moves the hand pointer |
| Pinch (thumb and index) while pointing | Drops a numbered pin on what's under the pointer |
| Point at a lane window and pinch | Selects that lane; the next thing said goes to it alone |
| Open palm towards the camera, held half a second | Everyone stop |
| Two fingers up (index and middle), held | Talk while held, as an alternative to the talk key |

Approvals for anything irreversible still need a spoken "yes" or a click. A gesture can never approve a payment, booking or message.

**On screen.** A small camera preview in the Podium shows the hand skeleton while camera mode is on, so the person (and the video) can see it tracking. A clear "Camera on" indicator whenever the camera is in use, and one switch to turn it off.

**Gate**
- After calibration, pointing at each of nine targets across the screen lands within 40 pixels of the target. Show the measurements.
- Every gesture in the table is recognised in at least 9 of 10 attempts, with no false "everyone stop" during two minutes of normal talking and pointing.
- The "Compare" demo example runs start to finish using only the hand and voice.

---

## 3. Voice that feels instant

Measured today: 6.7–7.8 seconds from releasing the key to understanding a real spoken command, and planning adds about 3.5 seconds more. Two jobs: make it actually faster, and make the wait feel alive.

**Make it faster**
1. **One call instead of three.** Today the recording is transcribed, then interpreted, then planned, each a separate model call. Send the audio, the pins and the profile in one call that returns the transcript, the intent and the Score together. Measure before and after.
2. **Stream the plan and start lanes as parts arrive.** Stream the model's answer and parse the JSON as it grows. The moment the first part of the Score is complete, open and start that lane, while the rest of the plan is still arriving. The person sees work begin seconds earlier.
3. **Prepare everything while the key is held.** Capture pins, page context and screenshots during speech, and warm the connection to Baseten when the key goes down, so nothing waits after release.
4. **Open lane windows early.** As soon as the plan says how many parts there are, tile empty lane windows into place so the screen is already arranging itself.
5. **Shortest prompts that work.** Keep the understanding call at `low` reasoning effort with a compact prompt; measure whether `medium` changes accuracy enough to be worth it.

**Make the wait feel alive** (every state is honest; nothing pretends to be done before it is)
- **0 ms after release:** a soft tick and the Podium changes to "Heard you", with the waveform of what was just said frozen in place and the numbered pins still visible.
- **Live words while speaking:** run a small open-source speech recogniser locally in the renderer (for example a Whisper tiny or base model through transformers.js or whisper.cpp in WebAssembly) only to show the person's words on the Podium as they speak. These live captions are for display. Muse Spark Open still hears the original audio and its transcript is the one Baton acts on; if the two differ, the Podium quietly replaces the live caption with Muse's.
- **The model thinking, in its own words:** stream the reasoning and show it as a single line that rewrites itself in the monospace ("they want flights for Dec 2–4… the venue address is in the email… four parts"). Keep it to one line and short phrases, not a wall of text.
- **The plan assembling:** each part of the Score appears on the Podium as its own chip the moment it is parsed, then turns into a lane.
- **Sound:** a tick on release, a low tone when the plan is ready, a soft note as each lane starts.

**Gate**
- Median time from key release to the first lane starting work, over 10 real spoken commands, is under 5 seconds (today it is about 10–11). Show the before and after table.
- Live captions appear while speaking, and the reasoning line updates at least twice during every wait longer than 2 seconds.
- Muse's transcript is correct in at least 9 of 10 real commands.
