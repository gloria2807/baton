// Event log for the main process. Logs events only: never secrets, tokens or page contents.
// Written to stdout and to out/baton.log, because a GUI Electron process on Windows often has no console.

import { app } from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Installed: the user data folder. In development: the repository's out/ folder.
const dir = app.isPackaged ? join(app.getPath('userData'), 'out') : join(resolve(__dirname, '../../..'), 'out');
const file = join(dir, 'baton.log');
mkdirSync(dir, { recursive: true });

export function log(message: string) {
  const line = `[baton ${new Date().toISOString().slice(11, 23)}] ${message}`;
  console.log(line);
  try {
    appendFileSync(file, `${line}\n`);
  } catch {
    /* logging must never break Baton */
  }
}
