// Lane chips and the cards that wait for the person: approval, question, injection, result.

export interface LaneView {
  laneId: string;
  name: string;
  color: string;
  state: string;
  line: string;
  step: number;
}

export type Card =
  | { kind: 'approval'; id: number; laneId: string; laneName: string; color: string; summary: string; reason: string; image?: string }
  | { kind: 'question'; id: number; laneId: string; laneName: string; color: string; question: string }
  | { kind: 'injection'; id: number; laneId: string; laneName: string; color: string; url: string; findings: Array<{ source: string; text: string }> }
  | { kind: 'result'; id: number; laneId: string; laneName: string; color: string; status: string; result: string; detail: string };

const answer = (id: number, a: unknown) => void window.baton.answerCard(id, a);

const STATE_LABEL: Record<string, string> = {
  running: 'working',
  'waiting-approval': 'needs your yes',
  'waiting-person': 'asking you',
  'paused-injection': 'paused',
  done: 'done',
  stopped: 'stopped',
};

export function Lanes({ lanes }: { lanes: LaneView[] }) {
  if (!lanes.length) return null;
  return (
    <div className="lanes">
      {lanes.map((l) => (
        <div key={l.laneId} className={`lane state-${l.state}`} style={{ ['--c' as string]: l.color }}>
          <i />
          <span className="lane-name">{l.name}</span>
          <span className="lane-state">{STATE_LABEL[l.state] ?? l.state}</span>
          <span className="lane-line">{l.line}</span>
          {l.step > 0 && <span className="lane-step">step {l.step}</span>}
        </div>
      ))}
      <button className="btn ghost small" onClick={() => void window.baton.stopAll()}>
        Stop all
      </button>
    </div>
  );
}

function Head({ card, label }: { card: Card; label: string }) {
  return (
    <div className="card-head" style={{ ['--c' as string]: card.color }}>
      <i />
      <span className="lane-name">{card.laneName}</span>
      <span className="card-label">{label}</span>
    </div>
  );
}

export function CardView({ card }: { card: Card }) {
  switch (card.kind) {
    case 'approval':
      return (
        <div className="card approval">
          <Head card={card} label="needs your yes" />
          <div className="card-title">{card.summary}</div>
          {card.reason && <div className="card-sub">{card.reason}</div>}
          {card.image && <img className="crop" src={card.image} alt="The button the lane wants to press" />}
          <div className="card-actions">
            <span className="hint">or say “yes” / “no”</span>
            <button className="btn ghost" onClick={() => answer(card.id, { choice: 'decline' })}>
              Decline
            </button>
            <button className="btn" onClick={() => answer(card.id, { choice: 'approve' })}>
              Approve
            </button>
          </div>
        </div>
      );
    case 'question':
      return (
        <div className="card question">
          <Head card={card} label="asks you" />
          <div className="card-title">{card.question}</div>
          <div className="card-actions">
            <span className="hint">answer by voice, or</span>
            <button className="btn ghost" onClick={() => answer(card.id, { choice: 'stop' })}>
              Stop lane
            </button>
            <button className="btn" onClick={() => answer(card.id, { text: 'Done. Please continue.' })}>
              Done, continue
            </button>
          </div>
        </div>
      );
    case 'injection':
      return (
        <div className="card injection">
          <Head card={card} label="paused" />
          <div className="card-title">This page contains instructions aimed at AI agents</div>
          <div className="card-sub">{card.url}</div>
          <ul className="findings">
            {card.findings.map((f, i) => (
              <li key={i}>
                <span className="src">{f.source}</span>“{f.text}”
              </li>
            ))}
          </ul>
          <div className="card-sub">Baton does not follow instructions from web pages.</div>
          <div className="card-actions">
            <button className="btn ghost" onClick={() => answer(card.id, { choice: 'continue' })}>
              Continue, ignoring it
            </button>
            <button className="btn" onClick={() => answer(card.id, { choice: 'stop' })}>
              Stop lane
            </button>
          </div>
        </div>
      );
    case 'result':
      return (
        <div className={`card result status-${card.status}`}>
          <Head card={card} label={card.status === 'done' ? 'finished' : card.status === 'answer' ? 'answered' : card.status} />
          <div className="card-title">{card.result}</div>
          <div className="card-actions">
            <span className="hint">{card.detail}</span>
            <button className="btn ghost" onClick={() => answer(card.id, { choice: 'dismiss' })}>
              Dismiss
            </button>
          </div>
        </div>
      );
  }
}
