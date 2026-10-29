import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command, FromExtension, PROTOCOL_VERSION, ToExtension, parseFrame } from './bridge.js';
import { BridgeError, BridgeSession, type Transport } from './bridge-session.js';
import { isAllowedOrigin, isWellFormedToken, newPairingToken, tokensMatch } from './pairing.js';

describe('bridge schemas', () => {
  it('accepts every command the hands understand', () => {
    const ok = [
      { op: 'ping' },
      { op: 'openLane', laneId: 'blue', url: 'http://localhost:4401/', color: '#3b82f6', title: 'Flights' },
      { op: 'openLane', laneId: 'l1', url: 'https://example.com', color: '#3b82f6', title: 't', bounds: { left: 0, top: 0, width: 960, height: 540 } },
      { op: 'look', laneId: 'blue' },
      { op: 'click', laneId: 'blue', mark: 5 },
      { op: 'click', laneId: 'blue', x: 10, y: 20 },
      { op: 'moveCursor', laneId: 'blue', mark: 3 },
      { op: 'type', laneId: 'blue', mark: 2, text: 'hello', submit: true },
      { op: 'key', laneId: 'blue', key: 'Enter' },
      { op: 'scroll', laneId: 'blue', dy: 600 },
      { op: 'setThinking', laneId: 'blue', text: 'Looking for the cheapest fare' },
    ];
    for (const c of ok) expect(Command.safeParse(c).success, JSON.stringify(c)).toBe(true);
  });

  it('fills defaults for look', () => {
    expect(Command.parse({ op: 'look', laneId: 'a' })).toEqual({ op: 'look', laneId: 'a', maxWidth: 1280, screenshot: true });
  });

  it('rejects malformed commands', () => {
    const bad = [
      { op: 'rm -rf' },
      { op: 'openLane', laneId: 'Blue Lane!', url: 'http://x', color: '#3b82f6', title: 't' },
      { op: 'openLane', laneId: 'a', url: 'not a url', color: '#3b82f6', title: 't' },
      { op: 'openLane', laneId: 'a', url: 'http://x.y', color: 'blue', title: 't' },
      { op: 'click', laneId: 'a', mark: -1 },
      { op: 'key', laneId: 'a', key: 'F12' },
      { op: 'type', laneId: 'a', text: 'no mark' },
      { op: 'setThinking', laneId: 'a', text: 'x'.repeat(200) },
    ];
    for (const c of bad) expect(Command.safeParse(c).success, JSON.stringify(c)).toBe(false);
  });

  it('parses frames in both directions and drops junk', () => {
    expect(parseFrame(FromExtension, '{"type":"hello","token":"abcdefghijklmnopqrstu","version":1,"extensionVersion":"0.1.0"}')?.type).toBe('hello');
    expect(parseFrame(FromExtension, '{"type":"result","id":3,"ok":false,"error":"no tab"}')).toEqual({ type: 'result', id: 3, ok: false, error: 'no tab' });
    expect(parseFrame(ToExtension, '{"type":"command","id":1,"command":{"op":"ping"}}')?.type).toBe('command');
    expect(parseFrame(FromExtension, 'not json')).toBeNull();
    expect(parseFrame(FromExtension, '{"type":"result","id":"x","ok":true}')).toBeNull();
    expect(parseFrame(FromExtension, '{"type":"event","event":{"kind":"nope"}}')).toBeNull();
  });
});

describe('pairing tokens', () => {
  it('makes unique, url-safe, 256-bit tokens', () => {
    const a = newPairingToken();
    const b = newPairingToken();
    expect(a).not.toBe(b);
    expect(isWellFormedToken(a)).toBe(true);
    expect(a).toHaveLength(43);
  });

  it('matches only the exact token', () => {
    const t = newPairingToken();
    expect(tokensMatch(t, t)).toBe(true);
    expect(tokensMatch(t, t.slice(0, -1))).toBe(false);
    expect(tokensMatch(t, t + 'x')).toBe(false);
    expect(tokensMatch(t, t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'))).toBe(false);
    expect(tokensMatch(t, '')).toBe(false);
    expect(tokensMatch('short', 'short')).toBe(false); // a malformed expected token never matches
  });

  it('allows only extension origins', () => {
    const id = 'abcdefghijklmnopabcdefghijklmnop';
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin(`chrome-extension://${id}`)).toBe(true);
    expect(isAllowedOrigin(`chrome-extension://${id}`, [id])).toBe(true);
    expect(isAllowedOrigin(`chrome-extension://${id}`, ['p'.repeat(32)])).toBe(false);
    expect(isAllowedOrigin('http://localhost:4400')).toBe(false);
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
  });
});

class FakeTransport implements Transport {
  sent: unknown[] = [];
  closedWith: [number, string] | null = null;
  send(frame: string) {
    this.sent.push(JSON.parse(frame));
  }
  close(code: number, reason: string) {
    this.closedWith = [code, reason];
  }
}

describe('BridgeSession', () => {
  let token: string;
  let t: FakeTransport;
  beforeEach(() => {
    vi.useFakeTimers();
    token = newPairingToken();
    t = new FakeTransport();
  });
  afterEach(() => vi.useRealTimers());

  const hello = (tok: string, version = PROTOCOL_VERSION) => JSON.stringify({ type: 'hello', token: tok, version, extensionVersion: '0.1.0' });

  it('pairs with the right token and answers welcome', () => {
    const onPaired = vi.fn();
    const s = new BridgeSession(t, token, { onPaired });
    s.receive(hello(token));
    expect(s.isPaired).toBe(true);
    expect(onPaired).toHaveBeenCalledOnce();
    expect(t.sent).toEqual([{ type: 'welcome', version: PROTOCOL_VERSION }]);
    expect(t.closedWith).toBeNull();
  });

  it('rejects a wrong token, a wrong version, a non-hello first frame and junk', () => {
    for (const frame of [hello(newPairingToken()), hello(token, 99), JSON.stringify({ type: 'event', event: { kind: 'log', message: 'hi' } }), 'garbage']) {
      const tt = new FakeTransport();
      const s = new BridgeSession(tt, token);
      s.receive(frame);
      expect(s.isPaired).toBe(false);
      expect(tt.closedWith?.[0]).toBe(4001);
      expect((tt.sent[0] as { type: string }).type).toBe('rejected');
    }
  });

  it('closes a connection that never says hello', () => {
    new BridgeSession(t, token, {}, 5000);
    vi.advanceTimersByTime(5001);
    expect(t.closedWith).toEqual([4001, 'no hello']);
  });

  it('refuses commands before pairing', async () => {
    const s = new BridgeSession(t, token);
    await expect(s.request({ op: 'ping' })).rejects.toBeInstanceOf(BridgeError);
  });

  it('matches results to requests by id, in any order', async () => {
    const s = new BridgeSession(t, token);
    s.receive(hello(token));
    const a = s.request<string>({ op: 'ping' });
    const b = s.request({ op: 'look', laneId: 'blue' });
    const [, cmdA, cmdB] = t.sent as Array<{ id: number; command: { op: string } }>;
    expect(cmdB!.command).toEqual({ op: 'look', laneId: 'blue', maxWidth: 1280, screenshot: true });
    s.receive(JSON.stringify({ type: 'result', id: cmdB!.id, ok: false, error: 'lane not found' }));
    s.receive(JSON.stringify({ type: 'result', id: cmdA!.id, ok: true, data: 'pong' }));
    await expect(a).resolves.toBe('pong');
    await expect(b).rejects.toThrow('lane not found');
  });

  it('validates commands before sending them', async () => {
    const s = new BridgeSession(t, token);
    s.receive(hello(token));
    expect(() => s.request({ op: 'click', laneId: 'NOT OK' } as never)).toThrow();
    expect(t.sent).toHaveLength(1); // only the welcome
  });

  it('times out and fails pending requests on disconnect', async () => {
    const s = new BridgeSession(t, token);
    s.receive(hello(token));
    const slow = s.request({ op: 'ping' }, 1000);
    vi.advanceTimersByTime(1001);
    await expect(slow).rejects.toThrow('timed out');
    const dropped = s.request({ op: 'ping' });
    s.closed();
    await expect(dropped).rejects.toThrow('disconnected');
  });

  it('forwards lane events', () => {
    const onEvent = vi.fn();
    const s = new BridgeSession(t, token, { onEvent });
    s.receive(hello(token));
    s.receive(JSON.stringify({ type: 'event', event: { kind: 'laneClosed', laneId: 'blue' } }));
    expect(onEvent).toHaveBeenCalledWith({ kind: 'laneClosed', laneId: 'blue' });
  });
});
