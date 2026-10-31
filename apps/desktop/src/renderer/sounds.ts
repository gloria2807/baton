// Small synthesized cues so the person hears Baton react the instant the key moves.

let ctx: AudioContext | null = null;

function tone(from: number, to: number, ms: number, gain = 0.06) {
  ctx ??= new AudioContext();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + ms / 1000);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.02);
}

export const sounds = {
  // Key released: a soft tick at once, before anything else happens.
  tick: () => tone(1400, 1100, 40, 0.035),
  // The plan is ready: one low tone.
  plan: () => tone(262, 262, 260, 0.04),
  // A lane starts: a soft note.
  laneStart: () => tone(523, 523, 140, 0.025),
  listen: () => tone(620, 930, 120),
  release: () => tone(930, 560, 140),
  heard: () => {
    tone(740, 740, 90, 0.045);
    setTimeout(() => tone(990, 990, 140, 0.045), 90);
  },
  // Lanes start: a low, soft rising pair, like an orchestra standing up.
  lanesStart: () => {
    tone(330, 330, 160, 0.04);
    setTimeout(() => tone(440, 440, 220, 0.04), 120);
  },
  // One lane finishes: a single short note.
  laneDone: () => tone(660, 660, 120, 0.03),
  // All done: a quiet major chord, the sound people should remember.
  allDone: () => {
    [523.25, 659.25, 783.99].forEach((f, i) => setTimeout(() => tone(f, f, 520, 0.035), i * 70));
  },
};
