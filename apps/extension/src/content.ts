// Runs in every page. Inside a lane tab it draws the lane frame, title and ghost cursor, numbers
// interactive elements for screenshots, and resolves marks to coordinates. Outside lanes it stays idle.

import { blockedFieldMessage, blockedFieldReason } from '@baton/core/safety/fields';
import type { Element } from '@baton/core/bridge';
import type { CollectResult, LaneInfo, TargetResult, ToContent } from './messages';

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
  const t0 = performance.now();
  return new Promise((resolve) => {
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const arc = Math.sin(Math.PI * e) * bend;
      placeCursor(from.x + (x - from.x) * e + nx * arc, from.y + (y - from.y) * e + ny * arc);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
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

function visible(el: HTMLElement, r: DOMRect): boolean {
  if (r.width < 2 || r.height < 2) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return false;
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

function collect(showMarks: boolean): CollectResult {
  ensureLayer();
  marked = new Map();
  const elements: Element[] = [];
  let n = 0;
  for (const el of document.querySelectorAll<HTMLElement>(INTERACTIVE)) {
    if (host?.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    const mark = ++n;
    marked.set(mark, el);
    const tag = el.tagName.toLowerCase();
    const i = el as HTMLInputElement;
    const blocked = blockedReason(el);
    elements.push({
      mark,
      tag,
      role: roleOf(el),
      name: nameOf(el),
      // Never report what is in a blocked field.
      value: ['input', 'textarea', 'select'].includes(tag) && !blocked && !['checkbox', 'radio', 'submit', 'button'].includes(i.type) ? String(i.value).slice(0, 200) : undefined,
      type: tag === 'input' ? i.type : undefined,
      href: tag === 'a' ? (el as HTMLAnchorElement).href : undefined,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      blocked: blocked ? true : undefined,
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
    text: (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').slice(0, 6000),
  };
}

function drawMarks() {
  const layer = q('.marks');
  layer.innerHTML = '';
  for (const [mark, el] of marked) {
    const r = el.getBoundingClientRect();
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
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), name: nameOf(el), blocked: reason ? blockedFieldMessage(reason) : undefined };
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
