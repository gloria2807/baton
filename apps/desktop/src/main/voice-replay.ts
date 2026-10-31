// Voice timing (docs/NEXT.md section 3): replays the person's real recorded commands, with the pins
// they pointed at, through a voice pipeline and measures key release → heard → planned → first lane
// open (or the spoken answer). Lanes are stopped the moment the first one opens, so a run costs
// cents. The same recordings go through the classic and the fast pipeline for a fair comparison.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Anchor } from '@baton/core';
import type { Model } from '@baton/model';
import type { Conductor } from './conductor';
import { log } from './log';
import { outDir } from './paths';

export type Pipeline = 'classic' | 'fast';

interface RecordedCue {
  id: string;
  file: string;
  transcript: string; // what was heard when it was first spoken
  anchors: Anchor[];
  heldMs: number;
}

export interface Timing {
  id: string;
  transcript: string;
  kind: string;
  heardMs?: number;
  plannedMs?: number;
  firstPartMs?: number;
  firstLaneMs?: number;
  answeredMs?: number;
  error?: string;
}

// Cue records are named by Date.now() in base 36; recordings by ISO time. Pair each record with the
// recording saved within a few seconds before it.
export function recordedCues(limit = 10): RecordedCue[] {
  const cuesDir = outDir('cues');
  const recDir = outDir('recordings');
  const recs = readdirSync(recDir)
    .filter((f) => f.endsWith('.wav'))
    .map((f) => ({ f, t: Date.parse(f.slice(4, -4).replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z/, 'T$1:$2:$3.$4Z')) }));
  const out: RecordedCue[] = [];
  for (const f of readdirSync(cuesDir).filter((x) => /^cue-[0-9a-z]+\.json$/.test(x))) {
    const j = JSON.parse(readFileSync(join(cuesDir, f), 'utf8')) as {
      id: string;
      transcript: string;
      anchors?: Anchor[];
      durationMs?: number;
    };
    const started = parseInt(j.id.slice(4), 36);
    const rec = recs.filter((r) => r.t >= started && r.t - started < 60_000).sort((a, b) => a.t - b.t)[0];
    if (!rec || !j.anchors?.length) continue;
    out.push({
      id: j.id,
      file: join(recDir, rec.f),
      transcript: j.transcript,
      anchors: j.anchors,
      heldMs: j.durationMs ?? 3000,
    });
  }
  return out.slice(0, limit);
}

export async function replayVoice(
  model: Model,
  conductor: Conductor,
  pipeline: Pipeline,
  limit = 10,
): Promise<Timing[]> {
  const cues = recordedCues(limit);
  log(`VOICE_REPLAY ${pipeline}: ${cues.length} recorded commands`);
  const rows: Timing[] = [];
  for (const cue of cues) {
    const wav = new Uint8Array(readFileSync(cue.file));
    const t0 = Date.now();
    const row: Timing = { id: cue.id, transcript: '', kind: '' };
    let done!: () => void;
    const reached = new Promise<void>((r) => (done = r));
    conductor.timing = (mark, detail) => {
      const ms = Date.now() - t0;
      if (mark === 'heard') row.heardMs ??= ms;
      if (mark === 'planned') {
        row.plannedMs ??= ms;
        row.kind = detail ?? row.kind;
      }
      if (mark === 'part') row.firstPartMs ??= ms;
      if (mark === 'lane-open') {
        row.firstLaneMs ??= ms;
        done();
      }
      if (mark === 'answered') {
        row.answeredMs ??= ms;
        row.kind = detail ?? row.kind;
        done();
      }
    };
    try {
      let work: Promise<unknown>;
      if (pipeline === 'classic') {
        const heard = await model.transcribeCue(wav);
        row.heardMs = Date.now() - t0;
        row.transcript = heard.value.transcript;
        work = conductor.fromCue({
          id: `${cue.id}-replay`,
          transcript: heard.value.transcript,
          intent: heard.value.intent,
          anchors: cue.anchors,
          heldMs: cue.heldMs,
        });
      } else {
        work = conductor.fromAudio(
          { id: `${cue.id}-replay`, wav, anchors: cue.anchors, heldMs: cue.heldMs },
          (t) => (row.transcript = t),
        );
      }
      // The first lane opening (or the spoken answer) is the measurement; then stop everything.
      await Promise.race([reached, work, new Promise((r) => setTimeout(r, 90_000))]);
      conductor.stopAll();
      await Promise.race([work, new Promise((r) => setTimeout(r, 30_000))]);
    } catch (e) {
      row.error = (e as Error).message;
    }
    conductor.timing = null;
    conductor.reset();
    rows.push(row);
    log(
      `VOICE_REPLAY ${pipeline} ${cue.id}: “${row.transcript}” ${row.kind} heard ${row.heardMs ?? '-'} planned ${row.plannedMs ?? '-'} first part ${row.firstPartMs ?? '-'} lane ${row.firstLaneMs ?? '-'} answered ${row.answeredMs ?? '-'}${row.error ? ` error ${row.error}` : ''}`,
    );
    await new Promise((r) => setTimeout(r, 1500));
  }
  const dir = outDir('voice');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `replay-${pipeline}-${Date.now()}.json`), JSON.stringify(rows, null, 2));
  const firsts = rows
    .map((r) => r.firstLaneMs ?? r.answeredMs)
    .filter((x): x is number => x !== undefined)
    .sort((a, b) => a - b);
  const median = firsts.length ? firsts[Math.floor((firsts.length - 1) / 2)] : undefined;
  log(`VOICE_REPLAY_DONE ${pipeline}: median release → first lane or answer ${median ?? '-'} ms over ${firsts.length}`);
  return rows;
}

export function hasRecordings(): boolean {
  return existsSync(outDir('recordings'));
}
