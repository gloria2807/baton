// The Score: the plan for a cue. A small task graph of parts; parts with no unmet dependencies run
// at the same time, each in its own lane, and the final answer merges their results.

import { z } from 'zod';

export const MAX_LANES = 8;
export const DEFAULT_LANE_LIMIT = 4;

const id = z.string().regex(/^[a-z0-9-]{1,24}$/, 'part ids are short lowercase words, like "flights"');

export const Part = z.object({
  id,
  name: z.string().transform((s) => s.replace(/\s+/g, ' ').trim().slice(0, 24)),
  goal: z.string().min(3).max(1500),
  startUrl: z.string().url(),
  dependsOn: z.array(id).default([]),
  // What a person would take to do this part by hand, for the Score view's comparison.
  manualMinutes: z.coerce.number().min(0).max(120).default(3),
});
export type Part = z.infer<typeof Part>;

export const ScoreFields = {
  title: z.string().max(80).default('Score'),
  parts: z.array(Part).min(1).max(MAX_LANES),
  // How to merge the parts' results into one answer for the person.
  final: z.string().max(600).default('Summarise what each part found or prepared.'),
};

// The graph must be well formed: unique ids, known dependencies, no cycles.
export function checkScore(s: { parts: Array<Pick<Part, 'id' | 'dependsOn'>> }, ctx: z.RefinementCtx): void {
  const ids = s.parts.map((p) => p.id);
  const dup = ids.find((x, i) => ids.indexOf(x) !== i);
  if (dup) ctx.addIssue({ code: 'custom', message: `part id "${dup}" is used twice` });
  for (const p of s.parts)
    for (const d of p.dependsOn) {
      if (!ids.includes(d)) ctx.addIssue({ code: 'custom', message: `part "${p.id}" depends on unknown part "${d}"` });
      if (d === p.id) ctx.addIssue({ code: 'custom', message: `part "${p.id}" depends on itself` });
    }
  if (!dup && levels(s.parts) === null) ctx.addIssue({ code: 'custom', message: 'the parts depend on each other in a circle' });
}

export const Score = z.object(ScoreFields).superRefine(checkScore);
export type Score = z.infer<typeof Score>;

// Parts grouped into waves that can run together; null if the graph has a cycle.
export function levels(parts: Array<Pick<Part, 'id' | 'dependsOn'>>): string[][] | null {
  const done = new Set<string>();
  const out: string[][] = [];
  let left = parts.slice();
  while (left.length) {
    const ready = left.filter((p) => p.dependsOn.every((d) => done.has(d)));
    if (!ready.length) return null;
    out.push(ready.map((p) => p.id));
    ready.forEach((p) => done.add(p.id));
    left = left.filter((p) => !done.has(p.id));
  }
  return out;
}

export function manualMinutes(score: Score): number {
  return score.parts.reduce((a, p) => a + p.manualMinutes, 0);
}
