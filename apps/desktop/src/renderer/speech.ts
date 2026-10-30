// Baton's voice: short replies through the system's speech voices.

let voice: SpeechSynthesisVoice | null = null;

function pickVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  // Prefer a natural-sounding English voice when Windows offers one.
  voice = voices.find((v) => /natural|aria|jenny|zira/i.test(v.name)) ?? voices.find((v) => v.default) ?? voices[0] ?? null;
}
speechSynthesis.onvoiceschanged = pickVoice;
pickVoice();

export function speak(text: string) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.rate = 1.03;
  speechSynthesis.speak(u);
}

// Pressing the talk key while Baton speaks stops it.
export function hush() {
  speechSynthesis.cancel();
}
