// Packs the built extension into release/baton-extension-<version>.zip for "Load unpacked" installs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('apps/extension/dist/manifest.json', 'utf8'));
mkdirSync('release', { recursive: true });
const out = `release/baton-extension-${version}.zip`;
rmSync(out, { force: true });
// tar on Windows 10+ (bsdtar) and macOS writes zip archives with -a.
execFileSync('tar', ['-a', '-c', '-f', out, '-C', 'apps/extension/dist', '.'], { stdio: 'inherit' });
console.log(`packed ${out}`);
