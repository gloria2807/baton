// Calibration: the person points at targets on the screen; Baton fits a projective mapping
// (a homography) from where the fingertip is in the camera image to where it points on screen.
// Four targets fix it exactly; more are fitted by least squares. The camera image is mirrored and
// tilted relative to the screen; a homography absorbs both.

import { z } from 'zod';

export interface Pt {
  x: number;
  y: number;
}

// h = [a, b, c, d, e, f, g, h] for x' = (a x + b y + c) / (g x + h y + 1), y' = (d x + e y + f) / (g x + h y + 1)
export const Calibration = z.object({
  h: z.array(z.number()).length(8),
  screen: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  at: z.string(),
});
export type Calibration = z.infer<typeof Calibration>;

function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / m[col]![col]!;
      for (let k = col; k <= n; k++) m[r]![k]! -= f * m[col]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

// Least-squares homography from camera points to screen points (at least four pairs, not three on a line).
export function fitHomography(from: Pt[], to: Pt[]): number[] | null {
  if (from.length < 4 || from.length !== to.length) return null;
  const ata = Array.from({ length: 8 }, () => Array(8).fill(0) as number[]);
  const atb = Array(8).fill(0) as number[];
  const add = (row: number[], rhs: number) => {
    for (let i = 0; i < 8; i++) {
      atb[i]! += row[i]! * rhs;
      for (let j = 0; j < 8; j++) ata[i]![j]! += row[i]! * row[j]!;
    }
  };
  from.forEach((p, i) => {
    const q = to[i]!;
    add([p.x, p.y, 1, 0, 0, 0, -p.x * q.x, -p.y * q.x], q.x);
    add([0, 0, 0, p.x, p.y, 1, -p.x * q.y, -p.y * q.y], q.y);
  });
  return solve(ata, atb);
}

export function applyHomography(h: number[], p: Pt): Pt {
  const w = h[6]! * p.x + h[7]! * p.y + 1;
  return { x: (h[0]! * p.x + h[1]! * p.y + h[2]!) / w, y: (h[3]! * p.x + h[4]! * p.y + h[5]!) / w };
}

// The four calibration targets, inset from the corners of the screen.
export function cornerTargets(s: { x: number; y: number; width: number; height: number }, inset = 0.1): Pt[] {
  const ix = s.width * inset;
  const iy = s.height * inset;
  return [
    { x: s.x + ix, y: s.y + iy },
    { x: s.x + s.width - ix, y: s.y + iy },
    { x: s.x + s.width - ix, y: s.y + s.height - iy },
    { x: s.x + ix, y: s.y + s.height - iy },
  ];
}

// The accuracy check: nine targets in a 3 × 3 grid across the screen.
export function gridTargets(s: { x: number; y: number; width: number; height: number }, inset = 0.12): Pt[] {
  const xs = [inset, 0.5, 1 - inset].map((f) => s.x + s.width * f);
  const ys = [inset, 0.5, 1 - inset].map((f) => s.y + s.height * f);
  return ys.flatMap((y) => xs.map((x) => ({ x, y })));
}

export function errors(targets: Pt[], landed: Pt[]): number[] {
  return targets.map((t, i) => Math.round(Math.hypot(t.x - landed[i]!.x, t.y - landed[i]!.y)));
}
