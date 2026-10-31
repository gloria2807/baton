// The conductor's hand, in the main process. The Podium tracks the hand from the camera and sends
// only a pose and a fingertip position per frame (camera frames never leave the renderer, and are
// never sent to the model). Here the fingertip is mapped to the screen with the person's
// calibration, smoothed with a One Euro filter, drawn as a brass ring in a click-through overlay
// window, and turned into gestures: pinch to pin (or select a lane), open palm to stop everyone,
// two fingers to talk. No gesture can approve anything.

import { BrowserWindow, screen } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Calibration,
  GestureTracker,
  OneEuro2D,
  GESTURE_HOLD_MS,
  applyHomography,
  cornerTargets,
  errors,
  fitHomography,
  gridTargets,
  type GestureEvent,
  type Pose,
  type Pt,
} from '@baton/core';
import { log } from './log';
import { dataDir, outDir } from './paths';

export interface HandFrame {
  pose: Pose;
  tip: Pt | null; // the pointing point (index knuckle), 0..1 in the camera image
  wrist: Pt | null;
  t: number;
  fps: number;
  delegate: string;
  cameraFps: number;
}

export interface HandDeps {
  preload: string;
  overlayHtml: string;
  // A pinch in live mode: pin what is under this screen point.
  pin(p: Pt): Promise<{ n: number | null; laneId?: string }>;
  stopAll(): void;
  talk(edge: 'start' | 'end', heldMs: number): void;
  notice(text: string): void;
  status(s: HandStatus): void;
}

export type HandMode =
  | { kind: 'live' }
  | { kind: 'calibrate'; step: number; samples: Pt[] }
  | { kind: 'accuracy'; step: number; landed: Pt[] }
  | {
      kind: 'gestures';
      plan: Trial[];
      step: number;
      results: TrialResult[];
      trialStart: number;
      falseStops: number;
      freeUntil?: number;
    };

type TrialKind = 'point' | 'pinch' | 'select-lane' | 'stop' | 'talk';
interface Trial {
  kind: TrialKind;
  n: number;
}
interface TrialResult {
  kind: TrialKind;
  ok: boolean;
}

export interface HandStatus {
  camera: boolean;
  calibrated: boolean;
  mode: HandMode['kind'];
  message: string;
}

const TRIAL_MS = 4000;
const FREE_MS = 120_000;
const calFile = () => join(dataDir(), 'hand-calibration.json');

export class HandController {
  private overlay: BrowserWindow | null = null;
  private calibration: Calibration | null = null;
  private filter = new OneEuro2D(1.0, 0.02);
  private tracker = new GestureTracker();
  private history: Array<{ t: number; cam: Pt; screen: Pt | null }> = [];
  private mode: HandMode = { kind: 'live' };
  private camera = false;
  private talkingSince = 0;
  private sawPose = new Set<Pose>();
  private trialTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private deps: HandDeps) {
    try {
      if (existsSync(calFile())) this.calibration = Calibration.parse(JSON.parse(readFileSync(calFile(), 'utf8')));
    } catch {
      this.calibration = null;
    }
  }

  private display() {
    return screen.getPrimaryDisplay().bounds;
  }

  private ensureOverlay() {
    if (this.overlay && !this.overlay.isDestroyed()) return this.overlay;
    const b = this.display();
    const w = new BrowserWindow({
      ...b,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: { preload: this.deps.preload, contextIsolation: true, sandbox: true },
    });
    w.setIgnoreMouseEvents(true); // click-through: the overlay never takes a click
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setVisibleOnAllWorkspaces(true);
    w.loadFile(this.deps.overlayHtml);
    w.once('ready-to-show', () => w.showInactive());
    this.overlay = w;
    return w;
  }

  private draw(payload: Record<string, unknown>) {
    const w = this.overlay;
    if (w && !w.isDestroyed()) w.webContents.send('overlay', payload);
  }

  private status(message = '') {
    this.deps.status({ camera: this.camera, calibrated: !!this.calibration, mode: this.mode.kind, message });
  }

  setCamera(on: boolean) {
    this.camera = on;
    if (on) this.ensureOverlay();
    else {
      this.overlay?.destroy();
      this.overlay = null;
      this.mode = { kind: 'live' };
      this.filter.reset();
      if (this.tracker.isTalking) this.deps.talk('end', Date.now() - this.talkingSince);
      this.tracker = new GestureTracker();
    }
    log(`camera ${on ? 'on' : 'off'}`);
    this.status(
      on ? (this.calibration ? 'Point with your index finger.' : 'Calibrate once: point at four targets.') : '',
    );
  }

  // ── Frames from the Podium ──
  private frames = 0;

  frame(f: HandFrame) {
    if (!this.camera) return;
    if (++this.frames === 1 || this.frames % 900 === 0)
      log(
        `hand tracking: ${this.frames} frames, pose ${f.pose}, ${f.fps} fps on ${f.delegate || '?'} (camera ${f.cameraFps} fps)`,
      );
    this.sawPose.add(f.pose);
    let screenPt: Pt | null = null;
    if (f.tip) {
      if (this.calibration) {
        const raw = applyHomography(this.calibration.h, f.tip);
        // Freeze the pointer while pinching: closing the fingers moves the fingertip.
        const p = f.pose === 'pinch' ? (this.history.at(-1)?.screen ?? raw) : this.filter.filter(raw, f.t);
        const b = this.display();
        screenPt = {
          x: Math.min(b.x + b.width - 1, Math.max(b.x, p.x)),
          y: Math.min(b.y + b.height - 1, Math.max(b.y, p.y)),
        };
      }
      this.history.push({ t: f.t, cam: f.tip, screen: screenPt });
      if (this.history.length > 90) this.history.shift();
    }
    this.draw({ pointer: screenPt && this.toOverlay(screenPt), pose: f.pose });
    for (const e of this.tracker.update(f.pose, f.t, f.wrist ?? undefined)) void this.gesture(e, f.t);
    if (this.mode.kind === 'gestures') this.watchTrial(f);
  }

  private toOverlay(p: Pt): Pt {
    const b = this.display();
    return { x: p.x - b.x, y: p.y - b.y };
  }

  // Where the hand was pointing just before the pinch: the median over the preceding half second,
  // which steadies a hand held up in the air better than any single frame.
  private before(t: number): { cam: Pt; screen: Pt | null } | null {
    const from = t - GESTURE_HOLD_MS.pinch - 500;
    const to = t - GESTURE_HOLD_MS.pinch;
    let span = this.history.filter((h) => h.t >= from && h.t <= to);
    if (!span.length) span = this.history.slice(-5);
    if (!span.length) return null;
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const cam = { x: median(span.map((h) => h.cam.x)), y: median(span.map((h) => h.cam.y)) };
    const screens = span.map((h) => h.screen).filter((p): p is Pt => !!p);
    const screen = screens.length ? { x: median(screens.map((p) => p.x)), y: median(screens.map((p) => p.y)) } : null;
    return { cam, screen };
  }

  private async gesture(e: GestureEvent, t: number) {
    const m = this.mode;
    if (m.kind === 'gestures') return this.trialEvent(e, t);
    if (e.type === 'pinch') {
      const at = this.before(t);
      if (!at) return;
      if (m.kind === 'calibrate') return this.calibrateSample(at.cam);
      if (m.kind === 'accuracy') return at.screen && this.accuracySample(at.screen);
      if (!at.screen) return this.status('Calibrate first: point at four targets.');
      this.draw({ pulse: this.toOverlay(at.screen) });
      const r = await this.deps.pin(at.screen);
      if (r.laneId) this.deps.notice(`Lane selected. Hold two fingers up and say what it should do.`);
      return;
    }
    if (m.kind !== 'live') return;
    if (e.type === 'stop') {
      log('hand: open palm, everyone stop');
      this.deps.stopAll();
      this.deps.notice('Everyone stop (open palm)');
    } else if (e.type === 'talk-start') {
      this.talkingSince = t;
      this.deps.talk('start', 0);
    } else if (e.type === 'talk-end') {
      this.deps.talk('end', t - this.talkingSince);
    }
  }

  // ── Calibration: four corners ──
  startCalibration() {
    this.mode = { kind: 'calibrate', step: 0, samples: [] };
    this.showTarget(cornerTargets(this.display())[0]!, 'Point at the ring and pinch (1 of 4)');
    this.status('Calibrating: point at each ring and pinch.');
  }

  private showTarget(p: Pt, label: string) {
    this.draw({ target: this.toOverlay(p), label });
  }

  private calibrateSample(cam: Pt) {
    const m = this.mode;
    if (m.kind !== 'calibrate') return;
    m.samples.push(cam);
    const targets = cornerTargets(this.display());
    if (m.samples.length < targets.length) {
      this.showTarget(targets[m.samples.length]!, `Point at the ring and pinch (${m.samples.length + 1} of 4)`);
      return;
    }
    const h = fitHomography(m.samples, targets);
    if (!h) {
      this.status('Those four points did not fit; try again, holding your hand steady.');
      return this.startCalibration();
    }
    this.calibration = { h, screen: this.display(), at: new Date().toISOString() };
    writeFileSync(calFile(), JSON.stringify(this.calibration, null, 2));
    this.filter.reset();
    log('hand calibrated');
    this.mode = { kind: 'live' };
    this.draw({ target: null, label: 'Calibrated' });
    this.status('Calibrated. Use "Check accuracy" to measure it.');
  }

  // ── Accuracy check: nine targets ──
  startAccuracy() {
    if (!this.calibration) return this.status('Calibrate first.');
    this.mode = { kind: 'accuracy', step: 0, landed: [] };
    this.showTarget(gridTargets(this.display())[0]!, 'Point at the ring and pinch (1 of 9)');
    this.status('Accuracy check: point at each ring and pinch.');
  }

  private accuracySample(p: Pt) {
    const m = this.mode;
    if (m.kind !== 'accuracy') return;
    m.landed.push(p);
    const targets = gridTargets(this.display());
    if (m.landed.length < targets.length) {
      this.showTarget(targets[m.landed.length]!, `Point at the ring and pinch (${m.landed.length + 1} of 9)`);
      return;
    }
    const errs = errors(targets, m.landed);
    const within = errs.filter((e) => e <= 40).length;
    const record = {
      at: new Date().toISOString(),
      screen: this.display(),
      targets,
      landed: m.landed.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
      errorsPx: errs,
      within40: within,
    };
    mkdirSync(outDir('hand'), { recursive: true });
    writeFileSync(join(outDir('hand'), `accuracy-${Date.now()}.json`), JSON.stringify(record, null, 2));
    log(
      `HAND_ACCURACY errors ${errs.join(', ')} px; ${within} of 9 within 40 px; median ${[...errs].sort((a, b) => a - b)[4]} px`,
    );
    this.mode = { kind: 'live' };
    this.draw({ target: null, label: `${within} of 9 within 40 px` });
    this.status(`Accuracy: ${within} of 9 targets within 40 px (errors ${errs.join(', ')} px).`);
  }

  // ── Gesture test: ten tries of each gesture, then two minutes of normal use ──
  startGestureTest(laneOpen: boolean) {
    const kinds: TrialKind[] = ['point', 'pinch', ...(laneOpen ? (['select-lane'] as const) : []), 'stop', 'talk'];
    const plan = kinds.flatMap((kind) => Array.from({ length: 10 }, (_, i) => ({ kind, n: i + 1 })));
    this.mode = { kind: 'gestures', plan, step: 0, results: [], trialStart: Date.now(), falseStops: 0 };
    this.nextTrial();
  }

  private static LABEL: Record<TrialKind, string> = {
    point: 'Point with your index finger',
    pinch: 'Pinch your thumb and index finger',
    'select-lane': 'Point at the lane window and pinch',
    stop: 'Show an open palm and hold it',
    talk: 'Hold two fingers up (index and middle), then lower them',
  };

  private nextTrial() {
    const m = this.mode;
    if (m.kind !== 'gestures') return;
    if (this.trialTimer) clearTimeout(this.trialTimer);
    if (m.step >= m.plan.length) return this.startFree();
    const tr = m.plan[m.step]!;
    this.sawPose.clear();
    m.trialStart = Date.now();
    // A short pause between tries: relax the hand.
    this.draw({ target: null, label: `${HandController.LABEL[tr.kind]} (${tr.n} of 10)` });
    this.status(`Gesture test: ${HandController.LABEL[tr.kind]} (${tr.n} of 10)`);
    this.trialTimer = setTimeout(() => this.endTrial(false), TRIAL_MS);
  }

  private endTrial(ok: boolean) {
    const m = this.mode;
    if (m.kind !== 'gestures' || m.freeUntil) return;
    if (this.trialTimer) clearTimeout(this.trialTimer);
    m.results.push({ kind: m.plan[m.step]!.kind, ok });
    m.step++;
    this.draw({ label: ok ? 'Recognised' : 'Not recognised' });
    this.trialTimer = setTimeout(() => this.nextTrial(), 900);
  }

  private watchTrial(f: HandFrame) {
    const m = this.mode;
    if (m.kind !== 'gestures' || m.freeUntil) return;
    const tr = m.plan[m.step];
    if (tr?.kind === 'point' && f.pose === 'point' && Date.now() - m.trialStart > 300) this.endTrial(true);
  }

  private async trialEvent(e: GestureEvent, t: number) {
    const m = this.mode;
    if (m.kind !== 'gestures') return;
    if (m.freeUntil) {
      if (e.type === 'stop') {
        m.falseStops++;
        log('HAND_FREE false everyone-stop');
      }
      return;
    }
    const tr = m.plan[m.step];
    if (!tr) return;
    if (tr.kind === 'pinch' && e.type === 'pinch') this.endTrial(true);
    else if (tr.kind === 'stop' && e.type === 'stop') this.endTrial(true);
    else if (tr.kind === 'talk' && e.type === 'talk-end') this.endTrial(true);
    else if (tr.kind === 'select-lane' && e.type === 'pinch') {
      const at = this.before(t);
      const r = at?.screen ? await this.deps.pin(at.screen) : { n: null };
      this.endTrial(!!r.laneId);
    }
  }

  private startFree() {
    const m = this.mode;
    if (m.kind !== 'gestures') return;
    m.freeUntil = Date.now() + FREE_MS;
    this.draw({
      target: null,
      label: 'Now two minutes of normal use: talk, point and pinch as usual; do not show an open palm.',
    });
    this.status('Two minutes of normal talking and pointing: counting false "everyone stop".');
    this.trialTimer = setTimeout(() => this.finishGestureTest(), FREE_MS);
  }

  private finishGestureTest() {
    const m = this.mode;
    if (m.kind !== 'gestures') return;
    const kinds = [...new Set(m.results.map((r) => r.kind))];
    const summary = Object.fromEntries(
      kinds.map((k) => [
        k,
        `${m.results.filter((r) => r.kind === k && r.ok).length}/${m.results.filter((r) => r.kind === k).length}`,
      ]),
    );
    const record = { at: new Date().toISOString(), summary, falseStopsIn2Min: m.falseStops, results: m.results };
    writeFileSync(join(outDir('hand'), `gestures-${Date.now()}.json`), JSON.stringify(record, null, 2));
    log(`HAND_GESTURES ${JSON.stringify(summary)}; false everyone-stop in 2 min: ${m.falseStops}`);
    this.mode = { kind: 'live' };
    this.draw({ label: 'Gesture test done' });
    this.status(
      `Gestures: ${Object.entries(summary)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}; false stops: ${m.falseStops}.`,
    );
  }
}
