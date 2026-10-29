# Baton — the film

Three minutes, made like a short film. The opening and closing can be as cinematic as you like. Everything in the middle is the real product working live, because judges score whether the demo holds up and whether it is "genuinely cool to watch". Both are true only if what they see is real.

## The rules this film follows

1. **A person in the first five seconds.** Judges remember a story about someone.
2. **The orchestra shot by 0:45.** Four ghost cursors moving at once is the image people will share. Do not make them wait for it.
3. **Show, then explain.** The product acts first; one sentence of voiceover explains afterwards.
4. **Real means real.** Every product shot is live, uncut and sped up only where a small "2×" badge says so. The motion graphics tell the story; they never fake a result.
5. **Captions throughout.** Many judges watch with the sound off.
6. **Plain voice.** Short sentences, spoken by you, calm and sure.

## Cast and setting

- **Ama**, an operations lead at a small company, played by you or a friend. Shown from behind or by her hands and screen if you prefer not to be on camera.
- Her laptop, her real Chrome, her real desk. A good microphone close to her.

## The film

### 0:00 – 0:20 · Cold open: one cursor (motion graphics, then live)

Black screen. A single white cursor blinks in the middle. A soft clock ticks.

> **Voiceover:** "For forty years, computers have given us one cursor. One click at a time."

The cursor starts clicking through tabs faster and faster: flights, hotels, calendar, email, a spreadsheet. A timer in the corner runs past 6 minutes. Cut to Ama's face, tired.

> **Voiceover:** "Ama spends her days being the cursor."

The cursor stops. It splits into four coloured cursors that spread out across the screen like an orchestra taking their seats. The word **Baton** appears.

### 0:20 – 1:00 · Conduct (live)

Ama's real screen. An event invitation is open in her inbox: a conference in Lisbon.

She holds the talk key, points at the invitation and says:

> **Ama:** "Get me there."

A numbered pin drops where she is pointing. The Podium shows a one-line plan. Then four Chrome windows tile across the screen, each with its own colour and ghost cursor, all moving at the same time:

- Blue searches flights for those dates from her home city.
- Green looks for hotels within walking distance of the venue address it read from the invitation.
- Orange blocks the days in her calendar.
- Purple drafts a reply to the organiser.

Each window's title shows a short line of what it is thinking. Ama takes her hand off the mouse and picks up her coffee.

> **Voiceover:** "Baton splits one request into parts and runs them side by side, each in its own window, in Ama's own browser, while her hands are free."

### 1:00 – 1:20 · Redirect a lane (live)

The blue lane finishes first: "Best option: $212, TAP, 7:40 AM."

Ama points at the blue window.

> **Ama:** "You. Under two hundred."

Only the blue lane starts again. The others keep going. Blue comes back with $186. The result card assembles: flight, hotel, calendar and reply, with one approval at the bottom: "Book the $186 flight?"

> **Ama:** "Yes."

The lane stops at the airline's final payment screen and waits for Ama to enter her own card details. Caption: "Baton never touches passwords or card numbers."

### 1:20 – 1:40 · This, there (live)

A web page with a table of speaker sessions. Ama points at the table.

> **Ama:** "Put this…"

She points at a spreadsheet.

> **Ama:** "…there."

Two numbered pins appear, one on each. The rows flow into the sheet.

### 1:40 – 2:15 · Rehearse, then perform (live, partly sped up with a badge)

> **Ama:** "Watch me."

A red dot on the Podium. She opens one invoice email and types it into the accounts app while saying what she is doing: "the vendor goes here, this number is the reference, the total goes here." The steps appear on the Podium as she works, with the changing parts highlighted.

> **Ama:** "Now do the rest."

She points at the inbox. Eight lanes open. A counter climbs from 1 to 40. The accounts app fills up.

> **Voiceover:** "Show it once. Baton learns the routine, then performs it in parallel, checking every step as it goes."

### 2:15 – 2:40 · Under the hood (motion graphics over the real Score view)

The Score view: the task graph from "get me there", then a filmstrip of one lane's receipt, every screenshot and every decision.

Three short beats on screen, each with one line of voiceover:

1. "Every lane plans, acts and checks its own work after every step."
2. "Anything you can't undo waits for your yes."
3. "It runs on Meta's open-weights model, Muse Spark Open, so a company can keep every screen on its own servers."

Then the benchmark: "20 tasks · one agent: X minutes · Baton: Y minutes". Use the real numbers, whatever they are.

End the section on the Baton Live link: "Try it yourself, no install."

### 2:40 – 2:50 · Who it's for (motion graphics)

One card, one line of voiceover: "For teams who live in their browser, and for anyone who finds the mouse hard to use." Then the real proof: a quote from one person who tried it and the real waitlist count from Baton Live.

### 2:50 – 3:00 · Close

Back to Ama. The four coloured cursors settle back into one.

> **Voiceover:** "You've always had one cursor. Now you have an orchestra."

End card: **Baton** · github link · "Built during the Meta Global AI Developer Hackathon on Muse Spark Open."

## Shooting it

- **Screen.** Record at 1920×1080 with a recorder that adds smooth zoom on clicks. Hide the bookmarks bar, turn off notifications, use a clean desktop wallpaper.
- **Real sites or demo sites.** Use real sites where they work reliably in rehearsal. If one blocks automation on the day, switch that scene to the matching demo site and keep a small "demo site" label on screen. Never pass a demo site off as a real one.
- **Ama.** Film her with your phone on a stand, side-on, natural light. Two or three shots are enough: the tired look, the coffee, the "yes".
- **Takes.** Run each scene five times and keep the cleanest. The live scenes must be single unedited takes, with "2×" badges where you speed them up.
- **Sound.** Quiet music under everything, lowered when anyone speaks. Baton's own sounds for listening, lanes starting, a lane finishing and all done. The "all done" sound is the one people should remember.

## Motion graphics with Remotion

Prompt for Claude Code, once the product is finished:

> In a new folder `video/`, set up a Remotion project at 1920×1080, 30 fps, using Baton's colours and font. Build the cold open from docs/DEMO_SCRIPT.md: a single blinking cursor, clicking through tabs faster and faster with a running timer, then splitting into four coloured cursors that spread across the frame, then the Baton title. Build the "under the hood" overlays as three short animated beats and a benchmark card whose numbers come from `bench/results.json`. Build the closing sequence where four cursors settle back into one and the end card appears. Expose all text as props.

## Before the final recording

- `npm run demo:reset`, then run the whole film from start to finish without stopping, at least three times.
- Check every real site you use is signed in and loads quickly.
- Close everything else. Plug in the laptop. Turn on Do Not Disturb.
