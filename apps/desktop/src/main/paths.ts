import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isWellFormedToken, newPairingToken } from '@baton/core';

// In development the app runs from apps/desktop; the repository root holds .env and out/.
export const repoRoot = resolve(app.getAppPath(), '../..');

export function outDir(...parts: string[]): string {
  const dir = join(repoRoot, 'out', ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dataDir(...parts: string[]): string {
  const dir = join(app.getPath('userData'), ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// The pairing token is made once and kept in the user's app data, never in the repository.
export function loadPairingToken(): string {
  const file = join(dataDir(), 'pairing.json');
  if (existsSync(file)) {
    const { token } = JSON.parse(readFileSync(file, 'utf8')) as { token?: string };
    if (token && isWellFormedToken(token)) return token;
  }
  const token = newPairingToken();
  writeFileSync(file, JSON.stringify({ token, created: new Date().toISOString() }));
  return token;
}

// Reads BASETEN_API_KEY into this process only. It is never passed to the renderer or the extension.
export function loadEnv() {
  const candidates = [join(repoRoot, '.env'), join(dataDir(), '.env')];
  for (const f of candidates) {
    if (existsSync(f)) {
      process.loadEnvFile(f);
      return;
    }
  }
}
