// The conductor's side of one extension connection, independent of any socket library: it checks
// the pairing handshake, sends commands, matches results to requests and times them out.

import { Command, FromExtension, PROTOCOL_VERSION, parseFrame, type CommandInput, type LaneEvent, type ToExtension } from './bridge.js';
import { tokensMatch } from './pairing.js';

export interface Transport {
  send(frame: string): void;
  close(code: number, reason: string): void;
}

export class BridgeError extends Error {}

interface Pending {
  resolve: (data: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BridgeSession {
  private paired = false;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  // Close if the extension does not say hello with the right token quickly.
  private helloTimer: ReturnType<typeof setTimeout>;

  constructor(
    private readonly transport: Transport,
    private readonly token: string,
    private readonly hooks: { onPaired?: () => void; onEvent?: (e: LaneEvent) => void; onLog?: (m: string) => void } = {},
    helloTimeoutMs = 5000,
  ) {
    this.helloTimer = setTimeout(() => this.reject('no hello'), helloTimeoutMs);
  }

  get isPaired(): boolean {
    return this.paired;
  }

  receive(raw: string): void {
    const msg = parseFrame(FromExtension, raw);
    if (!msg) {
      this.hooks.onLog?.('dropped malformed frame');
      if (!this.paired) this.reject('malformed hello');
      return;
    }
    if (!this.paired) {
      if (msg.type !== 'hello') return this.reject('expected hello');
      if (msg.version !== PROTOCOL_VERSION) return this.reject(`protocol ${msg.version} != ${PROTOCOL_VERSION}`);
      if (!tokensMatch(this.token, msg.token)) return this.reject('bad pairing token');
      clearTimeout(this.helloTimer);
      this.paired = true;
      this.send({ type: 'welcome', version: PROTOCOL_VERSION });
      this.hooks.onPaired?.();
      return;
    }
    if (msg.type === 'result') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new BridgeError(msg.error));
    } else if (msg.type === 'event') {
      this.hooks.onEvent?.(msg.event);
    }
  }

  // Send one command and wait for its result. Input is validated before it leaves the app.
  request<T = unknown>(input: CommandInput, timeoutMs = 30000): Promise<T> {
    if (!this.paired) return Promise.reject(new BridgeError('extension not paired'));
    const command = Command.parse(input);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError(`${command.op} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (d: unknown) => void, reject, timer });
      this.send({ type: 'command', id, command });
    });
  }

  closed(): void {
    clearTimeout(this.helloTimer);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new BridgeError('extension disconnected'));
    }
    this.pending.clear();
    this.paired = false;
  }

  private send(msg: ToExtension): void {
    this.transport.send(JSON.stringify(msg));
  }

  private reject(reason: string): void {
    clearTimeout(this.helloTimer);
    this.send({ type: 'rejected', reason });
    this.transport.close(4001, reason);
    this.hooks.onLog?.(`pairing rejected: ${reason}`);
  }
}
