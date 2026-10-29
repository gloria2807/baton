// Event log for the main process. Logs events only: never secrets, tokens or page contents.
// Written to stdout and to out/baton.log, because a GUI Electron process on Windows often has no console.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const file = join(resolve(__dirname, '../../..'), 'out', 'baton.log');
mkdirSync(join(file, '..'), { recursive: true });

export function log(message: string) {
  const line = `[baton ${new Date().toISOString().slice(11, 23)}] ${message}`;
  console.log(line);
  try {
    appendFileSync(file, line + '\n');
  } catch {
    /* logging must never break Baton */
  }
}
