// Baton's hands: connects to the desktop app over the paired local WebSocket and drives lane
// windows with chrome.debugger (DevTools Protocol) for screenshots, mouse and keyboard.

import {
  BRIDGE_PORT,
  PROTOCOL_VERSION,
  ToExtension,
  parseFrame,
  type Command,
  type FromExtension,
  type LookResult,
} from '@baton/core/bridge';
import { toIsoDate } from '@baton/core/lane/dates';
import type { CollectResult, LaneInfo, TargetResult, ToContent, ToWorker } from './messages';
import type { RestReport } from './pointer';
import { exportText, settleFrame, tidyFrame, type TidyReport } from './tidy';

interface Lane extends LaneInfo {
  windowId: number;
  tabId: number;
}

type Status = 'unpaired' | 'connecting' | 'connected' | 'rejected' | 'offline';

const lanes = new Map<string, Lane>();
let ws: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

// ── Lane bookkeeping survives service-worker restarts ────────────────────

async function saveLanes() {
  await chrome.storage.session.set({ lanes: [...lanes.values()] });
}

async function loadLanes() {
  const { lanes: saved } = (await chrome.storage.session.get('lanes')) as { lanes?: Lane[] };
  for (const l of saved ?? []) lanes.set(l.laneId, l);
}

const ready = loadLanes();

function laneByTab(tabId: number | undefined): Lane | undefined {
  return [...lanes.values()].find((l) => l.tabId === tabId);
}

function lane(laneId: string): Lane {
  const l = lanes.get(laneId);
  if (!l) throw new Error(`lane ${laneId} is not open`);
  return l;
}

// ── Bridge connection ────────────────────────────────────────────────────

async function setStatus(status: Status, detail = '') {
  await chrome.storage.local.set({ status, statusDetail: detail, statusAt: Date.now() });
}

function send(msg: FromExtension) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// Startup, install, the keep-alive alarm and settings changes can all call connect() at once; only
// one attempt may run, or two sockets open and replace each other in a loop.
let connecting = false;

async function connect() {
  if (connecting || (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))) return;
  connecting = true;
  try {
    await openSocket();
  } finally {
    connecting = false;
  }
}

async function openSocket() {
  if (retryTimer) clearTimeout(retryTimer);
  const { token, port } = (await chrome.storage.local.get(['token', 'port'])) as { token?: string; port?: number };
  if (!token) return setStatus('unpaired');
  await setStatus('connecting');
  const socket = new WebSocket(`ws://127.0.0.1:${port ?? BRIDGE_PORT}`);
  ws = socket;
  // Say hello on this socket itself, not on whichever socket `ws` points to by then.
  socket.onopen = () =>
    socket.send(
      JSON.stringify({
        type: 'hello',
        token,
        version: PROTOCOL_VERSION,
        extensionVersion: chrome.runtime.getManifest().version,
      } satisfies FromExtension),
    );
  socket.onmessage = (ev) => {
    const msg = parseFrame(ToExtension, String(ev.data));
    if (!msg) return;
    if (msg.type === 'welcome') void setStatus('connected');
    else if (msg.type === 'rejected') void setStatus('rejected', msg.reason);
    else if (msg.type === 'command') void run(msg.id, msg.command);
  };
  socket.onclose = async () => {
    if (ws !== socket) return;
    ws = null;
    const { status } = await chrome.storage.local.get('status');
    if (status !== 'rejected') await setStatus('offline');
    retryTimer = setTimeout(connect, 2000);
  };
  socket.onerror = () => socket.close();
}

async function run(id: number, command: Command) {
  await ready;
  try {
    const data = await execute(command);
    send({ type: 'result', id, ok: true, data: data ?? null });
  } catch (e) {
    send({ type: 'result', id, ok: false, error: (e as Error).message || String(e) });
  }
}

// ── Talking to a lane's tab ──────────────────────────────────────────────

async function toTab<T>(tabId: number, msg: ToContent, timeoutMs = 8000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last: unknown;
  // The content script may not be ready right after a navigation; retry until it answers.
  while (Date.now() < until) {
    try {
      const res = (await chrome.tabs.sendMessage(tabId, msg)) as { ok: boolean; data?: T; error?: string } | undefined;
      if (res?.ok) return res.data as T;
      if (res && !res.ok) throw new Error(res.error);
    } catch (e) {
      last = e;
      if (
        e instanceof Error &&
        !/Receiving end does not exist|Could not establish connection|message port closed/i.test(e.message)
      )
        throw e;
    }
    await sleep(120);
  }
  throw new Error(`lane page did not respond: ${(last as Error)?.message ?? 'timeout'}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Wait for the page to load. Busy real sites (maps, feeds) stream forever and never reach
// "complete"; once the document is usable, a few seconds is enough and the lane carries on.
async function waitForLoad(tabId: number, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  let usableSince = 0;
  while (Date.now() < until) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
    if (!usableSince && (await documentUsable(tabId))) usableSince = Date.now();
    if (usableSince && Date.now() - usableSince > 4000) return;
    await sleep(150);
  }
  if (!(await documentUsable(tabId))) throw new Error('page did not load in 15 s');
}

// Loaded is not the same as ready on heavy pages: also wait for the network to go quiet and the
// layout to stop shifting for 500 ms, at most 4 s.
async function waitForSettle(tabId: number) {
  await waitForLoad(tabId);
  await chrome.scripting
    .executeScript({ target: { tabId }, func: settleFrame, args: [500, 4000] })
    .catch(() => undefined);
}

// The top frame, plus frames that belong to consent and bot-check providers. Ad-heavy pages have
// dozens of ad frames; visiting every one made a single look take fifteen seconds.
const PROVIDER_FRAME =
  /consent|sourcepoint|privacy-mgmt|cmp|cookielaw|onetrust|trustarc|usercentrics|didomi|quantcast|cookiebot|privacy-center|recaptcha|hcaptcha|challenges\.cloudflare|turnstile|arkoselabs|captcha/i;
async function tidyFrames(tabId: number): Promise<number[]> {
  const frames = (await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null)) ?? [];
  return [0, ...frames.filter((f) => f.frameId !== 0 && PROVIDER_FRAME.test(f.url)).map((f) => f.frameId)];
}

// Before a lane looks: clear consent banners and pop-ups, and spot bot checks.
async function tidy(tabId: number): Promise<TidyReport> {
  const merged: TidyReport = { tidied: [] };
  for (let pass = 0; pass < 2; pass++) {
    const results = await chrome.scripting
      .executeScript({ target: { tabId, frameIds: await tidyFrames(tabId) }, func: tidyFrame })
      .catch(() => []);
    const reports = results.map((r) => r.result as TidyReport | undefined).filter((r): r is TidyReport => !!r);
    const cleared = reports.flatMap((r) => r.tidied);
    merged.tidied.push(...cleared);
    merged.captcha ??= reports.find((r) => r.captcha)?.captcha;
    merged.consent = reports.find((r) => r.consent?.length)?.consent;
    // A banner often gives way to a second one (or a page reload): look once more.
    if (!cleared.length || merged.captcha) break;
    await sleep(600);
    await waitForSettle(tabId);
  }
  return merged;
}

async function chord(tabId: number, key: string, code: string, vk: number, modifiers: number) {
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers });
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
}

async function rectOf(tabId: number, selector: string): Promise<{ x: number; y: number } | null> {
  const r = await cdp<{ result: { value?: { x: number; y: number } | null } }>(tabId, 'Runtime.evaluate', {
    expression: `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 40) }; })()`,
    returnByValue: true,
  });
  return r.result.value ?? null;
}

async function readExport(tabId: number, kind: 'sheet' | 'doc', range: string | null): Promise<string> {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: exportText, args: [kind, range] });
  if (typeof r?.result !== 'string') throw new Error('the file could not be read');
  return r.result;
}

async function documentUsable(tabId: number): Promise<boolean> {
  try {
    const r = await cdpSend<{ result: { value?: string } }>(tabId, 'Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    });
    return r.result.value === 'interactive' || r.result.value === 'complete';
  } catch {
    return false;
  }
}

// A DevTools command may wait on a frame Chrome never draws (window hidden); never wait forever.
function cdpSend<T>(tabId: number, method: string, params: Record<string, unknown>): Promise<T> {
  return Promise.race([
    chrome.debugger.sendCommand({ tabId }, method, params) as Promise<T>,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${method} got no answer in 8 s (is the lane window hidden?)`)), 8000),
    ),
  ]);
}

async function cdp<T = unknown>(tabId: number, method: string, params: Record<string, unknown> = {}): Promise<T> {
  try {
    return await cdpSend<T>(tabId, method, params);
  } catch (e) {
    // The person may have dismissed the debugging bar; attach again and retry once.
    if (/not attached/i.test((e as Error).message)) {
      await attach(tabId);
      return await cdpSend<T>(tabId, method, params);
    }
    throw e;
  }
}

async function attach(tabId: number) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (e) {
    if (!/already attached/i.test((e as Error).message)) throw e;
  }
  // The person keeps using their own mouse and windows while lanes work. Without this, a lane page
  // loses focus whenever another window is active, and text it types goes nowhere.
  await chrome.debugger
    .sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true })
    .catch(() => undefined);
}

async function mouse(tabId: number, x: number, y: number) {
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await cdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

const KEYS: Record<string, { code: string; vk: number; text?: string }> = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Tab: { code: 'Tab', vk: 9 },
  Escape: { code: 'Escape', vk: 27 },
  Backspace: { code: 'Backspace', vk: 8 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  PageDown: { code: 'PageDown', vk: 34 },
  PageUp: { code: 'PageUp', vk: 33 },
};

async function key(tabId: number, name: string) {
  const k = KEYS[name];
  if (!k) throw new Error(`unknown key ${name}`);
  await cdp(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: name,
    code: k.code,
    windowsVirtualKeyCode: k.vk,
    text: k.text,
  });
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: k.code, windowsVirtualKeyCode: k.vk });
}

// Glide the ghost cursor to the target and return where it landed.
async function aim(l: Lane, t: { mark?: number; x?: number; y?: number }, forTyping = false): Promise<TargetResult> {
  await waitForLoad(l.tabId);
  const pos = await toTab<TargetResult>(l.tabId, { kind: 'target', ...t, forTyping });
  if (pos.blocked) throw new Error(`blocked field: ${pos.blocked}`);
  await toTab(l.tabId, { kind: 'moveCursor', x: pos.x, y: pos.y });
  return pos;
}

// ── Commands ─────────────────────────────────────────────────────────────

async function execute(c: Command): Promise<unknown> {
  switch (c.op) {
    case 'ping':
      return 'pong';

    case 'cueStart':
      cue = { id: c.cueId, startedAt: Date.now(), n: 0, keys: new Map() };
      await broadcast({ kind: 'cue', active: true, cueId: c.cueId });
      return true;

    case 'cueEnd':
      if (cue?.id === c.cueId) cue = null;
      await broadcast({ kind: 'cue', active: false, keep: c.keep });
      return true;

    case 'recordStart':
      rehearsal = { startedAt: Date.now() };
      await broadcast({ kind: 'record', active: true });
      return true;

    case 'recordStop':
      rehearsal = null;
      await broadcast({ kind: 'record', active: false });
      return true;

    case 'reloadTab':
      await chrome.tabs.reload(c.tabId);
      return true;

    case 'fillCells': {
      const l = lane(c.laneId);
      await aim(l, { mark: c.mark }, true);
      await toTab(l.tabId, { kind: 'clickPulse' });
      return { filled: await toTab<number>(l.tabId, { kind: 'fillCells', mark: c.mark, rows: c.rows }, 20000) };
    }

    case 'reloadExtension':
      setTimeout(() => chrome.runtime.reload(), 200);
      return true;

    case 'openLane': {
      const existing = lanes.get(c.laneId);
      if (existing) await closeLane(existing);
      // Lanes open in front: they are meant to be watched, and Chrome stops drawing (and stalls
      // DevTools input for) windows that are completely covered by others.
      const win = await chrome.windows.create({
        url: c.url,
        focused: true,
        type: 'normal',
        ...(c.bounds ?? { width: 1280, height: 860 }),
      });
      const tabId = win?.tabs?.[0]?.id;
      if (!win?.id || tabId === undefined) throw new Error('could not open a lane window');
      const l: Lane = { laneId: c.laneId, color: c.color, title: c.title, thinking: '', windowId: win.id, tabId };
      lanes.set(c.laneId, l);
      await saveLanes();
      await attach(tabId);
      await waitForLoad(tabId);
      await toTab(tabId, { kind: 'lane', lane: l });
      return { windowId: win.id, tabId };
    }

    case 'closeLane':
      await closeLane(lane(c.laneId));
      return true;

    // Which Chrome window is under the point: a lane window first (they sit on top), then the focused
    // one. Its page pins what is there; the reply says which pin and which lane, or none.
    case 'pinAtScreen': {
      const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      const inside = wins.filter(
        (w) =>
          w.state !== 'minimized' &&
          w.left !== undefined &&
          w.top !== undefined &&
          c.x >= w.left &&
          c.x < w.left + (w.width ?? 0) &&
          c.y >= w.top &&
          c.y < w.top + (w.height ?? 0),
      );
      const isLane = (w: chrome.windows.Window) => [...lanes.values()].some((l) => l.windowId === w.id);
      const win = inside.find(isLane) ?? inside.find((w) => w.focused) ?? inside[0];
      const tab = win?.tabs?.find((t) => t.active);
      if (!win || tab?.id === undefined) return { n: null };
      const n = await toTab<number | null>(tab.id, { kind: 'pinAt', cueId: c.cueId, x: c.x, y: c.y }).catch(() => null);
      return { n, laneId: laneByTab(tab.id)?.laneId };
    }

    case 'focusLane': {
      const l = lane(c.laneId);
      await chrome.windows.update(l.windowId, { focused: true, drawAttention: true });
      return true;
    }

    // Google Sheets: the Name Box moves to a cell; values are typed with Tab between cells and Enter
    // at the end of each row, which brings Sheets back to the starting column.
    case 'sheetWrite': {
      const l = lane(c.laneId);
      await waitForSettle(l.tabId);
      const box = await rectOf(l.tabId, '#t-name-box');
      if (!box) throw new Error('the Name Box is not on this page; is this a Google Sheet?');
      await toTab(l.tabId, { kind: 'moveCursor', x: box.x, y: box.y }).catch(() => undefined);
      await mouse(l.tabId, box.x, box.y);
      await chord(l.tabId, 'a', 'KeyA', 65, 2);
      await cdp(l.tabId, 'Input.insertText', { text: c.cell });
      await key(l.tabId, 'Enter');
      await sleep(300);
      for (const row of c.rows) {
        for (const [j, v] of row.entries()) {
          if (v) await cdp(l.tabId, 'Input.insertText', { text: v });
          if (j < row.length - 1) await key(l.tabId, 'Tab');
        }
        await key(l.tabId, 'Enter');
        await sleep(60);
      }
      // Sheets saves on its own a moment after typing stops.
      await sleep(1500);
      return true;
    }

    case 'sheetRead':
      return readExport(lane(c.laneId).tabId, 'sheet', c.range ?? null);

    // Google Docs: click into the document, go to its end, and type; Enter starts a new paragraph.
    case 'docWrite': {
      const l = lane(c.laneId);
      await waitForSettle(l.tabId);
      const page = (await rectOf(l.tabId, '.kix-page-paginated')) ?? (await rectOf(l.tabId, '.kix-appview-editor'));
      if (!page) throw new Error('the document page is not on this page; is this a Google Doc?');
      await toTab(l.tabId, { kind: 'moveCursor', x: page.x, y: page.y }).catch(() => undefined);
      await mouse(l.tabId, page.x, page.y);
      await chord(l.tabId, 'End', 'End', 35, 2);
      const paragraphs = c.text.split(/\r?\n/);
      for (const [i, p] of paragraphs.entries()) {
        if (p) await cdp(l.tabId, 'Input.insertText', { text: p });
        if (i < paragraphs.length - 1) await key(l.tabId, 'Enter');
      }
      await sleep(1500);
      return true;
    }

    case 'docRead':
      return readExport(lane(c.laneId).tabId, 'doc', null);

    case 'navigate': {
      const l = lane(c.laneId);
      await chrome.tabs.update(l.tabId, { url: c.url });
      await sleep(100);
      await waitForLoad(l.tabId);
      return true;
    }

    case 'look': {
      const l = lane(c.laneId);
      await waitForSettle(l.tabId);
      const tidied = await tidy(l.tabId);
      const page = await toTab<CollectResult>(l.tabId, { kind: 'collect', showMarks: c.screenshot });
      let screenshot: string | undefined;
      let scale = page.dpr;
      if (c.screenshot) {
        await toTab(l.tabId, { kind: 'cursorVisible', visible: false });
        try {
          // clip.scale multiplies the device pixel ratio, so solve for the final width.
          const s = Math.min(1, c.maxWidth / (page.viewport.width * page.dpr));
          scale = page.dpr * s;
          const shot = await cdp<{ data: string }>(l.tabId, 'Page.captureScreenshot', {
            format: 'jpeg',
            quality: 82,
            clip: {
              x: page.scroll.x,
              y: page.scroll.y,
              width: page.viewport.width,
              height: page.viewport.height,
              scale: s,
            },
          });
          screenshot = shot.data;
        } finally {
          await toTab(l.tabId, { kind: 'hideMarks' });
          await toTab(l.tabId, { kind: 'cursorVisible', visible: true });
        }
      }
      const app = /docs\.google\.com\/spreadsheets\//.test(page.url)
        ? 'sheets'
        : /docs\.google\.com\/document\//.test(page.url)
          ? 'docs'
          : undefined;
      const result: LookResult = {
        url: page.url,
        title: page.title,
        viewport: page.viewport,
        scale,
        screenshot,
        elements: page.elements,
        text: page.text,
        hidden: page.hidden,
        tidied: tidied.tidied,
        blocker: tidied.captcha ? { kind: 'captcha', text: tidied.captcha.slice(0, 300) } : undefined,
        consent: tidied.consent,
        app,
      };
      return result;
    }

    case 'moveCursor': {
      const pos = await aim(lane(c.laneId), c);
      return { x: pos.x, y: pos.y, name: pos.name };
    }

    case 'click': {
      const l = lane(c.laneId);
      const pos = await aim(l, c);
      await toTab(l.tabId, { kind: 'clickPulse' });
      await mouse(l.tabId, pos.x, pos.y);
      // Give a navigation a moment to start before anyone waits for the load.
      await sleep(200);
      await waitForSettle(l.tabId);
      return { x: pos.x, y: pos.y, name: pos.name };
    }

    case 'type': {
      const l = lane(c.laneId);
      const pos = await aim(l, { mark: c.mark }, true);
      await toTab(l.tabId, { kind: 'clickPulse' });
      if (pos.inputType === 'date') {
        const iso = toIsoDate(c.text);
        if (!iso) throw new Error(`“${c.text}” is not a date; write it as YYYY-MM-DD`);
        await toTab(l.tabId, { kind: 'setDate', mark: c.mark, iso });
        return { name: pos.name };
      }
      await mouse(l.tabId, pos.x, pos.y);
      // Replace what is there: select all, then insert.
      await cdp(l.tabId, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
        modifiers: 2,
        commands: ['selectAll'],
      });
      await cdp(l.tabId, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
        modifiers: 2,
      });
      await cdp(l.tabId, 'Input.insertText', { text: c.text });
      if (c.submit) {
        await key(l.tabId, 'Enter');
        await sleep(200);
        await waitForLoad(l.tabId);
      }
      return { name: pos.name };
    }

    case 'key': {
      const l = lane(c.laneId);
      await key(l.tabId, c.key);
      await sleep(150);
      await waitForLoad(l.tabId);
      return true;
    }

    case 'select': {
      const l = lane(c.laneId);
      const pos = await aim(l, { mark: c.mark });
      await toTab(l.tabId, { kind: 'clickPulse' });
      const chosen = await toTab<string>(l.tabId, { kind: 'select', mark: c.mark, option: c.option });
      return { name: pos.name, chosen };
    }

    case 'back': {
      const l = lane(c.laneId);
      await chrome.tabs.goBack(l.tabId);
      await sleep(200);
      await waitForLoad(l.tabId);
      return true;
    }

    case 'scroll': {
      const l = lane(c.laneId);
      // Scrolling is not a person's input that needs to be trusted, so the page does it itself:
      // a DevTools wheel event waits for a compositor frame and can stall.
      if (c.mark !== undefined) {
        await toTab(l.tabId, { kind: 'scrollTo', mark: c.mark });
        return true;
      }
      return toTab(l.tabId, { kind: 'scrollBy', dy: c.dy });
    }

    case 'setThinking': {
      const l = lane(c.laneId);
      l.thinking = c.text;
      await saveLanes();
      await toTab(l.tabId, { kind: 'setThinking', text: c.text });
      return true;
    }
  }
}

async function closeLane(l: Lane) {
  lanes.delete(l.laneId);
  await saveLanes();
  try {
    await chrome.debugger.detach({ tabId: l.tabId });
  } catch {
    /* already detached */
  }
  try {
    await chrome.windows.remove(l.windowId);
  } catch {
    /* already closed */
  }
}

// ── Chrome events ────────────────────────────────────────────────────────

// ── Cues: anchors from wherever the person points ─────────────────────────

let cue: { id: string; startedAt: number; n: number; keys: Map<string, number> } | null = null;
// A rehearsal in progress: when it started, so each recorded step gets its time.
let rehearsal: { startedAt: number } | null = null;

async function broadcast(msg: ToContent) {
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id !== undefined && /^https?:|^file:/.test(tab.url ?? ''))
      chrome.tabs.sendMessage(tab.id, msg).catch(() => undefined);
  }
}

// A crop around what was pointed at, for the model and the Podium. Best effort: Chrome limits
// how often a visible tab can be captured.
async function cropAround(windowId: number, r: RestReport): Promise<string | undefined> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 });
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const s = bitmap.width / r.viewport.width;
    const pad = 24;
    let x = Math.max(0, r.rect.x - pad);
    let y = Math.max(0, r.rect.y - pad);
    let w = Math.min(r.viewport.width, r.rect.x + r.rect.w + pad) - x;
    let h = Math.min(r.viewport.height, r.rect.y + r.rect.h + pad) - y;
    // Very large targets: a window centred on the pointer instead.
    if (w > 1100 || h > 750) {
      w = Math.min(1100, r.viewport.width);
      h = Math.min(750, r.viewport.height);
      x = Math.min(Math.max(0, r.point.x - w / 2), r.viewport.width - w);
      y = Math.min(Math.max(0, r.point.y - h / 2), r.viewport.height - h);
    }
    if (w < 8 || h < 8) return undefined;
    const canvas = new OffscreenCanvas(Math.round(w * s), Math.round(h * s));
    canvas.getContext('2d')!.drawImage(bitmap, x * s, y * s, w * s, h * s, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  } catch {
    return undefined;
  }
}

async function onRest(r: RestReport, tab: chrome.tabs.Tab | undefined): Promise<{ n?: number; isNew?: boolean }> {
  if (!cue || r.cueId !== cue.id || tab?.id === undefined) return {};
  const key = `${tab.id}|${r.key}`;
  const seen = cue.keys.get(key);
  if (seen) return { n: seen, isNew: false };
  const c = cue;
  const n = ++c.n;
  c.keys.set(key, n);
  const at = Date.now() - c.startedAt;
  // Answer the page first so the pin appears at once; the screenshot follows.
  void (async () => {
    const screenshot = await cropAround(tab.windowId, r);
    send({
      type: 'event',
      event: {
        kind: 'anchor',
        cueId: c.id,
        anchor: {
          n,
          at,
          source: 'chrome',
          url: r.url,
          title: r.title,
          tabId: tab.id,
          laneId: laneByTab(tab.id)?.laneId,
          point: r.point,
          rect: r.rect,
          target: r.target,
          screenshot,
        },
      },
    });
  })();
  return { n, isNew: true };
}

chrome.runtime.onMessage.addListener((msg: ToWorker, sender, reply) => {
  if (msg.kind === 'recording?') {
    reply(!!rehearsal);
    return false;
  }
  if (msg.kind === 'recorded') {
    // Only the person's own tabs are recorded, never lane windows.
    if (rehearsal && !laneByTab(sender.tab?.id))
      send({
        type: 'event',
        event: { kind: 'recorded', step: { ...msg.step, at: Date.now() - rehearsal.startedAt } as never },
      });
    return false;
  }
  if (msg.kind === 'rest') {
    onRest(msg, sender.tab).then(reply, () => reply({}));
    return true;
  }
  if (msg.kind === 'whoami') {
    ready.then(() => {
      const l = laneByTab(sender.tab?.id);
      reply(l ? { laneId: l.laneId, color: l.color, title: l.title, thinking: l.thinking } : null);
    });
    return true;
  }
  return false;
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  await ready;
  for (const l of [...lanes.values()]) {
    if (l.windowId !== windowId) continue;
    lanes.delete(l.laneId);
    await saveLanes();
    send({ type: 'event', event: { kind: 'laneClosed', laneId: l.laneId } });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.token || changes.port)) {
    ws?.close();
    ws = null;
    void connect();
  }
});

// Wake regularly so a sleeping service worker reconnects to the app.
chrome.alarms.create('baton-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'baton-keepalive') void connect();
});

chrome.runtime.onStartup.addListener(() => void connect());
// Tabs that were open before an install or reload still run the old page script, which can no
// longer reach this worker. Give every open page the new one so pointing works without a refresh.
chrome.runtime.onInstalled.addListener(async () => {
  void connect();
  for (const tab of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })) {
    if (tab.id !== undefined)
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => undefined);
  }
});
void connect();
