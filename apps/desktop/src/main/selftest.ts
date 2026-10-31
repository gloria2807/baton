// Stage 1 gate: open a lane on Ledgerly, glide the ghost cursor to "+ New bill", click it and
// return a screenshot with marks. Everything here goes through the real bridge and extension.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LookResult } from '@baton/core';
import type { BridgeServer } from './bridge-server';
import { log } from './log';
import { outDir } from './paths';

const LEDGERLY = 'http://localhost:4401/';

export interface SelfTestResult {
  ok: boolean;
  steps: Array<{ step: string; ms: number; detail: string }>;
  screenshots: string[];
  error?: string;
}

export async function laneSelfTest(
  bridge: BridgeServer,
  bounds?: { left: number; top: number; width: number; height: number },
): Promise<SelfTestResult> {
  const dir = outDir('selftest');
  const steps: SelfTestResult['steps'] = [];
  const screenshots: string[] = [];
  const step = async <T>(name: string, fn: () => Promise<T>, describe: (r: T) => string): Promise<T> => {
    const t0 = Date.now();
    const r = await fn();
    steps.push({ step: name, ms: Date.now() - t0, detail: describe(r) });
    log(`selftest ${name}: ${describe(r)} (${Date.now() - t0} ms)`);
    return r;
  };
  const save = (name: string, look: LookResult) => {
    if (!look.screenshot) return;
    const file = join(dir, name);
    writeFileSync(file, Buffer.from(look.screenshot, 'base64'));
    screenshots.push(file);
  };

  try {
    await step(
      'openLane',
      () =>
        bridge.request({
          op: 'openLane',
          laneId: 'blue',
          url: LEDGERLY,
          color: '#4d7bd8',
          title: 'Blue · Ledgerly',
          bounds,
        }),
      () => 'lane window open on Ledgerly',
    );
    await bridge.request({ op: 'setThinking', laneId: 'blue', text: 'Looking for the New bill button' });
    const before = await step(
      'look',
      () => bridge.request<LookResult>({ op: 'look', laneId: 'blue' }, 20000),
      (l) => `${l.elements.length} marks on ${l.url}`,
    );
    save('1-before-marks.jpg', before);
    const target = before.elements.find((e) => /new bill/i.test(e.name));
    if (!target) throw new Error('no "New bill" element in the element list');
    await bridge.request({ op: 'setThinking', laneId: 'blue', text: `Found “${target.name}” at mark ${target.mark}` });
    await step(
      'moveCursor',
      () => bridge.request({ op: 'moveCursor', laneId: 'blue', mark: target.mark }),
      () => `cursor at mark ${target.mark} (${target.name})`,
    );
    await new Promise((r) => setTimeout(r, 400)); // let the eye settle on the target before clicking
    await step(
      'click',
      () => bridge.request({ op: 'click', laneId: 'blue', mark: target.mark }),
      () => `clicked mark ${target.mark}`,
    );
    await bridge.request({ op: 'setThinking', laneId: 'blue', text: 'Checking the New bill form opened' });
    const after = await step(
      'verify',
      () => bridge.request<LookResult>({ op: 'look', laneId: 'blue' }, 20000),
      (l) => `${l.url} · ${l.elements.length} marks`,
    );
    save('2-after-click-marks.jpg', after);
    const opened = after.url.endsWith('/bills/new') && after.elements.some((e) => /vendor/i.test(e.name));
    if (!opened) throw new Error(`expected the New bill form, got ${after.url}`);
    await bridge.request({ op: 'setThinking', laneId: 'blue', text: 'Done: the New bill form is open' });
    const result: SelfTestResult = { ok: true, steps, screenshots };
    writeFileSync(join(dir, 'result.json'), JSON.stringify(result, null, 2));
    return result;
  } catch (e) {
    const result: SelfTestResult = { ok: false, steps, screenshots, error: (e as Error).message };
    writeFileSync(join(dir, 'result.json'), JSON.stringify(result, null, 2));
    log(`selftest FAILED: ${(e as Error).message}`);
    return result;
  }
}
