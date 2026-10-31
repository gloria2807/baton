// "This, there": map the pointing words in a cue to the anchors the person pointed at.
// Deterministic, so it can be tested and shown; the cue interpreter gets it as a strong hint.

export interface Reference {
  word: string;
  index: number; // character offset in the transcript
  anchor: number | null; // anchor n, or null when nothing was pointed at
}

interface Token {
  word: string;
  index: number;
  strong: boolean;
}

// Words that point. Strong ones name something new; weak ones usually refer back.
const STRONG = new Set(['this', 'that', 'these', 'those', 'here', 'there']);
const WEAK = new Set(['it', 'them', 'her', 'him', 'one']);

// Uses of those words that do not point: "is there a…", "I think that…", "this morning".
function pointing(words: string[], i: number): boolean {
  const w = words[i]!;
  const prev = words[i - 1] ?? '';
  const next = words[i + 1] ?? '';
  if (w === 'there' && /^(is|are|was|were|be|been|isn't|aren't)$/.test(prev)) return false;
  if (w === 'there' && /^(is|are|was|were)$/.test(next) && i === 0) return false;
  if (w === 'that' && /^(so|such|think|say|said|know|sure|hope|mean|means|than|now)$/.test(prev)) return false;
  if (
    (w === 'this' || w === 'that') &&
    /^(morning|afternoon|evening|week|weekend|month|year|time|way|much|many)$/.test(next)
  )
    return false;
  if (w === 'one' && !/^(this|that|the|which|another|first|second|third|cheaper|other)$/.test(prev)) return false;
  if (w === 'one' && /^(this|that)$/.test(prev)) return false; // "this one" is a single reference
  return true;
}

export function tokensOf(transcript: string): Token[] {
  const out: Token[] = [];
  const re = /[a-z']+/gi;
  const all: Array<{ word: string; index: number }> = [];
  for (let m = re.exec(transcript); m; m = re.exec(transcript)) all.push({ word: m[0].toLowerCase(), index: m.index });
  const words = all.map((t) => t.word);
  all.forEach((t, i) => {
    if ((STRONG.has(t.word) || WEAK.has(t.word)) && pointing(words, i)) out.push({ ...t, strong: STRONG.has(t.word) });
  });
  return out;
}

export interface TimedAnchor {
  n: number;
  at: number; // ms after the talk key went down
}

// Where in the recording a character probably was spoken, assuming even speech.
function estimate(index: number, length: number, durationMs: number): number {
  const lead = Math.min(700, durationMs * 0.15); // the microphone opens and the person starts talking
  return lead + (index / Math.max(1, length)) * (durationMs - lead);
}

// People rest the pointer on a thing just before or while they name it.
const LAG = 300;

// Choose a non-decreasing anchor for each word (distinct when there are enough anchors) that best
// fits the timing. Small dynamic programme: words × anchors.
function assign(words: Token[], anchors: TimedAnchor[], est: number[]): number[] {
  const k = words.length;
  const m = anchors.length;
  const distinct = m >= k;
  const cost = (i: number, j: number) => Math.abs(est[i]! - (anchors[j]!.at + LAG));
  const best: number[][] = Array.from({ length: k }, () => Array(m).fill(Infinity));
  const from: number[][] = Array.from({ length: k }, () => Array(m).fill(-1));
  for (let j = 0; j < m; j++) best[0]![j] = cost(0, j);
  for (let i = 1; i < k; i++)
    for (let j = 0; j < m; j++)
      for (let p = 0; p <= j; p++) {
        if (distinct && p === j) continue;
        const c = best[i - 1]![p]! + cost(i, j);
        if (c < best[i]![j]!) {
          best[i]![j] = c;
          from[i]![j] = p;
        }
      }
  let j = best[k - 1]!.indexOf(Math.min(...best[k - 1]!));
  const out = Array(k).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    out[i] = j;
    j = from[i]![j]!;
  }
  return out;
}

export function mapDeixis(transcript: string, durationMs: number, anchors: TimedAnchor[]): Reference[] {
  const tokens = tokensOf(transcript);
  if (!tokens.length) return [];
  const sorted = [...anchors].sort((a, b) => a.at - b.at);
  if (!sorted.length) return tokens.map((t) => ({ word: t.word, index: t.index, anchor: null }));

  // Weak pronouns get their own anchor only when there are anchors to spare.
  const enough = sorted.length >= tokens.length;
  const pointers = enough ? tokens : tokens.filter((t) => t.strong);
  const est = pointers.map((t) => estimate(t.index, transcript.length, durationMs));
  const picks =
    pointers.length === sorted.length
      ? pointers.map((_, i) => i)
      : pointers.length
        ? assign(pointers, sorted, est)
        : [];
  const chosen = new Map(pointers.map((t, i) => [t.index, sorted[picks[i]!]!.n]));

  let last: number | null = null;
  const refs = tokens.map((t) => {
    if (chosen.has(t.index)) last = chosen.get(t.index)!;
    return { word: t.word, index: t.index, anchor: chosen.get(t.index) ?? last };
  });
  // A weak word before any strong one ("put it there"): it refers to the first anchor.
  return refs.map((r) => (r.anchor === null ? { ...r, anchor: sorted[0]!.n } : r));
}
