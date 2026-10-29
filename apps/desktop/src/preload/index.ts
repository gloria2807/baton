// The only bridge between the Podium renderer and the main process. No secrets cross it.

import { contextBridge, ipcRenderer } from 'electron';

const on = (channel: string) => (fn: (payload: unknown) => void) => {
  const listener = (_e: unknown, payload: unknown) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const api = {
  init: () => ipcRenderer.invoke('podium:init'),
  expand: (expanded: boolean) => ipcRenderer.invoke('podium:expand', expanded),
  copyToken: () => ipcRenderer.invoke('pairing:copy'),
  runSelfTest: () => ipcRenderer.invoke('selftest:run'),
  sendCue: (wav: Uint8Array, seconds: number) => ipcRenderer.invoke('cue:audio', wav, seconds),
  setTalkKey: (key: string) => ipcRenderer.invoke('settings:talkKey', key),
  onTalkKey: on('talkKey'),
  onExtension: on('extension'),
  onPtt: on('ptt'),
  onCue: on('cue'),
  onNotice: on('podium:notice'),
  onShowPairing: on('podium:showPairing'),
};

contextBridge.exposeInMainWorld('baton', api);
export type BatonApi = typeof api;
