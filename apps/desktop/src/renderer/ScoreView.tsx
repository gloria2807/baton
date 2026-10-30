// The Score view window: task graph, filmstrip receipts, time against an estimate by hand.

import { useEffect, useState } from 'react';

interface Frame {
  n: number;
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
  seconds: number;
  manualMinutes: number;
  waves: string[][] | null;
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

  const byId = (id: string) => rec?.lanes.find((l) => l.id === id);
  const saved = rec ? rec.manualMinutes * 60 - rec.seconds : 0;

  return (
    <div className="scoreview">
      <aside>
        <div className="sv-brand">Score</div>
        {list.map((s) => (
          <button key={s.runId} className={s.runId === runId ? 'on' : ''} onClick={() => setRunId(s.runId)}>
            <b>{s.title}</b>
            <span>
              {new Date(s.startedAt).toLocaleString()} · {s.lanes} lanes · {fmt(s.seconds)}
            </span>
          </button>
        ))}
        {!list.length && <p className="muted">No Scores yet. Give Baton a request with several parts.</p>}
      </aside>
      {rec && (
        <main>
          <header>
            <h1>{rec.score.title}</h1>
            <p>{rec.headline}</p>
            <div className="stats">
              <div>
                <b>{fmt(rec.seconds)}</b>
                <span>with Baton</span>
              </div>
              <div>
                <b>about {rec.manualMinutes} min</b>
                <span>estimated by hand</span>
              </div>
              <div>
                <b>{saved > 0 ? fmt(saved) : '—'}</b>
                <span>saved</span>
              </div>
            </div>
          </header>

          <section className="graph">
            {(rec.waves ?? [rec.score.parts.map((p) => p.id)]).map((wave, i) => (
              <div className="sv-wave" key={i}>
                <div className="sv-wave-label">{i === 0 ? 'together' : `then (wave ${i + 1})`}</div>
                {wave.map((id) => {
                  const l = byId(id);
                  const part = rec.score.parts.find((p) => p.id === id);
                  return (
                    <div className="node" key={id} style={{ ['--c' as string]: l?.color ?? '#8b9bff' }}>
                      <i />
                      <b>{part?.name ?? id}</b>
                      <span className={`st s-${l?.result?.status}`}>{l?.result?.status ?? '—'}</span>
                      {part?.dependsOn.length ? <em>needs {part.dependsOn.map((d) => byId(d)?.name ?? d).join(', ')}</em> : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </section>

          {rec.lanes.map((l) => (
            <section className="lane-strip" key={l.id} style={{ ['--c' as string]: l.color }}>
              <div className="strip-head">
                <i />
                <b>{l.name}</b>
                <span>{l.result?.result}</span>
              </div>
              {l.attempts.map((frames, a) => (
                <div className="film" key={a}>
                  {a > 0 && <div className="redirected">redirected</div>}
                  {frames.map((f) => (
                    <figure key={f.n} className={`${f.ok ? '' : 'bad'} gate-${f.gate}`} onClick={() => setZoom(f)}>
                      {f.image ? <img src={f.image} alt="" /> : <div className="noimg" />}
                      <figcaption>
                        <b>
                          {f.n}. {f.action}
                        </b>
                        <span>{f.thinking}</span>
                        {f.gate !== 'allowed' && <em>{f.gate}</em>}
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
            <p className={zoom.ok ? 'ok' : 'bad'}>
              {zoom.ok ? 'Checked' : 'Check failed'}: {zoom.note} · {zoom.seconds} s{zoom.gate !== 'allowed' ? ` · ${zoom.gate}` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
