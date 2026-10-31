// One cue: from the talk key going down to the answer. Collects anchors from Chrome (via the
// extension) and, where the pointer rests outside Chrome, a screenshot around it.

import { BrowserWindow, desktopCapturer, screen } from 'electron';
import { uIOhook } from 'uiohook-napi';
import { describeAnchor, type Anchor } from '@baton/core';
import type { BridgeServer } from './bridge-server';
import { log } from './log';

const REST_MS = 300;
// How long to wait for Chrome to report the same rest before treating it as a desktop anchor.
const CHROME_GRACE_MS = 450;

export class CueSession {
  readonly id = `cue-${Date.now().toString(36)}`;
  readonly startedAt = Date.now();
  private anchors: Anchor[] = [];
  private restTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRest: { x: number; y: number } | null = null;
  private pending = 0;
  private ended = false;
  private readonly onMove = () => this.moved();

  constructor(
    private bridge: BridgeServer,
    private podium: () => BrowserWindow | null,
    private onAnchors: (list: Array<{ n: number; label: string; source: string }>) => void,
  ) {
    if (bridge.connected)
      bridge.request({ op: 'cueStart', cueId: this.id }, 3000).catch((e) => log(`cueStart: ${(e as Error).message}`));
    uIOhook.on('mousemove', this.onMove);
    this.moved(); // the person may already be pointing
  }

  // Anchor events from the extension.
  addChrome(cueId: string, anchor: Anchor) {
    if (cueId !== this.id || this.ended) return;
    this.anchors.push(anchor);
    this.publish();
  }

  private publish() {
    this.onAnchors(this.sorted().map((a) => ({ n: a.n, label: describeAnchor(a), source: a.source })));
  }

  private sorted(): Anchor[] {
    return [...this.anchors].sort((a, b) => a.at - b.at);
  }

  private moved() {
    if (this.ended) return;
    if (this.restTimer) clearTimeout(this.restTimer);
    this.restTimer = setTimeout(() => void this.rested(), REST_MS);
  }

  private async rested() {
    const p = screen.getCursorScreenPoint();
    if (this.lastRest && Math.hypot(p.x - this.lastRest.x, p.y - this.lastRest.y) < 12) return;
    this.lastRest = p;
    // Pointing at the Podium itself is not pointing at anything.
    const b = this.podium()?.getBounds();
    if (b && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) return;
    const restAt = Date.now() - this.startedAt;
    this.pending++;
    try {
      await new Promise((r) => setTimeout(r, CHROME_GRACE_MS));
      // Chrome saw this rest (the pointer is over a web page): nothing more to do.
      if (this.anchors.some((a) => a.source === 'chrome' && Math.abs(a.at - restAt) < CHROME_GRACE_MS + 200)) return;
      if (this.ended) return;
      const shot = await this.desktopShot(p);
      if (!shot || this.ended) return;
      const n = Math.max(0, ...this.anchors.map((a) => a.n)) + 1;
      this.anchors.push({ n, at: restAt, source: 'desktop', point: p, screenshot: shot });
      log(`desktop anchor ${n}`);
      this.publish();
    } finally {
      this.pending--;
    }
  }

  // A crop of the screen centred on the pointer (read-only questions about things outside Chrome).
  private async desktopShot(p: { x: number; y: number }): Promise<string | undefined> {
    try {
      const display = screen.getDisplayNearestPoint(p);
      const { width, height } = display.size;
      const scale = display.scaleFactor;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
      });
      const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
      if (!source) return undefined;
      const w = Math.min(1100, width);
      const h = Math.min(700, height);
      const x = Math.min(Math.max(0, p.x - display.bounds.x - w / 2), width - w);
      const y = Math.min(Math.max(0, p.y - display.bounds.y - h / 2), height - h);
      const crop = source.thumbnail.crop({
        x: Math.round(x * scale),
        y: Math.round(y * scale),
        width: Math.round(w * scale),
        height: Math.round(h * scale),
      });
      return crop
        .resize({ width: Math.min(1100, crop.getSize().width) })
        .toJPEG(80)
        .toString('base64');
    } catch (e) {
      log(`desktop screenshot failed: ${(e as Error).message}`);
      return undefined;
    }
  }

  // Stop collecting; wait briefly for anchors still on their way. `keep` leaves the pins showing.
  async end(keep: boolean): Promise<Anchor[]> {
    this.ended = true;
    if (this.restTimer) clearTimeout(this.restTimer);
    uIOhook.off('mousemove', this.onMove);
    if (this.bridge.connected)
      await this.bridge.request({ op: 'cueEnd', cueId: this.id, keep }, 3000).catch(() => undefined);
    const until = Date.now() + 1500;
    while (this.pending > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 250)); // last Chrome screenshots
    // Number anchors in the order they were pointed at.
    return this.sorted().map((a, i) => ({ ...a, n: i + 1 }));
  }
}
