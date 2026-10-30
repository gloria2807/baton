// Builds the extension into dist/ (load it with "Load unpacked") and draws its icons.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { iconPng } from '../../scripts/icon.mjs';

const watch = process.argv.includes('--watch');
mkdirSync('dist', { recursive: true });
cpSync('static', 'dist', { recursive: true });

// Baton's icon (scripts/icon.mjs): an ink tile with a brass baton.
for (const s of [16, 32, 48, 128]) writeFileSync(`dist/icon${s}.png`, iconPng(s));

const common = { bundle: true, target: 'chrome116', sourcemap: 'inline', logLevel: 'info' };
const configs = [
  { ...common, entryPoints: ['src/background.ts'], outfile: 'dist/background.js', format: 'esm' },
  { ...common, entryPoints: ['src/content.ts'], outfile: 'dist/content.js', format: 'iife' },
  { ...common, entryPoints: ['src/options.ts'], outfile: 'dist/options.js', format: 'iife' },
];
if (watch) for (const c of configs) await (await context(c)).watch();
else await Promise.all(configs.map((c) => build(c)));
