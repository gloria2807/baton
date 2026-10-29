// Baton's hands: connects to the desktop app over the paired local WebSocket and drives lane
// windows with chrome.debugger (DevTools Protocol) for screenshots, mouse and keyboard.

import { BRIDGE_PORT, PROTOCOL_VERSION, ToExtension, parseFrame, type Command, type FromExtension, type LookResult } from '@baton/core/bridge';
import type { CollectResult, LaneInfo, TargetResult, ToContent, ToWorker } from './messages';

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

async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (retryTimer) clearTimeout(retryTimer);
  const { token, port } = (await chrome.storage.local.get(['token', 'port'])) as { token?: string; port?: number };
  if (!token) return setStatus('unpaired');
  await setStatus('connecting');
  const socket = new WebSocket(`ws://127.0.0.1:${port ?? BRIDGE_PORT}`);
  ws = socket;
  socket.onopen = () => send({ type: 'hello', token, version: PROTOCOL_VERSION, extensionVersion: chrome.runtime.getManifest().version });
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
      if (e instanceof Error && !/Receiving end does not exist|Could not establish connection|message port closed/i.test(e.message)) throw e;
    }
    await sleep(120);
  }
  throw new Error(`lane page did not respond: ${(last as Error)?.message ?? 'timeout'}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForLoad(tabId: number, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await sleep(100);
  }
  throw new Error('page did not finish loading in 15 s');
}

async function cdp<T = unknown>(tabId: number, method: string, params: Record<string, unknown> = {}): Promise<T> {
  try {
    return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
  } catch (e) {
    // The person may have dismissed the debugging bar; attach again and retry once.
    if (/not attached/i.test((e as Error).message)) {
      await attach(tabId);
      return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
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
}

async function mouse(tabId: number, x: number, y: number) {
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
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
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: k.code, windowsVirtualKeyCode: k.vk, text: k.text });
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

    case 'openLane': {
      const existing = lanes.get(c.laneId);
      if (existing) await closeLane(existing);
      const win = await chrome.windows.create({ url: c.url, focused: false, type: 'normal', ...(c.bounds ?? { width: 1280, height: 860 }) });
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

    case 'navigate': {
      const l = lane(c.laneId);
      await chrome.tabs.update(l.tabId, { url: c.url });
      await sleep(100);
      await waitForLoad(l.tabId);
      return true;
    }

    case 'look': {
      const l = lane(c.laneId);
      await waitForLoad(l.tabId);
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
            clip: { x: page.scroll.x, y: page.scroll.y, width: page.viewport.width, height: page.viewport.height, scale: s },
          });
          screenshot = shot.data;
        } finally {
          await toTab(l.tabId, { kind: 'hideMarks' });
          await toTab(l.tabId, { kind: 'cursorVisible', visible: true });
        }
      }
      const result: LookResult = { url: page.url, title: page.title, viewport: page.viewport, scale, screenshot, elements: page.elements, text: page.text };
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
      await waitForLoad(l.tabId);
      return { x: pos.x, y: pos.y, name: pos.name };
    }

    case 'type': {
      const l = lane(c.laneId);
      const pos = await aim(l, { mark: c.mark }, true);
      await toTab(l.tabId, { kind: 'clickPulse' });
      await mouse(l.tabId, pos.x, pos.y);
      // Replace what is there: select all, then insert.
      await cdp(l.tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] });
      await cdp(l.tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
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

    case 'scroll': {
      const l = lane(c.laneId);
      const tab = await chrome.tabs.get(l.tabId);
      const x = Math.round((tab.width ?? 1200) / 2);
      const y = Math.round((tab.height ?? 800) / 2);
      await cdp(l.tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: c.dy });
      await sleep(300);
      return true;
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

chrome.runtime.onMessage.addListener((msg: ToWorker, sender, reply) => {
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
chrome.runtime.onInstalled.addListener(() => void connect());
void connect();
