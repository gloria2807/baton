import { describe, expect, it } from 'vitest';
import { applyHomography, cornerTargets, errors, fitHomography, gridTargets } from './calibration.js';
import { OneEuro } from './filter.js';
import { GestureTracker, classify, type Landmark, type Pose } from './gestures.js';

// A synthetic right hand facing the camera: wrist low in the image, fingers up or curled.
function hand(fingers: {
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
  thumb: 'out' | 'in' | 'pinch';
}): Landmark[] {
  const l: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8, z: 0 }));
  const finger = (base: number, x: number, isUp: boolean) => {
    l[base] = { x, y: 0.6, z: 0 }; // knuckle
    l[base + 1] = { x, y: isUp ? 0.5 : 0.55, z: 0 }; // middle joint
    l[base + 2] = { x, y: isUp ? 0.45 : 0.6, z: 0 };
    l[base + 3] = { x, y: isUp ? 0.4 : 0.66, z: 0 }; // tip
  };
  finger(5, 0.44, fingers.index);
  finger(9, 0.5, fingers.middle);
  finger(13, 0.56, fingers.ring);
  finger(17, 0.62, fingers.pinky);
  const thumbTip =
    fingers.thumb === 'out'
      ? { x: 0.28, y: 0.62 }
      : fingers.thumb === 'pinch'
        ? { x: 0.445, y: 0.41 }
        : { x: 0.46, y: 0.66 };
  l[4] = { ...thumbTip, z: 0 };
  return l;
}

describe('hand poses', () => {
  it('recognises each pose from the landmarks', () => {
    expect(classify(hand({ index: true, middle: false, ring: false, pinky: false, thumb: 'in' }))).toBe('point');
    expect(classify(hand({ index: true, middle: false, ring: false, pinky: false, thumb: 'pinch' }))).toBe('pinch');
    expect(classify(hand({ index: true, middle: true, ring: true, pinky: true, thumb: 'out' }))).toBe('open');
    expect(classify(hand({ index: true, middle: true, ring: false, pinky: false, thumb: 'in' }))).toBe('two');
    expect(classify(hand({ index: false, middle: false, ring: false, pinky: false, thumb: 'in' }))).toBe('other');
    expect(classify(null)).toBe('none');
  });

  it('does not depend on how far the hand is from the camera', () => {
    const small = hand({ index: true, middle: true, ring: false, pinky: false, thumb: 'in' }).map((p) => ({
      x: 0.5 + (p.x - 0.5) * 0.4,
      y: 0.5 + (p.y - 0.5) * 0.4,
      z: 0,
    }));
    expect(classify(small)).toBe('two');
  });
});

describe('gestures need to be held', () => {
  const run = (frames: Array<[Pose, number]>) => {
    const t = new GestureTracker();
    return frames.flatMap(([p, ms]) => t.update(p, ms).map((e) => `${e.type}@${ms}`));
  };

  it('fires a pinch once per hold, after a moment', () => {
    expect(
      run([
        ['point', 0],
        ['pinch', 100],
        ['pinch', 150],
        ['pinch', 230],
        ['pinch', 400],
        ['point', 500],
        ['point', 650],
        ['pinch', 780],
        ['pinch', 910],
      ]),
    ).toEqual(['pinch@230', 'pinch@910']);
  });

  it('is not reset by a single flickering frame', () => {
    expect(
      run([
        ['point', 0],
        ['pinch', 100],
        ['other', 140],
        ['pinch', 170],
        ['pinch', 240],
      ]),
    ).toEqual(['pinch@240']);
  });

  it('stops everyone only after an open palm is held half a second, and not again straight away', () => {
    const quick = run([
      ['open', 0],
      ['open', 300],
      ['point', 350],
    ]);
    expect(quick).toEqual([]);
    expect(
      run([
        ['open', 0],
        ['open', 520],
        ['point', 600],
        ['open', 700],
        ['open', 1300],
        ['point', 1400],
        ['point', 1600],
        ['open', 2600],
        ['open', 2750],
        ['open', 3200],
      ]),
    ).toEqual(['stop@520', 'stop@3200']);
  });

  it('never stops everyone for an open hand that is moving, as hands do while talking', () => {
    const t = new GestureTracker();
    const events = [];
    for (let ms = 0; ms <= 1500; ms += 33)
      events.push(...t.update('open', ms, { x: 0.4 + 0.1 * Math.sin(ms / 150), y: 0.6 }));
    expect(events).toEqual([]);
    const still = new GestureTracker();
    const held = [];
    for (let ms = 0; ms <= 700; ms += 33)
      held.push(...still.update('open', ms, { x: 0.5 + (ms % 66 ? 0.004 : 0), y: 0.6 }));
    expect(held.map((e) => e.type)).toEqual(['stop']);
  });

  it('talks while two fingers are held, and a dropped frame is not a release', () => {
    expect(
      run([
        ['two', 0],
        ['two', 260],
        ['none', 300],
        ['two', 340],
        ['two', 900],
        ['point', 1000],
        ['point', 1250],
        ['point', 1500],
      ]),
    ).toEqual(['talk-start@260', 'talk-end@1500']);
  });
});

describe('calibration', () => {
  const screen = { x: 0, y: 0, width: 1920, height: 1080 };

  // The camera sees the screen mirrored and a little in perspective.
  it('fits four corner targets exactly and maps the rest of the screen', () => {
    const cam = [
      { x: 0.7, y: 0.3 },
      { x: 0.3, y: 0.32 },
      { x: 0.32, y: 0.7 },
      { x: 0.68, y: 0.68 },
    ];
    const targets = cornerTargets(screen);
    const h = fitHomography(cam, targets)!;
    expect(h).not.toBeNull();
    expect(
      errors(
        targets,
        cam.map((c) => applyHomography(h, c)),
      ),
    ).toEqual([0, 0, 0, 0]);
    // The centre of the camera quad lands near the centre of the screen.
    const centre = applyHomography(h, { x: 0.5, y: 0.5 });
    expect(Math.abs(centre.x - 960)).toBeLessThan(80);
    expect(Math.abs(centre.y - 540)).toBeLessThan(80);
  });

  it('recovers a known mapping from noisy points by least squares', () => {
    const h0 = [-2000, 50, 1700, 30, 1600, -250, 0.05, 0.02];
    const cam = gridTargets({ x: 0.3, y: 0.3, width: 0.4, height: 0.4 }, 0);
    const scr = cam.map((c, i) => {
      const p = applyHomography(h0, c);
      return { x: p.x + (i % 2 ? 2 : -2), y: p.y + (i % 3 ? 1.5 : -1.5) };
    });
    const h = fitHomography(cam, scr)!;
    const worst = Math.max(
      ...errors(
        scr,
        cam.map((c) => applyHomography(h, c)),
      ),
    );
    expect(worst).toBeLessThan(6);
  });

  it('refuses to fit from too few points', () => {
    expect(fitHomography([{ x: 0, y: 0 }], [{ x: 1, y: 1 }])).toBeNull();
  });
});

describe('One Euro filter', () => {
  it('holds steady against jitter and follows a fast move', () => {
    const f = new OneEuro(1, 0.02);
    let out = 0;
    for (let i = 0; i < 60; i++) out = f.filter(500 + (i % 2 ? 6 : -6), i * 33);
    expect(Math.abs(out - 500)).toBeLessThan(3);
    for (let i = 60; i < 75; i++) out = f.filter(500 + (i - 59) * 60, i * 33);
    expect(out).toBeGreaterThan(1100); // a fast sweep to 1400 is followed closely
  });
});
