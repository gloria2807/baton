// Memory (docs/FOCUS.md section 3): what the person tells Baton to remember, preferences it saves
// only after asking, and a short record of each finished plan. Kept in a readable JSON file on the
// person's computer; a memory leaves it only as part of a model prompt, and only when relevant.
// Passwords, card numbers, one-time codes and anything typed into a blocked field are never stored.

import { z } from 'zod';
import { redactSecrets } from '../safety/secrets.js';

export const MemoryItem = z.object({
  id: z.number().int().positive(),
  kind: z.enum(['fact', 'preference', 'task']),
  text: z.string().min(1).max(600),
  // A short name for the chip: "home airport", "hotel budget", "Lisbon weekend plan".
  label: z.string().max(60),
  created: z.string(),
  // For a past task: what was asked, and links to the files it made.
  request: z.string().max(600).optional(),
  links: z.array(z.string().max(500)).max(5).optional(),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

export const MAX_RELEVANT = 10;

const STOP = new Set(
  'a an the and or of to in on at for from with my me i is are was be that this it its please about do does what who your you our we they them there here as by if then than so just also any some can could would should will now same again'.split(
    ' ',
  ),
);

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9@.'-]+/g) ?? [])
    .map((w) => w.replace(/'s$/, '').replace(/^'|'$/g, ''))
    .filter((w) => w.length > 2 && !STOP.has(w));
}

// A memory that would hold a secret is refused: masking changes it, or it names one.
export function holdsSecret(text: string): boolean {
  return (
    redactSecrets(text) !== text ||
    /\b(password|passcode|one[- ]time code|otp|cvv|cvc|card number|security code)\b/i.test(text)
  );
}

// A short label for a chip: the subject of "my X is …" or "I like …", else the first words.
export function labelOf(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const my = /\b(?:my|our)\s+(.{3,40}?)\s+(?:is|are|was|=)\b/i.exec(t);
  if (my) return my[1]!.toLowerCase();
  const like = /\bI\s+(?:like|prefer|love|hate|avoid|want|need)\s+(.{3,40}?)(?:[.,;]|$)/i.exec(t);
  if (like) return like[1]!.toLowerCase();
  return t.split(' ').slice(0, 4).join(' ').toLowerCase().slice(0, 60);
}

export class MemoryBook {
  constructor(
    private items: MemoryItem[] = [],
    private save: (items: MemoryItem[]) => void = () => undefined,
    private now: () => Date = () => new Date(),
  ) {}

  list(): MemoryItem[] {
    return [...this.items];
  }

  // Stores a fact or preference; a later one about the same thing replaces the earlier one.
  remember(
    text: string,
    kind: 'fact' | 'preference' = 'fact',
  ): { ok: true; item: MemoryItem } | { ok: false; reason: string } {
    const clean = text
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.!]+$/, '');
    if (clean.length < 3) return { ok: false, reason: 'there is nothing to remember' };
    if (holdsSecret(clean)) return { ok: false, reason: 'Baton never stores passwords, card numbers or codes' };
    const label = labelOf(clean);
    this.items = this.items.filter((m) => !(m.kind !== 'task' && m.label === label));
    const item: MemoryItem = {
      id: this.nextId(),
      kind,
      text: clean.slice(0, 600),
      label,
      created: this.now().toISOString(),
    };
    this.items.push(item);
    this.save(this.items);
    return { ok: true, item };
  }

  // A finished plan: what was asked, what came of it, and the files it made.
  recordTask(request: string, summary: string, links: string[] = []): MemoryItem {
    const item: MemoryItem = {
      id: this.nextId(),
      kind: 'task',
      text: redactSecrets(summary).slice(0, 600),
      label: redactSecrets(request).replace(/\s+/g, ' ').trim().slice(0, 60),
      request: redactSecrets(request).slice(0, 600),
      links: links.slice(0, 5),
      created: this.now().toISOString(),
    };
    // Past tasks keep the 20 most recent.
    const tasks = this.items.filter((m) => m.kind === 'task');
    if (tasks.length >= 20) this.items = this.items.filter((m) => m.id !== tasks[0]!.id);
    this.items.push(item);
    this.save(this.items);
    return item;
  }

  // "Forget my hotel budget": removes the items that best match. Returns what was forgotten.
  forget(query: string): MemoryItem[] {
    const q = new Set(words(query));
    if (!q.size) return [];
    // Past plans are forgotten only when the person asks about a plan: "forget my hotel budget" must
    // not take the Lisbon plan with it just because its summary mentions a hotel (measured).
    const plans = /\b(plan|plans|task|trip|weekend|last time)\b/i.test(query);
    const scored = this.items
      .filter((m) => plans || m.kind !== 'task')
      .map((m) => ({ m, s: words(`${m.label} ${m.text}`).filter((w) => q.has(w)).length }));
    const best = Math.max(0, ...scored.map((x) => x.s));
    if (!best) return [];
    const gone = scored.filter((x) => x.s === best).map((x) => x.m);
    this.items = this.items.filter((m) => !gone.includes(m));
    this.save(this.items);
    return gone;
  }

  remove(id: number): void {
    this.items = this.items.filter((m) => m.id !== id);
    this.save(this.items);
  }

  edit(id: number, text: string): { ok: boolean; reason?: string } {
    if (holdsSecret(text)) return { ok: false, reason: 'Baton never stores passwords, card numbers or codes' };
    this.items = this.items.map((m) =>
      m.id === id ? { ...m, text: text.slice(0, 600), label: m.kind === 'task' ? m.label : labelOf(text) } : m,
    );
    this.save(this.items);
    return { ok: true };
  }

  // The memories a request needs: shared words first, then, for "the same as last time" requests,
  // the most recent past tasks. Never more than MAX_RELEVANT.
  relevant(request: string, limit = MAX_RELEVANT): MemoryItem[] {
    const q = new Set(words(request));
    const scored = this.items
      .map((m) => ({ m, s: words(`${m.label} ${m.text} ${m.request ?? ''}`).filter((w) => q.has(w)).length }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || b.m.id - a.m.id)
      .map((x) => x.m);
    const callback = /\b(same|again|last|previous|yesterday|like before|that plan|the plan)\b/i.test(request);
    const recentTasks = callback
      ? this.items
          .filter((m) => m.kind === 'task')
          .slice(-3)
          .reverse()
      : [];
    // Facts about travel, budgets and the person that apply to most plans travel along with travel requests.
    const travel = /\b(trip|travel|weekend|hotel|flight|visit|plan)\b/i.test(request)
      ? this.items.filter(
          (m) =>
            m.kind !== 'task' &&
            /\b(hotel|budget|airport|seat|home|travel|night|prefer|like|allerg|vegetarian|vegan)\b/i.test(m.text),
        )
      : [];
    const out: MemoryItem[] = [];
    for (const m of [...recentTasks, ...scored, ...travel]) if (!out.includes(m)) out.push(m);
    return out.slice(0, limit);
  }

  private nextId() {
    return Math.max(0, ...this.items.map((m) => m.id)) + 1;
  }
}

// The memories a plan may use, as prompt lines with their numbers (the plan lists the ones it used).
export function memoryLines(items: MemoryItem[]): string {
  return items
    .map((m) =>
      m.kind === 'task'
        ? `[m${m.id}] Past task (${m.created.slice(0, 10)}): asked “${m.request ?? m.label}”. ${m.text}${m.links?.length ? ` Files: ${m.links.join(', ')}` : ''}`
        : `[m${m.id}] ${m.kind === 'preference' ? 'Preference' : 'Fact'}: ${m.text}`,
    )
    .join('\n');
}

// The fixed phrases for memory, handled without the model.
export type MemoryCommand = { kind: 'remember'; text: string } | { kind: 'forget'; text: string } | { kind: 'recall' };

export function memoryCommand(transcript: string): MemoryCommand | null {
  const t = transcript.trim();
  const remember = /^\W*(?:please\s+)?remember(?:\s+that)?\s+(.{3,})$/i.exec(t);
  if (remember) return { kind: 'remember', text: firstPerson(remember[1]!) };
  const forget = /^\W*(?:please\s+)?forget(?:\s+(?:that|about))?\s+(.{2,})$/i.exec(t);
  if (forget) return { kind: 'forget', text: forget[1]! };
  if (/\bwhat do you (?:remember|know) about me\b/i.test(t)) return { kind: 'recall' };
  return null;
}

// "my home airport is Lagos" is kept as said; Baton reads it back as "Your home airport is Lagos".
function firstPerson(text: string): string {
  return text.replace(/[.!?]+$/, '').trim();
}
