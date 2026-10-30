// Baton Live: the visitor's own browser on the left, the orchestra on the right, the Podium on top.

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { CardView } from '../../desktop/src/renderer/Cards';
import type { Conductor, LaneFrame, Receipt } from './conductor';
import { frames } from './hands';
import { sites } from './sites';
import type { Talk } from './talk';

const HOME_TABS = [
  { label: 'Inbox', url: '/sites/inbox/' },
  { label: 'Ledgerly', url: '/sites/ledgerly/' },
  { label: 'Roam', url: '/sites/roam/' },
];
const START = '/sites/inbox/m/atlas-invite';
// Lane pages render at this width and are scaled to fit their tile, like a window seen from afar.
const LANE_PAGE_WIDTH = 1180;
const BARS = 18;

interface Budget {
  configured: boolean;
  visitor: { spent: number; budget: number };
}

function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
      <path d="M5 21 L21 5" stroke="#c99a3b" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4.2 21.8 L7.6 18.4" stroke="#efe9dd" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

function Wave({ level }: { level: () => number }) {
  const [levels, setLevels] = useState<number[]>(Array(BARS).fill(0));
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setLevels((prev) => [...prev.slice(1), level()]);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [level]);
  return (
    <span className="wave" aria-hidden>
      {levels.map((l, i) => (
        <span key={i} style={{ transform: `scaleY(${Math.max(0.08, Math.min(1, l * 9))})` }} />
      ))}
    </span>
  );
}

function Bar({
  conductor,
  talk,
  budget,
  onReset,
  onReceipts,
  receiptsOpen,
}: {
  conductor: Conductor;
  talk: Talk;
  budget: Budget | null;
  onReset: () => void;
  onReceipts: () => void;
  receiptsOpen: boolean;
}) {
  const t = useSyncExternalStore(talk.subscribe, talk.snapshot);
  const c = useSyncExternalStore(conductor.subscribe, conductor.snapshot);
  const [text, setText] = useState('');
  const phase = t.phase;
  const busy = c.lanes.some((l) =>
    ['running', 'waiting-approval', 'waiting-person', 'paused-injection'].includes(l.state),
  );

  let main = 'Hold Space and speak, or type a request';
  let sub = 'Rest the pointer on things while you speak; each place becomes a numbered pin.';
  if (phase.kind === 'opening') main = 'Opening the microphone…';
  if (phase.kind === 'listening') main = 'Listening';
  if (phase.kind === 'understanding') main = 'Understanding…';
  if (phase.kind === 'heard') main = `“${phase.transcript}”`;
  if (phase.kind === 'notice') main = phase.text;
  if (c.thinking) sub = 'Planning the work…';
  else if (c.notice) sub = c.notice.text;
  else if (phase.kind === 'listening' || phase.kind === 'opening')
    sub = t.pins.length ? `${t.pins.length} pinned` : 'Rest the pointer on what you mean';

  function submit(e: FormEvent) {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    setText('');
    void talk.typed(v);
  }

  return (
    <header className={`bar phase-${phase.kind}`}>
      <div className="mark">
        <Mark />
      </div>
      <div className="center">
        <div className={`main ${phase.kind === 'notice' ? `notice ${phase.tone}` : ''}`}>
          {phase.kind === 'listening' && <Wave level={talk.level} />}
          <span>{main}</span>
        </div>
        <div className={`sub ${c.notice?.tone === 'warn' ? 'warn' : ''}`}>{sub}</div>
      </div>
      <form className="ask" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a request, e.g. Get me there"
          aria-label="Type a request"
        />
      </form>
      <button
        className={`btn talk ${t.holding ? 'held' : ''}`}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          talk.down();
        }}
        onPointerUp={() => void talk.up()}
        onPointerCancel={() => void talk.up()}
      >
        {t.holding ? 'Release to send' : 'Hold to talk'}
      </button>
      <div className="tools">
        {busy ? (
          <button className="btn ghost" onClick={() => conductor.stopAll()}>
            Stop all
          </button>
        ) : (
          <>
            {c.receipts.length > 0 && (
              <button className="btn ghost" onClick={onReceipts}>
                {receiptsOpen ? 'Show lanes' : 'Receipts'}
              </button>
            )}
            <button className="btn ghost" onClick={onReset}>
              Reset demo
            </button>
          </>
        )}
      </div>
      <div className="spend">
        {budget
          ? budget.configured
            ? `Your model budget today: $${budget.visitor.spent.toFixed(2)} of $${budget.visitor.budget.toFixed(2)}`
            : 'Model not configured on this server'
          : ''}
      </div>
    </header>
  );
}

function Home() {
  const [url, setUrl] = useState(START);
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    frames.attach('home', ref.current);
    const prev = frames.onReady;
    frames.onReady = (name) => {
      prev(name);
      if (name === 'home') setUrl(ref.current?.contentWindow?.location.pathname ?? '');
    };
    return () => {
      frames.onReady = prev;
    };
  }, []);
  const go = (to: string) => frames.navigate('home', to);
  return (
    <section className="home" aria-label="Your browser">
      <div className="tabs">
        <button
          className="btn ghost small"
          onClick={() => {
            try {
              frames.back('home');
            } catch {
              /* already on the first page */
            }
          }}
          aria-label="Back"
        >
          ‹
        </button>
        {HOME_TABS.map((t) => (
          <button key={t.label} className={`tab ${url.startsWith(t.url) ? 'on' : ''}`} onClick={() => go(t.url)}>
            {t.label}
          </button>
        ))}
        <span className="where">Your browser</span>
      </div>
      <iframe ref={ref} name="home" src={START} title="Your browser" />
    </section>
  );
}

function LaneTile({ f, view }: { f: LaneFrame; view?: { state: string; line: string; step: number } }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / LANE_PAGE_WIDTH));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const state = view?.state ?? 'running';
  return (
    <div className={`tile state-${state}`} style={{ ['--c' as string]: f.color }}>
      <div className="tile-head">
        <i />
        <span className="lane-name">{f.name}</span>
        <span className="tile-line">{view?.line}</span>
        {view && view.step > 0 && <span className="tile-step">step {view.step}</span>}
      </div>
      <div className="tile-body" ref={box}>
        <iframe
          ref={(el) => frames.attach(f.laneId, el)}
          name={f.laneId}
          src={f.url}
          title={f.name}
          style={{ width: LANE_PAGE_WIDTH, height: `${100 / scale}%`, transform: `scale(${scale})` }}
        />
      </div>
    </div>
  );
}

const describeStep = (r: Receipt['steps'][number]) => {
  const a = r.action as unknown as Record<string, unknown>;
  const arg =
    a.url ??
    a.query ??
    a.text ??
    a.option ??
    a.what ??
    a.item ??
    a.question ??
    a.result ??
    (a.mark !== undefined ? `mark ${a.mark}` : '');
  return `${String(a.tool).replace(/_/g, ' ')}${arg ? `: ${String(arg).slice(0, 120)}` : ''}`;
};

function Receipts({ receipts }: { receipts: Receipt[] }) {
  return (
    <div className="receipts">
      <p className="lede">
        Every step each lane took: what it did, why, and whether the page then showed the expected change.
      </p>
      {receipts.map((r) => (
        <section key={r.laneId} style={{ ['--c' as string]: r.color }}>
          <h3>
            <i />
            {r.name}
            <span>
              {r.outcome
                ? `${r.outcome.status} · ${r.outcome.steps} steps · ${(r.outcome.ms / 1000).toFixed(0)} s`
                : 'running'}
            </span>
          </h3>
          <ol>
            {r.steps.map((s) => (
              <li key={s.n} className={s.verdict.ok ? '' : 'miss'}>
                <span className="what">{describeStep(s)}</span>
                <span className="why">{s.reason}</span>
                <span className="check">
                  {s.gate === 'approved' ? 'approved by you · ' : s.gate === 'declined' ? 'declined by you · ' : ''}
                  {s.verdict.ok ? 'checked' : s.verdict.note}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Tour({ talk }: { talk: Talk }) {
  const show = (path: string) => frames.navigate('home', path);
  return (
    <div className="tour">
      <h1>One cursor, many hands.</h1>
      <p className="lede">
        Baton plans what you ask, splits it into parts and gives each part its own lane. Lanes work at the same time
        while your pointer stays free. Everything here is real: Muse Spark Open on Baseten drives every lane on these
        fictional demo sites, and nothing irreversible happens without your yes.
      </p>
      <ol className="cues">
        <li>
          <div className="cue-title">Get me there</div>
          <p>
            The Atlas Summit invitation is open on the left. Hold Space, rest the pointer on the email and say{' '}
            <q>Get me there</q>. Four lanes find flights and a hotel, block your calendar and draft a reply.
          </p>
          <button
            className="btn ghost"
            onClick={() => {
              show(START);
              setTimeout(() => void talk.typed('Get me there'), 600);
            }}
          >
            Run it without a microphone
          </button>
        </li>
        <li>
          <div className="cue-title">Put this there</div>
          <p>
            Open an invoice email, hold Space and rest on the invoice, click the Ledgerly tab, rest on <em>New bill</em>
            , and say <q>Put this there</q>. One lane enters the bill and stops before saving.
          </p>
          <button
            className="btn ghost"
            onClick={() => {
              show('/sites/inbox/m/inv-1');
              setTimeout(() => void talk.typed('Put this invoice into Ledgerly as a new bill'), 600);
            }}
          >
            Run it without a microphone
          </button>
        </li>
        <li>
          <div className="cue-title">Watch me, then do the rest</div>
          <p>
            Show Baton one invoice entered by hand and it enters the rest, four lanes at a time. This move needs the
            desktop app, which watches your own Chrome; it is not in Baton Live yet.
          </p>
        </li>
      </ol>
      <p className="fine">
        Lanes here read pages as text and act through real DOM events. The desktop app drives your own signed-in Chrome
        with the Chrome DevTools Protocol, so it works on real websites.
      </p>
    </div>
  );
}

export function App({ conductor, talk }: { conductor: Conductor; talk: Talk }) {
  const c = useSyncExternalStore(conductor.subscribe, conductor.snapshot);
  const t = useSyncExternalStore(talk.subscribe, talk.snapshot);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [receiptsOpen, setReceiptsOpen] = useState(false);

  const refreshBudget = () =>
    fetch('/api/budget')
      .then((r) => (r.ok ? (r.json() as Promise<Budget>) : null))
      .then(setBudget, () => undefined);
  useEffect(() => {
    void refreshBudget();
  }, [c.cards.length, c.lanes.length]);

  useEffect(() => {
    window.baton = {
      answerCard: (id: number, a: unknown) => conductor.answer(id, a as Parameters<Conductor['answer']>[1]),
      stopAll: () => conductor.stopAll(),
      openScore: () => setReceiptsOpen(true),
    };
    // Space anywhere on this page (outside text fields) is the talk key too.
    const editable = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || editable(e.target)) return;
      e.preventDefault();
      if (!e.repeat) talk.down();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !editable(e.target)) void talk.up();
    };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return () => {
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
    };
  }, [conductor, talk]);

  function reset() {
    conductor.clear();
    setReceiptsOpen(false);
    sites.reset();
    frames.navigate('home', START);
  }

  const n = c.frames.length;
  return (
    <div className="live">
      <Bar
        conductor={conductor}
        talk={talk}
        budget={budget}
        onReset={reset}
        onReceipts={() => setReceiptsOpen((o) => !o)}
        receiptsOpen={receiptsOpen}
      />
      <main className="desk">
        <Home />
        <section className="stage" aria-label="Lanes">
          {receiptsOpen && c.receipts.length ? (
            <Receipts receipts={c.receipts} />
          ) : n ? (
            <div className={`grid n${Math.min(n, 4)}`}>
              {c.frames.map((f) => (
                <LaneTile key={f.laneId} f={f} view={c.lanes.find((l) => l.laneId === f.laneId)} />
              ))}
            </div>
          ) : (
            <Tour talk={talk} />
          )}
          {c.cards.length > 0 && (
            <div className="cards">
              {c.cards.map((card) => (
                <CardView key={card.id} card={card} />
              ))}
            </div>
          )}
        </section>
      </main>
      {t.pins.map((p) => (
        <div key={p.n} className="pin" style={{ left: p.x, top: p.y }} title={p.label}>
          {p.n}
        </div>
      ))}
      <div className="narrow">Baton Live needs a wider screen: open it on a computer.</div>
    </div>
  );
}
