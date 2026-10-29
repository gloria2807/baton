import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, KEYCODES, TalkKeyGesture, isTalkKeyId, type TalkAction, type TalkKeyId } from './talk-key.js';

const { AltLeft, AltRight, CtrlLeft, CtrlRight } = KEYCODES;
const TAB = 0x000f;
const F4 = 0x003e;
const SHIFT = 0x002a;
const E = 0x0012;

let actions: TalkAction[];
const types = () => actions.map((a) => a.type);

function make(key: TalkKeyId = 'Alt') {
  return new TalkKeyGesture(key, (a) => actions.push(a), CtrlLeft, {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  actions = [];
});
afterEach(() => vi.useRealTimers());

describe('talk key: holding speaks', () => {
  it('starts after the hold threshold and commits on release', () => {
    const g = make();
    g.keydown(AltLeft);
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(actions).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(types()).toEqual(['mask', 'start']);
    vi.advanceTimersByTime(2000);
    g.keyup(AltLeft);
    expect(actions.at(-1)).toEqual({ type: 'commit', heldMs: 2000 + HOLD_MS });
  });

  it('works with either Alt by default, and with Right Alt alone', () => {
    const g = make();
    g.keydown(AltRight);
    vi.advanceTimersByTime(HOLD_MS);
    g.keyup(AltRight);
    expect(types()).toEqual(['mask', 'start', 'commit']);
  });

  it('ignores key auto-repeat while held', () => {
    const g = make();
    g.keydown(AltLeft);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(50);
      g.keydown(AltLeft);
    }
    g.keyup(AltLeft);
    expect(types()).toEqual(['mask', 'start', 'commit']);
  });

  it('does not treat its own injected mask keystroke as a shortcut', () => {
    const g = make();
    g.keydown(AltLeft);
    vi.advanceTimersByTime(HOLD_MS);
    g.keydown(CtrlLeft); // echo of the injected tap
    g.keyup(CtrlLeft);
    vi.advanceTimersByTime(1000);
    g.keyup(AltLeft);
    expect(types()).toEqual(['mask', 'start', 'commit']);
  });

  it('a real Ctrl press after the mask echo window still cancels', () => {
    const g = make();
    g.keydown(AltLeft);
    vi.advanceTimersByTime(HOLD_MS + 600);
    g.keydown(CtrlLeft);
    expect(types()).toEqual(['mask', 'start', 'cancel']);
  });

  it('Right Ctrl needs no mask', () => {
    const g = make('RightCtrl');
    g.keydown(CtrlRight);
    vi.advanceTimersByTime(HOLD_MS);
    g.keyup(CtrlRight);
    expect(types()).toEqual(['start', 'commit']);
  });
});

describe('talk key: normal typing is untouched', () => {
  it('Alt+Tab never opens the microphone', () => {
    const g = make();
    g.keydown(AltLeft);
    vi.advanceTimersByTime(60);
    g.keydown(TAB);
    g.keyup(TAB);
    vi.advanceTimersByTime(1500); // still holding Alt while choosing a window
    g.keydown(TAB);
    g.keyup(TAB);
    g.keyup(AltLeft);
    expect(actions).toEqual([]);
  });

  it('a quick Alt tap is left to Windows (menu key) and does nothing here', () => {
    const g = make();
    g.keydown(AltLeft);
    vi.advanceTimersByTime(80);
    g.keyup(AltLeft);
    vi.advanceTimersByTime(1000);
    expect(actions).toEqual([]);
  });

  it('Alt+F4 pressed late cancels and discards the recording', () => {
    const g = make();
    g.keydown(AltLeft);
    vi.advanceTimersByTime(400);
    g.keydown(F4);
    g.keyup(F4);
    g.keyup(AltLeft);
    expect(types()).toEqual(['mask', 'start', 'cancel']);
    expect(actions.at(-1)).toEqual({ type: 'cancel', reason: 'other-key' });
  });

  it('AltGr typing (Ctrl then Right Alt, then a letter) never starts', () => {
    const g = make();
    g.keydown(CtrlLeft);
    g.keydown(AltRight);
    vi.advanceTimersByTime(500);
    g.keydown(E);
    g.keyup(E);
    g.keyup(AltRight);
    g.keyup(CtrlLeft);
    expect(actions).toEqual([]);
  });

  it('Shift+Alt (keyboard layout switch) never starts', () => {
    const g = make();
    g.keydown(SHIFT);
    g.keydown(AltLeft);
    vi.advanceTimersByTime(500);
    g.keyup(AltLeft);
    g.keyup(SHIFT);
    expect(actions).toEqual([]);
  });

  it('works again after a spoiled press', () => {
    const g = make();
    g.keydown(AltLeft);
    g.keydown(TAB);
    g.keyup(TAB);
    g.keyup(AltLeft);
    g.keydown(AltLeft);
    vi.advanceTimersByTime(HOLD_MS);
    g.keyup(AltLeft);
    expect(types()).toEqual(['mask', 'start', 'commit']);
  });

  it('a missed keyup does not block the talk key forever', () => {
    const g = make();
    g.keydown(SHIFT); // its keyup never arrives (e.g. lock screen)
    vi.advanceTimersByTime(10000);
    g.keydown(AltLeft);
    vi.advanceTimersByTime(HOLD_MS);
    g.keyup(AltLeft);
    expect(types()).toEqual(['mask', 'start', 'commit']);
  });

  it('typing that does not involve the talk key is ignored', () => {
    const g = make();
    for (const k of [E, SHIFT, TAB, CtrlLeft]) {
      g.keydown(k);
      g.keyup(k);
    }
    vi.advanceTimersByTime(1000);
    expect(actions).toEqual([]);
  });
});

describe('talk key: configuration', () => {
  it('switching keys closes an open microphone and uses the new key', () => {
    const g = make();
    g.keydown(AltLeft);
    vi.advanceTimersByTime(HOLD_MS);
    g.setKey('RightCtrl');
    expect(types()).toEqual(['mask', 'start', 'cancel']);
    actions = [];
    g.keyup(AltLeft);
    g.keydown(AltLeft);
    vi.advanceTimersByTime(HOLD_MS);
    expect(actions).toEqual([]); // Alt is now an ordinary key
  });

  it('validates stored settings', () => {
    expect(isTalkKeyId('Alt')).toBe(true);
    expect(isTalkKeyId('RightCtrl')).toBe(true);
    expect(isTalkKeyId('toString')).toBe(false);
    expect(isTalkKeyId('F13')).toBe(false);
    expect(isTalkKeyId(undefined)).toBe(false);
  });
});
