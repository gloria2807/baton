// Builds main and preload with esbuild and the Podium renderer with Vite into dist/.
import { build } from 'esbuild';
import { build as vite } from 'vite';
import { cpSync, existsSync } from 'node:fs';

const node = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', sourcemap: true, logLevel: 'info',
  external: ['electron', 'uiohook-napi', 'bufferutil', 'utf-8-validate'] };
await Promise.all([
  build({ ...node, entryPoints: ['src/main/index.ts'], outfile: 'dist/main.cjs' }),
  build({ ...node, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload.cjs' }),
]);
await vite({ configFile: 'vite.config.mts', logLevel: 'warn' });
// MediaPipe's WebAssembly runtime and the hand model, served to the Podium as baton-asset://hand/…
cpSync('../../node_modules/@mediapipe/tasks-vision/wasm', 'dist/hand/wasm', { recursive: true });
if (existsSync('assets/hand_landmarker.task')) cpSync('assets/hand_landmarker.task', 'dist/hand/hand_landmarker.task');
else console.warn('hand model missing: run node scripts/fetch-hand-model.mjs');
console.log('desktop built');
