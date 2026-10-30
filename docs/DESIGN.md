# Baton — design direction

Baton conducts. The person is the conductor; lanes are sections of an orchestra; the plan is a score. The interface should feel like a well-made instrument: quiet until played, precise when it speaks. Every visual decision below comes from that idea, not from a template.

## What we do not do

These are the tells of generated interfaces, and Baton avoids all of them:

- No purple, indigo or blue-to-purple gradients, no gradient text, no aurora glows.
- No frosted glass panels or glow shadows. Surfaces are solid.
- No uppercase tracked micro-labels ("NEEDS YOUR YES"). Labels are sentence case.
- No coloured left-border cards, no cards inside cards, no rows of three equal stat cards.
- No status dots on everything. A colour swatch appears only where it identifies a lane, because the same colour frames that lane's window.
- No fade-and-rise on every panel. One orchestrated moment: the Podium opening when lanes start.
- No emoji as icons, no invented numbers. Every number on screen is measured.

## Material

The Podium sits on top of whatever is on the person's screen, so it is a solid object, not a tint: dark lacquer with a warm, papery foreground and a single metal accent, like a conductor's stand.

| Token | Value | Role |
|---|---|---|
| `--ink` | `#17161a` | Podium and window surface |
| `--ink-2` | `#211f24` | Raised rows inside the Podium (one level only) |
| `--line` | `#34313a` | 1 px dividers and outlines |
| `--paper` | `#efe9dd` | Primary text on ink |
| `--paper-2` | `#a7a19a` | Secondary text |
| `--brass` | `#c99a3b` | The one accent: the talk key, approvals, anchors, the primary button |
| `--brass-ink` | `#1d160a` | Text on brass |
| `--alert` | `#e0674f` | Danger only: injection warnings, failures |
| `--done` | `#7fae7a` | Success text only, never as a fill |

Lane colours identify sections of the orchestra and match each lane window's frame. They are distinct on camera, without neon:

| Lane | Colour |
|---|---|
| 1 | `#4d7bd8` cobalt |
| 2 | `#3f9a6b` moss |
| 3 | `#d98a3a` amber |
| 4 | `#c8577a` rose |
| 5 | `#2f9c9c` teal |
| 6 | `#9b7a3d` bronze |
| 7 | `#7c8a9e` slate |
| 8 | `#b85c3c` rust |

## Type

One family: **Schibsted Grotesk** (variable, OFL), shipped with the app. Numbers use tabular figures. No monospace labels.

| Use | Size / weight |
|---|---|
| Podium line | 17 / 560 |
| Card title | 16 / 600 |
| Body | 13.5 / 420 |
| Secondary | 12.5 / 420, `--paper-2` |

## Shape and space

- Spacing on a 4 px grid: 4, 8, 12, 16, 24, 32.
- Radius has meaning: the Podium is 14 px (an object), rows inside it are 8 px, buttons 7 px, swatches 3 px. Never "rounded everything".
- One elevation: the Podium casts a short, dark shadow so it reads above any wallpaper. Nothing inside it casts a shadow.
- Dividers are 1 px `--line`. Structure comes from alignment and spacing, not boxes.

## Motion

- 180 ms, `cubic-bezier(.2,.7,.2,1)`, for state changes the person caused (key down, card appears).
- The ghost cursor glides on a gentle arc; it never glows.
- The listening waveform is the only continuous animation, and only while the key is held.

## Voice of the interface

Short, concrete, active. "Book the $186 flight?" not "Confirm your booking action". Buttons say what they do: "Approve all 3", "Stop lane", "Show the score".

## The Score view

A finished cue is drawn as an actual score: one staff line per lane, running left to right in real time, each step a note on the line, approvals marked in brass, failures in alert. The filmstrip of screenshots sits under its staff. Totals are one sentence with measured numbers, not three cards.
