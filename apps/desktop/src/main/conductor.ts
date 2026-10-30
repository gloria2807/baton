// The conductor (Stage 2: one lane at a time). It turns a spoken cue into a lane, shows the lane's
// status on the Podium, and owns the cards that wait for the person: approvals, questions and
// injection warnings, answerable by click or by voice.

import { screen } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CueMove, cueMessages, mapDeixis, transferGoal, voiceAnswer, type Anchor, type InjectionFinding, type LaneStatus, type Profile, type Supervisor } from '@baton/core';
import type { Model } from '@baton/model';
import type { BridgeServer } from './bridge-server';
import { costUsd, cropElement, launchLane, toOpenAI } from './lanes';
import { outDir } from './paths';
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
    private getProfile: () => Profile,
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

  // A spoken cue first answers whatever card is waiting; returns true if it did. A cue that points
  // at things is a new request, not an answer to a lane's question.
  answerByVoice(transcript: string, pointed = false): boolean {
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
      if (pointed) return false;
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

  // A cue that is not an answer to a card: interpret what was said and pointed at, then answer
  // aloud, run one lane, or move data from "this" to "there". (Stage 4 adds multi-lane Scores.)
  async fromCue(cue: { id: string; transcript: string; intent: string; anchors: Anchor[]; heldMs: number }) {
    const model = this.getModel();
    if (!model) return;
    if (/\b(everyone|everybody|all lanes)\b.*\bstop\b|^\s*stop everything\b/i.test(cue.transcript)) {
      this.stopAll();
      return;
    }
    const references = mapDeixis(cue.transcript, cue.heldMs, cue.anchors);
    this.send('podium:notice', 'Thinking…');
    const record: Record<string, unknown> = {
      id: cue.id,
      transcript: cue.transcript,
      intent: cue.intent,
      durationMs: cue.heldMs,
      anchors: cue.anchors.map(({ screenshot: _s, ...a }) => a),
      references,
    };
    try {
      const r = await model.json(CueMove, toOpenAI(cueMessages({ transcript: cue.transcript, intent: cue.intent, anchors: cue.anchors, references, profile: this.getProfile(), sites: SITES })), 'low');
      const move = r.value;
      record.move = move;
      record.ms = Math.round(r.ms);
      log(`cue ${cue.id} → ${move.kind} (${Math.round(r.ms)} ms, ${cue.anchors.length} anchors)`);
      await this.perform(move, cue.anchors);
    } catch (e) {
      record.error = (e as Error).message;
      this.send('podium:notice', `Could not understand that: ${(e as Error).message}`);
    } finally {
      writeFileSync(join(outDir('cues'), `${cue.id}.json`), JSON.stringify(record, null, 2));
    }
  }

  private async perform(move: CueMove, anchors: Anchor[]) {
    const byN = (n: number) => anchors.find((a) => a.n === n);
    if (move.kind === 'answer' || move.kind === 'clarify') {
      const speech = move.kind === 'answer' ? move.speech : move.question;
      this.send('speak', speech);
      void this.show({ kind: 'result', laneId: 'answer', laneName: 'Baton', color: '#8b9bff', status: move.kind === 'answer' ? 'answer' : 'question', result: speech, detail: '' });
      return;
    }
    if (this.busy) {
      this.send('podium:notice', 'A lane is already running. Say “everyone stop” to stop it.');
      return;
    }
    if (move.kind === 'task') {
      await this.runOne({ name: move.name, goal: move.goal, startUrl: move.startUrl });
      return;
    }
    // Transfer: the data comes straight from the anchor, so nothing is retyped by a model.
    const from = byN(move.from);
    const to = byN(move.to);
    if (!from || from.source !== 'chrome' || !from.target) {
      this.send('speak', 'I could not read what you pointed at first. Point at it inside a Chrome page and try again.');
      this.send('podium:notice', '“This” was not on a web page Baton can read.');
      return;
    }
    if (!to || to.source !== 'chrome' || !to.url) {
      this.send('speak', 'I can only put things into a web page you pointed at in Chrome.');
      this.send('podium:notice', 'Point at a place in a Chrome tab for “there”.');
      return;
    }
    const out = await this.runOne({ name: move.name, goal: transferGoal(from, to, move.instruction), startUrl: to.url });
    // The person is looking at the destination in their own tab: show them the result there.
    if (out.status === 'done' && to.tabId !== undefined && !to.laneId) await this.bridge.request({ op: 'reloadTab', tabId: to.tabId }).catch(() => undefined);
  }
}
