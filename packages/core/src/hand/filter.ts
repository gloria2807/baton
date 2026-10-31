// The One Euro filter (Casiez, Roussel and Vogel, CHI 2012): steady when the hand is still,
// responsive when it moves fast. The cutoff frequency rises with speed.

const alpha = (cutoffHz: number, dtS: number) => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtS);
};

export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(
    private minCutoff = 1.0, // Hz: lower is steadier at rest
    private beta = 0.02, // how fast the cutoff rises with speed
    private dCutoff = 1.0,
  ) {}

  filter(value: number, tMs: number): number {
    if (this.x === null) {
      this.x = value;
      this.t = tMs;
      return value;
    }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset() {
    this.x = null;
    this.dx = 0;
  }
}

export class OneEuro2D {
  private fx: OneEuro;
  private fy: OneEuro;
  constructor(minCutoff?: number, beta?: number) {
    this.fx = new OneEuro(minCutoff, beta);
    this.fy = new OneEuro(minCutoff, beta);
  }
  filter(p: { x: number; y: number }, tMs: number) {
    return { x: this.fx.filter(p.x, tMs), y: this.fy.filter(p.y, tMs) };
  }
  reset() {
    this.fx.reset();
    this.fy.reset();
  }
}
