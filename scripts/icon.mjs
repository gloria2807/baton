// Baton's icon, drawn in code: an ink tile with a brass baton and a paper grip (docs/DESIGN.md).
// Used for the extension icons, the desktop app and its installer.
import { deflateSync } from 'node:zlib';

const INK = [23, 22, 26];
const BRASS = [201, 154, 59];
const PAPER = [239, 233, 221];

// Distance from point p to segment ab.
function seg(px, py, ax, ay, bx, by) {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// RGBA pixels with 4× supersampling for smooth edges.
export function iconPixels(size) {
  const px = new Uint8Array(size * size * 4);
  const r = size * 0.22;
  const S = 4;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let a = 0,
        rr = 0,
        gg = 0,
        bb = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const fx = x + (sx + 0.5) / S,
            fy = y + (sy + 0.5) / S;
          const cx = Math.min(Math.max(fx, r), size - r),
            cy = Math.min(Math.max(fy, r), size - r);
          if (Math.hypot(fx - cx, fy - cy) > r) continue;
          let c = INK;
          const u = fx / size,
            v = fy / size;
          if (seg(u, v, 0.25, 0.77, 0.78, 0.24) < 0.035) c = BRASS;
          if (seg(u, v, 0.2, 0.82, 0.33, 0.69) < 0.07) c = PAPER;
          a++;
          rr += c[0];
          gg += c[1];
          bb += c[2];
        }
      const i = (y * size + x) * 4;
      if (a) px.set([rr / a, gg / a, bb / a, (255 * a) / (S * S)], i);
    }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

export function iconPng(size) {
  const px = iconPixels(size);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
