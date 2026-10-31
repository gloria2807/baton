// Camera mode on the Podium: one switch, a clear "Camera on" while the camera is in use, the live
// preview with the hand's skeleton, and calibration and the checks.

import { useEffect, useRef, useState } from 'react';
import { HandCam } from './hand';

interface HandStatus {
  camera: boolean;
  calibrated: boolean;
  mode: string;
  message: string;
}

const POSE_LABEL: Record<string, string> = {
  point: 'pointing',
  pinch: 'pinch',
  open: 'open palm',
  two: 'two fingers',
  other: 'hand',
  none: 'no hand',
};

export function CameraSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      className={`chip camera ${on ? 'on' : ''}`}
      onClick={onToggle}
      title={on ? 'Turn the camera off' : 'Conduct with your hand'}
    >
      <i />
      {on ? 'Camera on' : 'Camera'}
    </button>
  );
}

export function CameraPanel({ onOff }: { onOff: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = useRef<HandCam | null>(null);
  const [pose, setPose] = useState('none');
  const [fps, setFps] = useState(0);
  const [status, setStatus] = useState<HandStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const c = new HandCam(() => canvas.current, setPose);
    cam.current = c;
    const off = window.baton.onHand((s) => setStatus(s as HandStatus));
    void window.baton.setCamera(true);
    c.start().catch((e: Error) => setError(`Camera unavailable: ${e.message}`));
    const t = setInterval(() => setFps(c.fps), 1000);
    return () => {
      clearInterval(t);
      off();
      c.stop();
      void window.baton.setCamera(false);
    };
  }, []);

  return (
    <div className="camera-panel">
      <canvas ref={canvas} width={176} height={132} aria-label="Camera preview with the hand's skeleton" />
      <div className="camera-side">
        <div className="camera-line">
          <span className="pose">{POSE_LABEL[pose] ?? pose}</span>
          <span className="fps">
            {fps} fps{cam.current?.delegate ? ` · ${cam.current.delegate}` : ''}
          </span>
        </div>
        <div className="camera-msg">{error || status?.message || 'Starting the camera…'}</div>
        <div className="camera-actions">
          <button className="btn small" onClick={() => void window.baton.calibrateHand()}>
            {status?.calibrated ? 'Recalibrate' : 'Calibrate'}
          </button>
          <button
            className="btn ghost small"
            disabled={!status?.calibrated}
            onClick={() => void window.baton.checkHandAccuracy()}
          >
            Check accuracy
          </button>
          <button
            className="btn ghost small"
            disabled={!status?.calibrated}
            onClick={() => void window.baton.testGestures()}
          >
            Test gestures
          </button>
          <button className="btn ghost small" onClick={onOff}>
            Turn off
          </button>
        </div>
        <div className="camera-note">
          Frames stay on this computer and are never sent to the model. Gestures cannot approve anything.
        </div>
      </div>
    </div>
  );
}
