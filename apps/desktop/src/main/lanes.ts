// Runs lanes for real: the core step loop wired to the extension (hands), Muse Spark Open (brain),
// the Podium (approvals and questions) and receipts on disk.

import { nativeImage } from 'electron';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LANE_TOOLS,
  ListReply,
  decisionFromToolCall,
  LookResult,
  ReadReply,
  StepDecision,
  redactSecrets,
  runLane,
  type Brain,
  type BrainReply,
  type Hands,
  type LaneMessage,
  type LaneOutcome,
  type LaneSpec,
  type ReceiptSink,
  type StepRecord,
  type Supervisor,
} from '@baton/core';
import { imagePart, type Model } from '@baton/model';
import type OpenAI from 'openai';
import type { BridgeServer } from './bridge-server';
import { log } from './log';
import { repoRoot } from './paths';

export const PRICE = { inputPerM: 1.25, outputPerM: 4.25 };

export function costUsd(u: { input: number; output: number }): number {
  return (u.input * PRICE.inputPerM + u.output * PRICE.outputPerM) / 1e6;
}

export class BridgeHands implements Hands {
  constructor(
    private bridge: BridgeServer,
    private laneId: string,
  ) {}
  async look(screenshot: boolean) {
    return LookResult.parse(await this.bridge.request({ op: 'look', laneId: this.laneId, screenshot, maxWidth: 1280 }, 30000));
  }
  async open(url: string) {
    await this.bridge.request({ op: 'navigate', laneId: this.laneId, url }, 30000);
  }
  async click(mark: number) {
    await this.bridge.request({ op: 'click', laneId: this.laneId, mark }, 20000);
  }
  async type(mark: number, text: string, submit: boolean) {
    await this.bridge.request({ op: 'type', laneId: this.laneId, mark, text, submit }, 20000);
  }
  async select(mark: number, option: string) {
    await this.bridge.request({ op: 'select', laneId: this.laneId, mark, option });
  }
  async scroll(by: { dy: number } | { mark: number }) {
    await this.bridge.request({ op: 'scroll', laneId: this.laneId, ...by });
  }
  async back() {
    await this.bridge.request({ op: 'back', laneId: this.laneId }, 20000);
  }
  async thinking(text: string) {
    await this.bridge.request({ op: 'setThinking', laneId: this.laneId, text: text.slice(0, 140) });
  }
}

function toOpenAI(messages: LaneMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((m) =>
    m.role === 'system'
      ? { role: 'system', content: typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n') }
      : { role: 'user', content: typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? { type: 'text' as const, text: p.text } : imagePart(p.jpegBase64))) },
  );
}

export class ModelBrain implements Brain {
  constructor(private model: Model) {}
  private async ask<T>(schema: Parameters<Model['json']>[0], messages: LaneMessage[]): Promise<BrainReply<T>> {
    const r = await this.model.json(schema, toOpenAI(messages), 'low');
    return { value: r.value as T, reasoning: r.reasoning, ms: r.ms, usage: r.usage && { input: r.usage.input, output: r.usage.output } };
  }
  // Lane steps use the model's native tool calling, which it follows far more reliably than a
  // JSON format described in the prompt (see the model contract in docs/SPEC.md).
  async decide(messages: LaneMessage[]): Promise<BrainReply<StepDecision>> {
    const r = await this.model.toolStep(StepDecision, toOpenAI(messages), LANE_TOOLS as OpenAI.Chat.Completions.ChatCompletionTool[], decisionFromToolCall, 'low');
    return { value: r.value, reasoning: r.reasoning, ms: r.ms, usage: r.usage && { input: r.usage.input, output: r.usage.output } };
  }
  read(messages: LaneMessage[]) {
    return this.ask<{ facts: string }>(ReadReply, messages);
  }
  list(messages: LaneMessage[]) {
    return this.ask<{ rows: Array<Record<string, unknown>> }>(ListReply, messages);
  }
}

// Receipts: one JSON line per step plus the step's screenshot, under receipts/<run>/<lane>/.
export class FileReceipts implements ReceiptSink {
  readonly dir: string;
  constructor(runId: string, laneId: string, meta: Record<string, unknown>) {
    this.dir = join(repoRoot, 'receipts', runId, laneId);
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, 'lane.json'), JSON.stringify({ ...meta, started: new Date().toISOString() }, null, 2));
  }
  step(r: StepRecord, screenshot?: string) {
    const shot = screenshot ? `step-${String(r.n).padStart(2, '0')}.jpg` : undefined;
    if (shot) writeFileSync(join(this.dir, shot), Buffer.from(screenshot!, 'base64'));
    appendFileSync(join(this.dir, 'steps.jsonl'), JSON.stringify({ ...r, screenshot: shot }) + '\n');
  }
  event(kind: string, detail: unknown) {
    appendFileSync(join(this.dir, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), kind, detail }) + '\n');
  }
  finish(outcome: LaneOutcome) {
    writeFileSync(join(this.dir, 'outcome.json'), JSON.stringify({ ...outcome, costUsd: costUsd(outcome.usage) }, null, 2));
  }
}

// Crop the element an approval is about out of the lane's screenshot, for the approval card.
export function cropElement(look: LookResult, rect: { x: number; y: number; w: number; h: number }): string | undefined {
  if (!look.screenshot) return undefined;
  const img = nativeImage.createFromBuffer(Buffer.from(look.screenshot, 'base64'));
  const { width, height } = img.getSize();
  const pad = 70 * look.scale;
  const x = Math.max(0, Math.round(rect.x * look.scale - pad));
  const y = Math.max(0, Math.round(rect.y * look.scale - pad * 0.6));
  const w = Math.min(width - x, Math.round(rect.w * look.scale + pad * 2));
  const h = Math.min(height - y, Math.round(rect.h * look.scale + pad * 1.2));
  if (w <= 0 || h <= 0) return undefined;
  return `data:image/jpeg;base64,${img.crop({ x, y, width: w, height: h }).toJPEG(85).toString('base64')}`;
}

export interface LaneLaunch {
  runId: string;
  laneId: string;
  name: string;
  color: string;
  spec: LaneSpec & { startUrl: string };
  bounds?: { left: number; top: number; width: number; height: number };
  keepOpen?: boolean;
}

export async function launchLane(bridge: BridgeServer, model: Model, supervisor: Supervisor, launch: LaneLaunch): Promise<LaneOutcome & { receipts: string }> {
  // A lane never types passwords or card numbers, so it never needs them: mask them before anything sees the goal.
  const l = { ...launch, spec: { ...launch.spec, goal: redactSecrets(launch.spec.goal) } };
  const receipts = new FileReceipts(l.runId, l.laneId, { name: l.name, color: l.color, goal: l.spec.goal, startUrl: l.spec.startUrl });
  log(`lane ${l.laneId} starting (${l.name})`);
  await bridge.request({ op: 'openLane', laneId: l.laneId, url: l.spec.startUrl, color: l.color, title: l.name, bounds: l.bounds }, 30000);
  const hands = new BridgeHands(bridge, l.laneId);
  let outcome: LaneOutcome;
  try {
    // The lane window already opened at the start URL.
    outcome = await runLane({ ...l.spec, startUrl: undefined }, hands, new ModelBrain(model), supervisor, receipts);
  } catch (e) {
    outcome = { status: 'failed', result: `Lane error: ${(e as Error).message}`, notes: [], steps: 0, ms: 0, usage: { input: 0, output: 0 } };
    supervisor.status({ kind: 'stopped', reason: outcome.result });
  }
  receipts.finish(outcome);
  log(`lane ${l.laneId} ${outcome.status} in ${outcome.steps} steps, ${(outcome.ms / 1000).toFixed(1)} s, $${costUsd(outcome.usage).toFixed(4)}`);
  if (!l.keepOpen) await bridge.request({ op: 'closeLane', laneId: l.laneId }).catch(() => undefined);
  return { ...outcome, receipts: receipts.dir };
}
