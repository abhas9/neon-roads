/** Low-latency smoothing and gesture detection for camera input. Pure: no DOM, no timers. */

/**
 * 1€ filter (Casiez, Roussel & Vogel, CHI 2012). A low-pass whose cutoff rises with speed,
 * so it kills jitter while the wand is still without adding lag while it moves.
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

/** A flick lasts roughly this long; a 2-frame window wider than it cannot confirm anything. */
const CONFIRM_WINDOW = 0.12;

export interface FlickOptions {
  /** Upward speed that triggers a jump, in height-normalised units per second. */
  threshold: number;
  /** Minimum gap between two jumps. */
  refractory: number;
}

/**
 * Detects a quick upward flick of the wand.
 *
 * Fires on the first frame the upward velocity crosses the threshold rather than waiting for
 * confirmation, because every extra frame here is ~16ms of jump latency the player pays for.
 * The 2-frame window is only a weak sanity check on a sample we already have, so it costs nothing.
 */
export class FlickDetector {
  private y: number[] = [];
  private cooldown = 0;
  private armed = true;
  /** Upward velocity of the most recent sample, exposed for the tuning UI. */
  velocity = 0;

  constructor(private opts: FlickOptions) {}

  reset(): void {
    this.y = [];
    this.cooldown = 0;
    this.armed = true;
    this.velocity = 0;
  }

  setThreshold(v: number): void {
    this.opts.threshold = v;
  }

  /** Returns true on the frame a flick starts. */
  push(y: number, dt: number): boolean {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    this.y.unshift(y);
    if (this.y.length > 3) this.y.pop();
    if (this.y.length < 3 || dt <= 0) return false;

    const v1 = (this.y[0] - this.y[1]) / dt;
    const v2 = (this.y[0] - this.y[2]) / (2 * dt);
    this.velocity = v1;

    const t = this.opts.threshold;
    // Re-arm only once the wand has slowed, so one flick cannot fire twice on its way up.
    if (!this.armed && v1 < t * 0.3) this.armed = true;
    if (!this.armed || this.cooldown > 0) return false;
    // The 2-frame check rejects a single noisy sample, but it only means anything while the
    // window is shorter than a flick. On a slow camera (or a slow machine, since tracking runs
    // off the page's frame cadence) a whole flick lands in one or two samples, and demanding a
    // fast 2-frame average would reject every real jump. Velocity noise also shrinks as dt grows,
    // so dropping the check at low frame rates costs nothing.
    const confirmed = 2 * dt > CONFIRM_WINDOW || v2 > t * 0.6;
    if (v1 > t && confirmed) {
      this.armed = false;
      this.cooldown = this.opts.refractory;
      return true;
    }
    return false;
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
