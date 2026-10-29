// Turns push-to-talk samples into what Muse Spark Open hears best (Stage 0 model contract):
// 16 kHz mono 16-bit WAV with one second of silence before and after the speech.

export const CUE_SAMPLE_RATE = 16000;
export const CUE_PAD_SECONDS = 1;

// Linear-interpolation resampler; good enough for speech going to a model.
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = pos - i0;
    out[i] = input[i0]! * (1 - t) + input[i1]! * t;
  }
  return out;
}

export function encodeWav(samples: Float32Array, sampleRate: number, padSeconds = 0): Uint8Array {
  const pad = Math.round(padSeconds * sampleRate);
  const frames = samples.length + pad * 2;
  const buf = new ArrayBuffer(44 + frames * 2);
  const v = new DataView(buf);
  const ascii = (off: number, s: string) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + frames * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  v.setUint32(40, frames * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + (pad + i) * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export function cueWav(samples: Float32Array, recordedRate: number): Uint8Array {
  return encodeWav(resample(samples, recordedRate, CUE_SAMPLE_RATE), CUE_SAMPLE_RATE, CUE_PAD_SECONDS);
}

// Root-mean-square level, used to reject recordings that are only silence.
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}
