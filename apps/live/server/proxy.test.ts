import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  MODEL,
  MemoryStore,
  envFromProcess,
  handleBudget,
  handleProxy,
  sanitize,
  type ProxyEnv,
} from './proxy';
import { MODEL as CLIENT_MODEL, PRICE_PER_M as CLIENT_PRICE } from '../../../packages/model/src/index';
import { PRICE_PER_M } from './proxy';

const KEY = 'test-key-7f3a9c1e5b2d4f6a8c0e';

// A fake Baseten: records what it was sent and answers with fixed usage (1000 in, 200 out = $0.00210).
function fakeUpstream(status = 200) {
  const sent: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    sent.push({ headers: new Headers(init.headers), body: JSON.parse(String(init.body)) as Record<string, unknown> });
    if (status !== 200)
      return new Response(`{"error":"echo of request with ${KEY}"}`, { status, headers: { 'retry-after': '3' } });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
      }),
      { status: 200 },
    );
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent };
}

function env(over: Partial<ProxyEnv> = {}, limits: Partial<ProxyEnv['limits']> = {}): ProxyEnv {
  return {
    apiKey: KEY,
    store: new MemoryStore(),
    requireStore: true,
    limits: { ...DEFAULT_LIMITS, ...limits },
    fetch: fakeUpstream().fetch,
    now: () => new Date('2026-11-02T10:00:00Z'),
    salt: 'test',
    ...over,
  };
}

const call = (body: unknown, ip = '203.0.113.7') =>
  new Request('https://live.example/api/chat/completions', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const simple = { model: MODEL, messages: [{ role: 'user', content: 'hello' }], max_tokens: 100 };

describe('Baton Live model proxy', () => {
  it('forwards a valid request with the key added, and returns the answer without the key', async () => {
    const up = fakeUpstream();
    const res = await handleProxy(call(simple), env({ fetch: up.fetch }));
    expect(res.status).toBe(200);
    expect(up.sent[0]!.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(up.sent[0]!.body.model).toBe(MODEL);
    expect(await res.text()).not.toContain(KEY);
  });

  it('never echoes an upstream error body (it could quote the request) and passes rate limits through', async () => {
    const res = await handleProxy(call(simple), env({ fetch: fakeUpstream(429).fetch }));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3');
    expect(await res.text()).not.toContain(KEY);
  });

  it('refuses a visitor beyond the calls-per-hour limit, but not other visitors', async () => {
    const e = env({}, { visitorCallsPerHour: 3 });
    for (let i = 0; i < 3; i++) expect((await handleProxy(call(simple), e)).status).toBe(200);
    const refused = await handleProxy(call(simple), e);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { limit: string } }).error.limit).toBe('visitor-rate');
    expect((await handleProxy(call(simple, '198.51.100.4'), e)).status).toBe(200);
  });

  it('refuses a visitor who has spent their daily share', async () => {
    // Each call costs $0.0021; a $0.005 share allows three calls (the third starts below the cap).
    const e = env({}, { visitorBudgetUsd: 0.005 });
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await handleProxy(call(simple), e)).status);
    expect(statuses).toEqual([200, 200, 200, 403]);
  });

  it('refuses everyone once the daily budget is used, and the next day starts fresh', async () => {
    let now = new Date('2026-11-02T10:00:00Z');
    const e = env({ now: () => now }, { dailyBudgetUsd: 0.004 });
    expect((await handleProxy(call(simple, '192.0.2.1'), e)).status).toBe(200);
    expect((await handleProxy(call(simple, '192.0.2.2'), e)).status).toBe(200);
    const refused = await handleProxy(call(simple, '192.0.2.3'), e);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { limit: string } }).error.limit).toBe('daily-budget');
    now = new Date('2026-11-03T00:05:00Z');
    expect((await handleProxy(call(simple, '192.0.2.3'), e)).status).toBe(200);
  });

  it('refuses to spend when deployed without a budget store', async () => {
    const res = await handleProxy(call(simple), env({ store: null, requireStore: true }));
    expect(res.status).toBe(503);
  });

  it('refuses without a key, and never calls upstream', async () => {
    const up = fakeUpstream();
    expect((await handleProxy(call(simple), env({ apiKey: undefined, fetch: up.fetch }))).status).toBe(503);
    expect(up.sent).toHaveLength(0);
  });

  it('forwards only the request shape Baton makes', () => {
    const L = DEFAULT_LIMITS;
    expect(sanitize({ ...simple, model: 'some-other-model' }, L).ok).toBe(false);
    expect(sanitize({ ...simple, stream: true }, L).ok).toBe(false);
    expect(sanitize({ ...simple, n: 3 }, L).ok).toBe(false);
    expect(
      sanitize(
        { ...simple, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:' } }] }] },
        L,
      ).ok,
    ).toBe(false);
    expect(sanitize({ ...simple, messages: [{ role: 'tool', content: 'x' }] }, L).ok).toBe(false);
    const ok = sanitize({ ...simple, max_tokens: 999999, reasoning_effort: 'xhigh', temperature: 2, user: 'x' }, L);
    expect(ok.ok && ok.body).toEqual({
      model: MODEL,
      messages: simple.messages,
      max_tokens: L.maxTokens,
      reasoning_effort: 'low',
    });
    const audio = sanitize(
      {
        ...simple,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'hi' },
              { type: 'audio_url', audio_url: { url: 'data:audio/wav;base64,' } },
            ],
          },
        ],
      },
      L,
    );
    expect(audio.ok).toBe(true);
  });

  it('keeps no raw IP address in its counters', async () => {
    const store = new MemoryStore();
    const keys: string[] = [];
    const spy: typeof store = Object.assign(Object.create(store) as MemoryStore, {
      get: (k: string) => (keys.push(k), store.get(k)),
      add: (k: string, by: number, t: number) => (keys.push(k), store.add(k, by, t)),
    });
    await handleProxy(call(simple, '203.0.113.99'), env({ store: spy }));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.join(' ')).not.toContain('203.0.113.99');
  });

  it('reports the budget as numbers only', async () => {
    const res = await handleBudget(call({}), env());
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toMatchObject({ configured: true, visitor: { budget: 1 }, all: { budget: 5 } });
  });

  it('reads limits from the environment and requires a store on Vercel', () => {
    const e = envFromProcess({
      BASETEN_API_KEY: KEY,
      VERCEL: '1',
      LIVE_DAILY_BUDGET_USD: '2',
      LIVE_VISITOR_CALLS_PER_HOUR: 'nonsense',
    });
    expect(e.requireStore).toBe(true);
    expect(e.store).toBeNull();
    expect(e.limits.dailyBudgetUsd).toBe(2);
    expect(e.limits.visitorCallsPerHour).toBe(DEFAULT_LIMITS.visitorCallsPerHour);
  });

  it('uses the same model and prices as the desktop client', () => {
    expect(MODEL).toBe(CLIENT_MODEL);
    expect(PRICE_PER_M).toEqual(CLIENT_PRICE);
  });
});
