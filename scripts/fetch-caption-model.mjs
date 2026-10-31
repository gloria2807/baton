// Fetches Whisper tiny (English, quantized ONNX) from Hugging Face into the desktop app's assets,
// once. It runs on this computer only, to show the person's words while they speak; Muse Spark Open
// still hears the original audio, and its transcript is the one Baton acts on.
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://huggingface.co/onnx-community/whisper-tiny.en/resolve/main';
const FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];
const root = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'desktop',
  'assets',
  'models',
  'whisper-tiny.en',
);

let total = 0;
for (const f of FILES) {
  const out = join(root, f);
  if (existsSync(out) && statSync(out).size > 0) {
    total += statSync(out).size;
    continue;
  }
  mkdirSync(dirname(out), { recursive: true });
  const r = await fetch(`${REPO}/${f}`);
  if (!r.ok) throw new Error(`could not fetch ${f}: ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  writeFileSync(out, bytes);
  total += bytes.length;
}
console.log(`caption model ready: ${root} (${(total / 1e6).toFixed(1)} MB)`);
