// Runs in every page. Inside a lane tab it draws the lane frame, title and ghost cursor, numbers
// interactive elements for screenshots, and resolves marks to coordinates. Outside lanes it stays idle.

import { blockedFieldMessage, blockedFieldReason } from '@baton/core/safety/fields';
import type { Element } from '@baton/core/bridge';
import type { CollectResult, LaneInfo, TargetResult, ToContent } from './messages';
import { onCue } from './pointer';

let lane: LaneInfo | null = null;
let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let marked = new Map<number, HTMLElement>();
let cursorPos = { x: -40, y: -40 };

const INTERACTIVE = [
  'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
  '[role=button]', '[role=link]', '[role=tab]', '[role=checkbox]', '[role=radio]', '[role=menuitem]',
  '[role=option]', '[role=textbox]', '[role=combobox]', '[role=switch]', '[contenteditable=""]', '[contenteditable=true]',
].join(',');

const CURSOR_SVG = (color: string) => `
<svg width="30" height="34" viewBox="0 0 30 34" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 2 L3 26 L9.5 20 L14 31 L18.5 29 L14 18.5 L23 18.5 Z" fill="${color}" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>
</svg>`;

const STYLE = `
:host{all:initial}
.layer{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:600 13px/1.2 "Inter","Segoe UI",system-ui,sans-serif}
.frame{position:fixed;inset:0;border:4px solid var(--c);border-radius:2px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}
.title{position:fixed;top:10px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;max-width:72vw;
  padding:8px 16px 8px 12px;border-radius:999px;background:rgba(15,18,28,.86);color:#fff;backdrop-filter:blur(12px);
  box-shadow:0 6px 24px rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.12)}
.dot{width:10px;height:10px;border-radius:50%;background:var(--c);box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 30%,transparent);flex:none}
.name{flex:none}
.thinking{color:rgba(255,255,255,.72);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.thinking:empty{display:none}
.cursor{position:fixed;left:0;top:0;width:30px;height:34px;transform:translate(-40px,-40px);
  filter:drop-shadow(0 0 10px var(--c)) drop-shadow(0 2px 3px rgba(0,0,0,.35));will-change:transform}
.cursor.hidden{opacity:0}
.pulse{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid var(--c);
  animation:pulse .5s ease-out forwards}
@keyframes pulse{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
.mark{position:fixed;padding:1px 6px;border-radius:4px 4px 4px 0;background:#e11d48;color:#fff;font:700 12px/16px "Inter","Segoe UI",sans-serif;
  box-shadow:0 1px 2px rgba(0,0,0,.3)}
.box{position:fixed;border:1.5px solid rgba(225,29,72,.75);border-radius:3px}
`;

function ensureLayer(): ShadowRoot {
  if (root && host?.isConnected) return root;
  host = document.createElement('baton-lane');
  root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${STYLE}</style><div class="layer"><div class="frame"></div>
    <div class="title"><span class="dot"></span><span class="name"></span><span class="thinking"></span></div>
    <div class="marks"></div><div class="cursor"></div></div>`;
  document.documentElement.appendChild(host);
  return root;
}

function q<T extends HTMLElement>(sel: string): T {
  return ensureLayer().querySelector(sel) as T;
}

function applyLane(info: LaneInfo | null) {
  lane = info;
  if (!info) {
    host?.remove();
    host = null;
    root = null;
    return;
  }
  const layer = q<HTMLDivElement>('.layer');
  layer.style.setProperty('--c', info.color);
  q('.name').textContent = info.title;
  q('.thinking').textContent = info.thinking;
  q('.cursor').innerHTML = CURSOR_SVG(info.color);
  placeCursor(cursorPos.x, cursorPos.y);
}

function placeCursor(x: number, y: number) {
  cursorPos = { x, y };
  // The arrow's tip sits at (3,2) inside the SVG.
  q('.cursor').style.transform = `translate(${x - 3}px, ${y - 2}px)`;
}

// Glide along a gentle arc with ease-in-out, so the eye can follow it on camera.
function animateCursor(x: number, y: number): Promise<void> {
  const from = { ...cursorPos };
  if (from.x < 0) {
    from.x = window.innerWidth / 2;
    from.y = window.innerHeight - 40;
  }
  const dist = Math.hypot(x - from.x, y - from.y);
  const duration = Math.min(900, 280 + dist * 0.6);
  const bend = Math.min(80, dist * 0.18);
  const nx = -(y - from.y) / (dist || 1);
  const ny = (x - from.x) / (dist || 1);
  // Nobody can see a hidden page, and Chrome pauses its animation frames: just arrive.
  if (document.visibilityState !== 'visible') {
    placeCursor(x, y);
    return Promise.resolve();
  }
  const t0 = performance.now();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      placeCursor(x, y);
      resolve();
    };
    const frame = (now: number) => {
      if (done) return;
      const t = Math.min(1, (now - t0) / duration);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const arc = Math.sin(Math.PI * e) * bend;
      placeCursor(from.x + (x - from.x) * e + nx * arc, from.y + (y - from.y) * e + ny * arc);
      if (t < 1) requestAnimationFrame(frame);
      else finish();
    };
    requestAnimationFrame(frame);
    // If the window gets covered mid-glide, frames stop; never let that stall the lane.
    setTimeout(finish, duration + 250);
  });
}

function clickPulse() {
  const p = document.createElement('div');
  p.className = 'pulse';
  p.style.left = `${cursorPos.x}px`;
  p.style.top = `${cursorPos.y}px`;
  q('.layer').appendChild(p);
  setTimeout(() => p.remove(), 600);
}

// ── Element list ─────────────────────────────────────────────────────────

const inViewport = (r: DOMRect) => !(r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth);

// Rendered and usable, whether or not it is scrolled into view right now.
function visible(el: HTMLElement, r: DOMRect): boolean {
  if (r.width < 2 || r.height < 2) return false;
  // Far off to the side is a hiding trick, not a long page.
  if (r.right < 0 || r.left > window.innerWidth) return false;
  const s = getComputedStyle(el);
  if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
  if ((el as HTMLInputElement).disabled) return false;
  return true;
}

function labelOf(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const t = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? '').join(' ').trim();
    if (t) return t;
  }
  const labels = (el as HTMLInputElement).labels;
  if (labels?.length) return [...labels].map((l) => l.innerText).join(' ').trim();
  return '';
}

function nameOf(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const text =
    labelOf(el) ||
    (tag === 'input' || tag === 'textarea' ? (el as HTMLInputElement).placeholder : '') ||
    (tag === 'input' && ['submit', 'button'].includes((el as HTMLInputElement).type) ? (el as HTMLInputElement).value : '') ||
    el.innerText ||
    el.getAttribute('title') ||
    el.querySelector('img')?.alt ||
    '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 100);
}

function roleOf(el: HTMLElement): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button' || tag === 'summary') return 'button';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const t = (el as HTMLInputElement).type;
    if (['submit', 'button', 'reset'].includes(t)) return 'button';
    if (['checkbox', 'radio'].includes(t)) return t;
    if (t === 'search') return 'searchbox';
    return 'textbox';
  }
  if (el.isContentEditable) return 'textbox';
  return tag;
}

function blockedReason(el: HTMLElement) {
  const tag = el.isContentEditable ? 'contenteditable' : el.tagName.toLowerCase();
  const i = el as HTMLInputElement;
  return blockedFieldReason({
    tag,
    type: i.type,
    autocomplete: el.getAttribute('autocomplete') ?? undefined,
    name: el.getAttribute('name') ?? undefined,
    id: el.id || undefined,
    label: [labelOf(el), i.placeholder].filter(Boolean).join(' ') || undefined,
    inputmode: el.getAttribute('inputmode') ?? undefined,
  });
}

function formOf(el: HTMLElement): Element['form'] {
  const form = (el as HTMLInputElement).form ?? el.closest('form');
  if (!form) return undefined;
  const submit = form.querySelector<HTMLElement>('button:not([type=button]):not([type=reset]), input[type=submit]');
  // Read attributes, never form.action / form.method: a control named "action" or "method"
  // shadows those properties (DOM clobbering), which a page could use to fool the approval gate.
  return {
    method: (form.getAttribute('method') || 'get').toLowerCase(),
    action: new URL(form.getAttribute('action') || location.href, location.href).href,
    submitLabel: submit ? nameOf(submit) : undefined,
  };
}

// Text a person cannot see but a model would read: comments, attributes, invisible elements.
function hiddenText(): CollectResult['hidden'] {
  const out: CollectResult['hidden'] = [];
  let budget = 20000;
  const push = (source: 'hidden' | 'comment' | 'attribute', text: string) => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t.length < 12 || budget <= 0) return;
    budget -= t.length;
    out.push({ source, text: t.slice(0, 2000) });
  };
  const comments = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT);
  while (comments.nextNode()) push('comment', comments.currentNode.nodeValue ?? '');
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    if (host?.contains(el) || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    for (const attr of el.attributes) {
      if (/^(data-|aria-description|title$|alt$)/.test(attr.name)) push('attribute', attr.value);
    }
    const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.nodeValue ?? '').join(' ');
    if (own.trim().length < 12) continue;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const invisible =
      !el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ||
      r.width < 2 || r.height < 2 || r.right < 0 || r.bottom < -window.scrollY ||
      parseFloat(s.fontSize) < 4 ||
      s.color === s.backgroundColor ||
      (s.clip && s.clip !== 'auto');
    if (invisible) push('hidden', own);
  }
  return out;
}

function collect(showMarks: boolean): CollectResult {
  ensureLayer();
  marked = new Map();
  const elements: Element[] = [];
  let n = 0;
  for (const el of document.querySelectorAll<HTMLElement>(INTERACTIVE)) {
    if (host?.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    // Long forms: list the whole page so a lane can see every field, but keep the list bounded.
    if (n >= 200) break;
    const mark = ++n;
    marked.set(mark, el);
    const tag = el.tagName.toLowerCase();
    const i = el as HTMLInputElement;
    const blocked = blockedReason(el);
    const select = tag === 'select' ? (el as HTMLSelectElement) : null;
    let value: string | undefined;
    // Never report what is in a blocked field.
    if (select) value = select.selectedOptions[0]?.text ?? '';
    else if (['input', 'textarea'].includes(tag) && !blocked && !['checkbox', 'radio', 'submit', 'button'].includes(i.type)) value = String(i.value).slice(0, 4000);
    else if (['checkbox', 'radio'].includes(i.type)) value = i.checked ? 'checked' : 'unchecked';
    elements.push({
      mark,
      tag,
      role: roleOf(el),
      name: nameOf(el),
      value,
      type: tag === 'input' ? i.type : undefined,
      href: tag === 'a' ? (el as HTMLAnchorElement).href : undefined,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      blocked: blocked ? true : undefined,
      offscreen: inViewport(r) ? undefined : true,
      hints: [el.getAttribute('name'), el.id, el.getAttribute('autocomplete'), i.placeholder, el.getAttribute('type')].filter(Boolean).join(' ') || undefined,
      form: ['input', 'button', 'select', 'textarea'].includes(tag) ? formOf(el) : undefined,
      options: select ? [...select.options].map((o) => o.text).slice(0, 40) : undefined,
    });
  }
  if (showMarks) drawMarks();
  return {
    url: location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: { x: window.scrollX, y: window.scrollY },
    dpr: window.devicePixelRatio,
    elements,
    text: (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').slice(0, 12000),
    hidden: hiddenText(),
  };
}

function chooseOption(mark: number, option: string): string {
  const el = marked.get(mark);
  if (!(el instanceof HTMLSelectElement)) throw new Error(`mark ${mark} is not a dropdown`);
  const want = option.trim().toLowerCase();
  const opt =
    [...el.options].find((o) => o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want) ??
    [...el.options].find((o) => o.text.toLowerCase().includes(want));
  if (!opt) throw new Error(`no option “${option}” in ${nameOf(el)} (options: ${[...el.options].map((o) => o.text).join(', ')})`);
  el.value = opt.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return opt.text;
}

function drawMarks() {
  const layer = q('.marks');
  layer.innerHTML = '';
  for (const [mark, el] of marked) {
    const r = el.getBoundingClientRect();
    if (!inViewport(r)) continue; // only what the screenshot can show
    const box = document.createElement('div');
    box.className = 'box';
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const tag = document.createElement('div');
    tag.className = 'mark';
    tag.textContent = String(mark);
    Object.assign(tag.style, { left: `${Math.max(0, r.left)}px`, top: `${Math.max(0, r.top - 17)}px` });
    layer.append(box, tag);
  }
}

async function target(msg: Extract<ToContent, { kind: 'target' }>): Promise<TargetResult> {
  if (msg.mark === undefined) return { x: msg.x ?? 0, y: msg.y ?? 0, name: `point ${msg.x},${msg.y}` };
  const el = marked.get(msg.mark);
  if (!el || !el.isConnected) throw new Error(`mark ${msg.mark} is not on the page any more; look again`);
  let r = el.getBoundingClientRect();
  if (r.top < 0 || r.bottom > window.innerHeight) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    r = el.getBoundingClientRect();
  }
  const reason = msg.forTyping ? blockedReason(el) : null;
  if (msg.forTyping && !reason) el.focus();
  return {
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
    name: nameOf(el),
    blocked: reason ? blockedFieldMessage(reason) : undefined,
    inputType: el instanceof HTMLInputElement ? el.type : undefined,
  };
}

// Enter a block of rows into a grid of fields, starting at a cell and filling right and down.
// Values are set the way a paste would set them; blocked fields are refused.
async function fillCells(mark: number, rows: string[][]): Promise<number> {
  const start = marked.get(mark);
  const cell = start?.closest('td,th') as HTMLTableCellElement | null;
  const table = start?.closest('table');
  if (!start || !cell || !table) throw new Error(`mark ${mark} is not a cell in a table`);
  const r0 = (cell.parentElement as HTMLTableRowElement).rowIndex;
  const c0 = cell.cellIndex;
  const setValue = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  let filled = 0;
  for (const [i, row] of rows.entries()) {
    const tr = table.rows[r0 + i];
    if (!tr) throw new Error(`the sheet has only ${table.rows.length - r0} rows from this cell; ${rows.length} were needed`);
    for (const [j, value] of row.entries()) {
      const field = tr.cells[c0 + j]?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:not([type=hidden]),textarea');
      if (!field) throw new Error(`no field at row ${i + 1}, column ${j + 1} of the block`);
      if (blockedReason(field)) throw new Error('blocked field: Baton never types into password or payment fields');
      setValue(field, value);
      filled++;
    }
    // Rows land one after another so the eye can follow them.
    tr.animate([{ backgroundColor: 'rgba(139,155,255,.35)' }, { backgroundColor: 'transparent' }], { duration: 700 });
    await new Promise((r) => setTimeout(r, 70));
  }
  return filled;
}

// Date inputs ignore inserted text; set the ISO value the way a picker would.
function setDate(mark: number, iso: string): string {
  const el = marked.get(mark);
  if (!(el instanceof HTMLInputElement) || el.type !== 'date') throw new Error(`mark ${mark} is not a date field`);
  el.focus();
  el.value = iso;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
}

chrome.runtime.onMessage.addListener((msg: ToContent, _sender, reply) => {
  (async () => {
    switch (msg.kind) {
      case 'lane':
        applyLane(msg.lane);
        return true;
      case 'collect':
        return collect(msg.showMarks);
      case 'hideMarks':
        q('.marks').innerHTML = '';
        return true;
      case 'target':
        return target(msg);
      case 'moveCursor':
        await animateCursor(msg.x, msg.y);
        return true;
      case 'clickPulse':
        clickPulse();
        return true;
      case 'setThinking':
        if (lane) lane.thinking = msg.text;
        q('.thinking').textContent = msg.text;
        return true;
      case 'cursorVisible':
        q('.cursor').classList.toggle('hidden', !msg.visible);
        return true;
      case 'select':
        return chooseOption(msg.mark, msg.option);
      case 'setDate':
        return setDate(msg.mark, msg.iso);
      case 'cue':
        onCue(msg);
        return true;
      case 'fillCells':
        return fillCells(msg.mark, msg.rows);
      case 'scrollBy': {
        const y0 = window.scrollY;
        window.scrollBy({ top: msg.dy, behavior: document.visibilityState === 'visible' ? 'smooth' : 'instant' });
        await new Promise((r) => setTimeout(r, 450));
        return { moved: Math.round(window.scrollY - y0) };
      }
      case 'scrollTo': {
        const el = marked.get(msg.mark);
        if (!el?.isConnected) throw new Error(`mark ${msg.mark} is not on the page any more; look again`);
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        await new Promise((r) => setTimeout(r, 450));
        return true;
      }
    }
  })().then(
    (data) => reply({ ok: true, data }),
    (e: Error) => reply({ ok: false, error: e.message }),
  );
  return true; // async reply
});

// On every page load, ask whether this tab is a lane and draw its chrome if so.
chrome.runtime.sendMessage({ kind: 'whoami' }).then(
  (info: LaneInfo | null) => applyLane(info),
  () => undefined,
);
