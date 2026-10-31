// Runs bench/ tasks unattended through real lanes and writes the results table.
// Approvals beyond a task's own pre-approvals are declined; questions to the person stop the lane.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LaneStatus, Supervisor } from '@baton/core';
import type { Model } from '@baton/model';
import { TASKS } from '../../../../bench/tasks';
import type { BridgeServer } from './bridge-server';
import { LANE_COLORS, type Conductor } from './conductor';
import { costUsd, launchLane } from './lanes';
import { log } from './log';
import { repoRoot } from './paths';

export interface BenchRow {
  id: string;
  ok: boolean;
  detail: string;
  status: string;
  result: string;
  steps: number;
  seconds: number;
  manualSeconds: number;
  costUsd: number;
  tokens: { input: number; output: number };
  approvalsDeclined: string[];
  questions: string[];
  receipts: string;
}

function benchSupervisor(declined: string[], questions: string[], onStatus: (s: LaneStatus) => void): Supervisor {
  return {
    approve: async (req) => {
      declined.push(req.summary);
      return false;
    },
    ask: async (q) => {
      questions.push(q);
      return { stop: true };
    },
    injection: async () => 'stop',
    status: onStatus,
    shouldStop: () => false,
  };
}

async function resetDemoSites() {
  const r = await fetch('http://127.0.0.1:4400/__reset', { method: 'POST' });
  if (!r.ok) throw new Error('demo sites did not reset');
}

export async function runBench(bridge: BridgeServer, model: Model, conductor: Conductor, only?: string[]) {
  const tasks = TASKS.filter((t) => !only || only.includes(t.id));
  const runId = `bench-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const rows: BenchRow[] = [];
  log(`BENCH ${runId}: ${tasks.length} tasks`);
  for (const [i, task] of tasks.entries()) {
    await resetDemoSites();
    const declined: string[] = [];
    const questions: string[] = [];
    const host = new URL(task.startUrl).host;
    const out = await launchLane(
      bridge,
      model,
      benchSupervisor(declined, questions, (s) => {
        if (s.kind === 'running') log(`  ${task.id} step ${s.step}: ${s.thinking}`);
      }),
      {
        runId,
        laneId: task.id,
        name: `Bench ${i + 1}/${tasks.length}`,
        color: LANE_COLORS[i % LANE_COLORS.length]!,
        spec: {
          goal: task.goal,
          startUrl: task.startUrl,
          preApproved: task.preApprove ? { categories: task.preApprove, hosts: [host] } : undefined,
        },
        bounds: conductor.laneBounds(),
      },
    );
    let verdict = { ok: false, detail: `lane ${out.status}: ${out.result}` };
    if (out.status === 'done') {
      try {
        verdict = await task.check({ result: out.result, data: out.data, json: (u) => fetch(u).then((r) => r.json()) });
      } catch (e) {
        verdict = { ok: false, detail: `check failed: ${(e as Error).message}` };
      }
    }
    const row: BenchRow = {
      id: task.id,
      ...verdict,
      status: out.status,
      result: out.result,
      steps: out.steps,
      seconds: Math.round(out.ms / 100) / 10,
      manualSeconds: task.manualSeconds,
      costUsd: Math.round(costUsd(out.usage) * 10000) / 10000,
      tokens: out.usage,
      approvalsDeclined: declined,
      questions,
      receipts: out.receipts,
    };
    rows.push(row);
    log(`BENCH ${task.id}: ${row.ok ? 'PASS' : 'FAIL'} — ${row.detail} (${row.steps} steps, ${row.seconds} s)`);
  }

  const passed = rows.filter((r) => r.ok).length;
  const dir = join(repoRoot, 'bench', 'runs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${runId}.json`),
    JSON.stringify({ runId, model: 'meta-models/muse-spark-open-1026', rows }, null, 2),
  );
  const table = [
    `# Baton benchmark — single lane (${runId})`,
    '',
    `Model: meta-models/muse-spark-open-1026 on Baseten. ${passed} of ${rows.length} tasks passed.`,
    '',
    '| Task | Result | Steps | Time (s) | By hand (s) | Cost (USD) | Check |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.ok ? 'pass' : '**fail**'} | ${r.steps} | ${r.seconds} | ${r.manualSeconds} | ${r.costUsd.toFixed(4)} | ${r.detail.replace(/\|/g, '/')} |`,
    ),
    '',
    `Totals: ${rows.reduce((a, r) => a + r.steps, 0)} steps, ${rows.reduce((a, r) => a + r.seconds, 0).toFixed(1)} s, $${rows.reduce((a, r) => a + r.costUsd, 0).toFixed(4)}.`,
    '',
  ].join('\n');
  writeFileSync(join(repoRoot, 'bench', 'results-single-lane.md'), table);
  log(`BENCH_DONE ${passed}/${rows.length} passed`);
  return rows;
}
