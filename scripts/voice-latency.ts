// Where the time goes in the one-call voice pipeline: time to the first reasoning token, to the
// first answer token, to the transcript, and to the end, for a few recorded real commands and a
// couple of prompt variants. Spending goes through the same governor and caps as the app.
//   npx tsx scripts/voice-latency.ts [count]
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  LISTEN_SYSTEM,
  ListenReply,
  PlanStream,
  Profile,
  decodeWav,
  encodeWav,
  listenText,
  trimSilence,
} from '../packages/core/src/index.js';
import { Governor, Model, type SpendState } from '../packages/model/src/index.js';
import { writeFileSync } from 'node:fs';

process.loadEnvFile('.env');
const appData = process.env.APPDATA ?? join(homedir(), '.config');
const spendFile = join(appData, 'Baton', 'spend.json');
const governor = new Governor({
  maxConcurrent: 1,
  dailyBudgetUsd: Number(process.env.BATON_DAILY_BUDGET_USD ?? 3),
  totalBudgetUsd: process.env.BATON_TOTAL_BUDGET_USD ? Number(process.env.BATON_TOTAL_BUDGET_USD) : undefined,
  load: () => JSON.parse(readFileSync(spendFile, 'utf8')) as SpendState,
  save: (s) => writeFileSync(spendFile, JSON.stringify(s)),
});
const model = new Model(process.env.BASETEN_API_KEY ?? '', governor);
const profile = Profile.parse(JSON.parse(readFileSync('demo-sites/profile.json', 'utf8')));

const cues = readdirSync('out/cues')
  .filter((f) => /^cue-[0-9a-z]+\.json$/.test(f))
  .map(
    (f) =>
      JSON.parse(readFileSync(join('out/cues', f), 'utf8')) as { id: string; anchors: never[]; durationMs: number },
  );
const recs = readdirSync('out/recordings').map((f) => ({
  f,
  t: Date.parse(f.slice(4, -4).replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z/, 'T$1:$2:$3.$4Z')),
}));
const pairs = cues
  .map((c) => ({
    c,
    r: recs.filter((r) => r.t >= parseInt(c.id.slice(4), 36) && r.t - parseInt(c.id.slice(4), 36) < 60000)[0],
  }))
  .filter((p) => p.r)
  .slice(0, Number(process.argv[2] ?? 3));

// Audio variants: as recorded (1 s of padding each side), or with the silence trimmed and less padding.
const repad = (pad: number) => (wav: Uint8Array) => {
  const { samples, sampleRate } = decodeWav(wav);
  return encodeWav(trimSilence(samples, sampleRate), sampleRate, pad);
};
const variants: Record<string, (wav: Uint8Array) => Uint8Array> = {
  'pad 1 s': (w) => w,
  'trim 0.5': repad(0.5),
  'trim 0.25': repad(0.25),
};

for (const [name, shape] of Object.entries(variants)) {
  const system = LISTEN_SYSTEM;
  for (const { c, r } of pairs) {
    const wav = shape(new Uint8Array(readFileSync(join('out/recordings', r!.f))));
    const audioSeconds = (wav.byteLength - 44) / 2 / 16000;
    const s = new PlanStream();
    const t0 = performance.now();
    let firstReasoning = 0;
    let firstContent = 0;
    let heard = 0;
    let reasoningChars = 0;
    const out = await model.listen(
      ListenReply,
      wav,
      system,
      listenText({
        anchors: c.anchors,
        profile,
        sites: 'Use the real public websites that fit.',
        heldMs: c.durationMs,
      }),
      {
        onReasoning: (all) => {
          firstReasoning ||= performance.now() - t0;
          reasoningChars = all.length;
        },
        onContent: (all) => {
          firstContent ||= performance.now() - t0;
          if (!heard && s.feed(all).transcript !== undefined) heard = performance.now() - t0;
        },
      },
    );
    const ms = (x: number) => (x / 1000).toFixed(2).padStart(5);
    console.log(
      `${name.padEnd(9)} ${audioSeconds.toFixed(1)} s audio  ${c.id}  first reasoning ${ms(firstReasoning)} s · first answer ${ms(firstContent)} s · transcript ${ms(heard)} s · done ${ms(performance.now() - t0)} s · reasoning ${reasoningChars} chars · “${out.value.transcript}” → ${out.value.move.kind}`,
    );
  }
}
console.log(`spent today $${governor.spentToday.toFixed(3)}; total $${governor.spentTotal.toFixed(3)}`);
