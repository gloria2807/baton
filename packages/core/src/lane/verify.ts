// Verify: a fresh look must show that an action had the effect it should. Deterministic checks
// on the page, no model call, so verification is fast and cannot be talked out of failing.

import type { Element, LookResult } from '../bridge.js';
import type { Action } from './actions.js';
import { toIsoDate } from './dates.js';

export interface Verdict {
  ok: boolean;
  note: string;
}

// A compact fingerprint of what the person would see change.
export function signature(look: LookResult): string {
  const els = look.elements.map((e) => `${e.role}|${e.name}|${e.value ?? ''}`).join('\n');
  return `${look.url}\n${look.title}\n${hash(els)}\n${hash(look.text)}`;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const sameUrl = (a: string, b: string) => {
  const norm = (u: string) => {
    try {
      const x = new URL(u);
      return `${x.host}${x.pathname.replace(/\/$/, '')}${x.search}`;
    } catch {
      return u;
    }
  };
  return norm(a) === norm(b);
};

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
// A one-line field drops line breaks instead of turning them into spaces, so compare without any.
const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();
const holds = (value: string, wanted: string) => norm(value) === norm(wanted) || squash(value) === squash(wanted);

// Marks are renumbered on every look, so find the same field again by what it is.
export function findSame(target: Element, after: LookResult): Element | undefined {
  const candidates = after.elements.filter(
    (e) => e.tag === target.tag && e.role === target.role && e.name === target.name,
  );
  if (candidates.length <= 1) return candidates[0];
  return candidates.sort(
    (a, b) =>
      Math.hypot(a.rect.x - target.rect.x, a.rect.y - target.rect.y) -
      Math.hypot(b.rect.x - target.rect.x, b.rect.y - target.rect.y),
  )[0];
}

export function verify(action: Action, before: LookResult, after: LookResult, target?: Element): Verdict {
  const changed = signature(before) !== signature(after);
  switch (action.tool) {
    case 'open_url':
      return sameUrl(after.url, action.url) || after.url !== before.url
        ? { ok: true, note: `opened ${after.url}` }
        : // Real sites send unknown addresses back to a page the lane was already on.
          {
            ok: false,
            note: `${action.url} redirected back to ${after.url}: that address does not exist here. Use this page's links or menus instead of guessing addresses.`,
          };
    case 'click':
    case 'back':
    case 'search_site':
      return changed
        ? { ok: true, note: after.url !== before.url ? `now on ${after.url}` : 'the page changed' }
        : { ok: false, note: 'nothing on the page changed' };
    case 'type': {
      if (action.submit)
        return changed
          ? {
              ok: true,
              note: after.url !== before.url ? `submitted, now on ${after.url}` : 'submitted, the page changed',
            }
          : { ok: false, note: 'pressing Enter changed nothing' };
      const field = target && findSame(target, after);
      if (!field) return { ok: false, note: 'the field is no longer on the page' };
      // Date inputs hold YYYY-MM-DD whatever was typed; other fields compare loosely.
      const iso = field.type === 'date' ? toIsoDate(action.text) : null;
      const ok = iso
        ? field.value === iso
        : holds(field.value ?? '', action.text) || (!!field.value && norm(action.text).includes(norm(field.value)));
      return ok
        ? { ok: true, note: `field now holds “${field.value}”` }
        : { ok: false, note: `field holds “${field.value ?? ''}”, not “${action.text}”` };
    }
    case 'fill_form': {
      // Submitted: the page must have moved on. Not submitted: every field must hold its value.
      if (action.submit !== undefined)
        return changed
          ? {
              ok: true,
              note: after.url !== before.url ? `submitted, now on ${after.url}` : 'submitted, the page changed',
            }
          : { ok: false, note: 'pressing the button changed nothing' };
      const wrong = action.fields.filter((f) => {
        const el = before.elements.find((e) => e.mark === f.mark);
        const now = el && findSame(el, after);
        if (!now) return true;
        const iso = now.type === 'date' ? toIsoDate(f.value) : null;
        return iso
          ? now.value !== iso
          : !(
              holds(now.value ?? '', f.value) ||
              norm(now.value ?? '').includes(norm(f.value)) ||
              norm(f.value).includes(norm(now.value ?? '-'))
            );
      });
      return wrong.length
        ? {
            ok: false,
            note: `${wrong.length} field(s) did not take their value (mark ${wrong.map((f) => f.mark).join(', ')})`,
          }
        : { ok: true, note: `${action.fields.length} fields filled` };
    }
    case 'fill_cells': {
      // Every value written must now be in some field on the page.
      const values = after.elements.map((e) => norm(e.value ?? ''));
      const wanted = action.rows.flat().map(norm).filter(Boolean);
      const missing = wanted.filter((w) => {
        const i = values.indexOf(w);
        if (i < 0) return true;
        values.splice(i, 1);
        return false;
      });
      return missing.length === 0
        ? { ok: true, note: `${wanted.length} cells filled` }
        : {
            ok: false,
            note: `${missing.length} of ${wanted.length} values are not in the sheet (e.g. “${missing[0]}”)`,
          };
    }
    case 'select': {
      const field = target && findSame(target, after);
      const ok =
        !!field &&
        (norm(field.value ?? '') === norm(action.option) || norm(field.value ?? '').includes(norm(action.option)));
      return ok
        ? { ok: true, note: `selected “${field!.value}”` }
        : { ok: false, note: `dropdown shows “${field?.value ?? '?'}”` };
    }
    case 'scroll': {
      if (action.mark !== undefined && target) {
        // Scrolling to an element succeeds when it is in view afterwards, even if it already was.
        const el = findSame(target, after);
        return el && !el.offscreen
          ? { ok: true, note: `“${el.name.slice(0, 40)}” is in view` }
          : { ok: false, note: 'the element is still out of view' };
      }
      return changed
        ? { ok: true, note: 'scrolled' }
        : { ok: false, note: 'the view did not move (top or bottom of the page?)' };
    }
    case 'wait_for':
      return norm(after.text).includes(norm(action.text))
        ? { ok: true, note: `“${action.text}” is on the page` }
        : { ok: false, note: `“${action.text}” never appeared` };
    // Nothing to see on the page. Writes to Sheets and Docs are checked by reading the file back (see the lane loop).
    case 'read':
    case 'extract_list':
    case 'sheet_read':
    case 'doc_read':
    case 'note_site':
    case 'post_finding':
    case 'sheet_write':
    case 'doc_write':
    case 'ask_person':
    case 'finish':
      return { ok: true, note: '' };
  }
}

// Sheets and Docs: after writing, the values read back from the file must contain what was typed.
export function checkWritten(values: string[], readBack: string): Verdict {
  const text = squash(readBack);
  const missing = values.map((v) => v.trim()).filter((v) => v && !text.includes(squash(v)));
  return missing.length
    ? { ok: false, note: `${missing.length} value(s) not found when read back, e.g. “${missing[0]!.slice(0, 40)}”` }
    : { ok: true, note: `${values.filter((v) => v.trim()).length} value(s) read back` };
}
