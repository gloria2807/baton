// The fast voice pipeline (docs/NEXT.md section 3): one call hears the audio, reads the pins and
// the profile, and returns the transcript, the intent and the move together. The answer is
// streamed, and PlanStream picks out each part of a Score the moment its JSON is complete, so the
// first lane can start while the rest of the plan is still arriving.

import { z } from 'zod';
import type { Anchor } from './anchor.js';
import { CUE_SYSTEM, CueMove, MEMORY_RULE, anchorBlock } from './interpret.js';
import { profileLines, type Profile } from './profile.js';
import { Part } from '../score/score.js';

export const ListenReply = z.object({
  transcript: z.string(),
  intent: z.string().default(''),
  move: CueMove,
});
export type ListenReply = z.infer<typeof ListenReply>;

export const LISTEN_SYSTEM = `${CUE_SYSTEM}

This time you hear the request as audio instead of reading it. Reply with ONE JSON object, keys in this order:
{"transcript": exactly what was said, "intent": a few words, "move": one of the moves above}
Write the transcript first, and transcribe only what is actually said in the audio: the example requests above are examples, not what the person said. For a "score", write "kind", "title" and then "partCount" (how many parts) before "parts", and write each part completely before starting the next. Pointing words: "this" usually means the anchor pointed at while saying it (anchors are numbered in the order pointed, with their times); "there" usually means the last one. If there is no speech, the transcript is empty and the move is {"kind":"clarify","question":"I didn't catch that."}.`;

export function listenText(i: {
  anchors: Anchor[];
  profile: Profile;
  sites: string;
  heldMs: number;
  memories?: string;
}): string {
  return [
    `The audio is ${(i.heldMs / 1000).toFixed(1)} s long.`,
    i.anchors.length ? i.anchors.map(anchorBlock).join('\n\n') : 'The person did not point at anything.',
    `Profile (facts the person chose to share):\n${profileLines(i.profile)}`,
    i.memories ? `${MEMORY_RULE}\n${i.memories}` : '',
    i.sites,
  ]
    .filter(Boolean)
    .join('\n\n');
}

// Reads a JSON answer as it grows. Reports the transcript as soon as its string closes, the plan's
// kind and size, and each new complete part.
export class PlanStream {
  transcript?: string;
  kind?: string;
  partCount?: number;
  private seen = new Set<string>();

  feed(text: string): { transcript?: string; parts: Part[] } {
    const out: { transcript?: string; parts: Part[] } = { parts: [] };
    if (this.transcript === undefined) {
      const m = /"transcript"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
      if (m) {
        try {
          this.transcript = JSON.parse(`"${m[1]}"`) as string;
        } catch {
          this.transcript = m[1]!;
        }
        out.transcript = this.transcript;
      }
    }
    this.kind ??= /"move"\s*:\s*\{\s*"kind"\s*:\s*"(\w+)"/.exec(text)?.[1];
    if (this.partCount === undefined) {
      const c = /"partCount"\s*:\s*(\d+)/.exec(text);
      if (c) this.partCount = Number(c[1]);
    }
    if (this.kind && this.kind !== 'score') return out;
    const start = text.search(/"parts"\s*:\s*\[/);
    if (start < 0) return out;
    let i = text.indexOf('[', start) + 1;
    let depth = 0;
    let inString = false;
    let objStart = -1;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') {
        if (depth === 0) objStart = i;
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0 && objStart >= 0) {
          this.take(text.slice(objStart, i + 1), out.parts);
          objStart = -1;
        }
      } else if (c === ']' && depth === 0) break;
    }
    return out;
  }

  private take(json: string, into: Part[]) {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return;
    }
    const p = Part.safeParse(raw);
    if (!p.success || this.seen.has(p.data.id)) return;
    this.seen.add(p.data.id);
    into.push(p.data);
  }
}
