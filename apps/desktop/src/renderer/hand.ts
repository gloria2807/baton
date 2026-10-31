// Hand tracking in the Podium: MediaPipe Hand Landmarker (Tasks Vision, WebAssembly with the GPU
// where available) on the laptop camera. Camera frames stay in this renderer; only the pose and the
// fingertip position go to the main process, and nothing from the camera is sent to the model.

import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { classify, pointerPoint, type Landmark } from '@baton/core/hand/gestures';

// Served by the main process from the app's own files (see the baton-asset protocol).
const WASM = 'baton-asset://hand/wasm';
const MODEL = 'baton-asset://hand/hand_landmarker.task';

// Bones between MediaPipe's 21 hand landmarks, for the preview.
const BONES: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

export class HandCam {
  private video = document.createElement('video');
  private stream: MediaStream | null = null;
  private landmarker: HandLandmarker | null = null;
  private running = false;
  fps = 0;
  delegate = '';
  // Frames the camera delivers per second, apart from how fast the model keeps up.
  cameraFps = 0;

  constructor(
    private canvas: () => HTMLCanvasElement | null,
    private onPose: (pose: string) => void,
  ) {
    this.video.muted = true;
    this.video.playsInline = true;
  }

  async start() {
    const files = await FilesetResolver.forVisionTasks(WASM);
    const make = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5,
      });
    let delegate: 'GPU' | 'CPU' = 'GPU';
    this.landmarker = await make('GPU').catch(() => ((delegate = 'CPU'), make('CPU')));
    this.delegate = delegate;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, frameRate: { ideal: 30 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.cameraFps = Math.round(this.stream.getVideoTracks()[0]?.getSettings().frameRate ?? 0);
    this.running = true;
    let frames = 0;
    let since = performance.now();
    const step = () => {
      if (!this.running || !this.landmarker) return;
      const t = performance.now();
      const r = this.landmarker.detectForVideo(this.video, t);
      const lm = (r.landmarks[0] as NormalizedLandmark[] | undefined) ?? null;
      const pose = classify(lm as Landmark[] | null);
      window.baton.handFrame({
        pose,
        tip: lm ? pointerPoint(lm as Landmark[]) : null,
        wrist: lm ? { x: lm[0]!.x, y: lm[0]!.y } : null,
        t: Date.now(),
        fps: this.fps,
        delegate: this.delegate,
        cameraFps: this.cameraFps,
      });
      this.onPose(pose);
      this.drawPreview(lm);
      frames++;
      if (t - since >= 1000) {
        this.fps = Math.round((frames * 1000) / (t - since));
        frames = 0;
        since = t;
      }
      this.video.requestVideoFrameCallback(step);
    };
    this.video.requestVideoFrameCallback(step);
  }

  // The camera picture, mirrored like a mirror, with the hand's skeleton drawn in brass.
  private drawPreview(lm: NormalizedLandmark[] | null) {
    const c = this.canvas();
    const g = c?.getContext('2d');
    if (!c || !g) return;
    g.save();
    g.translate(c.width, 0);
    g.scale(-1, 1);
    g.drawImage(this.video, 0, 0, c.width, c.height);
    g.fillStyle = 'rgba(23,22,26,0.35)';
    g.fillRect(0, 0, c.width, c.height);
    if (lm) {
      g.strokeStyle = '#c99a3b';
      g.lineWidth = 2;
      for (const [a, b] of BONES) {
        g.beginPath();
        g.moveTo(lm[a]!.x * c.width, lm[a]!.y * c.height);
        g.lineTo(lm[b]!.x * c.width, lm[b]!.y * c.height);
        g.stroke();
      }
      g.fillStyle = '#efe9dd';
      for (const p of lm) {
        g.beginPath();
        g.arc(p.x * c.width, p.y * c.height, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.landmarker?.close();
    this.landmarker = null;
  }
}
