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
  reportMic: (openMs: number | null, seconds: number, timing: string) => ipcRenderer.send('mic:timing', openMs, seconds, timing),
  onTalkKey: on('talkKey'),
  onExtension: on('extension'),
  onPtt: on('ptt'),
  onCue: on('cue'),
  onNotice: on('podium:notice'),
  onShowPairing: on('podium:showPairing'),
};

contextBridge.exposeInMainWorld('baton', api);
export type BatonApi = typeof api;
