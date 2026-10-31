// Pointing: while the person holds the talk key, every place the pointer rests for about 300 ms
// becomes a numbered anchor, shown as a pin on the page. Works in any tab, not just lanes.

import type { AnchorTarget } from '@baton/core/cue/anchor';
import type { Rect } from '@baton/core/geometry';

const REST_MS = 300;
const MOVE_PX = 6;

let pos: { x: number; y: number } | null = null;
let inside = false;
let cue: { id: string } | null = null;
let restTimer: ReturnType<typeof setTimeout> | null = null;
let restAt: { x: number; y: number } | null = null;
const keys = new WeakMap<Element, string>();
let nextKey = 1;

// ── Pins ─────────────────────────────────────────────────────────────────

let host: HTMLElement | null = null;
let layer: HTMLElement | null = null;

const STYLE = `
:host{all:initial}
.layer{position:fixed;inset:0;pointer-events:none;z-index:2147483646;font:700 13px/1 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;font-variant-numeric:tabular-nums}
.outline{position:fixed;border-radius:6px;outline:2px solid #c99a3b;outline-offset:2px;transition:opacity .4s ease}
.pin{position:fixed;width:26px;height:26px;margin:-34px 0 0 -13px;display:grid;place-items:center;border-radius:6px 6px 6px 1px;
  background:#c99a3b;color:#1d160a;box-shadow:0 2px 6px rgba(0,0,0,.35);
  animation:drop .18s cubic-bezier(.2,.7,.2,1);transition:opacity .4s ease}
.fade{opacity:0}
@keyframes drop{from{transform:translateY(-6px);opacity:0}}
`;

function ensureLayer(): HTMLElement {
  if (layer && host?.isConnected) return layer;
  host = document.createElement('baton-anchors');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${STYLE}</style><div class="layer"></div>`;
  document.documentElement.appendChild(host);
  layer = root.querySelector('.layer') as HTMLElement;
  return layer;
}

function drawPin(n: number, point: { x: number; y: number }, rect: Rect) {
  const l = ensureLayer();
  const outline = document.createElement('div');
  outline.className = 'outline';
  Object.assign(outline.style, {
    left: `${rect.x - 4}px`,
    top: `${rect.y - 4}px`,
    width: `${rect.w + 8}px`,
    height: `${rect.h + 8}px`,
  });
  const pin = document.createElement('div');
  pin.className = 'pin';
  pin.textContent = String(n);
  Object.assign(pin.style, { left: `${point.x}px`, top: `${point.y}px` });
  l.append(outline, pin);
}

function clearPins(afterMs: number) {
  const l = layer;
  if (!l) return;
  setTimeout(() => {
    for (const el of l.children) el.classList.add('fade');
    setTimeout(() => (l.innerHTML = ''), 700);
  }, afterMs);
}

// ── What is under the pointer ────────────────────────────────────────────

const text = (el: Element) => ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();

function cellText(cell: HTMLTableCellElement): string {
  const field = cell.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input:not([type=hidden]),textarea,select',
  );
  if (field)
    return field instanceof HTMLSelectElement
      ? (field.selectedOptions[0]?.text ?? '')
      : field.type === 'password'
        ? ''
        : field.value;
  return text(cell).replace(/\s+/g, ' ');
}

// A nearby heading names what is being pointed at ("Sessions", "Import sheet").
function nearbyHeading(el: Element): string {
  let n: Element | null = el;
  for (let i = 0; n && i < 8; i++, n = n.parentElement) {
    let sib: Element | null = n.previousElementSibling;
    for (let k = 0; sib && k < 6; k++, sib = sib.previousElementSibling) {
      const h = sib.matches('h1,h2,h3,h4,caption,legend') ? sib : sib.querySelector('h1,h2,h3,h4');
      if (h && text(h)) return text(h).slice(0, 120);
    }
  }
  return document.title;
}

function roleOf(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  return (
    (
      {
        a: 'link',
        button: 'button',
        img: 'image',
        table: 'table',
        tr: 'row',
        li: 'listitem',
        article: 'article',
        input: 'textbox',
        textarea: 'textbox',
        h1: 'heading',
        h2: 'heading',
        h3: 'heading',
      } as Record<string, string>
    )[tag] ?? tag
  );
}

const BLOCKS =
  'a,button,img,input,textarea,select,li,tr,article,section,figure,[role=listitem],[role=article],[role=row]';

export function targetAt(x: number, y: number): { el: Element; target: AnchorTarget } | null {
  const hit = document.elementFromPoint(x, y);
  if (!hit || hit === document.documentElement || hit === document.body || hit.closest('baton-anchors,baton-lane'))
    return null;

  const table = hit.closest('table');
  if (table) {
    const rows = [...table.rows].slice(0, 60).map((r) => [...r.cells].slice(0, 20).map(cellText));
    const tr = hit.closest('tr');
    return {
      el: table,
      target: {
        tag: 'table',
        role: 'table',
        label: table.getAttribute('aria-label') || table.caption?.innerText || nearbyHeading(table),
        text: rows
          .map((r) => r.join('\t'))
          .join('\n')
          .slice(0, 4000),
        table: {
          rows,
          editable: !!table.querySelector('input:not([type=hidden]),textarea,[contenteditable=true]'),
          pointedRow: tr ? tr.rowIndex : undefined,
        },
      },
    };
  }

  // Grow from the exact element to the smallest block that says something.
  const viewArea = window.innerWidth * window.innerHeight;
  let el: Element = hit;
  while (el.parentElement && el.parentElement !== document.body) {
    const enough = text(el).length >= 30 || el.matches(BLOCKS);
    if (enough) break;
    const r = el.parentElement.getBoundingClientRect();
    if (r.width * r.height > viewArea * 0.7) break;
    el = el.parentElement;
  }
  // A heading or line inside a message belongs to the message: an enclosing article is the thing
  // being pointed at, however tall it is. Smaller cards and list items only when they fit the view.
  const article = el.closest('article,[role=article],[role=main] .msg');
  const card = el.closest('.card,.msg,li,[role=listitem]');
  if (article) el = article;
  else if (card && card.getBoundingClientRect().width * card.getBoundingClientRect().height < viewArea * 0.8) el = card;

  const img = hit instanceof HTMLImageElement ? hit : null;
  const link = hit.closest('a');
  const heading = el.querySelector('h1,h2,h3');
  return {
    el,
    target: {
      tag: el.tagName.toLowerCase(),
      role: roleOf(el),
      label: (heading ? text(heading) : (text(el).split('\n')[0] ?? '')).slice(0, 200) || (img?.alt ?? ''),
      text: text(el).slice(0, 4000),
      href: link?.href,
      image: img ? { src: img.currentSrc.slice(0, 500), alt: img.alt.slice(0, 300) } : undefined,
    },
  };
}

// ── Rest detection ───────────────────────────────────────────────────────

export interface RestReport {
  kind: 'rest';
  cueId: string;
  key: string;
  url: string;
  title: string;
  point: { x: number; y: number };
  rect: Rect;
  dpr: number;
  viewport: { width: number; height: number };
  target: AnchorTarget;
}

function scheduleRest() {
  if (restTimer) clearTimeout(restTimer);
  if (!cue || !pos || !inside || document.visibilityState !== 'visible') return;
  restTimer = setTimeout(rest, REST_MS);
}

async function rest() {
  if (!cue || !pos) return;
  if (restAt && Math.hypot(pos.x - restAt.x, pos.y - restAt.y) < MOVE_PX) return;
  restAt = { ...pos };
  const found = targetAt(pos.x, pos.y);
  if (!found) return;
  let key = keys.get(found.el);
  if (!key) keys.set(found.el, (key = `${location.href}#${nextKey++}`));
  const r = found.el.getBoundingClientRect();
  const rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  const report: RestReport = {
    kind: 'rest',
    cueId: cue.id,
    key,
    url: location.href,
    title: document.title,
    point: { ...pos },
    rect,
    dpr: window.devicePixelRatio,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    target: found.target,
  };
  try {
    const reply = (await chrome.runtime.sendMessage(report)) as { n?: number; isNew?: boolean } | undefined;
    if (reply?.n && reply.isNew) drawPin(reply.n, report.point, rect);
  } catch {
    /* the extension reloaded; nothing to pin */
  }
}

export function onCue(msg: { active: boolean; cueId?: string; keep?: boolean }) {
  if (msg.active && msg.cueId) {
    cue = { id: msg.cueId };
    restAt = null;
    // Often the person is already pointing when they press the key: that counts too.
    scheduleRest();
  } else {
    cue = null;
    if (restTimer) clearTimeout(restTimer);
    clearPins(msg.keep ? 5000 : 0);
  }
}

window.addEventListener(
  'mousemove',
  (e) => {
    pos = { x: e.clientX, y: e.clientY };
    inside = true;
    scheduleRest();
  },
  { passive: true, capture: true },
);
document.documentElement.addEventListener('mouseleave', () => {
  inside = false;
  if (restTimer) clearTimeout(restTimer);
});
document.documentElement.addEventListener('mouseenter', () => (inside = true));
