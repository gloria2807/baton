import { useEffect, useRef, useState } from 'react';
import { cueWav, rms } from '@baton/core/audio';
import { CardView, Lanes, type Card, type LaneView } from './Cards';
import { Recorder } from './recorder';
import { sounds } from './sounds';

type Phase =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'listening'; since: number }
  | { kind: 'understanding'; seconds: number }
  | { kind: 'heard'; transcript: string; intent: string; ms: number; seconds: number }
  | { kind: 'notice'; text: string; tone: 'ok' | 'warn' | 'info' };

const toneOf = (t: string): 'ok' | 'warn' | 'info' => (/passed/i.test(t) ? 'ok' : /fail|could not|unavailable|not connected|no baseten/i.test(t) ? 'warn' : 'info');

interface CueUpdate {
  phase: 'saved' | 'heard' | 'error';
  seconds?: number;
  transcript?: string;
  intent?: string;
  ms?: number;
  error?: string;
}

type PttEvent = { type: 'start' } | { type: 'commit'; heldMs: number } | { type: 'cancel'; reason: string };

const LANE_COLORS = ['#3b82f6', '#22c55e', '#f97316', '#a855f7'];
const BARS = 28;

export function Podium() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [extension, setExtension] = useState<'connected' | 'waiting'>('waiting');
  const [token, setToken] = useState('');
  const [hasModel, setHasModel] = useState(true);
  const [panel, setPanel] = useState(false);
  const [copied, setCopied] = useState(false);
  const [talkKey, setTalkKey] = useState('Alt');
  const [talkKeys, setTalkKeys] = useState<Array<{ id: string; label: string }>>([]);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [lanes, setLanes] = useState<LaneView[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const recorder = useRef(new Recorder());
  const seconds = useRef(0);
  const shell = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Build the audio graph now so the talk key only has to open the microphone.
    void recorder.current.warm().catch(() => undefined);
    void window.baton.init().then((s) => {
      setExtension(s.extension);
      setToken(s.token);
      setHasModel(s.hasModel);
      setTalkKey(s.talkKey);
      setTalkKeys(s.talkKeys);
    });
    const offs = [
      window.baton.onExtension((s) => setExtension(s as 'connected' | 'waiting')),
      window.baton.onShowPairing(() => setPanel(true)),
      window.baton.onNotice((t) => setPhase({ kind: 'notice', text: String(t), tone: toneOf(String(t)) })),
      window.baton.onLanes((l) => setLanes(l as LaneView[])),
      window.baton.onCards((c) => {
        const next = c as Card[];
        setCards((prev) => {
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
          setPhase({ kind: 'heard', transcript: u.transcript ?? '', intent: u.intent ?? '', ms: u.ms ?? 0, seconds: seconds.current });
        } else if (u.phase === 'error') setPhase({ kind: 'notice', text: u.error ?? 'Something went wrong', tone: 'warn' });
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
    setLevels(Array(BARS).fill(0));
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
    // Acknowledge at once; the model works after this.
    sounds.release();
    const rec = await recorder.current.stop();
    window.baton.reportMic(rec.openMs, rec.seconds, rec.timing);
    seconds.current = rec.seconds;
    if (rec.seconds < 0.25 || rms(rec.samples) < 0.004) {
      setPhase({ kind: 'notice', text: rec.seconds < 0.25 ? 'Hold the key while you speak.' : 'I didn’t hear anything.', tone: 'warn' });
      return;
    }
    setPhase({ kind: 'understanding', seconds: rec.seconds });
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
          {LANE_COLORS.map((c) => (
            <span key={c} style={{ background: c }} />
          ))}
        </div>
        <div className="center">
          {phase.kind === 'idle' && (
            <>
              <div className="main">Hold {talkKeys.find((k) => k.id === talkKey)?.label ?? talkKey} and speak</div>
              <div className="sub">{hasModel ? 'Release to send. Baton listens only while the key is down.' : 'No Baseten key found: recordings are saved but not understood.'}</div>
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
              <div className="main">Listening…</div>
            </div>
          )}
          {phase.kind === 'understanding' && (
            <>
              <div className="main shimmer">Understanding…</div>
              <div className="sub">{phase.seconds.toFixed(1)} s recorded</div>
            </>
          )}
          {phase.kind === 'heard' && (
            <>
              <div className="main transcript">“{phase.transcript || '…'}”</div>
              <div className="sub">
                {phase.intent} · understood in {(phase.ms / 1000).toFixed(1)} s
              </div>
            </>
          )}
          {phase.kind === 'notice' && <div className={`main notice ${phase.tone}`}>{phase.text}</div>}
        </div>
        <button className={`chip ${extension}`} onClick={() => setPanel((p) => !p)} title="Chrome extension pairing">
          <i />
          {extension === 'connected' ? 'Chrome' : 'Pair Chrome'}
        </button>
      </div>
      <Lanes lanes={lanes} />
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
          <ol>
            <li>In Chrome, open the Baton extension’s options.</li>
            <li>Paste this token and press Save.</li>
            <li>The chip turns green when the extension is connected.</li>
          </ol>
          <div className="row end">
            <button className="btn ghost" onClick={() => setPanel(false)}>
              Close
            </button>
            <button className="btn" disabled={extension !== 'connected'} onClick={() => void window.baton.runSelfTest()}>
              Run lane self-test
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
