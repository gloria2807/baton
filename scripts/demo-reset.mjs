// Puts the demo into the starting state of docs/DEMO_SCRIPT.md: demo sites reset, Ama's demo
// profile in Baton's settings folder, and the Podium cleared (cards, lanes, the learned routine).
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const appData =
  process.env.APPDATA ??
  (process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support') : join(homedir(), '.config'));
const dir = join(appData, 'Baton');
mkdirSync(dir, { recursive: true });
copyFileSync('demo-sites/profile.json', join(dir, 'profile.json'));
console.log(`demo profile written to ${join(dir, 'profile.json')}`);

try {
  const r = await fetch('http://127.0.0.1:4400/__reset', { method: 'POST' });
  console.log(`demo sites reset (${r.status})`);
} catch {
  console.error('demo sites are not running; start them with: npm run demo-sites');
  process.exit(1);
}

// A second Baton launch hands its flags to the running one and exits (single instance), so this
// clears the Podium without restarting it. If Baton is not running it starts clean anyway.
const electron = createRequire(join(process.cwd(), 'apps/desktop/package.json'))('electron');
const child = spawn(electron, ['.', '--demo-reset'], { cwd: 'apps/desktop', stdio: 'ignore', detached: true });
child.unref();
console.log('podium reset requested');
