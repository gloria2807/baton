import { useEffect, useRef, useState } from 'react';
import { cueWav, rms } from '@baton/core/audio';
import { CardView, Lanes, type Card, type LaneView } from './Cards';
import { ProfileForm } from './Profile';
import { CameraPanel, CameraSwitch } from './Camera';
import { Recorder } from './recorder';
import { Captions } from './captions';
import { hush, speak } from './speech';
import { sounds } from './sounds';

type Phase =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'listening'; since: number }
  | { kind: 'understanding'; seconds: number; caption: string }
  | { kind: 'heard'; transcript: string; intent: string; ms: number; seconds: number }
  | { kind: 'notice'; text: string; tone: 'ok' | 'warn' | 'info' };

const toneOf = (t: string): 'ok' | 'warn' | 'info' =>
  /passed/i.test(t) ? 'ok' : /fail|could not|unavailable|not connected|no baseten/i.test(t) ? 'warn' : 'info';

interface CueUpdate {
  phase: 'saved' | 'heard' | 'error';
  seconds?: number;
  transcript?: string;
  intent?: string;
  ms?: number;
  error?: string;
}

type PttEvent = { type: 'start' } | { type: 'commit'; heldMs: number } | { type: 'cancel'; reason: string };

const BARS = 28;

// Today's model spending against the daily cap, so the cost is never a surprise.
type Note = { id: number; site: string; note: string; source: string };

// Baton's memory of how sites work: what lanes have learned, for the person to review.
function SiteNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  useEffect(() => {
    void window.baton.listNotes().then((n) => setNotes(n as Note[]));
  }, []);
  if (!notes.length) return null;
  return (
    <div className="notes">
      <div className="label">Site notes: what lanes are told on each site</div>
      <ul>
        {notes.map((n) => (
          <li key={n.id}>
            <span className="site">{n.site}</span>
            <span className="text">
              {n.note}
              {n.source === 'lane' ? <em> · learned by a lane</em> : null}
            </span>
            <button
              className="btn ghost small"
              onClick={() => void window.baton.removeNote(n.id).then((x) => setNotes(x as Note[]))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Spend = { spent: number; budget: number; total: number; totalBudget?: number };

function Budget() {
  const [b, setB] = useState<Spend | null>(null);
  useEffect(() => {
    void window.baton.getBudget().then((x) => setB(x as Spend | null));
  }, []);
  if (!b) return null;
  return (
    <div className="budget">
      Model spend today: ${b.spent.toFixed(2)} of ${b.budget.toFixed(2)}
      {b.totalBudget !== undefined ? `; in total: $${b.total.toFixed(2)} of $${b.totalBudget.toFixed(2)}` : ''}. The
      caps are BATON_DAILY_BUDGET_USD and BATON_TOTAL_BUDGET_USD in .env.
    </div>
  );
}

export function Podium() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [camera, setCamera] = useState(false);
  const [extension, setExtension] = useState<'connected' | 'waiting'>('waiting');
  const [token, setToken] = useState('');
  const [hasModel, setHasModel] = useState(true);
  const [panel, setPanel] = useState(false);
  const [copied, setCopied] = useState(false);
  const [talkKey, setTalkKey] = useState('Alt');
  const [talkKeys, setTalkKeys] = useState<Array<{ id: string; label: string }>>([]);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [lanes, setLanes] = useState<LaneView[]>([]);
  const [caption, setCaption] = useState('');
  const [thinking, setThinking] = useState('');
  const [posts, setPosts] = useState<
    Array<{ id: number; laneName: string; color?: string; text: string; adjusts?: number }>
  >([]);
  const captions = useRef(new Captions());
  const [cards, setCards] = useState<Card[]>([]);
  const [anchors, setAnchors] = useState<Array<{ n: number; label: string; source: string }>>([]);
  const [profile, setProfile] = useState<Record<string, string> | null>(null);
  const recorder = useRef(new Recorder());
  const seconds = useRef(0);
  const shell = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Build the audio graph now so the talk key only has to open the microphone.
    void recorder.current.warm().catch(() => undefined);
    // Load the caption model now, so the first words appear while the person is still speaking.
    const t0 = performance.now();
    void captions.current.warm()?.then(
      () => window.baton.logStatus(`caption model ready in ${Math.round(performance.now() - t0)} ms`),
      (e: Error) => window.baton.logStatus(`caption model failed: ${e.message}`),
    );
    void window.baton.init().then((s) => {
      setExtension(s.extension);
      setToken(s.token);
      setHasModel(s.hasModel);
      setTalkKey(s.talkKey);
      setTalkKeys(s.talkKeys);
      setProfile(s.profile);
    });
    const offs = [
      window.baton.onExtension((s) => setExtension(s as 'connected' | 'waiting')),
      window.baton.onShowPairing(() => setPanel(true)),
      window.baton.onReset(() => {
        setPanel(false);
        setAnchors([]);
        setPhase({ kind: 'idle' });
      }),
      window.baton.onNotice((t) => setPhase({ kind: 'notice', text: String(t), tone: toneOf(String(t)) })),
      window.baton.onThinking((t) => setThinking(String(t))),
      window.baton.onChannel((p) => setPosts(p as typeof posts)),
      window.baton.onSound((s) => (s === 'plan' ? sounds.plan() : undefined)),
      window.baton.onLanes((l) => {
        const next = l as LaneView[];
        setLanes((prev) => {
          // Each lane that appears gets a soft note, a little apart, as the plan becomes lanes.
          next
            .filter((n) => !prev.some((p) => p.laneId === n.laneId))
            .forEach((_, i) => setTimeout(() => sounds.laneStart(), i * 90));
          if (!prev.length && next.length) sounds.lanesStart();
          else if (next.some((n) => n.state === 'done' && prev.find((p) => p.laneId === n.laneId)?.state !== 'done'))
            sounds.laneDone();
          return next;
        });
      }),
      window.baton.onAnchors((a) => setAnchors(a as Array<{ n: number; label: string; source: string }>)),
      window.baton.onSpeak((t) => speak(String(t))),
      window.baton.onCards((c) => {
        const next = c as Card[];
        setCards((prev) => {
          if (next.some((x) => x.kind === 'score' && x.done && !prev.some((p) => p.id === x.id))) sounds.allDone();
          if (next.some((x) => x.kind !== 'result' && !prev.some((p) => p.id === x.id))) sounds.heard();
          return next;
        });
      }),
      window.baton.onTalkKey((k) => setTalkKey(String(k))),
      window.baton.onPtt((raw) => {
        const e = raw as PttEvent;
        if (e.type === 'start') void begin();
        else if (e.type === 'commit') void end();
        else void abort();
      }),
      window.baton.onCue((raw) => {
        const u = raw as CueUpdate;
        if (u.phase === 'heard') {
          sounds.heard();
          setPhase({
            kind: 'heard',
            transcript: u.transcript ?? '',
            intent: u.intent ?? '',
            ms: u.ms ?? 0,
            seconds: seconds.current,
          });
        } else if (u.phase === 'error')
          setPhase({ kind: 'notice', text: u.error ?? 'Something went wrong', tone: 'warn' });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // The window follows the content: bar, lane chips, cards, settings panel.
  useEffect(() => {
    const el = shell.current;
    if (!el) return;
    const ro = new ResizeObserver(() => void window.baton.resize(el.scrollHeight + 2));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Live captions while listening: the local recogniser goes over the audio so far about once a second.
  useEffect(() => {
    if (phase.kind !== 'listening') return;
    const t = setInterval(() => {
      const { samples, sampleRate } = recorder.current.snapshot();
      void captions.current.caption(samples, sampleRate).then(
        (text) => text && setCaption(text),
        () => undefined,
      );
    }, 900);
    return () => clearInterval(t);
  }, [phase.kind]);

  // Live waveform while listening.
  useEffect(() => {
    if (phase.kind !== 'listening') return;
    let raf = 0;
    const tick = () => {
      setLevels((prev) => [...prev.slice(1), recorder.current.level()]);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase.kind]);

  async function begin() {
    hush(); // pressing the key while Baton talks stops it
    setLevels(Array(BARS).fill(0));
    setCaption('');
    setThinking('');
    captions.current.updates = 0;
    setPhase({ kind: 'opening' });
    try {
      // The chime means "speak now": it plays only once the microphone is really capturing,
      // so the first word of a cue is never lost while Windows opens the device.
      await recorder.current.start(() => {
        sounds.listen();
        setPhase({ kind: 'listening', since: Date.now() });
      });
    } catch (e) {
      setPhase({ kind: 'notice', text: `Microphone unavailable: ${(e as Error).message}`, tone: 'warn' });
    }
  }

  async function end() {
    // Acknowledge at once (a tick, "Heard you", the waveform frozen); the model works after this.
    sounds.tick();
    setPhase({ kind: 'understanding', seconds: 0, caption });
    const rec = await recorder.current.stop();
    window.baton.captionStats(captions.current.updates);
    window.baton.reportMic(rec.openMs, rec.seconds, rec.timing);
    seconds.current = rec.seconds;
    if (rec.seconds < 0.25 || rms(rec.samples) < 0.004) {
      setPhase({
        kind: 'notice',
        text: rec.seconds < 0.25 ? 'Hold the key while you speak.' : 'I didn’t hear anything.',
        tone: 'warn',
      });
      return;
    }
    setPhase((p) => ({
      kind: 'understanding',
      seconds: rec.seconds,
      caption: p.kind === 'understanding' ? p.caption : '',
    }));
    // A last caption of the whole recording, while Muse Spark Open listens to the same audio.
    void captions.current.caption(rec.samples, rec.sampleRate).then(
      (text) => text && setCaption(text),
      () => undefined,
    );
    await window.baton.sendCue(cueWav(rec.samples, rec.sampleRate), rec.seconds);
  }

  // The talk key turned out to be part of a shortcut (Alt+F4, Alt+Tab…): drop the audio quietly.
  async function abort() {
    await recorder.current.stop();
    setPhase({ kind: 'idle' });
  }

  async function chooseTalkKey(id: string) {
    setTalkKey(String(await window.baton.setTalkKey(id)));
  }

  async function copy() {
    await window.baton.copyToken();
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="shell" ref={shell}>
      <div className={`bar phase-${phase.kind}`}>
        <div className="mark" aria-hidden>
          {/* The baton: a tapered brass stroke with a small grip. */}
          <svg width="26" height="26" viewBox="0 0 26 26">
            <path d="M5 21 L21 5" stroke="#c99a3b" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M4.2 21.8 L7.6 18.4" stroke="#efe9dd" strokeWidth="3.4" strokeLinecap="round" />
          </svg>
        </div>
        <div className="center">
          {phase.kind === 'idle' && (
            <>
              <div className="main">Hold {talkKeys.find((k) => k.id === talkKey)?.label ?? talkKey} and speak</div>
              <div className="sub">
                {hasModel
                  ? 'Release to send. Baton listens only while the key is down.'
                  : 'No Baseten key found: recordings are saved but not understood.'}
              </div>
            </>
          )}
          {phase.kind === 'opening' && <div className="main opening">Opening microphone…</div>}
          {phase.kind === 'listening' && (
            <div className="listening">
              <div className="wave">
                {levels.map((l, i) => (
                  <span key={i} style={{ transform: `scaleY(${0.12 + l * 0.88})` }} />
                ))}
              </div>
              <div className="main caption">{caption || 'Listening…'}</div>
            </div>
          )}
          {phase.kind === 'understanding' && (
            <>
              <div className="listening heard-you">
                <div className="wave frozen">
                  {levels.map((l, i) => (
                    <span key={i} style={{ transform: `scaleY(${0.12 + l * 0.88})` }} />
                  ))}
                </div>
                <div className="main caption">{caption ? `“${caption}”` : 'Heard you'}</div>
              </div>
              <div className="sub thinking-line">{thinking || 'Muse Spark Open is listening to what you said…'}</div>
            </>
          )}
          {phase.kind === 'heard' && (
            <>
              <div className="main transcript">“{phase.transcript || '…'}”</div>
              <div className="sub thinking-line">
                {thinking || (phase.intent ? `${phase.intent} · ` : '')}
                {!thinking && `heard in ${(phase.ms / 1000).toFixed(1)} s`}
              </div>
            </>
          )}
          {phase.kind === 'notice' && <div className={`main notice ${phase.tone}`}>{phase.text}</div>}
        </div>
        <CameraSwitch on={camera} onToggle={() => setCamera((c) => !c)} />
        <button className={`chip ${extension}`} onClick={() => setPanel((p) => !p)} title="Chrome extension pairing">
          <i />
          {extension === 'connected' ? 'Chrome' : 'Pair Chrome'}
        </button>
      </div>
      {camera && <CameraPanel onOff={() => setCamera(false)} />}
      {anchors.length > 0 && (
        <div className="anchors">
          {anchors.map((a) => (
            <span key={a.n} className={`anchor ${a.source}`}>
              <b>{a.n}</b>
              {a.label}
            </span>
          ))}
        </div>
      )}
      <Lanes lanes={lanes} />
      {lanes.length > 0 && posts.length > 0 && (
        <div className="thread" aria-label="What the lanes told each other">
          {posts.map((p) => (
            <div key={p.id} className="post" style={{ ['--c' as string]: p.color ?? '#7c8a9e' }}>
              <span className="who">{p.laneName} →</span>
              <span className="what">
                {p.adjusts ? '↳ ' : ''}
                {p.text}
              </span>
            </div>
          ))}
        </div>
      )}
      {cards.map((c) => (
        <CardView key={c.id} card={c} />
      ))}
      {panel && (
        <div className="panel">
          <div className="row">
            <div>
              <div className="label">Pairing token</div>
              <code>{token}</code>
            </div>
            <button className="btn" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="row talk">
            <label htmlFor="talk-key" className="label">
              Talk key
            </label>
            <select id="talk-key" value={talkKey} onChange={(e) => void chooseTalkKey(e.target.value)}>
              {talkKeys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          {profile && <ProfileForm initial={profile} />}
          <Budget />
          <SiteNotes />
          <ol>
            <li>In Chrome, open the Baton extension’s options.</li>
            <li>Paste this token and press Save.</li>
            <li>The chip turns green when the extension is connected.</li>
          </ol>
          <div className="row end">
            <button className="btn ghost" onClick={() => setPanel(false)}>
              Close
            </button>
            <button
              className="btn"
              disabled={extension !== 'connected'}
              onClick={() => void window.baton.runSelfTest()}
            >
              Run lane self-test
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
