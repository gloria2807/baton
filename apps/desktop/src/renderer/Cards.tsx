// Lane chips and the cards that wait for the person: approval, question, injection, result.
import { useState } from 'react';

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
  | { kind: 'result'; id: number; laneId: string; laneName: string; color: string; status: string; result: string; detail: string }
  | { kind: 'rehearsal'; id: number; laneId: string; laneName: string; color: string; steps: string[]; recording: boolean }
  | {
      kind: 'routine';
      id: number;
      laneId: string;
      laneName: string;
      color: string;
      routine: { name: string; summary: string; itemKind: string; variables: Array<{ name: string; description: string; example: string }>; steps: Array<{ do: string }> };
    }
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

const PART_STATE: Record<string, string> = { done: 'done', stopped: 'stopped', failed: 'failed', skipped: 'skipped', running: 'working', waiting: 'waiting', 'waiting-approval': 'needs your yes' };

// The learned routine, with its variables editable before Baton performs it.
function RoutineCard({ card }: { card: Extract<Card, { kind: 'routine' }> }) {
  const [vars, setVars] = useState(card.routine.variables.map((v) => ({ name: v.name, description: v.description })));
  const changed = vars.some((v, i) => v.name !== card.routine.variables[i]!.name || v.description !== card.routine.variables[i]!.description);
  return (
    <div className="card routine">
      <Head card={card} label="learned" />
      <div className="card-title">{card.routine.name}</div>
      <div className="card-sub">{card.routine.summary}</div>
      <ol className="routine-steps">
        {card.routine.steps.map((s, i) => (
          <li key={i}>{s.do}</li>
        ))}
      </ol>
      <div className="vars">
        {vars.map((v, i) => (
          <div className="var" key={i}>
            <input value={v.name} aria-label="Variable name" onChange={(e) => setVars(vars.map((x, j) => (j === i ? { ...x, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') } : x)))} />
            <input value={v.description} aria-label="Where to find it" onChange={(e) => setVars(vars.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
            <span className="example">e.g. {card.routine.variables[i]!.example}</span>
          </div>
        ))}
      </div>
      <div className="card-actions">
        <span className="hint">Say “now do the rest” to perform it.</span>
        <button className="btn" onClick={() => answer(card.id, changed ? { text: JSON.stringify(vars.map((v, index) => ({ index, ...v }))) } : { choice: 'dismiss' })}>
          {changed ? 'Save changes' : 'Looks right'}
        </button>
      </div>
    </div>
  );
}

export function CardView({ card }: { card: Card }) {
  switch (card.kind) {
    case 'rehearsal':
      return (
        <div className="card rehearsal">
          <Head card={card} label="recording" />
          <div className="card-title">
            <span className="rec" /> Do it once. Say what matters as you go.
          </div>
          <ol className="routine-steps">
            {card.steps.slice(-8).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <div className="card-actions">
            <span className="hint">or say “that’s it”</span>
            <button className="btn" onClick={() => answer(card.id, { choice: 'stop' })}>
              Finish
            </button>
          </div>
        </div>
      );
    case 'routine':
      return <RoutineCard card={card} />;
    case 'score':
      return (
        <div className={`card score ${card.approvals.length ? 'approval' : ''}`}>
          <Head card={card} label={card.done ? 'all done' : card.approvals.length ? 'needs your yes' : 'working'} />
          <div className="card-title">{card.headline}</div>
          <ul className="parts">
            {card.parts.slice(0, 8).map((p) => (
              <li key={p.name} style={{ ['--c' as string]: p.color }}>
                <i />
                <span className="lane-name">{p.name}</span>
                <span className={`part-state s-${p.status}`}>{PART_STATE[p.status] ?? p.status}</span>
                <span className="part-line">{p.line}</span>
              </li>
            ))}
            {card.parts.length > 8 && (
              <li className="more">
                …and {card.parts.length - 8} more · {card.parts.filter((p) => p.status === 'done').length} of {card.parts.length} done
              </li>
            )}
          </ul>
          {card.approvals.length > 0 && (
            <div className="bundle">
              {card.approvals.map((a, i) => (
                <div className="bundle-item" key={i} style={{ ['--c' as string]: a.color }}>
                  {a.image && <img src={a.image} alt="" />}
                  <div>
                    <div className="lane-name">{a.laneName}</div>
                    <div>{a.summary}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="card-actions">
            <span className="hint">
              {card.seconds} s · about {card.manualMinutes} min by hand{card.approvals.length ? ' · or say “yes” / “no”' : ''}
            </span>
            {card.approvals.length ? (
              <>
                <button className="btn ghost" onClick={() => answer(card.id, { choice: 'decline' })}>
                  Decline
                </button>
                <button className="btn" onClick={() => answer(card.id, { choice: 'approve' })}>
                  {card.approvals.length > 1 ? `Approve all ${card.approvals.length}` : 'Approve'}
                </button>
              </>
            ) : (
              <>
                {card.done && (
                  <button className="btn ghost" onClick={() => void window.baton.openScore(card.runId)}>
                    Show the Score
                  </button>
                )}
                <button className="btn ghost" onClick={() => answer(card.id, { choice: 'dismiss' })}>
                  Dismiss
                </button>
              </>
            )}
          </div>
        </div>
      );
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
