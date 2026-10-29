// Builds the extension into dist/ (load it with "Load unpacked") and draws its icons.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const watch = process.argv.includes('--watch');
mkdirSync('dist', { recursive: true });
cpSync('static', 'dist', { recursive: true });

// A dark rounded tile with four lane-coloured dots: Baton's orchestra.
function icon(size) {
  const px = Buffer.alloc(size * size * 4);
  const lanes = [[59, 130, 246], [34, 197, 94], [249, 115, 22], [168, 85, 247]];
  const r = size * 0.22;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const cx = Math.min(Math.max(x + 0.5, r), size - r), cy = Math.min(Math.max(y + 0.5, r), size - r);
      const inside = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r;
      if (!inside) continue;
      px.set([16, 19, 30, 255], i);
      lanes.forEach(([R, G, B], k) => {
        const dx = size * (k % 2 ? 0.66 : 0.34), dy = size * (k < 2 ? 0.34 : 0.66);
        if (Math.hypot(x + 0.5 - dx, y + 0.5 - dy) <= size * 0.14) px.set([R, G, B, 255], i);
      });
    }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [16, 32, 48, 128]) writeFileSync(`dist/icon${s}.png`, icon(s));

const common = { bundle: true, target: 'chrome116', sourcemap: 'inline', logLevel: 'info' };
const configs = [
  { ...common, entryPoints: ['src/background.ts'], outfile: 'dist/background.js', format: 'esm' },
  { ...common, entryPoints: ['src/content.ts'], outfile: 'dist/content.js', format: 'iife' },
  { ...common, entryPoints: ['src/options.ts'], outfile: 'dist/options.js', format: 'iife' },
];
if (watch) for (const c of configs) await (await context(c)).watch();
else await Promise.all(configs.map((c) => build(c)));
