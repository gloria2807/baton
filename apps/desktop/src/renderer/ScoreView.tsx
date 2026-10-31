// The Score view: a finished cue drawn as a score. One staff line per lane in real time, each step
// a note; approvals in brass, failed checks in alert. Each lane's receipt as a filmstrip below.

import { useEffect, useMemo, useState } from 'react';

interface Frame {
  n: number;
  atMs: number;
  thinking: string;
  action: string;
  reason: string;
  gate: string;
  ok: boolean;
  note: string;
  seconds: number;
  image?: string;
}

interface LaneRecord {
  id: string;
  name: string;
  color: string;
  goal?: string;
  result?: { status: string; result: string; ms?: number };
  attempts: Frame[][];
}

interface ScoreRecord {
  runId: string;
  score: { title: string; parts: Array<{ id: string; name: string; dependsOn: string[]; manualMinutes: number }> };
  headline: string;
  speech?: string;
  seconds: number;
  manualMinutes: number;
  lanes: LaneRecord[];
}

interface Listed {
  runId: string;
  title: string;
  startedAt: string;
  seconds: number;
  lanes: number;
}

const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

function Staff({ rec, onPick }: { rec: ScoreRecord; onPick: (f: Frame) => void }) {
  const total = Math.max(1, rec.seconds * 1000);
  const ticks = useMemo(() => {
    const step = total > 120000 ? 30000 : total > 40000 ? 10000 : 5000;
    // Leave room at the right edge so the last label never wraps.
    return Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step).filter((t) => t / total < 0.94);
  }, [total]);
  return (
    <div className="staff">
      <div className="staff-axis">
        {ticks.map((t) => (
          <span key={t} style={{ left: `${(t / total) * 100}%` }}>
            {t / 1000} s
          </span>
        ))}
      </div>
      {rec.lanes.map((l) => {
        const frames = l.attempts.flat();
        const last = frames[frames.length - 1];
        return (
          <div className="staff-row" key={l.id} style={{ ['--c' as string]: l.color }}>
            <div className="staff-name">
              <i />
              {l.name}
            </div>
            <div className="staff-line">
              {frames.map((f, i) => (
                <button
                  key={`${i}-${f.n}`}
                  className={`note ${f.ok ? '' : 'miss'} ${f.gate === 'approved' || f.gate === 'pre-approved' ? 'yes' : ''} ${f.gate === 'blocked' || f.gate === 'declined' ? 'held' : ''}`}
                  style={{ left: `${(f.atMs / total) * 100}%` }}
                  title={`${f.n}. ${f.action}`}
                  onClick={() => onPick(f)}
                />
              ))}
              {last && (
                <span
                  className={`barline ${l.result?.status === 'done' ? '' : 'open'}`}
                  style={{ left: `${(last.atMs / total) * 100}%` }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ScoreView() {
  const [list, setList] = useState<Listed[]>([]);
  const [runId, setRunId] = useState(() => decodeURIComponent(location.hash.match(/score=([^&]+)/)?.[1] ?? ''));
  const [rec, setRec] = useState<ScoreRecord | null>(null);
  const [zoom, setZoom] = useState<Frame | null>(null);

  useEffect(() => {
    void window.baton.listScores().then((l) => {
      const items = l as Listed[];
      setList(items);
      if (!runId && items[0]) setRunId(items[0].runId);
    });
  }, []);
  useEffect(() => {
    if (runId) void window.baton.getScore(runId).then((r) => setRec(r as ScoreRecord));
  }, [runId]);

  const steps = rec?.lanes.reduce((a, l) => a + l.attempts.flat().length, 0) ?? 0;

  return (
    <div className="scoreview">
      <aside>
        <div className="sv-title">Scores</div>
        {list.map((s) => (
          <button key={s.runId} className={s.runId === runId ? 'on' : ''} onClick={() => setRunId(s.runId)}>
            <span className="t">{s.title}</span>
            <span className="m">
              {when(s.startedAt)} · {s.lanes} {s.lanes === 1 ? 'lane' : 'lanes'} · {fmt(s.seconds)}
            </span>
          </button>
        ))}
        {!list.length && <p className="m">No scores yet. Ask Baton for something with several parts.</p>}
      </aside>
      {rec && (
        <main>
          <header>
            <h1>{rec.score.title}</h1>
            <p className="lead">{rec.speech ?? rec.headline}</p>
            <p className="totals">
              {rec.lanes.length} lanes, {steps} steps, {fmt(rec.seconds)} with Baton. By hand this is about{' '}
              {rec.manualMinutes} minutes.
            </p>
          </header>

          <Staff rec={rec} onPick={setZoom} />
          <p className="legend">
            <span className="note-key" /> step <span className="note-key yes" /> approved by you{' '}
            <span className="note-key miss" /> check failed, tried again <span className="bar-key" /> finished
          </p>

          {rec.lanes.map((l) => (
            <section className="lane-strip" key={l.id} style={{ ['--c' as string]: l.color }}>
              <div className="strip-head">
                <i />
                <b>{l.name}</b>
                <span>{l.result?.result}</span>
              </div>
              {l.attempts.map((frames, a) => (
                <div className="film" key={a}>
                  {a > 0 && <div className="redirected">After your redirect</div>}
                  {frames.map((f) => (
                    <figure key={f.n} className={f.ok ? '' : 'miss'} onClick={() => setZoom(f)}>
                      {f.image ? <img src={f.image} alt="" /> : <div className="noimg" />}
                      <figcaption>
                        <b>
                          {f.n}. {f.thinking || f.action}
                        </b>
                        <span>{f.action}</span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </main>
      )}
      {zoom && (
        <div className="zoom" onClick={() => setZoom(null)}>
          {zoom.image && <img src={zoom.image} alt="" />}
          <div>
            <b>
              Step {zoom.n}: {zoom.action}
            </b>
            <p>{zoom.reason}</p>
            <p className={zoom.ok ? 'ok' : 'miss'}>
              {zoom.ok ? 'Checked' : 'Check failed'}: {zoom.note} · {zoom.seconds} s
              {zoom.gate !== 'allowed' ? ` · ${zoom.gate}` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
