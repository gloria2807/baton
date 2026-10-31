// Fetches MediaPipe's hand landmark model (Google's official model bucket) into the desktop app's
// assets, once. The model runs on this computer; camera frames never leave it.
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'desktop', 'assets', 'hand_landmarker.task');

if (existsSync(out) && statSync(out).size > 1_000_000) {
  console.log(`hand model already present (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
} else {
  mkdirSync(dirname(out), { recursive: true });
  const r = await fetch(URL);
  if (!r.ok) throw new Error(`could not fetch the hand model: ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  writeFileSync(out, bytes);
  console.log(`hand model saved: ${out} (${(bytes.length / 1e6).toFixed(1)} MB)`);
}
