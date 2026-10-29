// The local WebSocket bridge on 127.0.0.1: accepts the paired extension and exposes `request()`
// to the rest of the main process.

import { EventEmitter } from 'node:events';
import { WebSocketServer, type WebSocket } from 'ws';
import { BRIDGE_PORT, BridgeError, BridgeSession, isAllowedOrigin, type CommandInput, type LaneEvent } from '@baton/core';
import { log } from './log';

export interface BridgeEvents {
  paired: [];
  unpaired: [];
  laneEvent: [LaneEvent];
}

export class BridgeServer extends EventEmitter<BridgeEvents> {
  private wss: WebSocketServer | null = null;
  private active: { session: BridgeSession; socket: WebSocket } | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  extensionVersion = '';

  constructor(
    private readonly token: string,
    private readonly port = BRIDGE_PORT,
  ) {
    super();
  }

  get connected(): boolean {
    return !!this.active?.session.isPaired;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({
        host: '127.0.0.1',
        port: this.port,
        maxPayload: 32 * 1024 * 1024,
        // Web pages cannot connect: only the extension (or a local tool with no Origin).
        verifyClient: ({ origin }: { origin?: string }) => isAllowedOrigin(origin),
      });
      this.wss.once('listening', () => {
        log(`bridge listening on 127.0.0.1:${this.port}`);
        resolve();
      });
      this.wss.once('error', reject);
      this.wss.on('connection', (socket) => this.accept(socket));
    });
  }

  private accept(socket: WebSocket) {
    const session = new BridgeSession(
      { send: (f) => socket.send(f), close: (code, reason) => socket.close(code, reason) },
      this.token,
      {
        onPaired: (version) => {
          // One extension at a time: the newest paired connection wins.
          if (this.active && this.active.socket !== socket) this.active.socket.close(4000, 'replaced');
          this.active = { session, socket };
          this.extensionVersion = version;
          this.startPinging();
          log(`extension ${version} paired`);
          this.emit('paired');
        },
        onEvent: (e) => this.emit('laneEvent', e),
        onLog: (m) => log(`bridge: ${m}`),
      },
    );
    socket.on('message', (data) => session.receive(String(data)));
    socket.on('close', () => {
      session.closed();
      if (this.active?.socket === socket) {
        this.active = null;
        log('extension disconnected');
        this.emit('unpaired');
      }
    });
  }

  // Keep the MV3 service worker awake: it stays alive while messages flow at least every 30 s.
  private startPinging() {
    if (this.pinger) return;
    this.pinger = setInterval(() => {
      if (this.connected) this.request({ op: 'ping' }, 10000).catch(() => undefined);
    }, 20000);
  }

  request<T = unknown>(cmd: CommandInput, timeoutMs?: number): Promise<T> {
    if (!this.active) return Promise.reject(new BridgeError('Chrome extension is not connected'));
    return this.active.session.request<T>(cmd, timeoutMs);
  }

  waitForPairing(timeoutMs: number): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('extension did not connect in time')), timeoutMs);
      this.once('paired', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  stop() {
    if (this.pinger) clearInterval(this.pinger);
    this.wss?.close();
  }
}
