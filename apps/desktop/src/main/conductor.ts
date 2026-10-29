// The conductor (Stage 2: one lane at a time). It turns a spoken cue into a lane, shows the lane's
// status on the Podium, and owns the cards that wait for the person: approvals, questions and
// injection warnings, answerable by click or by voice.

import { screen } from 'electron';
import { z } from 'zod';
import { voiceAnswer, type InjectionFinding, type LaneStatus, type Supervisor } from '@baton/core';
import type { Model } from '@baton/model';
import type { BridgeServer } from './bridge-server';
import { costUsd, cropElement, launchLane } from './lanes';
import { log } from './log';

export const LANE_COLORS = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#ef4444'];

export interface LaneView {
  laneId: string;
  name: string;
  color: string;
  state: LaneStatus['kind'];
  line: string;
  step: number;
}

export type Card =
  | { kind: 'approval'; id: number; laneId: string; laneName: string; color: string; summary: string; reason: string; image?: string }
  | { kind: 'question'; id: number; laneId: string; laneName: string; color: string; question: string }
  | { kind: 'injection'; id: number; laneId: string; laneName: string; color: string; url: string; findings: Array<{ source: string; text: string }> }
  | { kind: 'result'; id: number; laneId: string; laneName: string; color: string; status: string; result: string; detail: string };

type CardInput = Card extends infer C ? (C extends Card ? Omit<C, 'id'> : never) : never;

export type CardAnswer = { choice: 'approve' | 'decline' | 'continue' | 'stop' | 'dismiss' } | { text: string };

type Pending = { card: Card; resolve: (a: CardAnswer) => void };

// Demo sites the planner may send a lane to; real sites are allowed too.
const SITES = `Known sites (fictional demo sites, prefer them when the request matches):
- Inbox, webmail and calendar: http://localhost:4400/ (calendar: http://localhost:4400/calendar)
- Ledgerly, accounts payable (bills): http://localhost:4401/
- Roam, travel search (flights from/to airport codes LOS LIS ACC LHR NBO MAD, hotels near Doca Hall Lisbon, Atlas Summit event guide): http://localhost:4402/ (hotels: http://localhost:4402/hotels, event: http://localhost:4402/events/atlas-summit)
For anything else use the real public website that best fits (e.g. https://www.google.com/maps, https://www.openstreetmap.org, https://www.wikipedia.org).`;

const SingleLanePlan = z.object({
  name: z.string().transform((s) => s.slice(0, 24)),
  goal: z.string().min(3).max(400),
  startUrl: z.string().url(),
});

export class Conductor {
  private cards = new Map<number, Pending>();
  private nextCard = 1;
  private lanes = new Map<string, LaneView>();
  private stopRequested = new Set<string>();
  private laneCount = 0;
  busy = false;

  constructor(
    private bridge: BridgeServer,
    private getModel: () => Model | null,
    private send: (channel: string, payload: unknown) => void,
  ) {}

  // ── Cards ──────────────────────────────────────────────────────────────

  private show(card: CardInput): Promise<CardAnswer> {
    const id = this.nextCard++;
    const full = { ...card, id } as Card;
    log(`card ${id} (${card.kind}) shown for ${card.laneId}`);
    return new Promise((resolve) => {
      this.cards.set(id, { card: full, resolve });
      this.publishCards();
    });
  }

  private publishCards() {
    this.send('cards', [...this.cards.values()].map((p) => p.card));
  }

  answer(id: number, a: CardAnswer) {
    const p = this.cards.get(id);
    if (!p) return;
    this.cards.delete(id);
    this.publishCards();
    log(`card ${id} (${p.card.kind}) answered: ${'choice' in a ? a.choice : 'text'}`);
    p.resolve(a);
  }

  // A spoken cue first answers whatever card is waiting; returns true if it did.
  answerByVoice(transcript: string): boolean {
    const waiting = [...this.cards.values()].find((p) => p.card.kind !== 'result');
    if (!waiting) return false;
    const yesNo = voiceAnswer(transcript);
    const { card } = waiting;
    if (card.kind === 'approval') {
      if (!yesNo) return false;
      this.answer(card.id, { choice: yesNo === 'approved' ? 'approve' : 'decline' });
    } else if (card.kind === 'injection') {
      if (!yesNo) return false;
      this.answer(card.id, { choice: yesNo === 'approved' ? 'continue' : 'stop' });
    } else if (card.kind === 'question') {
      if (/^\s*(stop|cancel|never mind)\b/i.test(transcript)) this.answer(card.id, { choice: 'stop' });
      else this.answer(card.id, { text: transcript });
    }
    return true;
  }

  // ── Lanes ──────────────────────────────────────────────────────────────

  private publishLanes() {
    this.send('lanes', [...this.lanes.values()]);
  }

  supervisorFor(laneId: string, name: string, color: string): Supervisor {
    const base = { laneId, laneName: name, color };
    return {
      approve: async (req) => {
        const a = await this.show({ kind: 'approval', ...base, summary: req.summary, reason: req.reason, image: cropElement(req.look, req.element.rect) });
        return 'choice' in a && a.choice === 'approve';
      },
      ask: async (question) => {
        const a = await this.show({ kind: 'question', ...base, question });
        return 'text' in a ? { answer: a.text } : a.choice === 'stop' ? { stop: true } : { answer: 'Done.' };
      },
      injection: async (findings: InjectionFinding[], look) => {
        const a = await this.show({ kind: 'injection', ...base, url: look.url, findings: findings.slice(0, 3).map((f) => ({ source: f.source, text: f.text })) });
        return 'choice' in a && a.choice === 'continue' ? 'continue' : 'stop';
      },
      status: (s) => {
        const v = this.lanes.get(laneId);
        if (!v) return;
        v.state = s.kind;
        if (s.kind === 'running') {
          v.line = s.thinking;
          v.step = s.step;
        } else if (s.kind === 'waiting-approval') v.line = `Waiting for your yes: ${s.summary}`;
        else if (s.kind === 'waiting-person') v.line = s.question;
        else if (s.kind === 'paused-injection') v.line = 'Paused: this page talks to AI agents';
        else if (s.kind === 'done') v.line = s.result;
        else v.line = s.reason;
        this.publishLanes();
      },
      shouldStop: () => this.stopRequested.has(laneId),
    };
  }

  stopAll() {
    for (const id of this.lanes.keys()) this.stopRequested.add(id);
    // Release anything waiting on the person so lanes can wind down.
    for (const p of [...this.cards.values()]) if (p.card.kind !== 'result') this.answer(p.card.id, { choice: 'stop' });
  }

  laneBounds() {
    const { workArea } = screen.getPrimaryDisplay();
    const width = Math.min(1280, workArea.width - 80);
    const height = Math.min(900, workArea.height - 140);
    return { left: Math.round(workArea.x + (workArea.width - width) / 2), top: workArea.y + 120, width, height };
  }

  async runOne(opts: { name: string; goal: string; startUrl: string; keepOpen?: boolean }) {
    const model = this.getModel();
    if (!model) throw new Error('No Baseten key: Baton cannot run lanes.');
    if (!this.bridge.connected) throw new Error('The Chrome extension is not connected.');
    this.busy = true;
    const laneId = `lane-${++this.laneCount}`;
    const color = LANE_COLORS[0]!;
    const view: LaneView = { laneId, name: opts.name, color, state: 'running', line: 'Opening…', step: 0 };
    this.lanes.set(laneId, view);
    this.publishLanes();
    try {
      const out = await launchLane(this.bridge, model, this.supervisorFor(laneId, opts.name, color), {
        runId: `cue-${new Date().toISOString().replace(/[:.]/g, '-')}`,
        laneId,
        name: opts.name,
        color,
        spec: { goal: opts.goal, startUrl: opts.startUrl },
        bounds: this.laneBounds(),
        keepOpen: opts.keepOpen ?? true,
      });
      const detail = `${out.steps} steps · ${(out.ms / 1000).toFixed(0)} s · $${costUsd(out.usage).toFixed(3)}`;
      void this.show({ kind: 'result', laneId, laneName: opts.name, color, status: out.status, result: out.result, detail });
      return out;
    } finally {
      this.lanes.delete(laneId);
      this.stopRequested.delete(laneId);
      this.publishLanes();
      this.busy = false;
    }
  }

  // A cue that is not an answer becomes one lane (Stage 4 replaces this with a Score).
  async fromCue(transcript: string) {
    const model = this.getModel();
    if (!model) return;
    if (/\b(everyone|everybody|all lanes)\b.*\bstop\b|^\s*stop everything\b/i.test(transcript)) {
      this.stopAll();
      return;
    }
    if (this.busy) {
      this.send('podium:notice', 'A lane is already running. Say “everyone stop” to stop it.');
      return;
    }
    this.send('podium:notice', 'Planning…');
    try {
      const plan = await model.json(SingleLanePlan, [
        {
          role: 'system',
          content: `You turn a spoken request into one browser task for Baton. Reply with JSON only: {"name": short lane name (2-3 words), "goal": the full task in one or two sentences with every detail from the request, "startUrl": where to begin}.\n${SITES}`,
        },
        { role: 'user', content: `Request: "${transcript}"` },
      ]);
      log(`cue planned as one lane (${Math.round(plan.ms)} ms)`);
      await this.runOne({ name: plan.value.name, goal: plan.value.goal, startUrl: plan.value.startUrl });
    } catch (e) {
      this.send('podium:notice', `Could not start: ${(e as Error).message}`);
    }
  }
}
