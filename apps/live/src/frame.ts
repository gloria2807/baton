// Baton's hands inside one demo page in Baton Live. The service worker adds this script to every
// page it serves. It is the Chrome extension's own DOM code (apps/extension/src/page.ts), driven by
// direct calls from the Live page instead of the Chrome debugger: real DOM events on the real page.
// The frame's name says who it is: "home" is the visitor's own browser, anything else is a lane.

import { toIsoDate } from '@baton/core/lane/dates';
import {
  animateCursor,
  applyLane,
  chooseOption,
  clickPulse,
  collect,
  elementOf,
  fillCells,
  scrollByDy,
  scrollToMark,
  setDate,
  setThinking,
  target,
} from '../../extension/src/page';
import { targetAt } from '../../extension/src/pointer';
import type { FrameApi, FrameHost } from './frame-api';

const host = (): FrameHost | undefined =>
  window.parent !== window ? (window.parent as unknown as { __batonHost?: FrameHost }).__batonHost : undefined;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Glide to an element, refusing blocked fields (rule 2) before anything is touched.
async function aim(mark: number, forTyping = false) {
  const pos = await target({ mark, forTyping });
  if (pos.blocked) throw new Error(`blocked field: ${pos.blocked}`);
  await animateCursor(pos.x, pos.y);
  clickPulse();
  return pos;
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const api: FrameApi = {
  lane(info) {
    applyLane(info);
  },
  thinking(text) {
    setThinking(text);
  },
  collect() {
    return collect(false);
  },
  async click(mark) {
    await aim(mark);
    const el = elementOf(mark);
    el.focus({ preventScroll: true });
    el.click();
  },
  async type(mark, text, submit) {
    const pos = await aim(mark, true);
    const el = elementOf(mark);
    if (pos.inputType === 'date') {
      const iso = toIsoDate(text);
      if (!iso) throw new Error(`“${text}” is not a date; write it as YYYY-MM-DD`);
      setDate(mark, iso);
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      // A one-line field cannot hold line breaks; a person pasting would see spaces.
      if (el instanceof HTMLInputElement) text = text.replace(/\s*\r?\n\s*/g, ' ');
      // Typed in a few visible strokes, so the eye can follow it; long text arrives in chunks.
      const chunk = Math.max(1, Math.ceil(text.length / 24));
      for (let i = chunk; i < text.length; i += chunk) {
        setValue(el, text.slice(0, i));
        await sleep(16);
      }
      setValue(el, text);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else throw new Error(`mark ${mark} is not a text field`);
    if (submit) {
      const form = (el as HTMLInputElement).form;
      if (form) form.requestSubmit();
      else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  },
  async select(mark, option) {
    await aim(mark);
    return chooseOption(mark, option);
  },
  async fillCells(mark, rows) {
    await aim(mark);
    return fillCells(mark, rows);
  },
  scroll(by) {
    return 'mark' in by ? scrollToMark(by.mark).then(() => 0) : scrollByDy(by.dy).then((r) => r.moved);
  },
  anchorAt(x, y) {
    const hit = targetAt(x, y);
    if (!hit) return null;
    const r = hit.el.getBoundingClientRect();
    return {
      target: hit.target,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  },
  pageAnchor() {
    const el = document.querySelector('article') ?? document.querySelector('main');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const hit = targetAt(r.x + Math.min(40, r.width / 2), r.y + Math.min(40, r.height / 2));
    return hit
      ? {
          target: { ...hit.target, text: ((el as HTMLElement).innerText ?? '').slice(0, 4000) },
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        }
      : null;
  },
};

(window as unknown as { __baton: FrameApi }).__baton = api;

// Tell the Live page this frame is ready, when it is leaving, where the pointer is and when the
// talk key (Space) goes down or up while focus is inside the page.
const editable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
window.addEventListener('beforeunload', () => host()?.leaving(window.name));

// Form posts go to the demo sites in the Live page (src/sites.ts), the way a server would get them:
// the answer is a redirect (a real page load) or a page to show in place.
type Sites = { post(href: string, body: string): { html: string } | { redirect: string } };
document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement;
  if ((form.getAttribute('method') ?? 'get').toLowerCase() !== 'post') return;
  const sites = (window.parent as unknown as { __batonSites?: Sites }).__batonSites;
  if (!sites) return;
  e.preventDefault();
  const data = new FormData(form, e.submitter);
  const body = new URLSearchParams([...data].map(([k, v]) => [k, String(v)])).toString();
  const out = sites.post(new URL(form.getAttribute('action') || location.href, location.href).href, body);
  host()?.leaving(window.name);
  if ('redirect' in out) location.href = out.redirect;
  else {
    document.open();
    document.write(out.html);
    document.close();
  }
});
document.addEventListener('mousemove', (e) => host()?.pointer(window.name, e.clientX, e.clientY), { passive: true });
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !editable(e.target)) {
    e.preventDefault();
    if (!e.repeat) host()?.talkKey('down');
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && !editable(e.target)) host()?.talkKey('up');
});
host()?.ready(window.name, window);
// Back and forward can restore a page from the browser's cache without running scripts again.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) host()?.ready(window.name, window);
});
