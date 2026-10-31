// Parallel benchmark: each multi-part request is planned once by the conductor, then run by one
// lane doing every part in order and by the conductor running the parts in parallel. Same plan,
// same model, same checks; the only difference is parallelism.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CueMove,
  Profile,
  Score,
  cueMessages,
  runScore,
  tile,
  type LaneOutcome,
  type PartResult,
  type PreApproval,
  type Supervisor,
} from '@baton/core';
import type { Model } from '@baton/model';
import { screen } from 'electron';
import { MULTI_TASKS, type MultiTask } from '../../../../bench/multi';
import type { BridgeServer } from './bridge-server';
import { LANE_COLORS, SITES } from './conductor';
import { toOpenAI } from '@baton/model';
import { costUsd, launchLane } from './lanes';
import { log } from './log';
import { repoRoot } from './paths';

interface ModeResult {
  ok: boolean;
  detail: string;
  seconds: number;
  steps: number;
  costUsd: number;
  lanes: number;
}

const unattended: Supervisor = {
  approve: async () => false,
  ask: async () => ({ stop: true }),
  injection: async () => 'stop',
  status: () => undefined,
  shouldStop: () => false,
};

async function reset() {
  await fetch('http://127.0.0.1:4400/__reset', { method: 'POST' });
}

function preApproval(task: MultiTask): PreApproval | undefined {
  if (!task.preApprove?.length) return undefined;
  return {
    categories: [...new Set(task.preApprove.map((p) => p.category))],
    hosts: [...new Set(task.preApprove.map((p) => p.host))],
  };
}

async function plan(model: Model, task: MultiTask): Promise<Score> {
  const profile = Profile.parse(JSON.parse(readFileSync(join(repoRoot, 'demo-sites', 'profile.json'), 'utf8')));
  const r = await model.json(
    CueMove,
    toOpenAI(cueMessages({ transcript: task.request, intent: '', anchors: [], references: [], profile, sites: SITES })),
    'low',
  );
  const move = r.value;
  if (move.kind === 'score') return Score.parse(move);
  if (move.kind === 'task')
    return Score.parse({
      title: move.name,
      parts: [{ id: 'task', name: move.name, goal: move.goal, startUrl: move.startUrl }],
    });
  throw new Error(`planned as ${move.kind}, not a task`);
}

const textOf = (o: { result: string; data?: unknown; notes?: string[] }) =>
  [o.result, o.data === undefined ? '' : JSON.stringify(o.data), ...(o.notes ?? [])].join('\n');

async function sequential(
  bridge: BridgeServer,
  model: Model,
  task: MultiTask,
  score: Score,
  runId: string,
): Promise<ModeResult> {
  const goal = `Do all of these, one after another, then finish with every result:\n${score.parts.map((p, i) => `${i + 1}. ${p.goal}`).join('\n')}`;
  const { workArea } = screen.getPrimaryDisplay();
  const t0 = Date.now();
  const out = await launchLane(bridge, model, unattended, {
    runId,
    laneId: `${task.id}-seq`.slice(0, 32),
    name: 'One lane',
    color: LANE_COLORS[0]!,
    spec: { goal, startUrl: score.parts[0]!.startUrl, preApproved: preApproval(task) },
    bounds: tile(1, workArea, 110)[0],
  });
  const check = await task.check({ text: textOf(out), json: (u) => fetch(u).then((r) => r.json()) });
  return {
    ...check,
    ok: check.ok && out.status === 'done',
    seconds: (Date.now() - t0) / 1000,
    steps: out.steps,
    costUsd: costUsd(out.usage),
    lanes: 1,
  };
}

async function parallel(
  bridge: BridgeServer,
  model: Model,
  task: MultiTask,
  score: Score,
  runId: string,
): Promise<ModeResult> {
  const { workArea } = screen.getPrimaryDisplay();
  const bounds = tile(score.parts.length, workArea, 110);
  const outcomes: LaneOutcome[] = [];
  const t0 = Date.now();
  const results = await runScore(score, {
    runPart: async (part): Promise<PartResult> => {
      const i = score.parts.findIndex((p) => p.id === part.id);
      const out = await launchLane(bridge, model, unattended, {
        runId,
        laneId: `${task.id.slice(0, 20)}-${part.id}`.slice(0, 32),
        name: part.name,
        color: LANE_COLORS[i % LANE_COLORS.length]!,
        spec: { goal: part.goal, startUrl: part.startUrl, preApproved: preApproval(task) },
        bounds: bounds[i],
      });
      outcomes.push(out);
      return { status: out.status, result: textOf(out), ms: out.ms };
    },
  });
  const seconds = (Date.now() - t0) / 1000;
  const all = Object.values(results);
  const check = await task.check({
    text: all.map((r) => r.result).join('\n'),
    json: (u) => fetch(u).then((r) => r.json()),
  });
  return {
    ...check,
    ok: check.ok && all.every((r) => r.status === 'done'),
    seconds,
    steps: outcomes.reduce((a, o) => a + o.steps, 0),
    costUsd: outcomes.reduce((a, o) => a + costUsd(o.usage), 0),
    lanes: score.parts.length,
  };
}

export async function runMultiBench(bridge: BridgeServer, model: Model, only?: string[]) {
  const tasks = MULTI_TASKS.filter((t) => !only || only.includes(t.id));
  const runId = `bench-multi-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const rows: Array<{
    id: string;
    parts: number;
    plan?: string;
    sequential?: ModeResult;
    parallel?: ModeResult;
    error?: string;
  }> = [];
  log(`BENCH_MULTI ${runId}: ${tasks.length} tasks`);
  for (const task of tasks) {
    const row: (typeof rows)[number] = { id: task.id, parts: 0 };
    try {
      const score = await plan(model, task);
      row.parts = score.parts.length;
      row.plan = score.parts.map((p) => `${p.id}${p.dependsOn.length ? `←${p.dependsOn.join('+')}` : ''}`).join(', ');
      await reset();
      row.sequential = await sequential(bridge, model, task, score, runId);
      log(
        `BENCH_MULTI ${task.id} one lane: ${row.sequential.ok ? 'PASS' : 'FAIL'} ${row.sequential.seconds.toFixed(0)} s — ${row.sequential.detail}`,
      );
      await reset();
      row.parallel = await parallel(bridge, model, task, score, runId);
      log(
        `BENCH_MULTI ${task.id} conductor (${row.parts} lanes): ${row.parallel.ok ? 'PASS' : 'FAIL'} ${row.parallel.seconds.toFixed(0)} s — ${row.parallel.detail}`,
      );
    } catch (e) {
      row.error = (e as Error).message;
      log(`BENCH_MULTI ${task.id} error: ${row.error}`);
    }
    rows.push(row);
  }

  const done = rows.filter((r) => r.sequential && r.parallel);
  const sum = (f: (r: (typeof done)[number]) => number) => done.reduce((a, r) => a + f(r), 0);
  const seqPass = done.filter((r) => r.sequential!.ok).length;
  const parPass = done.filter((r) => r.parallel!.ok).length;
  const dir = join(repoRoot, 'bench', 'runs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${runId}.json`),
    JSON.stringify({ runId, model: 'meta-models/muse-spark-open-1026', rows }, null, 2),
  );
  const f = (s: number) => s.toFixed(0);
  const table = [
    `# Baton benchmark — one lane in sequence vs the conductor in parallel (${runId})`,
    '',
    'Model: meta-models/muse-spark-open-1026 on Baseten. Each request is planned once by the conductor; both modes then run the same parts.',
    '',
    '| Task | Parts | One lane | Time (s) | Conductor | Time (s) | Speed-up | Plan |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map((r) =>
      r.error
        ? `| ${r.id} | ${r.parts} | error | | error | | | ${r.error.replace(/\|/g, '/')} |`
        : `| ${r.id} | ${r.parts} | ${r.sequential!.ok ? 'pass' : '**fail**'} | ${f(r.sequential!.seconds)} | ${r.parallel!.ok ? 'pass' : '**fail**'} | ${f(r.parallel!.seconds)} | ${(r.sequential!.seconds / r.parallel!.seconds).toFixed(1)}× | ${r.plan} |`,
    ),
    '',
    `Totals over ${done.length} tasks: one lane ${seqPass}/${done.length} passed in ${f(sum((r) => r.sequential!.seconds))} s ($${sum((r) => r.sequential!.costUsd).toFixed(2)}); ` +
      `conductor ${parPass}/${done.length} passed in ${f(sum((r) => r.parallel!.seconds))} s ($${sum((r) => r.parallel!.costUsd).toFixed(2)}).`,
    '',
    'Failure details are in the JSON run file under bench/runs/.',
    '',
  ].join('\n');
  writeFileSync(join(repoRoot, 'bench', 'results-parallel.md'), table);
  log(
    `BENCH_MULTI_DONE one lane ${seqPass}/${done.length} in ${f(sum((r) => r.sequential!.seconds))} s · conductor ${parPass}/${done.length} in ${f(sum((r) => r.parallel!.seconds))} s`,
  );
}
