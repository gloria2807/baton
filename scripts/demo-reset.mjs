// Puts the demo into the starting state of docs/DEMO_SCRIPT.md: demo sites reset and Ama's demo
// profile in Baton's settings folder. (Later stages also reset the Podium.)
import { copyFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const appData = process.env.APPDATA ?? (process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support') : join(homedir(), '.config'));
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
