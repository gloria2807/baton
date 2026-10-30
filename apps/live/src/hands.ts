// The Live page's side of the hands: a registry of demo-page frames (the visitor's own "home"
// frame and one per lane) and the core loop's Hands, acting through each frame's script.

import { LookResult, type Hands } from '@baton/core';
import type { FrameApi, FrameHost } from './frame-api';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Entry {
  el: HTMLIFrameElement | null;
  win: Window | null;
  ready: boolean;
  // Pages this frame has shown, for its own Back button. Frames on one page share the browser's
  // session history, so history.back() in one lane could undo another lane's navigation.
  trail: string[];
}

type LaneInfo = { laneId: string; color: string; title: string; thinking: string };

class Frames implements FrameHost {
  private entries = new Map<string, Entry>();
  private lanes = new Map<string, LaneInfo>();
  onPointer: (name: string, x: number, y: number) => void = () => undefined;
  onTalkKey: (edge: 'down' | 'up') => void = () => undefined;
  onReady: (name: string) => void = () => undefined;

  private entry(name: string): Entry {
    let e = this.entries.get(name);
    if (!e) this.entries.set(name, (e = { el: null, win: null, ready: false, trail: [] }));
    return e;
  }

  attach(name: string, el: HTMLIFrameElement | null) {
    this.entry(name).el = el;
  }

  element(name: string): HTMLIFrameElement | null {
    return this.entries.get(name)?.el ?? null;
  }

  // ── FrameHost: called by the frame scripts ──
  ready(name: string, win: Window) {
    const e = this.entry(name);
    e.win = win;
    e.ready = true;
    if (e.trail.at(-1) !== win.location.href) e.trail.push(win.location.href);
    // A page load wipes the lane's frame and cursor; draw them again.
    const info = this.lanes.get(name);
    if (info) this.call(name)?.lane(info);
    this.onReady(name);
  }
  leaving(name: string) {
    this.entry(name).ready = false;
  }
  pointer(name: string, x: number, y: number) {
    this.onPointer(name, x, y);
  }
  talkKey(edge: 'down' | 'up') {
    this.onTalkKey(edge);
  }

  // The frame's script, if its page is loaded right now.
  call(name: string): FrameApi | null {
    const e = this.entries.get(name);
    const api = e?.ready ? (e.win as unknown as { __baton?: FrameApi } | null)?.__baton : undefined;
    return api ?? null;
  }

  // Wait until the frame has a loaded page with Baton's script in it.
  async api(name: string, timeoutMs = 15000): Promise<FrameApi> {
    const t0 = Date.now();
    for (;;) {
      const api = this.call(name);
      if (api && this.entries.get(name)!.win!.document.readyState === 'complete') return api;
      // No ready signal (a page restored from the back/forward cache, or a navigation that never
      // happened): after a moment, trust the page the frame actually shows.
      const live = this.entries.get(name)?.el?.contentWindow;
      if (
        Date.now() - t0 > 1500 &&
        live?.document.readyState === 'complete' &&
        (live as unknown as { __baton?: FrameApi }).__baton
      ) {
        this.ready(name, live);
        continue;
      }
      if (Date.now() - t0 > timeoutMs) throw new Error('the page did not finish loading');
      await sleep(40);
    }
  }

  // After an action that may navigate: give the navigation a moment to start, then wait for the page.
  async settle(name: string): Promise<FrameApi> {
    await sleep(180);
    return this.api(name);
  }

  setLane(name: string, info: LaneInfo | null) {
    if (info) this.lanes.set(name, info);
    else this.lanes.delete(name);
    this.call(name)?.lane(info);
  }

  setThinking(name: string, text: string) {
    const info = this.lanes.get(name);
    if (info) info.thinking = text;
    this.call(name)?.thinking(text);
  }

  navigate(name: string, url: string) {
    const e = this.entry(name);
    e.ready = false;
    if (e.win) e.win.location.href = url;
    else if (e.el) e.el.src = url;
  }

  back(name: string) {
    const e = this.entry(name);
    if (e.trail.length < 2) throw new Error('there is no earlier page in this lane to go back to');
    e.trail.pop();
    const to = e.trail.pop()!; // pushed again when it loads
    e.ready = false;
    if (e.win) e.win.location.href = to;
  }

  forget(name: string) {
    this.entries.delete(name);
    this.lanes.delete(name);
  }
}

export const frames = new Frames();
(window as unknown as { __batonHost: FrameHost }).__batonHost = frames;

// Only the demo sites exist in Baton Live; real websites cannot be framed or driven from a web page.
export function liveUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url, location.origin);
  } catch {
    throw new Error(`“${url}” is not a web address`);
  }
  if (u.origin !== location.origin || !u.pathname.startsWith('/sites/'))
    throw new Error(
      `Baton Live can only open its demo sites (${location.origin}/sites/…); ${u.host} is not one of them. Use the desktop app for real websites.`,
    );
  return u.href;
}

export class FrameHands implements Hands {
  constructor(private name: string) {}
  async look() {
    // Lanes in Baton Live read pages as text: no screenshots (cheaper, and the model contract
    // measured text-only steps about four times faster).
    const r = (await frames.api(this.name)).collect();
    return LookResult.parse({
      url: r.url,
      title: r.title,
      viewport: r.viewport,
      scale: 1,
      elements: r.elements,
      text: r.text,
      hidden: r.hidden,
    });
  }
  async open(url: string) {
    frames.navigate(this.name, liveUrl(url));
    await frames.settle(this.name);
  }
  async click(mark: number) {
    await (await frames.api(this.name)).click(mark);
    await frames.settle(this.name);
  }
  async type(mark: number, text: string, submit: boolean) {
    await (await frames.api(this.name)).type(mark, text, submit);
    if (submit) await frames.settle(this.name);
  }
  async select(mark: number, option: string) {
    await (await frames.api(this.name)).select(mark, option);
  }
  async fillCells(mark: number, rows: string[][]) {
    await (await frames.api(this.name)).fillCells(mark, rows);
  }
  async scroll(by: { dy: number } | { mark: number }) {
    await (await frames.api(this.name)).scroll(by);
  }
  async back() {
    frames.back(this.name);
    await frames.settle(this.name);
  }
  async thinking(text: string) {
    frames.setThinking(this.name, text.slice(0, 140));
  }
}
