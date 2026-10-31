// Runs a Score: every part whose dependencies are done starts at once, up to the lane limit.
// Results flow to the parts that depend on them; a part whose dependency failed is skipped.

import { DEFAULT_LANE_LIMIT, MAX_LANES, type Part, type Score } from './score.js';

export interface PartResult {
  status: 'done' | 'stopped' | 'failed' | 'skipped';
  result: string;
  data?: unknown;
  ms?: number;
}

export type PartUpdate = { id: string; state: 'waiting' | 'running' } | ({ id: string; state: 'settled' } & PartResult);

export interface RunOptions {
  limit?: number;
  runPart: (part: Part, inputs: Record<string, PartResult>) => Promise<PartResult>;
  onUpdate?: (u: PartUpdate) => void;
}

// A lane running one part of a Score. Measured: alone with one part, lanes dug for extra detail and
// took 2–4 times more steps for that part than one lane doing every part in turn.
export function partGoal(goal: string): string {
  return `${goal}

This is one part of a larger plan; other lanes are doing the other parts at the same time. Get exactly what this part asks for from the most direct page, then finish at once. Do not look for extra detail.`;
}

// A dependent part's goal carries what its dependencies found.
export function goalWithInputs(part: Part, inputs: Record<string, PartResult>, score: Score): string {
  const lines = part.dependsOn
    .map((d) => {
      const r = inputs[d];
      const name = score.parts.find((p) => p.id === d)?.name ?? d;
      return r
        ? `- ${name}: ${r.result}${r.data === undefined ? '' : ` (${JSON.stringify(r.data).slice(0, 600)})`}`
        : '';
    })
    .filter(Boolean);
  return lines.length ? `${part.goal}\n\nResults from earlier parts:\n${lines.join('\n')}` : part.goal;
}

export async function runScore(score: Score, opts: RunOptions): Promise<Record<string, PartResult>> {
  const limit = Math.max(1, Math.min(MAX_LANES, opts.limit ?? DEFAULT_LANE_LIMIT));
  const results: Record<string, PartResult> = {};
  const pending = new Map(score.parts.map((p) => [p.id, p]));
  const running = new Set<string>();
  for (const p of score.parts) opts.onUpdate?.({ id: p.id, state: 'waiting' });

  return new Promise((resolve) => {
    const settle = (id: string, r: PartResult) => {
      results[id] = r;
      running.delete(id);
      opts.onUpdate?.({ id, state: 'settled', ...r });
      pump();
    };

    const pump = () => {
      // Skip parts whose dependencies did not succeed.
      let skipped = true;
      while (skipped) {
        skipped = false;
        for (const p of pending.values()) {
          const bad = p.dependsOn.find((d) => results[d] && results[d]!.status !== 'done');
          if (bad) {
            pending.delete(p.id);
            settle(p.id, {
              status: 'skipped',
              result: `Skipped: “${score.parts.find((x) => x.id === bad)?.name ?? bad}” did not finish.`,
            });
            skipped = true;
          }
        }
      }
      for (const p of [...pending.values()]) {
        if (running.size >= limit) break;
        if (!p.dependsOn.every((d) => results[d]?.status === 'done')) continue;
        pending.delete(p.id);
        running.add(p.id);
        opts.onUpdate?.({ id: p.id, state: 'running' });
        const inputs = Object.fromEntries(p.dependsOn.map((d) => [d, results[d]!]));
        opts
          .runPart({ ...p, goal: goalWithInputs(p, inputs, score) }, inputs)
          .then((r) => settle(p.id, r))
          .catch((e: Error) => settle(p.id, { status: 'failed', result: `Lane error: ${e.message}` }));
      }
      if (!pending.size && !running.size) resolve(results);
    };
    pump();
  });
}

export type PartPhase = 'waiting' | 'running' | 'waiting-approval' | 'settled';

// When to show the Score's one approval card: some parts wait for a yes, and no other part is still
// working. A part waiting for a part that is itself waiting for a yes cannot start, so it must not
// hold the card back; otherwise each would wait for the other for ever.
export function readyForApprovals(parts: Array<{ id: string; dependsOn: string[]; phase: PartPhase }>): boolean {
  const phase = new Map(parts.map((p) => [p.id, p.phase]));
  if (!parts.some((p) => p.phase === 'waiting-approval')) return false;
  return !parts.some(
    (p) => p.phase === 'running' || (p.phase === 'waiting' && p.dependsOn.every((d) => phase.get(d) === 'settled')),
  );
}
