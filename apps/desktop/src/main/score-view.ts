// The Score view: for any finished Score, the task graph and each lane's receipt as a filmstrip of
// screenshots with actions and reasons, and the time taken against an estimate by hand.

import { BrowserWindow, ipcMain } from 'electron';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { levels } from '@baton/core';
import { outDir } from './paths';

let win: BrowserWindow | null = null;

interface Frame {
  n: number;
  atMs: number; // when the step ended, from the start of the run
  thinking: string;
  action: string;
  reason: string;
  gate: string;
  ok: boolean;
  note: string;
  seconds: number;
  image?: string;
}

function frames(dir: string, runStart: number): Frame[] {
  const file = join(dir, 'steps.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .slice(0, 40)
    .map((s) => ({
      n: s.n,
      atMs: Math.max(0, Date.parse(s.at) - runStart),
      thinking: s.thinking,
      action: `${s.action.tool}${s.action.mark !== undefined ? ` [${s.action.mark}]` : ''}${s.action.url ? ` ${s.action.url}` : ''}${s.action.text ? ` “${String(s.action.text).slice(0, 40)}”` : ''}`,
      reason: s.reason,
      gate: s.gate,
      ok: s.verdict.ok,
      note: s.verdict.note,
      seconds: Math.round(s.ms.total / 100) / 10,
      image: s.screenshot && existsSync(join(dir, s.screenshot)) ? `data:image/jpeg;base64,${readFileSync(join(dir, s.screenshot)).toString('base64')}` : undefined,
    }));
}

export function listScores() {
  const dir = outDir('scores');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 20)
    .map((f) => {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      return { runId: r.runId, title: r.score.title, startedAt: r.startedAt, seconds: r.seconds, lanes: r.parts.length };
    });
}

export function loadScore(runId: string) {
  const file = join(outDir('scores'), `${runId.replace(/[^\w.-]/g, '')}.json`);
  if (!existsSync(file)) return null;
  const r = JSON.parse(readFileSync(file, 'utf8'));
  return {
    ...r,
    waves: levels(r.score.parts),
    lanes: r.parts.map((p: { id: string; name: string; color: string; result?: unknown; receipts: string[] }) => ({
      ...p,
      goal: r.score.parts.find((x: { id: string }) => x.id === p.id)?.goal,
      // A redirected lane has several attempts; show them in order.
      attempts: p.receipts.map((dir) => frames(dir, Date.parse(r.startedAt))),
    })),
  };
}

export function registerScoreView() {
  ipcMain.handle('score:list', () => listScores());
  ipcMain.handle('score:get', (_e, runId: unknown) => (typeof runId === 'string' ? loadScore(runId) : null));
}

export function openScoreView(preload: string, page: string, runId?: string) {
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      width: 1280,
      height: 820,
      title: 'Baton · Score',
      backgroundColor: '#0b0d14',
      autoHideMenuBar: true,
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.on('closed', () => (win = null));
  }
  // Same file with only a different #hash would not reload, so new Scores (or a rebuilt view) would
  // not show: load, then reload.
  const w = win;
  void w.loadFile(page, { hash: runId ? `score=${runId}` : 'score' }).then(() => w.webContents.reloadIgnoringCache());
  win.show();
  win.focus();
  return win;
}

// For checking the view without a person: open it and save what it shows.
export async function snapshotScoreView(preload: string, page: string, file: string) {
  const w = openScoreView(preload, page);
  await new Promise((r) => setTimeout(r, 2500));
  const img = await w.webContents.capturePage();
  writeFileSync(file, img.toPNG());
}
