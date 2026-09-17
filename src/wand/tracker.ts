/**
 * Colour-blob tracking for the wand controller. Pure functions over raw RGBA pixels so the whole
 * detector can be unit-tested with synthetic frames, no camera and no browser.
 *
 * Pixels are classified in normalised rg chromaticity against a Gaussian fitted during
 * calibration. Two deliberate choices there:
 *  - normalised chromaticity divides out overall brightness, so shading across the disc, a dimmed
 *    lamp or a passing cloud do not move a pixel out of its model the way raw RGB or YCbCr would;
 *  - a fitted Gaussian beats a fixed hue band, which falls apart under tungsten light, a backlit
 *    window, or the magenta spill the game itself throws on the player.
 */

/** Neutral grey in normalised chromaticity: every unsaturated pixel lands here. */
export const GREY = 255 / 3;

/** Gaussian colour model in normalised (red, green) chromaticity, plus a luma gate. */
export interface ColorModel {
  u: number;
  v: number;
  /** Inverse covariance, symmetric 2x2. */
  i00: number;
  i01: number;
  i11: number;
  /** Squared Mahalanobis distance still counted as a match. */
  maxD: number;
  yMin: number;
  yMax: number;
}

export interface Blob {
  /** Centroid in pixels. */
  px: number;
  py: number;
  /**
   * Centroid in centred, height-normalised coordinates: x right, y up, origin at frame centre,
   * both axes divided by height so angles and distances are undistorted by the 4:3 aspect.
   */
  x: number;
  y: number;
  /** Matched pixel count and the equivalent disc radius in pixels. */
  n: number;
  r: number;
}

export interface Gate {
  px: number;
  py: number;
  r: number;
}

export interface WandModel {
  /** The disc that sat on the left of the calibration box; `b` sat on the right. */
  a: ColorModel;
  b: ColorModel;
}

export interface TrackResult {
  a: Blob | null;
  b: Blob | null;
}

/** Below this many matched pixels a blob is noise, not a disc. */
export const MIN_BLOB_PX = 14;

export function lumaOf(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Normalised red chromaticity, 0..255. */
export function uOf(r: number, g: number, b: number): number {
  const s = r + g + b;
  return s > 0 ? (255 * r) / s : GREY;
}

/** Normalised green chromaticity, 0..255. */
export function vOf(r: number, g: number, b: number): number {
  const s = r + g + b;
  return s > 0 ? (255 * g) / s : GREY;
}

/** How far a colour sits from neutral grey; the calibration gate for "is this actually coloured". */
export function saturationOf(r: number, g: number, b: number): number {
  return Math.hypot(uOf(r, g, b) - GREY, vOf(r, g, b) - GREY);
}

interface Accum {
  sx: number;
  sy: number;
  n: number;
}

/**
 * Sums matching pixels in a rectangle. When `rad` is given, pixels further than that from
 * `cx`/`cy` are ignored, which is how the second pass discards a same-coloured distractor
 * elsewhere in the room.
 */
function accumulate(
  data: Uint8ClampedArray,
  w: number,
  m: ColorModel,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx = 0,
  cy = 0,
  rad = 0,
): Accum {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const r2 = rad * rad;
  for (let y = y0; y < y1; y++) {
    let i = (y * w + x0) * 4;
    for (let x = x0; x < x1; x++, i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < m.yMin || lum > m.yMax) continue;
      const s = r + g + b;
      if (s <= 0) continue;
      const du = (255 * r) / s - m.u;
      const dv = (255 * g) / s - m.v;
      const d = m.i00 * du * du + 2 * m.i01 * du * dv + m.i11 * dv * dv;
      if (d > m.maxD) continue;
      if (rad > 0) {
        const ex = x - cx;
        const ey = y - cy;
        if (ex * ex + ey * ey > r2) continue;
      }
      sx += x;
      sy += y;
      n++;
    }
  }
  return { sx, sy, n };
}

function toBlob(a: Accum, w: number, h: number): Blob | null {
  if (a.n < MIN_BLOB_PX) return null;
  const px = a.sx / a.n;
  const py = a.sy / a.n;
  return {
    px,
    py,
    x: (px - w / 2) / h,
    y: (h / 2 - py) / h,
    n: a.n,
    r: Math.sqrt(a.n / Math.PI),
  };
}

function findOne(data: Uint8ClampedArray, w: number, h: number, m: ColorModel, gate: Gate | null): Blob | null {
  let x0 = 0;
  let y0 = 0;
  let x1 = w;
  let y1 = h;
  if (gate) {
    x0 = Math.max(0, Math.floor(gate.px - gate.r));
    y0 = Math.max(0, Math.floor(gate.py - gate.r));
    x1 = Math.min(w, Math.ceil(gate.px + gate.r));
    y1 = Math.min(h, Math.ceil(gate.py + gate.r));
    if (x1 <= x0 || y1 <= y0) return null;
  }
  const rough = toBlob(accumulate(data, w, m, x0, y0, x1, y1), w, h);
  if (!rough) return null;
  // Second pass around the rough centroid: keeps a magenta cushion across the room from
  // dragging the centroid off the real disc.
  const rad = Math.max(4, rough.r * 2.4);
  const tx0 = Math.max(0, Math.floor(rough.px - rad));
  const ty0 = Math.max(0, Math.floor(rough.py - rad));
  const tx1 = Math.min(w, Math.ceil(rough.px + rad));
  const ty1 = Math.min(h, Math.ceil(rough.py + rad));
  const tight = accumulate(data, w, m, tx0, ty0, tx1, ty1, rough.px, rough.py, rad);
  return toBlob(tight, w, h) ?? rough;
}

/**
 * Finds both discs. Passing the previous frame's blobs as gates restricts the search to a window
 * around each one, which is both faster and far less likely to latch onto a background object.
 */
export function detect(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  model: WandModel,
  gates: { a: Gate | null; b: Gate | null } | null = null,
): TrackResult {
  let a = findOne(data, w, h, model.a, gates?.a ?? null);
  let b = findOne(data, w, h, model.b, gates?.b ?? null);
  // A gated miss means the wand outran its window; fall back to a full-frame re-acquire.
  if (!a && gates?.a) a = findOne(data, w, h, model.a, null);
  if (!b && gates?.b) b = findOne(data, w, h, model.b, null);
  return { a, b };
}

/** Search window for the next frame: generous enough to cover a fast flick between frames. */
export function gateFor(blob: Blob | null, w: number, h: number): Gate | null {
  if (!blob) return null;
  return { px: blob.px, py: blob.py, r: Math.max(blob.r * 6, Math.min(w, h) * 0.22) };
}
