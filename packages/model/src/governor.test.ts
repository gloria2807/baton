import { describe, expect, it } from 'vitest';
import { BudgetExceededError, Governor, costOf, type SpendState } from './governor.js';

const usage = (input: number, output: number) => ({ usage: { prompt_tokens: input, completion_tokens: output } });

function make(opts: Partial<ConstructorParameters<typeof Governor>[0]> = {}) {
  let saved: SpendState | null = null;
  const slept: number[] = [];
  const g = new Governor({
    maxConcurrent: 2,
    dailyBudgetUsd: 1,
    load: () => saved,
    save: (s) => (saved = { ...s }),
    sleep: async (ms) => {
      slept.push(ms);
    },
    now: () => new Date(2026, 9, 30, 12),
    ...opts,
  });
  return { g, slept, saved: () => saved };
}

describe('model governor', () => {
  it('prices calls at the Baseten list price', () => {
    expect(costOf({ prompt_tokens: 1_000_000, completion_tokens: 0 })).toBeCloseTo(1.25);
    expect(costOf({ prompt_tokens: 0, completion_tokens: 1_000_000 })).toBeCloseTo(4.25);
  });

  it('never has more calls in flight than allowed', async () => {
    const { g } = make({ maxConcurrent: 2 });
    let live = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        g.run(async () => {
          peak = Math.max(peak, ++live);
          await new Promise((r) => setTimeout(r, 10));
          live--;
          return usage(10, 1);
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it('waits and retries when rate limited, honouring Retry-After', async () => {
    const { g, slept } = make();
    let calls = 0;
    const res = await g.run(async () => {
      calls++;
      if (calls === 1)
        throw Object.assign(new Error('429 Rate limit exceeded'), { status: 429, headers: { 'retry-after': '3' } });
      if (calls === 2) throw Object.assign(new Error('429'), { status: 429 });
      return usage(100, 10);
    });
    expect(calls).toBe(3);
    expect(res.usage.prompt_tokens).toBe(100);
    expect(slept[0]).toBeGreaterThanOrEqual(3000);
    expect(slept[1]).toBeGreaterThanOrEqual(4000); // 2 s × 2^1
  });

  it('gives up after the retry limit and does not retry other errors', async () => {
    const { g } = make({ maxRetries: 2 });
    let calls = 0;
    await expect(
      g.run(async () => (calls++, Promise.reject(Object.assign(new Error('429'), { status: 429 })))),
    ).rejects.toThrow('429');
    expect(calls).toBe(3);
    calls = 0;
    await expect(
      g.run(async () => (calls++, Promise.reject(Object.assign(new Error('400 bad'), { status: 400 })))),
    ).rejects.toThrow('400');
    expect(calls).toBe(1);
  });

  it('counts spending, keeps it across restarts, and refuses calls once the daily budget is used', async () => {
    const first = make({ dailyBudgetUsd: 1 });
    await first.g.run(async () => usage(400_000, 0)); // $0.50
    await first.g.run(async () => usage(400_000, 0)); // $1.00
    expect(first.g.spentToday).toBeCloseTo(1);
    await expect(first.g.run(async () => usage(1, 1))).rejects.toBeInstanceOf(BudgetExceededError);
    // A restart reads the saved total for the same day.
    const restarted = new Governor({
      maxConcurrent: 1,
      dailyBudgetUsd: 1,
      load: first.saved,
      save: () => undefined,
      now: () => new Date(2026, 9, 30, 18),
    });
    await expect(restarted.run(async () => usage(1, 1))).rejects.toBeInstanceOf(BudgetExceededError);
    // A new day starts from zero.
    const tomorrow = new Governor({
      maxConcurrent: 1,
      dailyBudgetUsd: 1,
      load: first.saved,
      save: () => undefined,
      now: () => new Date(2026, 9, 31, 9),
    });
    await expect(tomorrow.run(async () => usage(1, 1))).resolves.toBeTruthy();
  });

  it('keeps an all-time total across days and refuses calls past the total budget', async () => {
    const day1 = make({ dailyBudgetUsd: 10, totalBudgetUsd: 1 });
    await day1.g.run(async () => usage(600_000, 0)); // $0.75
    const day2 = new Governor({
      maxConcurrent: 1,
      dailyBudgetUsd: 10,
      totalBudgetUsd: 1,
      load: day1.saved,
      save: () => undefined,
      now: () => new Date(2026, 9, 31, 9),
    });
    expect(day2.spentToday).toBe(0);
    expect(day2.spentTotal).toBeCloseTo(0.75);
    await day2.run(async () => usage(400_000, 0)); // total $1.25
    await expect(day2.run(async () => usage(1, 1))).rejects.toThrow('total model budget');
  });
});

describe('model governor: concurrency for a Score', () => {
  it('lets more calls run at once when a Score needs more lanes, without losing count', async () => {
    let saved: SpendState | null = null;
    const g = new Governor({ maxConcurrent: 2, dailyBudgetUsd: 100, load: () => saved, save: (s) => (saved = s) });
    let live = 0;
    let peak = 0;
    const call = () =>
      g.run(async () => {
        peak = Math.max(peak, ++live);
        await new Promise((r) => setTimeout(r, 20));
        live--;
        return { usage: { prompt_tokens: 1, completion_tokens: 1 } };
      });
    const first = Array.from({ length: 6 }, call);
    g.ensureConcurrency(4);
    await Promise.all(first);
    expect(peak).toBe(4);
    peak = 0;
    await Promise.all(Array.from({ length: 8 }, call));
    expect(peak).toBe(4);
  });
});
