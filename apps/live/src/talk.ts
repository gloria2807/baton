// Push to talk and pointing in Baton Live. Hold Space (or the talk button), rest the pointer on
// things in any demo page, speak, release. The recording goes to Muse Spark Open as padded 16 kHz
// WAV, exactly as in the desktop app; where the pointer rested becomes numbered anchors.

import { cueWav, rms } from '@baton/core/audio';
import type { Anchor } from '@baton/core';
import type { Model } from '@baton/model';
import { Recorder } from '../../desktop/src/renderer/recorder';
import { hush } from '../../desktop/src/renderer/speech';
import { sounds } from '../../desktop/src/renderer/sounds';
import { friendlyError, type Conductor } from './conductor';
import { frames } from './hands';

const REST_MS = 300;
const MOVE_PX = 6;
const MIN_HOLD_MS = 250;

export type Phase =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'listening' }
  | { kind: 'understanding'; seconds: number }
  | { kind: 'heard'; transcript: string }
  | { kind: 'notice'; text: string; tone: 'info' | 'ok' | 'warn' };

// Where a pin is drawn on the Live page (page pixels).
export interface Pin {
  n: number;
  x: number;
  y: number;
  label: string;
}

export interface TalkState {
  phase: Phase;
  pins: Pin[];
  holding: boolean;
}

export class Talk {
  private state: TalkState = { phase: { kind: 'idle' }, pins: [], holding: false };
  private listeners = new Set<() => void>();
  private recorder = new Recorder();
  private downAt = 0;
  private anchors: Anchor[] = [];
  private last: { name: string; x: number; y: number } | null = null;
  private restAt: { name: string; x: number; y: number } | null = null;
  private restTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private model: Model,
    private conductor: Conductor,
  ) {
    frames.onPointer = (name, x, y) => this.pointer(name, x, y);
    frames.onTalkKey = (edge) => (edge === 'down' ? this.down() : void this.up());
    void this.recorder.warm().catch(() => undefined);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  snapshot = () => this.state;
  private set(patch: Partial<TalkState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  level = () => this.recorder.level();

  down() {
    if (this.state.holding) return;
    hush();
    this.downAt = Date.now();
    this.anchors = [];
    this.set({ holding: true, pins: [], phase: { kind: 'opening' } });
    // Already resting on something when the key goes down: that counts.
    if (this.last) this.schedule(this.last);
    this.recorder
      .start(() => {
        sounds.listen();
        this.set({ phase: { kind: 'listening' } });
      })
      .catch((e: Error) =>
        this.set({
          phase: {
            kind: 'notice',
            text: `Microphone unavailable: ${e.message}. Type your request instead.`,
            tone: 'warn',
          },
        }),
      );
  }

  async up() {
    if (!this.state.holding) return;
    const heldMs = Date.now() - this.downAt;
    if (this.restTimer) clearTimeout(this.restTimer);
    this.set({ holding: false });
    sounds.release();
    const rec = await this.recorder.stop();
    if (heldMs < MIN_HOLD_MS || rec.seconds < 0.25 || rms(rec.samples) < 0.004) {
      this.set({
        pins: [],
        phase: {
          kind: 'notice',
          text:
            heldMs < MIN_HOLD_MS || rec.seconds < 0.25 ? 'Hold the key while you speak.' : 'I didn’t hear anything.',
          tone: 'warn',
        },
      });
      return;
    }
    this.set({ phase: { kind: 'understanding', seconds: rec.seconds } });
    try {
      const heard = await this.model.transcribeCue(cueWav(rec.samples, rec.sampleRate));
      if (!heard.value.transcript.trim()) {
        this.set({
          pins: [],
          phase: { kind: 'notice', text: 'I didn’t catch that. Try again, or type it.', tone: 'warn' },
        });
        return;
      }
      sounds.heard();
      this.set({ phase: { kind: 'heard', transcript: heard.value.transcript } });
      await this.conductor.fromCue({
        transcript: heard.value.transcript,
        intent: heard.value.intent,
        anchors: this.anchors,
        heldMs,
      });
    } catch (e) {
      this.set({ phase: { kind: 'notice', text: friendlyError(e), tone: 'warn' } });
    } finally {
      this.set({ pins: [] });
    }
  }

  // A typed request points at what the visitor's own browser shows (the open email, the open page).
  async typed(text: string) {
    hush();
    const anchors: Anchor[] = [];
    const api = frames.call('home');
    const hit = api?.pageAnchor();
    const win = frames.element('home')?.contentWindow;
    if (hit && win)
      anchors.push({
        n: 1,
        at: 0,
        source: 'chrome',
        url: win.location.href,
        title: win.document.title,
        point: { x: hit.rect.x, y: hit.rect.y },
        rect: hit.rect,
        target: hit.target,
      });
    sounds.heard();
    this.set({ phase: { kind: 'heard', transcript: text } });
    await this.conductor.fromCue({ transcript: text, intent: text, anchors, heldMs: 0 });
  }

  private pointer(name: string, x: number, y: number) {
    this.last = { name, x, y };
    if (!this.state.holding) return;
    const r = this.restAt;
    if (r && r.name === name && Math.hypot(r.x - x, r.y - y) < MOVE_PX) return;
    this.schedule({ name, x, y });
  }

  private schedule(at: { name: string; x: number; y: number }) {
    this.restAt = at;
    if (this.restTimer) clearTimeout(this.restTimer);
    this.restTimer = setTimeout(() => this.pin(at), REST_MS);
  }

  private pin(at: { name: string; x: number; y: number }) {
    if (!this.state.holding) return;
    const hit = frames.call(at.name)?.anchorAt(at.x, at.y);
    const el = frames.element(at.name);
    const win = el?.contentWindow;
    if (!hit || !el || !win) return;
    // Resting twice on the same thing is one anchor.
    const prev = this.anchors.at(-1);
    if (
      prev &&
      prev.url === win.location.href &&
      prev.target?.label === hit.target.label &&
      prev.rect?.y === hit.rect.y
    )
      return;
    const n = this.anchors.length + 1;
    this.anchors.push({
      n,
      at: Date.now() - this.downAt,
      source: 'chrome',
      url: win.location.href,
      title: win.document.title,
      laneId: at.name === 'home' ? undefined : at.name,
      point: { x: at.x, y: at.y },
      rect: hit.rect,
      target: hit.target,
    });
    // Lane frames are drawn scaled down; map frame pixels to page pixels.
    const box = el.getBoundingClientRect();
    const scale = box.width / el.offsetWidth || 1;
    this.set({
      pins: [
        ...this.state.pins,
        {
          n,
          x: box.left + at.x * scale,
          y: box.top + at.y * scale,
          label: hit.target.label || hit.target.text.slice(0, 40),
        },
      ],
    });
  }
}
