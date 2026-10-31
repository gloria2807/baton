// Live captions while the person speaks: Whisper tiny (English, quantized) running locally in this
// renderer through transformers.js and ONNX Runtime Web. They are for display only. Muse Spark Open
// still hears the original audio, and its transcript replaces the caption and is what Baton acts on.

import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { CUE_SAMPLE_RATE, resample } from '@baton/core/audio';

// Everything is served from the app's own files (the baton-asset protocol); nothing is fetched online.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = 'baton-asset://models/';
env.useBrowserCache = false;
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: string; numThreads?: number } };
if (onnx.wasm) {
  onnx.wasm.wasmPaths = 'baton-asset://ort/';
  onnx.wasm.numThreads = 1; // no cross-origin isolation in the Podium, so no threads
}

export class Captions {
  private asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
  private busy = false;
  updates = 0;

  warm() {
    this.asr ??= pipeline('automatic-speech-recognition', 'whisper-tiny.en', {
      dtype: 'q8',
      device: 'wasm',
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
    this.asr.catch(() => (this.asr = null));
    return this.asr;
  }

  // Caption the audio so far; skipped if the last caption is still being worked out.
  async caption(samples: Float32Array, sampleRate: number): Promise<string | null> {
    if (this.busy || samples.length < sampleRate * 0.4) return null;
    this.busy = true;
    try {
      const asr = await this.warm();
      const audio = resample(samples, sampleRate, CUE_SAMPLE_RATE);
      const out = (await asr(audio)) as { text?: string } | Array<{ text?: string }>;
      const text = (Array.isArray(out) ? out[0]?.text : out.text)?.trim() ?? '';
      if (text) this.updates++;
      return text || null;
    } finally {
      this.busy = false;
    }
  }
}
