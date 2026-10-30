// Baton Live's conductor: the desktop conductor's moves on the same core pieces (cue interpreter,
// Scores, scheduler, lane loop, safety, merge), with lanes as frames on this page instead of
// Chrome windows. State is one snapshot the page subscribes to.

import {
  CueMove,
  DEFAULT_LANE_LIMIT,
  MergeReply,
  Score,
  cueMessages,
  goalWithProfile,
  manualMinutes,
  mapDeixis,
  mergeMessages,
  readyForApprovals,
  redactSecrets,
  runLane,
  runScore,
  transferGoal,
  voiceAnswer,
  type Anchor,
  type Brain,
  type LaneOutcome,
  type LaneStatus,
  type Part,
  type PartResult,
  type Profile,
  type ReceiptSink,
  type StepRecord,
  type Supervisor,
} from '@baton/core';
import { ModelBrain, toOpenAI, type Model } from '@baton/model';
import type { Card, LaneView } from '../../desktop/src/renderer/Cards';
import { FrameHands, frames, liveUrl } from './hands';

// Lane colours from docs/DESIGN.md.
export const LANE_COLORS = ['#4d7bd8', '#3f9a6b', '#d98a3a', '#c8577a', '#2f9c9c', '#9b7a3d', '#7c8a9e', '#b85c3c'];
const BRASS = '#c99a3b';

export function sitesFor(origin: string): string {
  return `Known sites. These fictional demo sites are the only websites in Baton Live; never use any other website:
- Inbox, webmail and calendar: ${origin}/sites/inbox/ (calendar: ${origin}/sites/inbox/calendar)
- Ledgerly, accounts payable (bills): ${origin}/sites/ledgerly/
- Roam, travel search (flights from/to airport codes LOS LIS ACC LHR NBO MAD, hotels near Doca Hall Lisbon, Atlas Summit event guide): ${origin}/sites/roam/ (hotels: ${origin}/sites/roam/hotels, event: ${origin}/sites/roam/events/atlas-summit)`;
}

export interface LaneFrame {
  laneId: string;
  name: string;
  color: string;
  url: string;
}

export interface Receipt {
  laneId: string;
  name: string;
  color: string;
  goal: string;
  steps: StepRecord[];
  outcome?: LaneOutcome;
}

export interface Snapshot {
  lanes: LaneView[];
  frames: LaneFrame[];
  cards: Card[];
  notice: { text: string; tone: 'info' | 'ok' | 'warn' } | null;
  thinking: boolean;
  receipts: Receipt[];
}

type CardAnswer = { choice: 'approve' | 'decline' | 'continue' | 'stop' | 'dismiss' } | { text: string };
type CardInput = Card extends infer C ? (C extends Card ? Omit<C, 'id'> : never) : never;

interface PartState {
  part: Part;
  laneId: string;
  color: string;
  state: 'waiting' | 'running' | 'waiting-approval' | 'settled';
  result?: PartResult;
  inbox: string[];
}

interface ScoreRun {
  score: Score;
  runId: string;
  startedAt: number;
  parts: Map<string, PartState>;
  pending: Array<{ partId: string; summary: string; resolve: (yes: boolean) => void }>;
  bundleCard?: number;
  bundleAnswered: boolean;
  spoke: boolean;
}

class MemoryReceipts implements ReceiptSink {
  constructor(
    private r: Receipt,
    private changed: () => void,
  ) {}
  step(record: StepRecord) {
    this.r.steps.push(record);
    this.changed();
  }
  event() {
    /* questions and injections are visible as cards */
  }
}

export class Conductor {
  private snap: Snapshot = { lanes: [], frames: [], cards: [], notice: null, thinking: false, receipts: [] };
  private listeners = new Set<() => void>();
  private pending = new Map<number, (a: CardAnswer) => void>();
  private nextCard = 1;
  private stopRequested = new Set<string>();
  private run: ScoreRun | null = null;
  private laneCount = 0;
  // Set when the proxy refuses for budget or rate: every lane stops, nobody is asked anything.
  private limited: string | null = null;
  busy = false;

  constructor(
    private model: Model,
    private profile: Profile,
    private speak: (text: string) => void,
  ) {}

  // ── State for the page ──
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  snapshot = () => this.snap;
  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn();
  }
  notice(text: string, tone: 'info' | 'ok' | 'warn' = 'info') {
    this.set({ notice: { text, tone } });
  }

  private patchLane(laneId: string, patch: Partial<LaneView>) {
    this.set({ lanes: this.snap.lanes.map((l) => (l.laneId === laneId ? { ...l, ...patch } : l)) });
  }

  // ── Cards ──
  private show(card: CardInput): Promise<CardAnswer> {
    const id = this.nextCard++;
    this.set({ cards: [...this.snap.cards, { ...card, id } as Card] });
    return new Promise((resolve) => this.pending.set(id, resolve));
  }
  private patchCard(id: number, patch: Partial<Card>) {
    this.set({ cards: this.snap.cards.map((c) => (c.id === id ? ({ ...c, ...patch } as Card) : c)) });
  }
  answer(id: number, a: CardAnswer) {
    const resolve = this.pending.get(id);
    this.pending.delete(id);
    this.set({ cards: this.snap.cards.filter((c) => c.id !== id) });
    resolve?.(a);
  }

  // A spoken "yes" or "no" answers the card that is waiting; returns true if it did.
  answerByVoice(transcript: string): boolean {
    const card = this.snap.cards.find(
      (c) => ['approval', 'injection', 'question'].includes(c.kind) || (c.kind === 'score' && c.approvals.length > 0),
    );
    if (!card) return false;
    if (card.kind === 'question') {
      this.answer(card.id, { text: transcript });
      return true;
    }
    const yesNo = voiceAnswer(transcript);
    if (!yesNo) return false;
    if (card.kind === 'injection') this.answer(card.id, { choice: yesNo === 'approved' ? 'continue' : 'stop' });
    else this.answer(card.id, { choice: yesNo === 'approved' ? 'approve' : 'decline' });
    return true;
  }

  stopAll() {
    for (const l of this.snap.lanes) this.stopRequested.add(l.laneId);
    for (const p of this.run?.pending.splice(0) ?? []) p.resolve(false);
    for (const c of this.snap.cards)
      if (c.kind !== 'result' && c.kind !== 'score') this.answer(c.id, { choice: 'stop' });
  }

  // Clear finished lanes, cards and receipts from the stage.
  clear() {
    if (this.busy) return;
    for (const f of this.snap.frames) frames.forget(f.laneId);
    for (const id of [...this.pending.keys()]) this.answer(id, { choice: 'dismiss' });
    this.set({ lanes: [], frames: [], cards: [], receipts: [], notice: null });
  }

  // ── Lanes ──
  private supervisorFor(laneId: string, name: string, color: string): Supervisor {
    const base = { laneId, laneName: name, color };
    return {
      approve: async (req) => {
        const a = await this.show({ kind: 'approval', ...base, summary: req.summary, reason: req.reason });
        return 'choice' in a && a.choice === 'approve';
      },
      ask: async (question) => {
        if (this.limited) return { stop: true };
        const a = await this.show({ kind: 'question', ...base, question });
        return 'text' in a ? { answer: a.text } : a.choice === 'stop' ? { stop: true } : { answer: 'Done.' };
      },
      injection: async (findings, look) => {
        const a = await this.show({
          kind: 'injection',
          ...base,
          url: look.url,
          findings: findings.slice(0, 3).map((f) => ({ source: f.source, text: f.text })),
        });
        return 'choice' in a && a.choice === 'continue' ? 'continue' : 'stop';
      },
      status: (s: LaneStatus) => {
        const line =
          s.kind === 'running'
            ? s.thinking
            : s.kind === 'waiting-approval'
              ? `Waiting for your yes: ${s.summary}`
              : s.kind === 'waiting-person'
                ? s.question
                : s.kind === 'paused-injection'
                  ? 'Paused: this page talks to AI agents'
                  : s.kind === 'done'
                    ? s.result
                    : s.reason;
        this.patchLane(laneId, { state: s.kind, line, ...(s.kind === 'running' ? { step: s.step } : {}) });
      },
      shouldStop: () => this.stopRequested.has(laneId) || this.limited !== null,
    };
  }

  // The lane's brain, watching for the proxy's refusals (budget or rate): those end the run.
  private brain(): Brain {
    const inner = new ModelBrain(this.model);
    const watch = <T>(p: Promise<T>) =>
      p.catch((e: unknown) => {
        if (isLimit(e) && !this.limited) {
          this.limited = friendlyError(e);
          this.notice(this.limited, 'warn');
        }
        throw e;
      });
    return {
      decide: (m) => watch(inner.decide(m)),
      read: (m) => watch(inner.read(m)),
      list: (m) => watch(inner.list(m)),
    };
  }

  // Open a lane frame on the stage, run the core loop in it, keep its receipt.
  private async launch(
    laneId: string,
    name: string,
    color: string,
    goal: string,
    startUrl: string,
    supervisor: Supervisor,
  ): Promise<LaneOutcome> {
    const url = liveUrl(startUrl);
    const receipt: Receipt = {
      laneId,
      name,
      color,
      goal: redactSecrets(goalWithProfile(goal, this.profile)),
      steps: [],
    };
    this.set({
      frames: [...this.snap.frames.filter((f) => f.laneId !== laneId), { laneId, name, color, url }],
      receipts: [...this.snap.receipts, receipt],
    });
    frames.setLane(laneId, { laneId, color, title: name, thinking: 'Opening…' });
    let outcome: LaneOutcome;
    try {
      await frames.api(laneId);
      outcome = await runLane(
        { goal: receipt.goal },
        new FrameHands(laneId),
        this.brain(),
        supervisor,
        new MemoryReceipts(receipt, () => this.set({ receipts: [...this.snap.receipts] })),
      );
    } catch (e) {
      outcome = {
        status: 'failed',
        result: `Lane error: ${(e as Error).message}`,
        notes: [],
        steps: 0,
        ms: 0,
        usage: { input: 0, output: 0 },
      };
      supervisor.status({ kind: 'stopped', reason: outcome.result });
    }
    receipt.outcome = outcome;
    this.set({ receipts: [...this.snap.receipts] });
    return outcome;
  }

  async runOne(name: string, goal: string, startUrl: string) {
    if (this.busy) return this.notice('Lanes are already running. Say “everyone stop” to stop them.', 'warn');
    this.busy = true;
    this.clearStage();
    const laneId = `lane-${++this.laneCount}`;
    const color = LANE_COLORS[0]!;
    this.set({ lanes: [{ laneId, name, color, state: 'running', line: 'Opening…', step: 0 }] });
    try {
      const out = await this.launch(laneId, name, color, goal, startUrl, this.supervisorFor(laneId, name, color));
      const usd = (out.usage.input * 1.25 + out.usage.output * 4.25) / 1e6;
      void this.show({
        kind: 'result',
        laneId,
        laneName: name,
        color,
        status: out.status,
        result: out.result,
        detail: `${out.steps} steps · ${(out.ms / 1000).toFixed(0)} s · $${usd.toFixed(3)}`,
      });
      this.speak(out.result.slice(0, 300));
    } finally {
      this.stopRequested.delete(laneId);
      this.busy = false;
    }
  }

  // A new run replaces the last one's lanes on the stage.
  private clearStage() {
    for (const f of this.snap.frames) frames.forget(f.laneId);
    for (const c of this.snap.cards)
      if (c.kind === 'result' || c.kind === 'score') this.answer(c.id, { choice: 'dismiss' });
    this.set({ lanes: [], frames: [], receipts: [] });
  }

  // ── Scores ──
  async runScoreCue(score: Score) {
    if (this.busy) return this.notice('Lanes are already running. Say “everyone stop” to stop them.', 'warn');
    this.busy = true;
    this.clearStage();
    const run: ScoreRun = {
      score,
      runId: `score-${Date.now()}`,
      startedAt: Date.now(),
      parts: new Map(),
      pending: [],
      bundleAnswered: false,
      spoke: false,
    };
    this.run = run;
    score.parts.forEach((part, i) => {
      run.parts.set(part.id, {
        part,
        laneId: part.id.replace(/[^a-z0-9-]/g, '-').slice(0, 24) || `part-${i}`,
        color: LANE_COLORS[i % LANE_COLORS.length]!,
        state: 'waiting',
        inbox: [],
      });
    });
    this.set({
      lanes: [...run.parts.values()].map((st) => ({
        laneId: st.laneId,
        name: st.part.name,
        color: st.color,
        state: 'running',
        line: 'Waiting to start…',
        step: 0,
      })),
    });
    this.notice(`${score.title}: ${score.parts.length} lanes`);
    try {
      await runScore(score, {
        limit: DEFAULT_LANE_LIMIT,
        runPart: async (part) => {
          const st = run.parts.get(part.id)!;
          st.state = 'running';
          const out = await this.launch(
            st.laneId,
            part.name,
            st.color,
            part.goal,
            part.startUrl,
            this.scoreSupervisor(run, st),
          );
          return { status: out.status, result: out.result, data: out.data, ms: out.ms };
        },
        onUpdate: (u) => {
          const st = run.parts.get(u.id);
          if (!st) return;
          if (u.state === 'settled') {
            st.state = 'settled';
            st.result = { status: u.status, result: u.result, data: u.data, ms: u.ms };
          } else if (u.state === 'running') st.state = 'running';
          this.refreshBundle(run);
          void this.checkApprovalPoint(run);
        },
      });
      await this.finishScore(run);
    } finally {
      for (const st of run.parts.values()) this.stopRequested.delete(st.laneId);
      this.run = null;
      this.busy = false;
    }
  }

  private scoreSupervisor(run: ScoreRun, st: PartState): Supervisor {
    const base = this.supervisorFor(st.laneId, st.part.name, st.color);
    return {
      ...base,
      // Until the person answers the Score's card, approvals are collected onto it.
      approve: async (req) => {
        if (run.bundleAnswered) return base.approve(req);
        return new Promise<boolean>((resolve) => {
          run.pending.push({
            partId: st.part.id,
            summary: req.summary,
            resolve: (yes) => {
              st.state = 'running';
              resolve(yes);
            },
          });
          st.state = 'waiting-approval';
          base.status({ kind: 'waiting-approval', summary: req.summary });
          this.refreshBundle(run);
          void this.checkApprovalPoint(run);
        });
      },
      inbox: () => st.inbox.splice(0),
    };
  }

  private scoreCardFields(run: ScoreRun, headline: string) {
    return {
      laneId: 'score',
      laneName: run.score.title,
      color: BRASS,
      headline,
      parts: [...run.parts.values()].map((st) => ({
        name: st.part.name,
        color: st.color,
        status: st.state === 'settled' ? st.result!.status : st.state,
        line:
          st.state === 'settled'
            ? st.result!.result
            : (this.snap.lanes.find((l) => l.laneId === st.laneId)?.line ?? ''),
      })),
      approvals: run.bundleAnswered
        ? []
        : run.pending.map((p) => ({
            laneName: run.parts.get(p.partId)!.part.name,
            color: run.parts.get(p.partId)!.color,
            summary: p.summary,
          })),
      seconds: Math.round((Date.now() - run.startedAt) / 1000),
      manualMinutes: manualMinutes(run.score),
      runId: run.runId,
    };
  }

  private refreshBundle(run: ScoreRun) {
    if (run.bundleCard === undefined || run.bundleCard < 0) return;
    const card = this.snap.cards.find((c) => c.id === run.bundleCard);
    if (card?.kind === 'score') this.patchCard(run.bundleCard, this.scoreCardFields(run, card.headline));
  }

  private async merged(run: ScoreRun): Promise<{ headline: string; speech: string }> {
    const results = Object.fromEntries([...run.parts.values()].map((st) => [st.part.id, st.result]));
    try {
      return (
        await this.model.json(
          MergeReply,
          toOpenAI(
            mergeMessages(
              run.score,
              results,
              run.pending.map((p) => p.summary),
            ),
          ),
          'low',
        )
      ).value;
    } catch {
      return { headline: run.score.title, speech: 'The lanes have finished. Here is what they found.' };
    }
  }

  // Once no lane is still working and some wait for a yes, show one card with everything.
  private async checkApprovalPoint(run: ScoreRun) {
    if (run.bundleCard !== undefined || run.bundleAnswered || !run.pending.length) return;
    if (
      !readyForApprovals(
        [...run.parts.values()].map((st) => ({ id: st.part.id, dependsOn: st.part.dependsOn, phase: st.state })),
      )
    )
      return;
    run.bundleCard = -1; // claimed while the summary is written
    const m = await this.merged(run);
    this.speak(m.speech);
    run.spoke = true;
    const answer = this.show({ kind: 'score', ...this.scoreCardFields(run, m.headline), done: false });
    run.bundleCard = this.nextCard - 1;
    const a = await answer;
    run.bundleAnswered = true;
    const yes = 'choice' in a && a.choice === 'approve';
    for (const p of run.pending.splice(0)) p.resolve(yes);
  }

  private async finishScore(run: ScoreRun) {
    const m = await this.merged(run);
    if (!run.spoke) this.speak(m.speech);
    void this.show({ kind: 'score', ...this.scoreCardFields(run, m.headline), done: true });
  }

  // Pointing at a lane while it runs and speaking: the words go to that lane alone.
  private redirect(laneId: string, words: string): boolean {
    const st = [...(this.run?.parts.values() ?? [])].find((p) => p.laneId === laneId);
    if (!st || st.state === 'settled') return false;
    st.inbox.push(words);
    this.patchLane(laneId, { line: `You said: “${words}”` });
    return true;
  }

  // ── Cues ──
  async fromCue(cue: { transcript: string; intent: string; anchors: Anchor[]; heldMs: number }) {
    this.limited = null;
    if (/\b(everyone|everybody|all lanes)\b.*\bstop\b|^\s*stop everything\b/i.test(cue.transcript))
      return this.stopAll();
    if (this.answerByVoice(cue.transcript)) return;
    const atLane = cue.anchors.find((a) => a.laneId);
    if (atLane?.laneId && this.redirect(atLane.laneId, cue.transcript)) return;
    const references = mapDeixis(cue.transcript, cue.heldMs, cue.anchors);
    this.set({ thinking: true });
    this.notice('Thinking…');
    let move: CueMove;
    try {
      const messages = cueMessages({
        transcript: cue.transcript,
        intent: cue.intent,
        anchors: cue.anchors,
        references,
        profile: this.profile,
        sites: sitesFor(location.origin),
      });
      move = (await this.model.json(CueMove, toOpenAI(messages), 'low')).value;
    } catch (e) {
      this.set({ thinking: false });
      return this.notice(friendlyError(e), 'warn');
    }
    this.set({ thinking: false, notice: null });
    await this.perform(move, cue.anchors);
  }

  private async perform(move: CueMove, anchors: Anchor[]) {
    if (move.kind === 'answer' || move.kind === 'clarify') {
      const speech = move.kind === 'answer' ? move.speech : move.question;
      this.speak(speech);
      void this.show({
        kind: 'result',
        laneId: 'answer',
        laneName: 'Baton',
        color: BRASS,
        status: move.kind === 'answer' ? 'answer' : 'question',
        result: speech,
        detail: '',
      });
      return;
    }
    if (move.kind === 'rehearse' || move.kind === 'perform') {
      this.notice(
        '“Watch me” and “do the rest” run in the desktop app. Baton Live shows conducting and “put this there”.',
        'warn',
      );
      return;
    }
    try {
      if (move.kind === 'score') return await this.runScoreCue(Score.parse(move));
      if (move.kind === 'task') return await this.runOne(move.name, move.goal, move.startUrl);
      const from = anchors.find((a) => a.n === move.from);
      const to = anchors.find((a) => a.n === move.to);
      if (!from?.target || !to?.url)
        return this.notice('Point at the thing to copy first, then at the place it goes, while you speak.', 'warn');
      await this.runOne(move.name, transferGoal(from, to, move.instruction), to.url);
    } catch (e) {
      this.notice(friendlyError(e), 'warn');
    }
  }
}

const isLimit = (e: unknown) => (e as { error?: { code?: string } }).error?.code === 'baton_limit';

// The proxy's refusals say plainly what happened; other errors keep their own message.
export function friendlyError(e: unknown): string {
  const err = e as { status?: number; error?: { message?: string }; message?: string };
  if (err.error?.message) return err.error.message;
  return err.message ?? String(e);
}
