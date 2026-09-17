/**
 * Builds colour models from what the player actually holds up, rather than assuming the printed
 * ink matches the design. The calibration box is split in half: whatever saturated colour
 * dominates the left half becomes disc A, the right half becomes disc B. That works for the
 * printed marker and equally for two random coloured objects when there is no printer around.
 */
import { lumaOf, saturationOf, uOf, vOf } from './tracker';
import type { ColorModel, WandModel } from './tracker';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bins per chroma axis; 8 units wide, well under the ridge added to the covariance. */
const BINS = 32;
const BIN_W = 256 / BINS;
/** Minimum distance from neutral grey to count as a coloured pixel. Skin sits near 20, the marker near 100. */
export const CHROMA_GATE = 45;
const LUMA_MIN = 22;
const LUMA_MAX = 246;
/** Chroma units around the histogram peak that belong to the same disc. */
const PEAK_RADIUS = 30;
/** Total sampled pixels needed per disc before a model is trusted. */
const MIN_SAMPLES = 180;
/** Two discs closer than this in chroma cannot be told apart reliably. */
const MIN_SEPARATION = 45;

const RIDGE = 36;
const MAX_VAR = 225;
const MAX_D = 16;

export type CalibrationError = 'no-marker-left' | 'no-marker-right' | 'too-similar' | 'cancelled';

export interface CalibrationResult {
  model: WandModel;
  /** Sampled pixel counts, surfaced in the UI so a weak read is visible before play starts. */
  counts: { a: number; b: number };
}

function peakModel(hist: Uint32Array): ColorModel | null {
  let peak = -1;
  let peakN = 0;
  for (let i = 0; i < hist.length; i++) {
    if (hist[i] > peakN) {
      peakN = hist[i];
      peak = i;
    }
  }
  if (peak < 0) return null;
  const pu = (peak % BINS) * BIN_W + BIN_W / 2;
  const pv = Math.floor(peak / BINS) * BIN_W + BIN_W / 2;

  let n = 0;
  let su = 0;
  let sv = 0;
  for (let i = 0; i < hist.length; i++) {
    const c = hist[i];
    if (!c) continue;
    const u = (i % BINS) * BIN_W + BIN_W / 2;
    const v = Math.floor(i / BINS) * BIN_W + BIN_W / 2;
    if (Math.hypot(u - pu, v - pv) > PEAK_RADIUS) continue;
    n += c;
    su += u * c;
    sv += v * c;
  }
  if (n < MIN_SAMPLES) return null;
  const mu = su / n;
  const mv = sv / n;

  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  for (let i = 0; i < hist.length; i++) {
    const c = hist[i];
    if (!c) continue;
    const u = (i % BINS) * BIN_W + BIN_W / 2;
    const v = Math.floor(i / BINS) * BIN_W + BIN_W / 2;
    if (Math.hypot(u - pu, v - pv) > PEAK_RADIUS) continue;
    const du = u - mu;
    const dv = v - mv;
    c00 += du * du * c;
    c01 += du * dv * c;
    c11 += dv * dv * c;
  }
  // The ridge keeps the inverse well conditioned for a flat, evenly lit disc; the cap stops one
  // stray highlight from widening the model until it matches half the room.
  c00 = Math.min(MAX_VAR, c00 / n + RIDGE);
  c11 = Math.min(MAX_VAR, c11 / n + RIDGE);
  c01 = c01 / n;
  const maxOff = Math.sqrt(c00 * c11) * 0.9;
  c01 = Math.max(-maxOff, Math.min(maxOff, c01));
  const det = c00 * c11 - c01 * c01;
  return {
    u: mu,
    v: mv,
    i00: c11 / det,
    i01: -c01 / det,
    i11: c00 / det,
    maxD: MAX_D,
    yMin: LUMA_MIN,
    yMax: LUMA_MAX,
  };
}

export class CalibrationSampler {
  private histA = new Uint32Array(BINS * BINS);
  private histB = new Uint32Array(BINS * BINS);
  frames = 0;
  /** Coloured pixels seen in the most recent frame, for the live "hold it steady" readout. */
  last = { a: 0, b: 0 };

  reset(): void {
    this.histA.fill(0);
    this.histB.fill(0);
    this.frames = 0;
    this.last = { a: 0, b: 0 };
  }

  /** Counts coloured pixels in the box without committing them, for the live aiming readout. */
  preview(data: Uint8ClampedArray, w: number, h: number, box: Rect): void {
    this.scanBox(data, w, h, box, false);
  }

  addFrame(data: Uint8ClampedArray, w: number, h: number, box: Rect): void {
    this.scanBox(data, w, h, box, true);
    this.frames++;
  }

  private scanBox(data: Uint8ClampedArray, w: number, h: number, box: Rect, commit: boolean): void {
    const x0 = Math.max(0, Math.floor(box.x));
    const y0 = Math.max(0, Math.floor(box.y));
    const x1 = Math.min(w, Math.ceil(box.x + box.w));
    const y1 = Math.min(h, Math.ceil(box.y + box.h));
    const mid = (x0 + x1) / 2;
    let na = 0;
    let nb = 0;
    for (let y = y0; y < y1; y++) {
      let i = (y * w + x0) * 4;
      for (let x = x0; x < x1; x++, i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = lumaOf(r, g, b);
        if (lum < LUMA_MIN || lum > LUMA_MAX) continue;
        if (saturationOf(r, g, b) < CHROMA_GATE) continue;
        const bin =
          Math.min(BINS - 1, Math.max(0, Math.floor(vOf(r, g, b) / BIN_W))) * BINS +
          Math.min(BINS - 1, Math.max(0, Math.floor(uOf(r, g, b) / BIN_W)));
        if (x < mid) {
          if (commit) this.histA[bin]++;
          na++;
        } else {
          if (commit) this.histB[bin]++;
          nb++;
        }
      }
    }
    this.last = { a: na, b: nb };
  }

  finish(): CalibrationResult | CalibrationError {
    const a = peakModel(this.histA);
    if (!a) return 'no-marker-left';
    const b = peakModel(this.histB);
    if (!b) return 'no-marker-right';
    if (Math.hypot(a.u - b.u, a.v - b.v) < MIN_SEPARATION) return 'too-similar';
    let na = 0;
    let nb = 0;
    for (let i = 0; i < this.histA.length; i++) {
      na += this.histA[i];
      nb += this.histB[i];
    }
    return { model: { a, b }, counts: { a: na, b: nb } };
  }
}

export const CALIBRATION_HELP: Record<CalibrationError, string> = {
  'no-marker-left': 'Could not see the first disc. Try more light, or hold the wand closer.',
  'no-marker-right': 'Could not see the second disc. Keep the whole wand inside the box.',
  'too-similar': 'Both ends look like the same colour. Use two clearly different colours.',
  cancelled: 'Calibration stopped.',
};
