// Stage 0 follow-up: repeat the audio cues to measure transcription reliability, not one lucky run.
// Usage: tsx scripts/audio-repeat.ts [runs]

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import OpenAI from 'openai';

process.loadEnvFile('.env');
const client = new OpenAI({ baseURL: 'https://inference.baseten.co/v1', apiKey: process.env.BASETEN_API_KEY });
const MODEL = 'meta-models/muse-spark-open-1026';
const FIX = 'fixtures/spike';
const expected = JSON.parse(readFileSync(join(FIX, 'expected.json'), 'utf8'));
const runs = Number(process.argv[2] ?? 5);

const norm = (s: string) => s.toLowerCase().replace(/\$200/g, 'two hundred dollars').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).join(' ');

type Format = 'ogg' | 'wav' | 'webm' | 'wavpad';

function prepare(file: string, format: Format): string {
  if (format === 'webm') return join(FIX, file);
  const ext = format === 'ogg' ? 'ogg' : 'wav';
  const out = join(tmpdir(), `baton-repeat-${file}.${format}.${ext}`);
  // ogg keeps the Opus stream as is; wav decodes to 16 kHz mono PCM, the classic speech-model input;
  // wavpad adds one second of silence either side, in case very short clips are the problem.
  const args =
    format === 'ogg'
      ? ['-c:a', 'copy']
      : format === 'wav'
        ? ['-ar', '16000', '-ac', '1']
        : ['-af', 'adelay=1000:all=1,apad=pad_dur=1', '-ar', '16000', '-ac', '1'];
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', join(FIX, file), ...args, out]);
  return out;
}

async function once(path: string, mime: string, prompt: string): Promise<{ ms: number; transcript: string }> {
  const url = `data:${mime};base64,${readFileSync(path).toString('base64')}`;
  const t0 = performance.now();
  const res = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 4000,
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Reply with JSON only: {"transcript":string,"intent":string}' },
          { type: 'audio_url', audio_url: { url } } as unknown as OpenAI.Chat.Completions.ChatCompletionContentPartText,
        ],
      },
    ],
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
  const ms = performance.now() - t0;
  const text = res.choices[0]?.message.content ?? '';
  const m = text.match(/\{[\s\S]*\}/);
  let transcript = '';
  try {
    transcript = m ? JSON.parse(m[0]).transcript ?? '' : '';
  } catch {
    /* counted as a miss */
  }
  return { ms, transcript };
}

const PROMPTS = {
  plain: 'You are Baton. Transcribe the spoken request in the audio exactly, then state the intent in a few words.',
  // Tells the model what kind of speech to expect: short commands to a browser assistant.
  primed:
    'You are Baton, a voice-driven browser assistant. The audio is a short spoken command from the person, often only a few words, ' +
    'such as "get me there", "put this there", "what is this?", "now do the rest". Transcribe it exactly, then state the intent in a few words.',
};

async function main() {
  const mime = { ogg: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm', wavpad: 'audio/wav' } as const;
  const files = (process.argv[3] ?? 'cue_short.webm,cue_long.webm').split(',');
  const formats = (process.argv[4] ?? 'ogg,wav,webm,wavpad').split(',') as Format[];
  for (const file of files) {
    for (const format of formats) {
      const path = prepare(file, format);
      for (const [pname, prompt] of Object.entries(PROMPTS)) {
        const rs = await Promise.all(Array.from({ length: runs }, () => once(path, mime[format], prompt).catch((e) => ({ ms: 0, transcript: `ERROR ${(e as Error).message}` }))));
        const exact = rs.filter((r) => norm(r.transcript) === norm(expected[file].transcript)).length;
        const mean = rs.reduce((a, r) => a + r.ms, 0) / rs.length;
        console.log(`${file.padEnd(15)} ${format.padEnd(5)} ${pname.padEnd(7)} exact ${exact}/${runs} · mean ${(mean / 1000).toFixed(2)}s`);
        for (const r of rs) if (norm(r.transcript) !== norm(expected[file].transcript)) console.log(`    heard: "${r.transcript}"`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
