// Baton's main process: tray, Podium window, bridge to the extension, push-to-talk and the
// model client. The Baseten key is read here and never leaves this process.

import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, powerMonitor, screen, session, Tray } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LookResult, TALK_KEYS, isTalkKeyId, type Anchor, type TalkKeyId } from '@baton/core';
import { Model } from '@baton/model';
import { runBench } from './bench';
import { BridgeServer } from './bridge-server';
import { Conductor, type CardAnswer } from './conductor';
import { CueSession } from './cue';
import { log } from './log';
import { loadEnv, loadPairingToken, outDir } from './paths';
import { PushToTalk } from './ptt';
import { laneSelfTest } from './selftest';
import { loadProfile, saveProfile } from './profile-store';
import { loadSettings, saveSettings } from './settings';

export type ExtensionState = 'connected' | 'waiting';

export interface CueUpdate {
  phase: 'saved' | 'heard' | 'error';
  seconds?: number;
  file?: string;
  transcript?: string;
  intent?: string;
  ms?: number;
  error?: string;
}

const PODIUM = { width: 680, collapsed: 92, max: 760 };

let podium: BrowserWindow | null = null;
let tray: Tray | null = null;
let bridge: BridgeServer;
let model: Model | null = null;
let conductor: Conductor;
let profile = loadProfile();
// The cue being spoken now, and the one whose audio is on its way to the model.
let cueSession: CueSession | null = null;
let spokenCue: { id: string; heldMs: number; anchors: Promise<Anchor[]> } | null = null;
const token = loadPairingToken();
const settings = loadSettings();
const ptt = new PushToTalk(settings.talkKey);

const talkKeyOptions = () => Object.entries(TALK_KEYS).map(([id, k]) => ({ id, label: k.label }));

function setTalkKey(key: TalkKeyId) {
  if (key === settings.talkKey) return;
  settings.talkKey = key;
  saveSettings(settings);
  ptt.setKey(key);
  send('talkKey', key);
  refreshTray();
}

// A second launch only hands its flags to the running Baton (see 'second-instance'), then exits.
if (!app.requestSingleInstanceLock()) app.exit(0);

function send(channel: string, payload: unknown) {
  podium?.webContents.send(channel, payload);
}

function createPodium() {
  const { workArea } = screen.getPrimaryDisplay();
  podium = new BrowserWindow({
    width: PODIUM.width,
    height: PODIUM.collapsed,
    x: Math.round(workArea.x + (workArea.width - PODIUM.width) / 2),
    y: workArea.y + 20,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    // The Podium resumes its audio graph from a global key press, which is not a page gesture.
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  podium.setAlwaysOnTop(true, 'screen-saver');
  podium.setVisibleOnAllWorkspaces(true);
  podium.loadFile(join(__dirname, 'renderer', 'index.html'));
  podium.once('ready-to-show', () => podium?.showInactive());
}

// Tray icon drawn in code: a dark tile with four lane-coloured dots.
function trayIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const lanes = [[246, 130, 59], [94, 197, 34], [22, 115, 249], [247, 85, 168]]; // BGR order
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const r = 7;
      const cx = Math.min(Math.max(x + 0.5, r), size - r);
      const cy = Math.min(Math.max(y + 0.5, r), size - r);
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
      buf.set([30, 19, 16, 255], i);
      lanes.forEach(([b, g, rr], k) => {
        const dx = size * (k % 2 ? 0.66 : 0.34);
        const dy = size * (k < 2 ? 0.34 : 0.66);
        if (Math.hypot(x + 0.5 - dx, y + 0.5 - dy) <= 4.5) buf.set([b!, g!, rr!, 255], i);
      });
    }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function refreshTray() {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: bridge.connected ? 'Chrome extension: connected' : 'Chrome extension: not connected', enabled: false },
      { type: 'separator' },
      { label: 'Show Podium', click: () => podium?.showInactive() },
      {
        label: 'Talk key',
        submenu: talkKeyOptions().map((o) => ({ label: o.label, type: 'radio' as const, checked: o.id === settings.talkKey, click: () => setTalkKey(o.id as TalkKeyId) })),
      },
      { label: 'Pairing token', click: () => send('podium:showPairing', null) },
      { label: 'Copy pairing token', click: () => clipboard.writeText(token) },
      { label: 'Run lane self-test', click: () => void runSelfTest() },
      { type: 'separator' },
      { label: 'Quit Baton', click: () => app.quit() },
    ]),
  );
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Baton');
  refreshTray();
  bridge.on('paired', refreshTray);
  bridge.on('unpaired', refreshTray);
}

async function runSelfTest() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(1280, workArea.width - 80);
  const height = Math.min(860, workArea.height - 160);
  const bounds = { left: Math.round(workArea.x + (workArea.width - width) / 2), top: workArea.y + 130, width, height };
  const result = await laneSelfTest(bridge, bounds);
  log(`SELFTEST_RESULT ${JSON.stringify(result)}`);
  send('podium:notice', result.ok ? 'Lane self-test passed' : `Lane self-test failed: ${result.error}`);
  return result;
}

function extensionState(): ExtensionState {
  return bridge.connected ? 'connected' : 'waiting';
}

async function handleCue(wav: Uint8Array, seconds: number) {
  const file = join(outDir('recordings'), `cue-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`);
  writeFileSync(file, wav);
  log(`cue saved: ${seconds.toFixed(2)} s of speech`);
  send('cue', { phase: 'saved', seconds, file } satisfies CueUpdate);
  if (!model) {
    send('cue', { phase: 'error', error: 'No Baseten key: recording saved, not transcribed.' } satisfies CueUpdate);
    return;
  }
  try {
    const r = await model.transcribeCue(wav);
    log(`cue heard in ${Math.round(r.ms)} ms`);
    send('cue', { phase: 'heard', transcript: r.value.transcript, intent: r.value.intent, ms: Math.round(r.ms), file } satisfies CueUpdate);
    const said = r.value.transcript.trim();
    const cue = spokenCue;
    spokenCue = null;
    // A waiting card (approval, question) takes the answer; otherwise the cue is interpreted.
    const anchors = cue ? await cue.anchors : [];
    if (said && !conductor.answerByVoice(said, anchors.length > 0))
      void conductor.fromCue({ id: cue?.id ?? `cue-${Date.now().toString(36)}`, transcript: said, intent: r.value.intent, anchors, heldMs: cue?.heldMs ?? seconds * 1000 });
  } catch (e) {
    send('cue', { phase: 'error', error: (e as Error).message, file } satisfies CueUpdate);
  }
}

app.whenReady().then(async () => {
  loadEnv();
  try {
    model = new Model(process.env.BASETEN_API_KEY ?? '');
  } catch {
    log('BASETEN_API_KEY missing: cues will be recorded but not understood');
  }

  // The Podium needs the microphone; nothing else may ask for permissions.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  bridge = new BridgeServer(token);
  try {
    await bridge.start();
  } catch (e) {
    log(`bridge could not start: ${(e as Error).message}. Is another Baton running?`);
  }
  bridge.on('paired', () => send('extension', 'connected' satisfies ExtensionState));
  bridge.on('unpaired', () => send('extension', 'waiting' satisfies ExtensionState));
  conductor = new Conductor(bridge, () => model, send, () => profile);
  bridge.on('laneEvent', (e) => {
    if (e.kind === 'anchor') cueSession?.addChrome(e.cueId, e.anchor);
  });

  ipcMain.handle('podium:init', () => ({ extension: extensionState(), token, hasModel: !!model, talkKey: settings.talkKey, talkKeys: talkKeyOptions(), profile }));
  ipcMain.handle('profile:save', (_e, p: unknown) => (profile = saveProfile(p)));
  ipcMain.handle('settings:talkKey', (_e, key: unknown) => {
    if (isTalkKeyId(key)) setTalkKey(key);
    return settings.talkKey;
  });
  // The Podium grows to fit its cards; the renderer reports its content height.
  ipcMain.handle('podium:resize', (_e, height: unknown) => {
    if (!podium || typeof height !== 'number') return;
    const [x, y] = podium.getPosition() as [number, number];
    podium.setBounds({ x, y, width: PODIUM.width, height: Math.round(Math.min(PODIUM.max, Math.max(PODIUM.collapsed, height))) });
  });
  ipcMain.handle('card:answer', (_e, id: unknown, answer: unknown) => {
    if (typeof id === 'number' && answer && typeof answer === 'object') conductor.answer(id, answer as CardAnswer);
  });
  ipcMain.handle('lanes:stopAll', () => conductor.stopAll());
  ipcMain.handle('pairing:copy', () => clipboard.writeText(token));
  ipcMain.on('mic:timing', (_e, openMs: unknown, seconds: unknown, timing: unknown) => {
    if (typeof seconds === 'number')
      log(`microphone: first audio ${typeof openMs === 'number' ? `${openMs} ms` : 'never'} after start (${String(timing).slice(0, 80)}), ${seconds.toFixed(2)} s recorded`);
  });
  ipcMain.handle('selftest:run', () => runSelfTest());
  ipcMain.handle('cue:audio', (_e, wav: Uint8Array, seconds: number) => void handleCue(wav, seconds));

  createPodium();
  createTray();

  ptt.on('ptt', (e) => {
    send('ptt', e);
    // Anchors are collected while the key is held; they travel with the cue's audio.
    if (e.type === 'start') {
      cueSession = new CueSession(bridge, () => podium, (list) => send('anchors', list));
      send('anchors', []);
    } else if (cueSession) {
      const s = cueSession;
      cueSession = null;
      if (e.type === 'commit') spokenCue = { id: s.id, heldMs: e.heldMs, anchors: s.end(true) };
      else void s.end(false).then(() => send('anchors', []));
    }
  });
  try {
    ptt.start();
  } catch (e) {
    log(`push-to-talk unavailable: ${(e as Error).message}`);
  }
  // A keyup can be lost across a lock screen or sleep; never leave the microphone open.
  powerMonitor.on('lock-screen', () => ptt.release());
  powerMonitor.on('suspend', () => ptt.release());
  app.on('will-quit', () => {
    ptt.stop();
    bridge.stop();
  });

  handleArgs(process.argv);
  // Running `electron . --task=…` again hands its flags to this instance instead of starting a second Baton.
  app.on('second-instance', (_e, argv) => handleArgs(argv));
});

// Development and gate-check flags.
function handleArgs(argv: string[]) {
  const arg = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const whenPaired = (fn: () => Promise<unknown>, label: string) =>
    bridge
      .waitForPairing(10 * 60 * 1000)
      .then(fn)
      .catch((e) => log(`${label} failed: ${(e as Error).message}`));

  if (argv.includes('--selftest')) {
    log('self-test: waiting for the Chrome extension to connect');
    void whenPaired(runSelfTest, 'SELFTEST');
  }

  // --probe=<url>: type into the first text field of a page and report what the field holds.
  const probe = arg('probe');
  if (probe)
    void whenPaired(async () => {
      await bridge.request({ op: 'openLane', laneId: 'probe', url: probe, color: '#eab308', title: 'Probe', bounds: conductor.laneBounds() }, 30000);
      const look = async () => LookResult.parse(await bridge.request({ op: 'look', laneId: 'probe', screenshot: false }, 30000));
      const field = (await look()).elements.find((e) => e.role === 'textbox' && !e.blocked);
      if (!field) return log('PROBE no text field');
      const typed = await bridge.request({ op: 'type', laneId: 'probe', mark: field.mark, text: 'Ama Owusu', submit: false }, 20000).catch((e) => `error ${(e as Error).message}`);
      const after = (await look()).elements.find((e) => e.name === field.name);
      log(`PROBE field “${field.name}” (autocomplete hints: ${field.hints ?? '-'}) type → ${JSON.stringify(typed)}; now holds “${after?.value ?? '?'}”`);
    }, 'PROBE');

  // Pick up a rebuilt extension.
  if (argv.includes('--reload-extension')) void whenPaired(() => bridge.request({ op: 'reloadExtension' }), 'reload-extension');

  // --task="goal" --url=https://… runs one supervised lane, for gate checks without speaking.
  const task = arg('task');
  if (task)
    void whenPaired(
      () =>
        conductor
          .runOne({ name: arg('name') ?? 'Blue', goal: task, startUrl: arg('url') ?? 'https://www.google.com/' })
          .then((out) => log(`TASK_RESULT ${JSON.stringify({ status: out.status, result: out.result, steps: out.steps, ms: out.ms, receipts: out.receipts })}`)),
      'TASK',
    );

  // --bench or --bench=id,id runs the benchmark unattended (no approvals beyond each task's own).
  const bench = argv.find((a) => a === '--bench' || a.startsWith('--bench='));
  if (bench)
    void whenPaired(
      () => (model ? runBench(bridge, model, conductor, bench.includes('=') ? bench.split('=')[1]!.split(',') : undefined) : Promise.reject(new Error('no Baseten key'))),
      'BENCH',
    );
}

// The Podium lives in the tray; closing windows does not quit Baton.
app.on('window-all-closed', () => undefined);
