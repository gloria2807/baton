// Records the microphone only while the talk key is held, then hands back raw samples.
// The audio graph (context, worklet, analyser) is built once and kept suspended, so pressing the
// key only has to open the microphone itself; the microphone is never open between cues.

const TAP = `class Tap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('baton-tap', Tap);`;

export interface Recording {
  samples: Float32Array;
  sampleRate: number;
  seconds: number;
  // Key-to-first-audio time: how much speech the start of a cue could lose.
  openMs: number | null;
  timing: string;
}

interface Graph {
  ctx: AudioContext;
  tap: AudioWorkletNode;
  analyser: AnalyserNode;
}

export class Recorder {
  private graph: Promise<Graph> | null = null;
  private ready: Graph | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private recording = false;
  private startedAt = 0;
  private firstAudioAt: number | null = null;
  private starting: Promise<void> | null = null;
  private micOpenAt = 0;
  private resumedAt = 0;
  private onAudio: (() => void) | null = null;
  // Voice processing costs only ≈50 ms to start (measured) and helps transcription, so it stays on.
  private constraints: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  // Build the audio graph ahead of time. Safe to call more than once.
  warm(): Promise<Graph> {
    this.graph ??= (async () => {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const tap = new AudioWorkletNode(ctx, 'baton-tap');
      tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (!this.recording) return;
        if (this.firstAudioAt === null) {
          this.firstAudioAt = performance.now();
          this.onAudio?.();
        }
        this.chunks.push(e.data);
      };
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      await ctx.suspend();
      this.ready = { ctx, tap, analyser };
      return this.ready;
    })();
    this.graph.catch(() => (this.graph = null)); // retry on the next cue if it failed
    return this.graph;
  }

  // `onAudio` fires when the first real samples arrive: only then is speech being captured.
  start(onAudio?: () => void): Promise<void> {
    this.chunks = [];
    this.recording = true;
    this.startedAt = performance.now();
    this.firstAudioAt = null;
    this.onAudio = onAudio ?? null;
    this.starting = (async () => {
      // Opening the Windows microphone is the slow part (≈400–650 ms); resume the graph meanwhile.
      const [g, stream] = await Promise.all([
        this.warm().then(async (g) => {
          await g.ctx.resume();
          this.resumedAt = performance.now();
          return g;
        }),
        navigator.mediaDevices.getUserMedia({ audio: this.constraints }).then((s) => {
          this.micOpenAt = performance.now();
          return s;
        }),
      ]);
      // The key may have been released while the microphone was opening.
      if (!this.recording) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.source = g.ctx.createMediaStreamSource(stream);
      this.source.connect(g.tap);
      this.source.connect(g.analyser);
    })();
    return this.starting;
  }

  // 0..1 loudness for the live waveform.
  level(): number {
    const analyser = this.ready?.analyser;
    if (!this.source || !analyser) return 0;
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.min(1, Math.sqrt(sum / buf.length) * 6);
  }

  // The audio captured so far, for live captions while the key is still held.
  snapshot(): { samples: Float32Array; sampleRate: number } {
    const length = this.chunks.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(length);
    let off = 0;
    for (const c of this.chunks) {
      samples.set(c, off);
      off += c.length;
    }
    return { samples, sampleRate: this.ready?.ctx.sampleRate ?? 48000 };
  }

  async stop(): Promise<Recording> {
    // A very quick tap can release the key before the microphone has opened.
    this.recording = false;
    this.onAudio = null;
    await this.starting?.catch(() => undefined);
    const g = await this.graph?.catch(() => null);
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    await g?.ctx.suspend().catch(() => undefined);
    const sampleRate = g?.ctx.sampleRate ?? 48000;
    const length = this.chunks.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(length);
    let off = 0;
    for (const c of this.chunks) {
      samples.set(c, off);
      off += c.length;
    }
    this.chunks = [];
    const openMs = this.firstAudioAt === null ? null : Math.round(this.firstAudioAt - this.startedAt);
    const timing = `mic open ${Math.round(this.micOpenAt - this.startedAt)} ms, graph running ${Math.round(this.resumedAt - this.startedAt)} ms`;
    return { samples, sampleRate, seconds: length / sampleRate, openMs, timing };
  }
}
