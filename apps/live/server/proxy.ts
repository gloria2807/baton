// Baton Live's model proxy: the only server code in Baton Live. The browser sends Chat Completions
// requests here; this adds the Baseten key, which never reaches the browser, and forwards them.
//
// It also keeps the credits safe: each visitor gets a limited number of calls per hour and a small
// daily spend, all visitors together share one hard daily budget, and only the shape of request
// Baton itself makes is forwarded (one fixed model, no images, no streaming, bounded tokens).

export const MODEL = 'meta-models/muse-spark-open-1026';
export const UPSTREAM = 'https://inference.baseten.co/v1/chat/completions';
export const PRICE_PER_M = { input: 1.25, output: 4.25 }; // USD per million tokens, Baseten list price

export interface Limits {
  dailyBudgetUsd: number; // all visitors together, per UTC day
  visitorBudgetUsd: number; // one visitor, per UTC day
  visitorCallsPerHour: number;
  maxBodyBytes: number;
  maxTokens: number;
}

export const DEFAULT_LIMITS: Limits = {
  dailyBudgetUsd: 5,
  visitorBudgetUsd: 1,
  visitorCallsPerHour: 200,
  maxBodyBytes: 2_000_000,
  maxTokens: 8000,
};

// Counters that survive between function instances. In production this is Upstash Redis (Vercel's
// storage integration); locally it is memory.
export interface Store {
  get(key: string): Promise<number>;
  // Adds `by` and returns the new value; the key expires after `ttlSeconds`.
  add(key: string, by: number, ttlSeconds: number): Promise<number>;
}

export class MemoryStore implements Store {
  private values = new Map<string, { v: number; until: number }>();
  constructor(private now: () => number = Date.now) {}
  async get(key: string) {
    const e = this.values.get(key);
    return e && e.until > this.now() ? e.v : 0;
  }
  async add(key: string, by: number, ttlSeconds: number) {
    const v = (await this.get(key)) + by;
    const old = this.values.get(key);
    this.values.set(key, { v, until: old && old.until > this.now() ? old.until : this.now() + ttlSeconds * 1000 });
    return v;
  }
}

export class UpstashStore implements Store {
  constructor(
    private url: string,
    private token: string,
  ) {}
  private async pipeline(commands: Array<Array<string | number>>): Promise<Array<{ result: unknown }>> {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`budget store answered ${res.status}`);
    return (await res.json()) as Array<{ result: unknown }>;
  }
  async get(key: string) {
    const [r] = await this.pipeline([['GET', key]]);
    return Number(r?.result ?? 0) || 0;
  }
  async add(key: string, by: number, ttlSeconds: number) {
    // NX: the expiry is set once, when the counter is created.
    const [r] = await this.pipeline([
      ['INCRBYFLOAT', key, by],
      ['EXPIRE', key, ttlSeconds, 'NX'],
    ]);
    return Number(r?.result ?? 0) || 0;
  }
}

// Local development without a shared store: counters live as long as the dev server.
const localStore = new MemoryStore();

export interface ProxyEnv {
  apiKey: string | undefined;
  store: Store | null; // null: no shared store configured
  requireStore: boolean; // deployed: refuse to run without one, so the budget is really hard
  limits: Limits;
  fetch: typeof fetch;
  now: () => Date;
  salt: string;
}

// Read the deployment's settings. Nothing here is ever sent to the browser.
export function envFromProcess(env: Record<string, string | undefined>, store?: Store): ProxyEnv {
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  return {
    apiKey: env.BASETEN_API_KEY,
    store: store ?? (url && token ? new UpstashStore(url, token) : null),
    requireStore: !!env.VERCEL,
    limits: {
      ...DEFAULT_LIMITS,
      dailyBudgetUsd: num(env.LIVE_DAILY_BUDGET_USD, DEFAULT_LIMITS.dailyBudgetUsd),
      visitorBudgetUsd: num(env.LIVE_VISITOR_BUDGET_USD, DEFAULT_LIMITS.visitorBudgetUsd),
      visitorCallsPerHour: num(env.LIVE_VISITOR_CALLS_PER_HOUR, DEFAULT_LIMITS.visitorCallsPerHour),
    },
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
    salt: env.LIVE_VISITOR_SALT ?? 'baton-live',
  };
}

export function costOf(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): number {
  if (!usage) return 0;
  return ((usage.prompt_tokens ?? 0) * PRICE_PER_M.input + (usage.completion_tokens ?? 0) * PRICE_PER_M.output) / 1e6;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

// Refusals carry code "baton_limit" so the page can say plainly what happened; the model client does
// not retry them (they are 403, not 429).
const refuse = (message: string, limit: string) => json(403, { error: { message, code: 'baton_limit', limit } });
const bad = (message: string) => json(400, { error: { message, code: 'baton_bad_request' } });

// A visitor is a salted hash of their IP address; the address itself is never stored.
export async function visitorId(request: Request, salt: string): Promise<string> {
  const ip =
    (request.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || request.headers.get('x-real-ip') || 'local';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Body = Record<string, unknown>;

// Only the request shape Baton makes is forwarded; everything else is dropped or refused.
export function sanitize(raw: unknown, limits: Limits): { ok: true; body: Body } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { ok: false, error: 'body must be a JSON object' };
  const r = raw as Body;
  if (r.model !== undefined && r.model !== MODEL) return { ok: false, error: `only ${MODEL} is available` };
  if (r.stream) return { ok: false, error: 'streaming is not available' };
  if (r.n !== undefined && r.n !== 1) return { ok: false, error: 'n must be 1' };
  if (!Array.isArray(r.messages) || r.messages.length === 0 || r.messages.length > 40)
    return { ok: false, error: 'messages must be a list of 1 to 40' };
  for (const m of r.messages as unknown[]) {
    const msg = m as { role?: unknown; content?: unknown };
    if (!['system', 'user', 'assistant'].includes(String(msg?.role)))
      return { ok: false, error: 'unsupported message role' };
    if (Array.isArray(msg.content)) {
      for (const p of msg.content as Array<{ type?: unknown }>) {
        // Images are refused: Baton Live's lanes read pages as text, and images cost the most.
        if (!['text', 'audio_url'].includes(String(p?.type)))
          return { ok: false, error: `content part "${String(p?.type)}" is not available` };
      }
    } else if (typeof msg.content !== 'string') return { ok: false, error: 'message content must be text' };
  }
  const body: Body = {
    model: MODEL,
    messages: r.messages,
    max_tokens: Math.min(Number(r.max_tokens) || limits.maxTokens, limits.maxTokens),
    reasoning_effort: r.reasoning_effort === 'medium' ? 'medium' : 'low',
  };
  if (r.tools !== undefined) {
    if (!Array.isArray(r.tools) || r.tools.length > 30) return { ok: false, error: 'at most 30 tools' };
    body.tools = r.tools;
    body.tool_choice = r.tool_choice === 'auto' ? 'auto' : 'required';
  }
  return { ok: true, body };
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const hourKey = (d: Date) => d.toISOString().slice(0, 13);

export async function handleProxy(request: Request, env: ProxyEnv): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: { message: 'POST only' } });
  if (!env.apiKey)
    return json(503, {
      error: {
        message: 'Baton Live is not configured: the model key is missing on the server.',
        code: 'baton_unconfigured',
      },
    });
  const store = env.store;
  if (!store && env.requireStore)
    return json(503, {
      error: {
        message: 'Baton Live is not configured: the budget store is missing, so it refuses to spend.',
        code: 'baton_unconfigured',
      },
    });

  const text = await request.text();
  if (text.length > env.limits.maxBodyBytes) return bad('request too large');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return bad('body is not JSON');
  }
  const clean = sanitize(raw, env.limits);
  if (!clean.ok) return bad(clean.error);

  const now = env.now();
  const visitor = await visitorId(request, env.salt);
  const keys = {
    day: `live:usd:${dayKey(now)}`,
    visitorDay: `live:usd:${dayKey(now)}:${visitor}`,
    visitorHour: `live:calls:${hourKey(now)}:${visitor}`,
  };
  const counters = store ?? localStore;
  const [spent, visitorSpent] = await Promise.all([counters.get(keys.day), counters.get(keys.visitorDay)]);
  if (spent >= env.limits.dailyBudgetUsd)
    return refuse(
      `Baton Live has used today's model budget ($${env.limits.dailyBudgetUsd.toFixed(2)}). It resets at midnight UTC.`,
      'daily-budget',
    );
  if (visitorSpent >= env.limits.visitorBudgetUsd)
    return refuse(
      `You have used your share of today's model budget ($${env.limits.visitorBudgetUsd.toFixed(2)}). Come back tomorrow, or run Baton on your own computer.`,
      'visitor-budget',
    );
  const calls = await counters.add(keys.visitorHour, 1, 3600);
  if (calls > env.limits.visitorCallsPerHour)
    return refuse(
      `You have reached ${env.limits.visitorCallsPerHour} model calls this hour. Try again in a little while.`,
      'visitor-rate',
    );

  const upstream = await env.fetch(UPSTREAM, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(clean.body),
  });
  const out = await upstream.text();
  if (!upstream.ok) {
    // Pass rate limits through (the client backs off); never echo upstream bodies, which may quote the request.
    const headers: Record<string, string> = {};
    const retry = upstream.headers.get('retry-after');
    if (retry) headers['retry-after'] = retry;
    return json(
      upstream.status,
      { error: { message: `The model service answered ${upstream.status}.`, code: 'upstream' } },
      headers,
    );
  }
  let parsed: { usage?: { prompt_tokens?: number; completion_tokens?: number } };
  try {
    parsed = JSON.parse(out) as typeof parsed;
  } catch {
    return json(502, { error: { message: 'The model service sent something that is not JSON.', code: 'upstream' } });
  }
  const usd = costOf(parsed.usage);
  await Promise.all([counters.add(keys.day, usd, 2 * 86400), counters.add(keys.visitorDay, usd, 2 * 86400)]);
  return json(200, parsed);
}

// How much of today's budget is left, for the page to show. Numbers only.
export async function handleBudget(request: Request, env: ProxyEnv): Promise<Response> {
  const now = env.now();
  const visitor = await visitorId(request, env.salt);
  const counters = env.store ?? localStore;
  const [spent, visitorSpent] = await Promise.all([
    counters.get(`live:usd:${dayKey(now)}`),
    counters.get(`live:usd:${dayKey(now)}:${visitor}`),
  ]);
  return json(200, {
    configured: !!env.apiKey && (!!env.store || !env.requireStore),
    visitor: { spent: visitorSpent, budget: env.limits.visitorBudgetUsd },
    all: { spent, budget: env.limits.dailyBudgetUsd },
  });
}
