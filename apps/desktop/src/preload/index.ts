// The only bridge between the Podium renderer and the main process. No secrets cross it.

import { contextBridge, ipcRenderer } from 'electron';

const on = (channel: string) => (fn: (payload: unknown) => void) => {
  const listener = (_e: unknown, payload: unknown) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const api = {
  init: () => ipcRenderer.invoke('podium:init'),
  resize: (height: number) => ipcRenderer.invoke('podium:resize', height),
  answerCard: (id: number, answer: unknown) => ipcRenderer.invoke('card:answer', id, answer),
  stopAll: () => ipcRenderer.invoke('lanes:stopAll'),
  saveProfile: (p: unknown) => ipcRenderer.invoke('profile:save', p),
  getBudget: () => ipcRenderer.invoke('budget:get'),
  // The conductor's hand: one small message per camera frame (a pose and a fingertip), never images.
  handFrame: (f: {
    pose: string;
    tip: { x: number; y: number } | null;
    wrist: { x: number; y: number } | null;
    t: number;
    fps: number;
    delegate: string;
    cameraFps: number;
  }) => ipcRenderer.send('hand:frame', f),
  setCamera: (on: boolean) => ipcRenderer.invoke('hand:camera', on),
  calibrateHand: () => ipcRenderer.invoke('hand:calibrate'),
  checkHandAccuracy: () => ipcRenderer.invoke('hand:accuracy'),
  testGestures: () => ipcRenderer.invoke('hand:gestures'),
  onHand: on('hand'),
  // Voice that feels alive: the model's reasoning as one line, sounds, and live caption counts.
  onThinking: on('thinking'),
  onSound: on('sound'),
  captionStats: (updates: number) => ipcRenderer.send('caption:stats', updates),
  // Status lines for the event log (never audio, text from the screen, or secrets).
  logStatus: (line: string) => ipcRenderer.send('renderer:status', String(line).slice(0, 200)),
  onOverlay: on('overlay'),
  listNotes: () => ipcRenderer.invoke('notes:list'),
  removeNote: (id: number) => ipcRenderer.invoke('notes:remove', id),
  onAnchors: on('anchors'),
  onSpeak: on('speak'),
  listScores: () => ipcRenderer.invoke('score:list'),
  getScore: (runId: string) => ipcRenderer.invoke('score:get', runId),
  openScore: (runId?: string) => ipcRenderer.invoke('score:open', runId),
  onLanes: on('lanes'),
  onCards: on('cards'),
  copyToken: () => ipcRenderer.invoke('pairing:copy'),
  runSelfTest: () => ipcRenderer.invoke('selftest:run'),
  sendCue: (wav: Uint8Array, seconds: number) => ipcRenderer.invoke('cue:audio', wav, seconds),
  setTalkKey: (key: string) => ipcRenderer.invoke('settings:talkKey', key),
  reportMic: (openMs: number | null, seconds: number, timing: string) =>
    ipcRenderer.send('mic:timing', openMs, seconds, timing),
  onTalkKey: on('talkKey'),
  onExtension: on('extension'),
  onPtt: on('ptt'),
  onCue: on('cue'),
  onNotice: on('podium:notice'),
  onShowPairing: on('podium:showPairing'),
  onReset: on('podium:reset'),
};

contextBridge.exposeInMainWorld('baton', api);
export type BatonApi = typeof api;
