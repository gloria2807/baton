// Every model call goes through the governor: a daily spending cap that survives restarts, a limit
// on calls in flight at once, and patient retries when Baseten says "rate limit exceeded".

export const PRICE_PER_M = { input: 1.25, output: 4.25 }; // USD per million tokens, Baseten list price

export interface SpendState {
  day: string; // YYYY-MM-DD, local time
  usd: number;
  // Everything spent since the ledger started, across days, for the all-time cap.
  total?: number;
}

export interface GovernorOptions {
  maxConcurrent: number;
  dailyBudgetUsd: number;
  // A hard ceiling across all days (BATON_TOTAL_BUDGET_USD), so a grant is never spent past it.
  totalBudgetUsd?: number;
  load: () => SpendState | null;
  save: (s: SpendState) => void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

export class BudgetExceededError extends Error {}

export function costOf(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): number {
  if (!usage) return 0;
  return ((usage.prompt_tokens ?? 0) * PRICE_PER_M.input + (usage.completion_tokens ?? 0) * PRICE_PER_M.output) / 1e6;
}

const dayOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function retryAfterMs(e: unknown): number | null {
  const h = (e as { headers?: Record<string, string> | Headers }).headers;
  const v = h instanceof Headers ? h.get('retry-after') : h?.['retry-after'];
  const s = v ? Number(v) : NaN;
  return Number.isFinite(s) ? Math.min(60000, s * 1000) : null;
}

const isRateLimit = (e: unknown) => (e as { status?: number }).status === 429;
const isTransient = (e: unknown) => [500, 502, 503, 504].includes((e as { status?: number }).status ?? 0);

export class Governor {
  private inFlight = 0;
  private queue: Array<() => void> = [];
  private state: SpendState;
  private now: () => Date;
  private sleep: (ms: number) => Promise<void>;

  constructor(private opts: GovernorOptions) {
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const today = dayOf(this.now());
    const saved = opts.load();
    this.state =
      saved && saved.day === today
        ? { ...saved, total: saved.total ?? saved.usd }
        : { day: today, usd: 0, total: saved?.total ?? saved?.usd ?? 0 };
  }

  get spentToday(): number {
    this.rollDay();
    return this.state.usd;
  }

  get budget(): number {
    return this.opts.dailyBudgetUsd;
  }

  get spentTotal(): number {
    return this.state.total ?? 0;
  }

  get totalBudget(): number | undefined {
    return this.opts.totalBudgetUsd;
  }

  private rollDay() {
    const today = dayOf(this.now());
    if (this.state.day !== today) this.state = { day: today, usd: 0, total: this.state.total ?? 0 };
  }

  private async acquire() {
    if (this.inFlight < this.opts.maxConcurrent) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.inFlight++;
  }

  private release() {
    this.inFlight--;
    this.queue.shift()?.();
  }

  // Run one call. `fn` must return the API response (with `usage`) so its cost can be counted.
  async run<T extends { usage?: { prompt_tokens?: number; completion_tokens?: number } }>(
    fn: () => Promise<T>,
  ): Promise<T> {
    this.rollDay();
    const cap = this.opts.totalBudgetUsd;
    if (cap !== undefined && (this.state.total ?? 0) >= cap)
      throw new BudgetExceededError(
        `Baton's total model budget ($${cap.toFixed(2)}) is used up ($${(this.state.total ?? 0).toFixed(2)} spent). Raise BATON_TOTAL_BUDGET_USD in .env to continue.`,
      );
    if (this.state.usd >= this.opts.dailyBudgetUsd)
      throw new BudgetExceededError(
        `Baton's daily model budget ($${this.opts.dailyBudgetUsd.toFixed(2)}) is used up ($${this.state.usd.toFixed(2)} spent today). Raise BATON_DAILY_BUDGET_USD in .env to continue.`,
      );
    await this.acquire();
    try {
      const max = this.opts.maxRetries ?? 4;
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fn();
          const usd = costOf(res.usage);
          this.state.usd += usd;
          this.state.total = (this.state.total ?? 0) + usd;
          this.opts.save(this.state);
          return res;
        } catch (e) {
          if (attempt >= max || !(isRateLimit(e) || isTransient(e))) throw e;
          // Back off: what the server asks for, else 2 s, 4 s, 8 s, 16 s, with jitter.
          const wait = retryAfterMs(e) ?? 2000 * 2 ** attempt;
          await this.sleep(wait + Math.floor(Math.random() * 500));
        }
      }
    } finally {
      this.release();
    }
  }
}
