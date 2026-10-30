// Tiling: lane windows arranged in a neat grid under the Podium, so every ghost cursor is visible
// at once on a 1920×1080 or 2560×1440 screen.

import type { Bounds } from '../bridge.js';

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

const GAP = 10;

// Columns × rows for n lanes: wide screens prefer columns.
export function grid(n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  if (n <= 4) return { cols: 2, rows: 2 };
  if (n <= 6) return { cols: 3, rows: 2 };
  return { cols: 4, rows: 2 };
}

// `area` is the screen's work area; `reserveTop` keeps the Podium's strip clear.
export function tile(n: number, area: Area, reserveTop = 0): Bounds[] {
  const { cols, rows } = grid(n);
  const top = area.y + reserveTop;
  const w = Math.floor((area.width - GAP * (cols + 1)) / cols);
  const h = Math.floor((area.height - reserveTop - GAP * (rows + 1)) / rows);
  const out: Bounds[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    // Centre a short last row.
    const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
    const offset = Math.floor(((cols - inRow) * (w + GAP)) / 2);
    const c = i % cols;
    out.push({ left: area.x + GAP + offset + c * (w + GAP), top: top + GAP + r * (h + GAP), width: w, height: h });
  }
  return out;
}
