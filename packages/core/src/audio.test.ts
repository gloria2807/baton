import { describe, expect, it } from 'vitest';
import { CUE_SAMPLE_RATE, cueWav, encodeWav, resample, rms } from './audio.js';

describe('cue audio', () => {
  it('writes a valid 16-bit mono WAV header', () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 16000);
    const v = new DataView(wav.buffer);
    const tag = (o: number) => String.fromCharCode(...wav.slice(o, o + 4));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(tag(36)).toBe('data');
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
    expect(v.getInt16(44 + 2, true)).toBe(16383);
    expect(v.getInt16(44 + 6, true)).toBe(32767);
  });

  it('pads one second of silence before and after the speech', () => {
    const speech = new Float32Array(CUE_SAMPLE_RATE / 2).fill(0.25);
    const wav = cueWav(speech, CUE_SAMPLE_RATE);
    const v = new DataView(wav.buffer);
    const frames = v.getUint32(40, true) / 2;
    expect(frames).toBe(CUE_SAMPLE_RATE * 2 + speech.length);
    expect(v.getInt16(44 + (CUE_SAMPLE_RATE - 1) * 2, true)).toBe(0);
    expect(v.getInt16(44 + CUE_SAMPLE_RATE * 2, true)).not.toBe(0);
    expect(v.getInt16(44 + (frames - 1) * 2, true)).toBe(0);
  });

  it('resamples 48 kHz to 16 kHz', () => {
    const one = new Float32Array(48000).map((_, i) => Math.sin((i / 48000) * 2 * Math.PI * 440));
    const out = resample(one, 48000, 16000);
    expect(out.length).toBe(16000);
    expect(rms(out)).toBeCloseTo(Math.SQRT1_2, 1);
  });

  it('measures silence as zero', () => {
    expect(rms(new Float32Array(100))).toBe(0);
  });
});
