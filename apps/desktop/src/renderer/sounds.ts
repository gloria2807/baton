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
  listen: () => tone(620, 930, 120),
  release: () => tone(930, 560, 140),
  heard: () => {
    tone(740, 740, 90, 0.045);
    setTimeout(() => tone(990, 990, 140, 0.045), 90);
  },
};
