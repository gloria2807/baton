// Push-to-talk gesture: turns raw global key events into start / commit / cancel, so that holding
// the talk key alone speaks to Baton while ordinary shortcuts (Alt+Tab, Alt+F4, AltGr typing,
// Ctrl+C) keep working untouched. Pure logic; the desktop app feeds it uiohook events.

// libuiohook scan codes (identical on Windows, macOS and Linux).
export const KEYCODES = {
  CtrlLeft: 0x001d,
  CtrlRight: 0x0e1d,
  AltLeft: 0x0038,
  AltRight: 0x0e38,
} as const;

export const TALK_KEYS = {
  Alt: { label: 'Alt', codes: [KEYCODES.AltLeft, KEYCODES.AltRight], alt: true },
  LeftAlt: { label: 'Left Alt', codes: [KEYCODES.AltLeft], alt: true },
  RightAlt: { label: 'Right Alt', codes: [KEYCODES.AltRight], alt: true },
  RightCtrl: { label: 'Right Ctrl', codes: [KEYCODES.CtrlRight], alt: false },
} as const;

export type TalkKeyId = keyof typeof TALK_KEYS;
export const DEFAULT_TALK_KEY: TalkKeyId = 'Alt';

export function isTalkKeyId(v: unknown): v is TalkKeyId {
  return typeof v === 'string' && Object.hasOwn(TALK_KEYS, v);
}

// Holding for this long with no other key counts as talking. Alt+Tab and similar shortcuts press
// their second key well inside this window, so they never open the microphone.
export const HOLD_MS = 200;
// A key we have not seen released for this long is treated as released (a missed keyup after
// a lock screen or UAC prompt must not disable the talk key forever).
const STALE_MS = 8000;
// Injected mask keystrokes we wait to see echoed back by the hook.
const MASK_ECHO_MS = 500;

export type TalkAction =
  | { type: 'start' } // open the microphone and show listening
  | { type: 'commit'; heldMs: number } // stop, keep the recording, transcribe it
  | { type: 'cancel'; reason: 'other-key' | 'focus-lost' } // stop and discard: it was a shortcut, not speech
  | { type: 'mask' }; // tap the mask key now, while the talk key is still down

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

type State =
  | { kind: 'idle' }
  | { kind: 'pending'; since: number; timer: unknown }
  | { kind: 'listening'; since: number }
  | { kind: 'spoiled' };

export class TalkKeyGesture {
  private state: State = { kind: 'idle' };
  private codes: readonly number[];
  private isAlt: boolean;
  private others = new Map<number, number>(); // keycode → when pressed
  private maskEchoes = { down: 0, up: 0, until: 0 };

  constructor(
    key: TalkKeyId,
    private readonly emit: (a: TalkAction) => void,
    private readonly maskKeycode: number = KEYCODES.CtrlLeft,
    private readonly clock: Clock = systemClock,
  ) {
    this.codes = TALK_KEYS[key].codes;
    this.isAlt = TALK_KEYS[key].alt;
  }

  get listening(): boolean {
    return this.state.kind === 'listening';
  }

  setKey(key: TalkKeyId) {
    this.reset('focus-lost');
    this.codes = TALK_KEYS[key].codes;
    this.isAlt = TALK_KEYS[key].alt;
  }

  keydown(code: number) {
    if (this.consumeMaskEcho(code, 'down')) return;
    if (this.codes.includes(code)) return this.talkDown();
    // Any other key while the talk key is down means the person is using a shortcut.
    this.others.set(code, this.clock.now());
    this.spoil('other-key');
  }

  keyup(code: number) {
    if (this.consumeMaskEcho(code, 'up')) return;
    if (this.codes.includes(code)) return this.talkUp();
    this.others.delete(code);
  }

  // The hook stopped or the session locked: never leave the microphone open.
  reset(reason: 'focus-lost' = 'focus-lost') {
    if (this.state.kind === 'pending') this.clock.clearTimeout(this.state.timer);
    if (this.state.kind === 'listening') this.emit({ type: 'cancel', reason });
    this.state = { kind: 'idle' };
    this.others.clear();
  }

  private otherKeysHeld(): boolean {
    const now = this.clock.now();
    for (const [code, at] of this.others) if (now - at > STALE_MS) this.others.delete(code);
    return this.others.size > 0;
  }

  private talkDown() {
    // Key auto-repeat sends keydown again and again while held; only the first counts.
    if (this.state.kind !== 'idle') return;
    // Ctrl+Alt+…, AltGr (which arrives as Ctrl then Right Alt) and Shift+Alt are shortcuts.
    if (this.otherKeysHeld()) {
      this.state = { kind: 'spoiled' };
      return;
    }
    const since = this.clock.now();
    const timer = this.clock.setTimeout(() => this.startListening(), HOLD_MS);
    this.state = { kind: 'pending', since, timer };
  }

  private startListening() {
    if (this.state.kind !== 'pending') return;
    const since = this.state.since;
    this.state = { kind: 'listening', since };
    // Releasing Alt on its own makes Windows apps activate their menu bar. Tapping a harmless key
    // while Alt is still down turns the release into "Alt+key", which apps ignore.
    if (this.isAlt) {
      this.maskEchoes = { down: 1, up: 1, until: this.clock.now() + MASK_ECHO_MS };
      this.emit({ type: 'mask' });
    }
    this.emit({ type: 'start' });
  }

  private talkUp() {
    const s = this.state;
    this.state = { kind: 'idle' };
    if (s.kind === 'pending') this.clock.clearTimeout(s.timer); // a quick Alt tap is the person's, not ours
    if (s.kind === 'listening') this.emit({ type: 'commit', heldMs: this.clock.now() - s.since });
  }

  private spoil(reason: 'other-key') {
    const s = this.state;
    if (s.kind === 'pending') {
      this.clock.clearTimeout(s.timer);
      this.state = { kind: 'spoiled' };
    } else if (s.kind === 'listening') {
      this.state = { kind: 'spoiled' };
      this.emit({ type: 'cancel', reason });
    }
  }

  private consumeMaskEcho(code: number, dir: 'down' | 'up'): boolean {
    if (code !== this.maskKeycode || this.maskEchoes[dir] === 0) return false;
    if (this.clock.now() > this.maskEchoes.until) {
      this.maskEchoes = { down: 0, up: 0, until: 0 };
      return false;
    }
    this.maskEchoes[dir]--;
    return true;
  }
}
