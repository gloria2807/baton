// The conductor's hand: what pose a hand is in (from MediaPipe's 21 landmarks), and which gestures
// that makes once held long enough. Holding is what separates a gesture from normal movement.
//
// | Pose  | Meaning                                                         |
// | point | moves the hand pointer                                          |
// | pinch | drops a pin under the pointer (on a lane window: selects it)    |
// | open  | open palm held half a second: everyone stop                     |
// | two   | index and middle up: talk while held                            |
//
// No pose approves anything. Approvals need a spoken "yes" or a click.

export interface Landmark {
  x: number; // 0..1 across the camera image
  y: number; // 0..1 down the camera image
  z: number;
}

export type Pose = 'point' | 'pinch' | 'open' | 'two' | 'other' | 'none';

// MediaPipe hand landmark indices.
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX = { mcp: 5, pip: 6, tip: 8 };
const MIDDLE = { mcp: 9, pip: 10, tip: 12 };
const RING = { mcp: 13, pip: 14, tip: 16 };
const PINKY = { mcp: 17, pip: 18, tip: 20 };

const d = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);
// In 3D: thumb and index tips can line up in the picture while one is far behind the other.
const d3 = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// A finger is up when its tip is clearly farther from the wrist than its middle joint.
// The ring and little fingers are shorter, so the length check is relative to each finger.
function up(l: Landmark[], f: { mcp: number; pip: number; tip: number }, size: number, minLength = 0.4): boolean {
  return d(l[f.tip]!, l[WRIST]!) > d(l[f.pip]!, l[WRIST]!) * 1.1 && d(l[f.tip]!, l[f.mcp]!) > size * minLength;
}

export function classify(l: Landmark[] | null | undefined): Pose {
  if (!l || l.length < 21) return 'none';
  // Hand size: wrist to the middle finger's knuckle. Every threshold is relative to it, so the
  // hand's distance from the camera does not matter.
  const size = d(l[WRIST]!, l[MIDDLE.mcp]!);
  if (size < 1e-3) return 'none';
  const index = up(l, INDEX, size);
  const middle = up(l, MIDDLE, size);
  const ring = up(l, RING, size, 0.35);
  const pinky = up(l, PINKY, size, 0.25);
  const thumbOut = d(l[THUMB_TIP]!, l[INDEX.mcp]!) > size * 0.55;
  // Thumb and index tips together. In a fist the index tip is folded back onto its own knuckle;
  // in a pinch it stays a finger's length away from it.
  const pinching = d3(l[THUMB_TIP]!, l[INDEX.tip]!) < size * 0.35 && d(l[INDEX.tip]!, l[INDEX.mcp]!) > size * 0.5;
  if (pinching && !middle) return 'pinch';
  if (index && middle && ring && pinky && thumbOut) return 'open';
  if (index && middle && !ring && !pinky) return 'two';
  if (index && !middle && !ring && !pinky) return 'point';
  return 'other';
}

// Where the hand points, in camera coordinates: the index finger's knuckle. The fingertip moves
// when the fingers close to pinch, which would drag the pointer at the very moment it is used;
// the knuckle stays put.
export function pointerPoint(l: Landmark[]): { x: number; y: number } {
  return { x: l[INDEX.mcp]!.x, y: l[INDEX.mcp]!.y };
}

export type GestureEvent = { type: 'pinch' } | { type: 'stop' } | { type: 'talk-start' } | { type: 'talk-end' };

export const GESTURE_HOLD_MS = { pinch: 120, open: 500, two: 250, release: 200, settle: 120 };

// Turns a stream of poses into gestures. Each fires once per hold; the open palm then waits two
// seconds before it can stop everyone again.
export class GestureTracker {
  private pose: Pose = 'none';
  private since = 0;
  private fired = false;
  private talking = false;
  private twoLostAt: number | null = null;
  private lastStop = -Infinity;
  private recent: Array<{ pose: Pose; t: number }> = [];
  private wristPath: Array<{ x: number; y: number; t: number }> = [];

  // `wrist` (camera coordinates) lets the open palm require a still hand: hands open and move
  // while people talk, and that must never stop everyone.
  update(seen: Pose, t: number, wrist?: { x: number; y: number }): GestureEvent[] {
    const out: GestureEvent[] = [];
    // Single frames flicker between poses: the pose is the one seen most in the last moment
    // (ties keep the current one), and a hold is timed from when that pose first appeared.
    this.recent = [...this.recent.filter((r) => r.t > t - GESTURE_HOLD_MS.settle - 30), { pose: seen, t }];
    const counts = new Map<Pose, number>();
    for (const r of this.recent) counts.set(r.pose, (counts.get(r.pose) ?? 0) + 1);
    let pose = this.pose;
    for (const [p, n] of counts) if (n > (counts.get(pose) ?? 0)) pose = p;
    if (pose !== this.pose) {
      this.pose = pose;
      this.since = this.recent.find((r) => r.pose === pose)?.t ?? t;
      this.fired = false;
      this.wristPath = [];
    }
    if (wrist && pose === 'open') this.wristPath.push({ ...wrist, t });
    const still = () => {
      if (!wrist) return true;
      const recent = this.wristPath.filter((p) => p.t >= t - GESTURE_HOLD_MS.open);
      const xs = recent.map((p) => p.x);
      const ys = recent.map((p) => p.y);
      return Math.max(...xs) - Math.min(...xs) < 0.05 && Math.max(...ys) - Math.min(...ys) < 0.05;
    };
    const held = t - this.since;
    if (!this.fired) {
      if (pose === 'pinch' && held >= GESTURE_HOLD_MS.pinch) {
        this.fired = true;
        out.push({ type: 'pinch' });
      } else if (pose === 'open' && held >= GESTURE_HOLD_MS.open && t - this.lastStop > 2000 && still()) {
        this.fired = true;
        this.lastStop = t;
        out.push({ type: 'stop' });
      } else if (pose === 'two' && held >= GESTURE_HOLD_MS.two && !this.talking) {
        this.fired = true;
        this.talking = true;
        out.push({ type: 'talk-start' });
      }
    }
    // Talking ends when the two fingers have been down for a moment (a dropped frame is not a release).
    if (this.talking) {
      if (pose === 'two') this.twoLostAt = null;
      else {
        this.twoLostAt ??= t;
        if (t - this.twoLostAt >= GESTURE_HOLD_MS.release) {
          this.talking = false;
          this.twoLostAt = null;
          out.push({ type: 'talk-end' });
        }
      }
    }
    return out;
  }

  get isTalking() {
    return this.talking;
  }
}
