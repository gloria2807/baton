import { describe, expect, it } from 'vitest';
import { runScore, type PartResult, type PartUpdate } from './scheduler.js';
import { Score, levels } from './score.js';
import { grid, tile } from './tiling.js';

const part = (id: string, dependsOn: string[] = [], extra = {}) => ({ id, name: id, goal: `do ${id}`, startUrl: 'http://localhost:4400/', dependsOn, ...extra });

// "Get me there": four independent parts, as in the film.
const GET_ME_THERE = { title: 'Get to Atlas Summit', parts: [part('flights'), part('hotel'), part('calendar'), part('reply')], final: 'Merge.' };

describe('Score validation', () => {
  it('accepts a valid graph and fills defaults', () => {
    const s = Score.parse(GET_ME_THERE);
    expect(s.parts[0]).toMatchObject({ dependsOn: [], manualMinutes: 3 });
    expect(levels(s.parts)).toEqual([['flights', 'hotel', 'calendar', 'reply']]);
  });

  it('orders dependent parts into waves', () => {
    expect(levels([part('find'), part('book', ['find']), part('tell', ['book', 'find']), part('note')])).toEqual([['find', 'note'], ['book'], ['tell']]);
  });

  it('rejects duplicates, unknown dependencies, cycles and too many lanes', () => {
    const bad = (parts: unknown[]) => Score.safeParse({ parts }).success;
    expect(bad([part('a'), part('a')])).toBe(false);
    expect(bad([part('a', ['ghost'])])).toBe(false);
    expect(bad([part('a', ['b']), part('b', ['a'])])).toBe(false);
    expect(bad([part('a', ['a'])])).toBe(false);
    expect(bad(Array.from({ length: 9 }, (_, i) => part(`p${i}`)))).toBe(false);
    expect(bad([part('Bad Id')])).toBe(false);
    expect(bad([])).toBe(false);
  });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('scheduler', () => {
  it('runs independent parts at the same time', async () => {
    let live = 0;
    let peak = 0;
    const t0 = Date.now();
    const results = await runScore(Score.parse(GET_ME_THERE), {
      runPart: async (p) => {
        peak = Math.max(peak, ++live);
        await sleep(60);
        live--;
        return { status: 'done', result: `${p.id} ok` };
      },
    });
    expect(peak).toBe(4);
    expect(Date.now() - t0).toBeLessThan(200); // not 4 × 60 ms in a row
    expect(Object.values(results).map((r) => r.status)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('respects the lane limit', async () => {
    let live = 0;
    let peak = 0;
    await runScore(Score.parse({ parts: ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => part(x)) }), {
      limit: 2,
      runPart: async () => {
        peak = Math.max(peak, ++live);
        await sleep(20);
        live--;
        return { status: 'done', result: 'ok' };
      },
    });
    expect(peak).toBe(2);
  });

  it('passes results to dependent parts and waits for them', async () => {
    const order: string[] = [];
    const goals: Record<string, string> = {};
    const s = Score.parse({ parts: [part('find', [], { name: 'Find flight' }), part('book', ['find'])] });
    await runScore(s, {
      runPart: async (p) => {
        order.push(p.id);
        goals[p.id] = p.goal;
        await sleep(10);
        return { status: 'done', result: p.id === 'find' ? 'TG 1504 at $212' : 'booked' };
      },
    });
    expect(order).toEqual(['find', 'book']);
    expect(goals.book).toContain('Results from earlier parts:\n- Find flight: TG 1504 at $212');
  });

  it('skips parts whose dependency failed, and keeps going with the rest', async () => {
    const updates: PartUpdate[] = [];
    const s = Score.parse({ parts: [part('a'), part('b', ['a']), part('c', ['b']), part('d')] });
    const results = await runScore(s, {
      onUpdate: (u) => updates.push(u),
      runPart: async (p): Promise<PartResult> => (p.id === 'a' ? { status: 'failed', result: 'site down' } : { status: 'done', result: 'ok' }),
    });
    expect(results.a!.status).toBe('failed');
    expect(results.b!.status).toBe('skipped');
    expect(results.c!.status).toBe('skipped');
    expect(results.d!.status).toBe('done');
    expect(updates.filter((u) => u.state === 'settled')).toHaveLength(4);
  });

  it('turns a thrown lane error into a failed part', async () => {
    const results = await runScore(Score.parse({ parts: [part('a')] }), {
      runPart: async () => {
        throw new Error('bridge gone');
      },
    });
    expect(results.a).toEqual({ status: 'failed', result: 'Lane error: bridge gone' });
  });
});

describe('tiling', () => {
  const overlaps = (a: { left: number; top: number; width: number; height: number }, b: typeof a) =>
    a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

  for (const [w, h] of [
    [1920, 1080],
    [2560, 1440],
  ] as Array<[number, number]>) {
    for (const n of [1, 2, 3, 4, 6, 8]) {
      it(`${n} lanes fit ${w}×${h} below the Podium without overlapping`, () => {
        const area = { x: 0, y: 0, width: w, height: h - 48 }; // taskbar
        const b = tile(n, area, 120);
        expect(b).toHaveLength(n);
        for (const x of b) {
          expect(x.top).toBeGreaterThanOrEqual(120);
          expect(x.left).toBeGreaterThanOrEqual(0);
          expect(x.left + x.width).toBeLessThanOrEqual(w);
          expect(x.top + x.height).toBeLessThanOrEqual(h - 48);
          expect(x.width).toBeGreaterThan(400);
        }
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(overlaps(b[i]!, b[j]!)).toBe(false);
      });
    }
  }

  it('uses a 2×2 grid for the four lanes of "get me there"', () => {
    expect(grid(4)).toEqual({ cols: 2, rows: 2 });
    const b = tile(4, { x: 0, y: 0, width: 1920, height: 1032 }, 120);
    expect(new Set(b.map((x) => x.left)).size).toBe(2);
    expect(new Set(b.map((x) => x.top)).size).toBe(2);
  });

  it('centres a short last row', () => {
    const b = tile(3, { x: 0, y: 0, width: 1920, height: 1032 }, 120);
    expect(b[2]!.left).toBeGreaterThan(b[0]!.left);
    expect(b[2]!.left + b[2]!.width / 2).toBeCloseTo(960, -1);
  });
});
