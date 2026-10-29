// Builds main and preload with esbuild and the Podium renderer with Vite into dist/.
import { build } from 'esbuild';
import { build as vite } from 'vite';

const node = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', sourcemap: true, logLevel: 'info',
  external: ['electron', 'uiohook-napi', 'bufferutil', 'utf-8-validate'] };
await Promise.all([
  build({ ...node, entryPoints: ['src/main/index.ts'], outfile: 'dist/main.cjs' }),
  build({ ...node, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload.cjs' }),
]);
await vite({ configFile: 'vite.config.mts', logLevel: 'warn' });
console.log('desktop built');
