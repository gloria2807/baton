// Rehearse, then perform: what the person did once by hand, cleaned up into the few steps that
// matter, plus hints about which values came from the item (and so change from item to item).

import { z } from 'zod';

const at = z.number().int().nonnegative(); // ms since "watch me"

export const RecordedStep = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('navigate'),
    at,
    url: z.string(),
    title: z.string().max(300),
    text: z.string().max(6000).default(''),
  }),
  z.object({
    type: z.literal('click'),
    at,
    url: z.string(),
    role: z.string().max(40),
    name: z.string().max(200),
    href: z.string().max(500).optional(),
  }),
  // A field's final value; blocked fields (passwords, card numbers) arrive with no value.
  z.object({
    type: z.literal('input'),
    at,
    url: z.string(),
    field: z.string().max(200),
    kind: z.string().max(40),
    value: z.string().max(2000).optional(),
    blocked: z.boolean().optional(),
  }),
  z.object({ type: z.literal('copy'), at, url: z.string(), text: z.string().max(2000) }),
  z.object({ type: z.literal('paste'), at, url: z.string(), field: z.string().max(200), text: z.string().max(2000) }),
  // What the person said while working ("the vendor goes here").
  z.object({ type: z.literal('narration'), at, text: z.string().max(1000) }),
]);
export type RecordedStep = z.infer<typeof RecordedStep>;

const sameField = (a: RecordedStep, b: RecordedStep) =>
  a.type === 'input' && b.type === 'input' && a.url === b.url && a.field === b.field;

// Remove noise: repeated edits of the same field keep the last value, a click that only focused a
// field before typing in it goes, duplicate page loads collapse.
export function cleanRehearsal(steps: RecordedStep[]): RecordedStep[] {
  const sorted = [...steps].sort((a, b) => a.at - b.at);
  const out: RecordedStep[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (s.type === 'input' && s.blocked) {
      out.push({ ...s, value: undefined });
      continue;
    }
    if (prev && sameField(prev, s)) {
      out[out.length - 1] = s;
      continue;
    }
    if (s.type === 'navigate' && prev?.type === 'navigate' && prev.url === s.url) continue;
    // A click on a field that is then typed into is just focusing it.
    if (
      prev?.type === 'click' &&
      (s.type === 'input' || s.type === 'paste') &&
      /textbox|searchbox|combobox|input|textarea/.test(prev.role) &&
      prev.name === s.field
    ) {
      out[out.length - 1] = s;
      continue;
    }
    out.push(s);
  }
  return out;
}

export interface VariableHint {
  field: string;
  value: string;
  source: 'copied' | 'page';
  from: string; // the url the value was seen on
}

const norm = (s: string) =>
  s
    .replace(/[\s,]+/g, ' ')
    .trim()
    .toLowerCase();

// A value typed into a field that the person had copied, or that appeared on a page they visited
// earlier, came from the item being processed: it is a variable.
export function variableHints(steps: RecordedStep[]): VariableHint[] {
  const hints: VariableHint[] = [];
  const copies: Array<{ text: string; url: string }> = [];
  const pages: Array<{ text: string; url: string }> = [];
  for (const s of steps) {
    if (s.type === 'copy') copies.push({ text: norm(s.text), url: s.url });
    if (s.type === 'navigate') pages.push({ text: norm(`${s.title} ${s.text}`), url: s.url });
    const value = s.type === 'input' ? s.value : s.type === 'paste' ? s.text : undefined;
    if (!value || value.trim().length < 2 || (s.type !== 'input' && s.type !== 'paste')) continue;
    const v = norm(value);
    // Money and dates are often typed in a different form than shown ("1240.50" for "$1,240.50").
    const loose = v.replace(/^\$/, '').replace(/\.00$/, '');
    const copied = copies.find((c) => c.text.includes(v) || c.text.includes(loose));
    const seen = pages.find((p) => p.url !== s.url && (p.text.includes(v) || p.text.includes(loose)));
    if (copied) hints.push({ field: s.field, value, source: 'copied', from: copied.url });
    else if (seen) hints.push({ field: s.field, value, source: 'page', from: seen.url });
  }
  return hints;
}

export function describeStep(s: RecordedStep): string {
  switch (s.type) {
    case 'navigate':
      return `Opened “${s.title || s.url}”`;
    case 'click':
      return `Clicked ${s.role} “${s.name}”`;
    case 'input':
      return s.blocked ? `Filled ${s.field} (private, not recorded)` : `Typed “${s.value ?? ''}” into ${s.field}`;
    case 'copy':
      return `Copied “${s.text.slice(0, 60)}”`;
    case 'paste':
      return `Pasted “${s.text.slice(0, 60)}” into ${s.field}`;
    case 'narration':
      return `Said “${s.text}”`;
  }
}
