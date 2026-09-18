/** Low-latency signal smoothing for camera input. Pure: no DOM, no timers. */

/**
 * 1€ filter (Casiez, Roussel & Vogel, CHI 2012). A low-pass whose cutoff rises with speed,
 * so it kills jitter while the input is still without adding lag once it moves.
 */
export class OneEuro {
  private x = 0;
  private dx = 0;
  private started = false;

  /**
   * Defaults are tuned for this game's signal scale. The published 1e filter examples use
   * beta ~= 0.007 for pointer data measured in pixels, where speeds run to the hundreds; tilt
   * here is radians over a range of ~0.7, so beta has to be about three orders larger to adapt
   * at all. Left at the pixel-scale value the filter degenerates into a flat 1Hz low-pass and
   * adds ~160ms of steering lag.
   */
  constructor(
    private minCutoff = 4,
    private beta = 1.5,
    private dCutoff = 1,
  ) {}

  reset(): void {
    this.started = false;
    this.dx = 0;
  }

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, dt: number): number {
    if (dt <= 0 || !Number.isFinite(dt)) return this.started ? this.x : value;
    if (!this.started) {
      this.started = true;
      this.x = value;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

/** Shortest signed distance between two angles, in radians. */
export function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/** Deadzone plus a signed-square response: fine control near neutral, full range at the edges. */
export function shapeAxis(v: number, deadzone: number): number {
  const a = Math.abs(v);
  if (a <= deadzone) return 0;
  const t = Math.min(1, (a - deadzone) / (1 - deadzone));
  return Math.sign(v) * t * t;
}
