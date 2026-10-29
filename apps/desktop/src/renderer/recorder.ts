// Records the microphone only while the talk key is held, then hands back raw samples.

const TAP = `class Tap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('baton-tap', Tap);`;

export interface Recording {
  samples: Float32Array;
  sampleRate: number;
  seconds: number;
}

export class Recorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private chunks: Float32Array[] = [];
  private starting: Promise<void> | null = null;
  private tapUrl = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }));

  start(): Promise<void> {
    this.chunks = [];
    this.starting = (async () => {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.ctx = new AudioContext();
      await this.ctx.audioWorklet.addModule(this.tapUrl);
      const src = this.ctx.createMediaStreamSource(this.stream);
      const tap = new AudioWorkletNode(this.ctx, 'baton-tap');
      tap.port.onmessage = (e: MessageEvent<Float32Array>) => this.chunks.push(e.data);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(tap);
      src.connect(this.analyser);
    })();
    return this.starting;
  }

  // 0..1 loudness for the live waveform.
  level(): number {
    if (!this.analyser) return 0;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.min(1, Math.sqrt(sum / buf.length) * 6);
  }

  async stop(): Promise<Recording> {
    // A very quick tap can release the key before the microphone has opened.
    await this.starting?.catch(() => undefined);
    const sampleRate = this.ctx?.sampleRate ?? 48000;
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => undefined);
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    const length = this.chunks.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(length);
    let off = 0;
    for (const c of this.chunks) {
      samples.set(c, off);
      off += c.length;
    }
    this.chunks = [];
    return { samples, sampleRate, seconds: length / sampleRate };
  }
}
