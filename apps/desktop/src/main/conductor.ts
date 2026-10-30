// The conductor (Stage 2: one lane at a time). It turns a spoken cue into a lane, shows the lane's
// status on the Podium, and owns the cards that wait for the person: approvals, questions and
// injection warnings, answerable by click or by voice.

import { screen } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { join } from 'node:path';
import {
  CueMove,
  DEFAULT_LANE_LIMIT,
  ItemPick,
  LookResult,
  Routine,
  cleanRehearsal,
  compileMessages,
  describeStep,
  itemsMessages,
  performGoal,
  pickedItems,
  routineCommand,
  variableHints,
  type RecordedStep,
  MergeReply,
  Score,
  cueMessages,
  manualMinutes,
  mapDeixis,
  mergeMessages,
  runScore,
  tile,
  transferGoal,
  voiceAnswer,
  type Anchor,
  type InjectionFinding,
  type LaneStatus,
  type Part,
  type PreApproval,
  type PartResult,
  type Profile,
  type Supervisor,
} from '@baton/core';
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
  | { kind: 'result'; id: number; laneId: string; laneName: string; color: string; status: string; result: string; detail: string }
  // Rehearsal: the steps recorded so far, while the person works.
  | { kind: 'rehearsal'; id: number; laneId: string; laneName: string; color: string; steps: string[]; recording: boolean }
  // The routine learned from a rehearsal, for the person to check and correct.
  | { kind: 'routine'; id: number; laneId: string; laneName: string; color: string; routine: Routine }
  // A Score's merged result: one line per lane, and every action still waiting for the person's yes.
  | {
      kind: 'score';
      id: number;
      laneId: string;
      laneName: string;
      color: string;
      headline: string;
      parts: Array<{ name: string; color: string; status: string; line: string }>;
      approvals: Array<{ laneName: string; color: string; summary: string; image?: string }>;
      seconds: number;
      manualMinutes: number;
      done: boolean;
      runId: string;
    };

interface PartState {
  part: Part;
  laneId: string;
  color: string;
  state: 'waiting' | 'running' | 'waiting-approval' | 'settled';
  result?: PartResult;
  inbox: string[];
  redirect?: string;
  attempt: number;
  receipts: string[];
}

interface ScoreRunState {
  score: Score;
  runId: string;
  startedAt: number;
  parts: Map<string, PartState>;
  // Approvals collected while lanes run, shown together on one card.
  pending: Array<{ partId: string; summary: string; image?: string; resolve: (yes: boolean) => void }>;
  bundleCard?: number;
  bundleAnswered: boolean;
  spoke: boolean;
  opts: ScoreOptions;
  // Screen positions for the lanes running at once; a part takes a free one while it runs.
  slots: boolean[];
}

export interface ScoreOptions {
  limit?: number;
  // Granted up front for the whole run (performing a routine the person approved as a batch).
  preApproved?: PreApproval;
  // Label for a running "n of m done" counter on the Podium.
  progress?: string;
  // Close each lane window when its part is done (many short parts share the screen).
  closeWhenDone?: boolean;
}

type CardInput = Card extends infer C ? (C extends Card ? Omit<C, 'id'> : never) : never;

export type CardAnswer = { choice: 'approve' | 'decline' | 'continue' | 'stop' | 'dismiss' } | { text: string };

type Pending = { card: Card; resolve: (a: CardAnswer) => void };

// Demo sites the planner may send a lane to; real sites are allowed too.
export const SITES = `Known sites (fictional demo sites, prefer them when the request matches):
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
  private run: ScoreRunState | null = null;
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

  private patchCard(id: number, patch: Partial<Card>) {
    const p = this.cards.get(id);
    if (!p) return;
    p.card = { ...p.card, ...patch } as Card;
    this.publishCards();
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
    const waiting = [...this.cards.values()].find((p) => !['result', 'rehearsal', 'routine'].includes(p.card.kind) && !(p.card.kind === 'score' && !p.card.approvals.length));
    if (!waiting) return false;
    const yesNo = voiceAnswer(transcript);
    const { card } = waiting;
    if (card.kind === 'score') {
      if (!yesNo || !card.approvals.length) return false;
      this.answer(card.id, { choice: yesNo === 'approved' ? 'approve' : 'decline' });
    } else if (card.kind === 'approval') {
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
    // Lanes waiting for the Score's approval card are released with a no.
    for (const p of this.run?.pending.splice(0) ?? []) p.resolve(false);
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

  // ── Scores: several lanes at once ─────────────────────────────────────

  async runScoreCue(score: Score, opts: ScoreOptions = {}) {
    const model = this.getModel();
    if (!model || !this.bridge.connected) {
      this.send('podium:notice', model ? 'The Chrome extension is not connected.' : 'No Baseten key: Baton cannot run lanes.');
      return;
    }
    if (this.busy) {
      this.send('podium:notice', 'Lanes are already running. Say “everyone stop” to stop them.');
      return;
    }
    this.busy = true;
    const runId = `score-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const slots = Array(Math.min(score.parts.length, opts.limit ?? DEFAULT_LANE_LIMIT)).fill(false);
    const run: ScoreRunState = { score, runId, startedAt: Date.now(), parts: new Map(), pending: [], bundleAnswered: false, spoke: false, opts, slots };
    this.run = run;
    score.parts.forEach((part, i) => {
      const st: PartState = { part, laneId: `${part.id}`.slice(0, 24), color: LANE_COLORS[i % LANE_COLORS.length]!, state: 'waiting', inbox: [], attempt: 1, receipts: [] };
      run.parts.set(part.id, st);
      // Many short parts (a performed routine) show a chip only while they run.
      if (!opts.closeWhenDone) this.lanes.set(st.laneId, { laneId: st.laneId, name: part.name, color: st.color, state: 'running', line: 'Waiting to start…', step: 0 });
    });
    this.publishLanes();
    log(`score ${runId}: ${score.parts.length} parts`);
    this.send('podium:notice', `${score.title}: ${score.parts.length} lanes`);
    try {
      await runScore(score, {
        limit: opts.limit ?? DEFAULT_LANE_LIMIT,
        runPart: (part) => this.runPart(run, part),
        onUpdate: (u) => {
          const st = run.parts.get(u.id);
          if (!st) return;
          if (u.state === 'settled') {
            st.state = 'settled';
            st.result = { status: u.status, result: u.result, data: u.data, ms: u.ms };
          } else if (u.state === 'running') st.state = 'running';
          if (opts.progress && u.state === 'settled') {
            const done = [...run.parts.values()].filter((p) => p.state === 'settled').length;
            this.send('podium:notice', `${opts.progress}: ${done} of ${run.parts.size} done`);
          }
          this.refreshBundle(run);
          void this.checkApprovalPoint(run);
        },
      });
      await this.finishScore(run);
    } finally {
      for (const st of run.parts.values()) {
        this.lanes.delete(st.laneId);
        this.stopRequested.delete(st.laneId);
      }
      this.publishLanes();
      this.run = null;
      this.busy = false;
    }
  }

  private async runPart(run: ScoreRunState, part: Part): Promise<PartResult> {
    const model = this.getModel()!;
    const st = run.parts.get(part.id)!;
    const { workArea } = screen.getPrimaryDisplay();
    const slot = Math.max(0, run.slots.indexOf(false));
    run.slots[slot] = true;
    if (!this.lanes.has(st.laneId)) {
      this.lanes.set(st.laneId, { laneId: st.laneId, name: part.name, color: st.color, state: 'running', line: 'Starting…', step: 0 });
      this.publishLanes();
    }
    const bounds = tile(run.slots.length, workArea, 110)[slot];
    let goal = part.goal;
    for (;;) {
      st.state = 'running';
      const out = await launchLane(this.bridge, model, this.scoreSupervisor(run, st), {
        runId: run.runId,
        laneId: st.laneId,
        name: part.name,
        color: st.color,
        spec: { goal, startUrl: part.startUrl, preApproved: run.opts.preApproved },
        bounds,
        keepOpen: true,
        reuseWindow: st.attempt > 1,
        attempt: st.attempt,
      });
      st.receipts.push(out.receipts);
      // Redirected while waiting: carry on in the same window with the new instruction.
      if (st.redirect && !this.stopRequested.has(st.laneId)) {
        goal = `${part.goal}\n\nThe person then told this lane: “${st.redirect}”. Follow that; it overrides the goal where they conflict.`;
        st.redirect = undefined;
        st.attempt++;
        continue;
      }
      run.slots[slot] = false;
      if (run.opts.closeWhenDone) {
        await this.bridge.request({ op: 'closeLane', laneId: st.laneId }).catch(() => undefined);
        this.lanes.delete(st.laneId);
        this.publishLanes();
      }
      return { status: out.status, result: out.result, data: out.data, ms: out.ms };
    }
  }

  private scoreSupervisor(run: ScoreRunState, st: PartState): Supervisor {
    const base = this.supervisorFor(st.laneId, st.part.name, st.color);
    return {
      ...base,
      // Until the person has answered the Score's approval card, approvals are collected onto it.
      approve: async (req) => {
        if (run.bundleAnswered) return base.approve(req);
        return new Promise<boolean>((resolve) => {
          const done = (yes: boolean) => {
            st.state = 'running';
            resolve(yes);
          };
          run.pending.push({ partId: st.part.id, summary: req.summary, image: cropElement(req.look, req.element.rect), resolve: done });
          st.state = 'waiting-approval';
          base.status({ kind: 'waiting-approval', summary: req.summary });
          this.refreshBundle(run);
          void this.checkApprovalPoint(run);
        });
      },
      inbox: () => st.inbox.splice(0),
    };
  }

  private scoreCardFields(run: ScoreRunState, headline: string) {
    return {
      laneId: 'score',
      laneName: run.score.title,
      color: '#8b9bff',
      headline,
      parts: [...run.parts.values()].map((st) => ({
        name: st.part.name,
        color: st.color,
        status: st.state === 'settled' ? st.result!.status : st.state,
        line: st.state === 'settled' ? st.result!.result : (this.lanes.get(st.laneId)?.line ?? ''),
      })),
      approvals: run.bundleAnswered ? [] : run.pending.map((p) => ({ laneName: run.parts.get(p.partId)!.part.name, color: run.parts.get(p.partId)!.color, summary: p.summary, image: p.image })),
      seconds: Math.round((Date.now() - run.startedAt) / 1000),
      manualMinutes: manualMinutes(run.score),
      runId: run.runId,
    };
  }

  private refreshBundle(run: ScoreRunState) {
    if (run.bundleCard === undefined) return;
    const card = this.cards.get(run.bundleCard)?.card;
    if (card?.kind === 'score') this.patchCard(run.bundleCard, this.scoreCardFields(run, card.headline));
  }

  private async merged(run: ScoreRunState): Promise<{ headline: string; speech: string }> {
    const results = Object.fromEntries([...run.parts.values()].map((st) => [st.part.id, st.result]));
    try {
      const r = await this.getModel()!.json(MergeReply, toOpenAI(mergeMessages(run.score, results, run.pending.map((p) => p.summary))), 'low');
      return r.value;
    } catch {
      return { headline: run.score.title, speech: 'The lanes have finished. Here is what they found.' };
    }
  }

  // Once no lane is still working and some wait for a yes, show one card with everything.
  private async checkApprovalPoint(run: ScoreRunState) {
    if (run.bundleCard !== undefined || run.bundleAnswered || !run.pending.length) return;
    if ([...run.parts.values()].some((st) => st.state === 'running' || st.state === 'waiting')) return;
    run.bundleCard = -1; // claimed while the summary is written
    const m = await this.merged(run);
    this.send('speak', m.speech);
    run.spoke = true;
    const answer = this.show({ kind: 'score', ...this.scoreCardFields(run, m.headline), done: false });
    run.bundleCard = this.nextCard - 1;
    const a = await answer;
    const yes = 'choice' in a && a.choice === 'approve';
    run.bundleAnswered = true;
    log(`score approvals ${yes ? 'approved' : 'declined'} (${run.pending.length})`);
    for (const p of run.pending.splice(0)) p.resolve(yes);
  }

  private async finishScore(run: ScoreRunState) {
    const m = await this.merged(run);
    if (!run.spoke) this.send('speak', m.speech);
    void this.show({ kind: 'score', ...this.scoreCardFields(run, m.headline), done: true });
    const record = {
      runId: run.runId,
      score: run.score,
      startedAt: new Date(run.startedAt).toISOString(),
      seconds: Math.round((Date.now() - run.startedAt) / 1000),
      manualMinutes: manualMinutes(run.score),
      headline: m.headline,
      speech: m.speech,
      parts: [...run.parts.values()].map((st) => ({ id: st.part.id, name: st.part.name, color: st.color, laneId: st.laneId, result: st.result, receipts: st.receipts })),
    };
    writeFileSync(join(outDir('scores'), `${run.runId}.json`), JSON.stringify(record, null, 2));
    log(`score ${run.runId} finished in ${record.seconds} s`);
  }

  // ── Rehearse, then perform ─────────────────────────────────────────────

  private rehearsal: { startedAt: number; steps: RecordedStep[]; cardId: number } | null = null;
  // The last routine learned, kept across restarts.
  private routine: (Routine & { doneUrls: string[] }) | null = (() => {
    try {
      const raw = JSON.parse(readFileSync(join(outDir('routines'), 'latest.json'), 'utf8')) as { doneUrls?: string[] };
      return { ...Routine.parse(raw), doneUrls: raw.doneUrls ?? [] };
    } catch {
      return null;
    }
  })();

  async startRehearsal() {
    if (this.busy || this.rehearsal) {
      this.send('podium:notice', this.rehearsal ? 'Already watching.' : 'Lanes are running. Say “everyone stop” first.');
      return;
    }
    if (!this.bridge.connected) {
      this.send('podium:notice', 'The Chrome extension is not connected.');
      return;
    }
    await this.bridge.request({ op: 'recordStart' });
    const answer = this.show({ kind: 'rehearsal', laneId: 'rehearsal', laneName: 'Watching you', color: '#ef4444', steps: [], recording: true });
    this.rehearsal = { startedAt: Date.now(), steps: [], cardId: this.nextCard - 1 };
    log('rehearsal started');
    this.send('speak', 'Watching. Do it once, and tell me what matters as you go. Say “that’s it” when you are done.');
    // The card's Finish button ends the rehearsal too.
    void answer.then((a) => {
      if ('choice' in a && a.choice === 'stop' && this.rehearsal) void this.finishRehearsal();
    });
  }

  addRehearsalStep(step: RecordedStep) {
    const r = this.rehearsal;
    if (!r) return;
    r.steps.push(step);
    this.patchCard(r.cardId, { steps: cleanRehearsal(r.steps).map(describeStep) });
  }

  // Development: learn a routine from a saved rehearsal, as if it had just been recorded.
  async learnFrom(steps: RecordedStep[]) {
    this.rehearsal = { startedAt: Date.now(), steps, cardId: -1 };
    await this.finishRehearsal();
  }

  private async finishRehearsal() {
    const r = this.rehearsal;
    if (!r) return;
    this.rehearsal = null;
    await this.bridge.request({ op: 'recordStop' }).catch(() => undefined);
    if (this.cards.has(r.cardId)) this.answer(r.cardId, { choice: 'dismiss' });
    const steps = cleanRehearsal(r.steps);
    writeFileSync(join(outDir('rehearsals'), `rehearsal-${new Date(r.startedAt).toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ steps: r.steps }, null, 2));
    log(`rehearsal finished: ${r.steps.length} recorded, ${steps.length} after cleaning`);
    if (!steps.some((s) => s.type === 'input' || s.type === 'paste' || s.type === 'click')) {
      this.send('speak', 'I did not see you do anything in Chrome. Say “watch me” to try again.');
      return;
    }
    this.send('podium:notice', 'Learning the routine…');
    try {
      const out = await this.getModel()!.json(Routine, toOpenAI(compileMessages(steps, variableHints(steps))), 'low');
      // Items handled during the rehearsal are done: never do them twice.
      const doneUrls = [...new Set(steps.filter((s) => s.type === 'navigate' && s.url !== out.value.itemSourceUrl).map((s) => (s as { url: string }).url))];
      this.routine = { ...out.value, doneUrls };
      writeFileSync(join(outDir('routines'), 'latest.json'), JSON.stringify(this.routine, null, 2));
      log(`routine compiled: ${out.value.name} (${out.value.variables.length} variables, ${out.value.steps.length} steps, ${Math.round(out.ms)} ms)`);
      this.send('speak', `Got it: ${out.value.name}. Say “now do the rest” when you are ready.`);
      const edit = await this.show({ kind: 'routine', laneId: 'routine', laneName: 'Routine', color: '#ef4444', routine: this.routine });
      if ('text' in edit) this.applyRoutineEdits(edit.text);
    } catch (e) {
      this.send('podium:notice', `Could not learn the routine: ${(e as Error).message}`);
    }
  }

  // The person renamed or corrected variables on the Routine card.
  private applyRoutineEdits(json: string) {
    if (!this.routine) return;
    try {
      const edits = z.array(z.object({ index: z.number().int(), name: z.string(), description: z.string() })).parse(JSON.parse(json));
      const variables = this.routine.variables.map((v, i) => {
        const e = edits.find((x) => x.index === i);
        return e ? { ...v, name: e.name, description: e.description } : v;
      });
      // Renamed variables are renamed in the steps too.
      const renames = this.routine.variables.map((v, i) => [v.name, variables[i]!.name] as const).filter(([a, b]) => a !== b);
      const steps = this.routine.steps.map((s) => ({ ...s, do: renames.reduce((t, [a, b]) => t.split(`{${a}}`).join(`{${b}}`), s.do) }));
      this.routine = { ...Routine.parse({ ...this.routine, variables, steps }), doneUrls: this.routine.doneUrls };
      writeFileSync(join(outDir('routines'), 'latest.json'), JSON.stringify(this.routine, null, 2));
      log('routine corrected by the person');
    } catch (e) {
      this.send('podium:notice', `Could not apply that change: ${(e as Error).message}`);
    }
  }

  async performRoutine(anchors: Anchor[]) {
    const routine = this.routine;
    const model = this.getModel();
    if (!routine || !model) {
      this.send('speak', 'Show me first: say “watch me” and do one by hand.');
      return;
    }
    if (this.busy) {
      this.send('podium:notice', 'Lanes are already running.');
      return;
    }
    // The list the person points at, or the one they picked the rehearsed item from.
    const pointed = anchors.find((a) => a.source === 'chrome' && a.url && !a.laneId)?.url;
    const source = pointed ?? routine.itemSourceUrl;
    this.send('podium:notice', 'Finding the rest…');
    let links: Array<{ name: string; href: string }>;
    try {
      await this.bridge.request({ op: 'openLane', laneId: 'finder', url: source, color: '#ef4444', title: 'Finding the items', bounds: this.laneBounds() }, 30000);
      const look = LookResult.parse(await this.bridge.request({ op: 'look', laneId: 'finder', screenshot: false }, 30000));
      links = look.elements.filter((e) => e.href && e.name).map((e) => ({ name: e.name, href: e.href! }));
    } finally {
      await this.bridge.request({ op: 'closeLane', laneId: 'finder' }).catch(() => undefined);
    }
    const picked = await model.json(ItemPick, toOpenAI(itemsMessages(routine, links, routine.doneUrls)), 'low');
    // Only real links from the page, never one already done, each once.
    const items = pickedItems(picked.value, links, routine.doneUrls);
    log(`perform: ${links.length} links on ${source}, model picked ${picked.value.numbers.length}, ${items.length} kept`);
    if (!items.length) {
      this.send('speak', 'I could not find any more items to do.');
      return;
    }
    log(`perform ${routine.name}: ${items.length} items`);
    // One approval for the whole batch: the saves the routine makes, on the sites it makes them.
    const hosts = [...new Set(routine.steps.map((s) => s.page).filter((p): p is string => !!p).map((p) => new URL(p).host).filter((h) => h !== new URL(source).host))];
    this.send('speak', `I found ${items.length} more. Shall I do them all?`);
    const a = await this.show({
      kind: 'approval',
      laneId: 'routine',
      laneName: routine.name,
      color: '#ef4444',
      summary: `Perform “${routine.name}” for ${items.length} ${routine.itemKind}s`,
      reason: `Each saves one entry${hosts.length ? ` on ${hosts.join(', ')}` : ''}. Payments, sending and deleting still ask you one by one.`,
    });
    if (!('choice' in a) || a.choice !== 'approve') return;
    const score = Score.parse({
      title: routine.name,
      final: `Say how many ${routine.itemKind}s were done, how many were already done, and any that failed.`,
      parts: items.map((it, i) => ({ id: `i${i + 1}`, name: `#${i + 1}`, goal: performGoal(routine, it), startUrl: it.url, manualMinutes: 1.5 })),
    });
    // Four at a time: fast enough to watch, gentle on the model's rate limit and the budget.
    await this.runScoreCue(score, { limit: 4, preApproved: hosts.length ? { categories: ['submit'], hosts } : undefined, progress: `Performing “${routine.name}”`, closeWhenDone: true });
  }

  // Pointing at a lane window and speaking changes only that lane.
  redirect(laneId: string, said: string): boolean {
    const run = this.run;
    const st = run && [...run.parts.values()].find((p) => p.laneId === laneId);
    if (!run || !st) return false;
    log(`redirect ${laneId}`);
    this.send('podium:notice', `${st.part.name}: “${said}”`);
    if (st.state === 'waiting-approval' && !run.bundleAnswered) {
      // Release the lane from the approval card and restart it with the new instruction.
      st.redirect = said;
      const i = run.pending.findIndex((p) => p.partId === st.part.id);
      if (i >= 0) run.pending.splice(i, 1)[0]!.resolve(false);
      this.refreshBundle(run);
      return true;
    }
    if (st.state === 'settled') {
      this.send('podium:notice', `${st.part.name} has already finished.`);
      return true;
    }
    st.inbox.push(said);
    return true;
  }

  // A cue that is not an answer to a card: interpret what was said and pointed at, then answer
  // aloud, run one lane or a Score of several, or move data from "this" to "there".
  async fromCue(cue: { id: string; transcript: string; intent: string; anchors: Anchor[]; heldMs: number }) {
    const model = this.getModel();
    if (!model) return;
    if (/\b(everyone|everybody|all lanes)\b.*\bstop\b|^\s*stop everything\b/i.test(cue.transcript)) {
      this.stopAll();
      return;
    }
    // Rehearsing: what the person says is narration, until they say they are done.
    const command = routineCommand(cue.transcript);
    if (this.rehearsal) {
      if (command === 'finish') await this.finishRehearsal();
      else this.addRehearsalStep({ type: 'narration', at: Date.now() - this.rehearsal.startedAt, text: cue.transcript.slice(0, 1000) });
      return;
    }
    if (command === 'rehearse') return this.startRehearsal();
    if (command === 'perform') return this.performRoutine(cue.anchors);
    // Pointing at a lane window while lanes run: the words are for that lane alone.
    const atLane = cue.anchors.find((a) => a.laneId);
    if (atLane?.laneId && this.redirect(atLane.laneId, cue.transcript)) return;
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
    if (move.kind === 'score') {
      await this.runScoreCue(Score.parse(move));
      return;
    }
    if (move.kind === 'task') {
      await this.runOne({ name: move.name, goal: move.goal, startUrl: move.startUrl });
      return;
    }
    if (move.kind === 'rehearse') {
      await this.startRehearsal();
      return;
    }
    if (move.kind === 'perform') {
      await this.performRoutine(anchors);
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
