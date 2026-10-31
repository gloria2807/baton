// Runs bench/real on real websites in the person's own Chrome and writes bench/results-real.md:
// success, steps, time, cost, what needed the person, and what Baton cleared out of the way
// (consent banners, pop-ups). Single-lane tasks run one lane each; multi-part requests are planned
// by the conductor once and run both by one lane in sequence and by lanes in parallel.
// Approvals beyond a task's own pre-approvals are declined; questions are recorded and stop the lane.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CueMove,
  Profile,
  Score,
  cueMessages,
  runScore,
  tile,
  type LaneOutcome,
  type LookResult,
  type PreApproval,
  type Supervisor,
} from '@baton/core';
import { toOpenAI, type Model } from '@baton/model';
import { screen } from 'electron';
import { realMultiTasks, realTasks, type RealEnv, type RealReader, type RealTask } from '../../../../bench/real/tasks';
import type { BridgeServer } from './bridge-server';
import { LANE_COLORS } from './conductor';
import { costUsd, launchLane } from './lanes';
import { log } from './log';
import { repoRoot } from './paths';

const REAL_SITES = `Use the real public websites that fit the request (the maker's or organisation's own site first). The person's own Chrome is signed in to Google, so Gmail, Google Calendar, Google Docs and Google Sheets are theirs to use. Never use the fictional localhost demo sites.`;

interface Run {
  ok: boolean;
  detail: string;
  status: string;
  steps: number;
  seconds: number;
  costUsd: number;
  lanes: number;
  person: string[]; // what needed the person: questions, declined approvals, bot checks
  cleared: number; // consent banners and pop-ups Baton cleared
  stoppedByOverlay: boolean;
}

interface Row {
  id: string;
  kind: string;
  mode: 'one lane' | 'one lane, all parts' | 'conductor';
  attempt: number;
  run?: Run;
  error?: string;
}

function preApproval(task: RealTask): PreApproval | undefined {
  if (!task.preApprove?.length) return undefined;
  return {
    categories: [...new Set(task.preApprove.map((p) => p.category))],
    hosts: [...new Set(task.preApprove.map((p) => p.host))],
  };
}

function unattended(person: string[]): Supervisor {
  return {
    approve: async (req) => (person.push(`declined: ${req.summary}`), false),
    ask: async (q) => (person.push(`asked: ${q.slice(0, 120)}`), { stop: true }),
    injection: async () => 'stop',
    status: () => undefined,
    shouldStop: () => false,
  };
}

// What the receipts say was cleared, and whether a banner or pop-up is what stopped the lane.
function receiptFacts(dir: string, out: LaneOutcome): { cleared: number; stoppedByOverlay: boolean } {
  const file = join(dir, 'events.jsonl');
  const events = existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { kind: string; detail: { cleared?: string[] } })
    : [];
  const cleared = events.filter((e) => e.kind === 'tidy').reduce((a, e) => a + (e.detail.cleared?.length ?? 0), 0);
  const stoppedByOverlay =
    out.status !== 'done' &&
    /cookie|consent|pop-?up|overlay|modal|banner|covering/i.test(`${out.result} ${out.notes.join(' ')}`);
  return { cleared, stoppedByOverlay };
}

const textOf = (o: { result: string; data?: unknown; notes?: string[] }) =>
  [o.result, o.data === undefined ? '' : JSON.stringify(o.data), ...(o.notes ?? [])].join('\n');

function reader(bridge: BridgeServer): RealReader {
  // A short-lived window, read without the model, then closed.
  const withWindow = async <T>(url: string, fn: () => Promise<T>) => {
    await bridge.request(
      { op: 'openLane', laneId: 'bench-check', url, color: '#7c8a9e', title: 'Checking the result' },
      30000,
    );
    try {
      return await fn();
    } finally {
      await bridge.request({ op: 'closeLane', laneId: 'bench-check' }).catch(() => undefined);
    }
  };
  const look = () => bridge.request<LookResult>({ op: 'look', laneId: 'bench-check', screenshot: false }, 30000);
  return {
    page: (url) =>
      withWindow(url, async () => {
        // Gmail and Calendar fill in their results a moment after the page loads.
        let text = (await look()).text;
        for (let i = 0; i < 3 && text.length < 400; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          text = (await look()).text;
        }
        await new Promise((r) => setTimeout(r, 1500));
        return `${text}\n${(await look()).text}`;
      }),
    sheet: (url) =>
      withWindow(url, async () => String(await bridge.request({ op: 'sheetRead', laneId: 'bench-check' }, 30000))),
    doc: (url) =>
      withWindow(url, async () => String(await bridge.request({ op: 'docRead', laneId: 'bench-check' }, 30000))),
  };
}

async function oneLane(
  bridge: BridgeServer,
  model: Model,
  task: RealTask,
  goal: string,
  runId: string,
  laneId: string,
): Promise<Run> {
  const person: string[] = [];
  const { workArea } = screen.getPrimaryDisplay();
  const t0 = Date.now();
  const out = await launchLane(bridge, model, unattended(person), {
    runId,
    laneId,
    name: task.id,
    color: LANE_COLORS[0]!,
    spec: { goal, startUrl: task.startUrl, preApproved: preApproval(task) },
    bounds: tile(1, workArea, 110)[0],
  });
  const verdict =
    out.status === 'done'
      ? await task
          .check({ text: textOf(out), read: reader(bridge) })
          .catch((e: Error) => ({ ok: false, detail: `check failed: ${e.message}` }))
      : { ok: false, detail: `lane ${out.status}: ${out.result.slice(0, 160)}` };
  return {
    ...verdict,
    status: out.status,
    steps: out.steps,
    seconds: (Date.now() - t0) / 1000,
    costUsd: costUsd(out.usage),
    lanes: 1,
    person,
    ...receiptFacts(out.receipts, out),
  };
}

async function plan(model: Model, task: RealTask): Promise<Score> {
  const profile = Profile.parse(JSON.parse(readFileSync(join(repoRoot, 'demo-sites', 'profile.json'), 'utf8')));
  const move = (
    await model.json(
      CueMove,
      toOpenAI(
        cueMessages({ transcript: task.request, intent: '', anchors: [], references: [], profile, sites: REAL_SITES }),
      ),
      'low',
    )
  ).value;
  if (move.kind === 'score') return Score.parse(move);
  if (move.kind === 'task')
    return Score.parse({
      title: move.name,
      parts: [{ id: 'task', name: move.name, goal: move.goal, startUrl: move.startUrl }],
    });
  throw new Error(`planned as ${move.kind}, not as work for lanes`);
}

async function conductor(
  bridge: BridgeServer,
  model: Model,
  task: RealTask,
  score: Score,
  runId: string,
  attempt: number,
): Promise<Run> {
  const person: string[] = [];
  const { workArea } = screen.getPrimaryDisplay();
  const bounds = tile(Math.min(score.parts.length, 4), workArea, 110);
  const outcomes: Array<LaneOutcome & { receipts: string }> = [];
  const t0 = Date.now();
  let slot = 0;
  const results = await runScore(score, {
    limit: 4,
    runPart: async (part) => {
      const i = score.parts.findIndex((p) => p.id === part.id);
      const out = await launchLane(bridge, model, unattended(person), {
        runId,
        laneId: `${task.id.slice(0, 14)}-${attempt}-${part.id}`.replace(/[^a-z0-9-]/g, '-').slice(0, 32),
        name: part.name,
        color: LANE_COLORS[i % LANE_COLORS.length]!,
        spec: { goal: part.goal, startUrl: part.startUrl, preApproved: preApproval(task) },
        bounds: bounds[slot++ % bounds.length],
      });
      outcomes.push(out);
      return { status: out.status, result: textOf(out), ms: out.ms };
    },
  });
  const all = Object.values(results);
  const text = all.map((r) => r.result).join('\n');
  const verdict = await task
    .check({ text, read: reader(bridge) })
    .catch((e: Error) => ({ ok: false, detail: `check failed: ${e.message}` }));
  const facts = outcomes.map((o) => receiptFacts(o.receipts, o));
  return {
    ...verdict,
    ok: verdict.ok && all.every((r) => r.status === 'done'),
    status: all.every((r) => r.status === 'done') ? 'done' : 'partly done',
    steps: outcomes.reduce((a, o) => a + o.steps, 0),
    seconds: (Date.now() - t0) / 1000,
    costUsd: outcomes.reduce((a, o) => a + costUsd(o.usage), 0),
    lanes: score.parts.length,
    person,
    cleared: facts.reduce((a, f) => a + f.cleared, 0),
    stoppedByOverlay: facts.some((f) => f.stoppedByOverlay),
  };
}

export interface RealBenchOptions {
  only?: string[];
  repeat?: number;
  multi?: boolean; // run the multi-part requests (both modes) instead of the single-lane tasks
}

export async function runRealBench(bridge: BridgeServer, model: Model, opts: RealBenchOptions = {}) {
  const env: RealEnv = {
    token: `BB${Date.now().toString(36).slice(-5).toUpperCase()}`,
    sheetUrl: process.env.BATON_TEST_SHEET_URL,
    docUrl: process.env.BATON_TEST_DOC_URL,
  };
  const tasks = (opts.multi ? realMultiTasks(env) : realTasks(env)).filter(
    (t) => !opts.only || opts.only.includes(t.id),
  );
  const repeat = Math.max(1, Math.min(5, opts.repeat ?? 1));
  const runId = `real-${opts.multi ? 'multi-' : ''}${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const rows: Row[] = [];
  log(`BENCH_REAL ${runId}: ${tasks.length} tasks × ${repeat} (token ${env.token})`);
  for (const task of tasks) {
    for (let attempt = 1; attempt <= repeat; attempt++) {
      const laneId = `${task.id}-${attempt}`.slice(0, 32);
      try {
        if (!opts.multi) {
          const run = await oneLane(bridge, model, task, task.request, runId, laneId);
          rows.push({ id: task.id, kind: task.kind, mode: 'one lane', attempt, run });
        } else {
          const score = await plan(model, task);
          const seqGoal = `Do all of these, one after another, then finish with every result:\n${score.parts.map((p, i) => `${i + 1}. ${p.goal}`).join('\n')}`;
          const seq = await oneLane(
            bridge,
            model,
            { ...task, startUrl: score.parts[0]!.startUrl },
            seqGoal,
            runId,
            `${laneId}-seq`.slice(0, 32),
          );
          rows.push({ id: task.id, kind: task.kind, mode: 'one lane, all parts', attempt, run: seq });
          const par = await conductor(bridge, model, task, score, runId, attempt);
          rows.push({ id: task.id, kind: task.kind, mode: 'conductor', attempt, run: par });
        }
      } catch (e) {
        rows.push({
          id: task.id,
          kind: task.kind,
          mode: opts.multi ? 'conductor' : 'one lane',
          attempt,
          error: (e as Error).message,
        });
      }
      const last = rows.at(-1)!;
      log(
        `BENCH_REAL ${task.id} #${attempt} ${last.mode}: ${last.run ? `${last.run.ok ? 'PASS' : 'FAIL'} ${last.run.seconds.toFixed(0)} s $${last.run.costUsd.toFixed(3)} — ${last.run.detail}` : `ERROR ${last.error}`}`,
      );
    }
  }

  const dir = join(repoRoot, 'bench', 'runs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${runId}.json`),
    JSON.stringify({ runId, token: env.token, model: 'meta-models/muse-spark-open-1026', rows }, null, 2),
  );
  const done = rows.filter((r) => r.run);
  const pass = done.filter((r) => r.run!.ok).length;
  const cell = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ');
  const table = [
    `## ${opts.multi ? 'Multi-part requests' : 'Everyday tasks'} on real websites (${runId})`,
    '',
    `Model: meta-models/muse-spark-open-1026 on Baseten, in the person's own signed-in Chrome. ${pass} of ${rows.length} runs passed. Banners and pop-ups cleared: ${done.reduce((a, r) => a + r.run!.cleared, 0)}; lanes stopped by one: ${done.filter((r) => r.run!.stoppedByOverlay).length}.`,
    '',
    '| Task | Site | Mode | Run | Result | Steps | Time (s) | Cost (USD) | Needed the person | Cleared | Check |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) =>
      r.run
        ? `| ${r.id} | ${r.kind} | ${r.mode} | ${r.attempt} | ${r.run.ok ? 'pass' : '**fail**'} | ${r.run.steps} | ${r.run.seconds.toFixed(0)} | ${r.run.costUsd.toFixed(3)} | ${cell(r.run.person.join('; ') || 'nothing')} | ${r.run.cleared} | ${cell(r.run.detail)} |`
        : `| ${r.id} | ${r.kind} | ${r.mode} | ${r.attempt} | **error** | | | | | | ${cell(r.error ?? '')} |`,
    ),
    '',
    `Totals: ${done.reduce((a, r) => a + r.run!.steps, 0)} steps, ${done.reduce((a, r) => a + r.run!.seconds, 0).toFixed(0)} s, $${done.reduce((a, r) => a + r.run!.costUsd, 0).toFixed(2)}.`,
    '',
  ].join('\n');
  const out = join(repoRoot, 'bench', 'results-real.md');
  const prior = existsSync(out)
    ? readFileSync(out, 'utf8')
    : '# Baton benchmark — real websites\n\nEach section is one run of `--bench-real` (single lanes) or `--bench-real-multi` (planned requests, one lane against the conductor). Task definitions and checks: bench/real/tasks.ts.\n\n';
  writeFileSync(out, `${prior}${table}\n`);
  log(`BENCH_REAL_DONE ${pass}/${rows.length} passed`);
  return rows;
}
