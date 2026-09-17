import { describe, expect, it } from 'vitest';
import { CalibrationSampler } from '../src/wand/calibrate';
import type { CalibrationError } from '../src/wand/calibrate';
import { detect, gateFor, saturationOf } from '../src/wand/tracker';
import type { WandModel } from '../src/wand/tracker';
import { FlickDetector, OneEuro, shapeAxis, wrapPi } from '../src/wand/filter';
import { DEFAULT_TUNING, WandMapper, neutralFrom, poseFrom } from '../src/wand/mapping';

const W = 160;
const H = 120;
const MAGENTA: RGB = [255, 0, 168];
const CYAN: RGB = [0, 229, 255];
const WALL: RGB = [196, 188, 176];

type RGB = [number, number, number];

function blank(bg: RGB = WALL): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    d[i * 4] = bg[0];
    d[i * 4 + 1] = bg[1];
    d[i * 4 + 2] = bg[2];
    d[i * 4 + 3] = 255;
  }
  return d;
}

function disc(d: Uint8ClampedArray, cx: number, cy: number, r: number, c: RGB): void {
  for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(H, cy + r + 1); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(W, cx + r + 1); x++) {
      if (Math.hypot(x - cx, y - cy) > r) continue;
      const i = (y * W + x) * 4;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
    }
  }
}

/** Deterministic pseudo-random sensor noise. */
function noise(d: Uint8ClampedArray, amp: number, seed = 1): void {
  let s = seed;
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      d[i + k] = Math.max(0, Math.min(255, d[i + k] + ((s / 0xffffffff) * 2 - 1) * amp));
    }
  }
}

/** Box blur, standing in for the motion blur of a fast flick. */
function blur(d: Uint8ClampedArray, rad: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        let n = 0;
        for (let dy = -rad; dy <= rad; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -rad; dx <= rad; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            sum += d[(yy * W + xx) * 4 + k];
            n++;
          }
        }
        out[(y * W + x) * 4 + k] = sum / n;
      }
    }
  }
  return out;
}

/** Uniform intensity scale: a dimmed lamp, or the player stepping out of a sunbeam. */
function dim(d: Uint8ClampedArray, k: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d);
  for (let i = 0; i < out.length; i += 4) {
    out[i] *= k;
    out[i + 1] *= k;
    out[i + 2] *= k;
  }
  return out;
}

/** A level wand: magenta disc left, cyan disc right, centred on (cx, cy). */
function wandFrame(cx: number, cy: number, half = 22, r = 7, angle = 0, bg: RGB = WALL): Uint8ClampedArray {
  const d = blank(bg);
  const dx = Math.cos(angle) * half;
  const dy = -Math.sin(angle) * half;
  disc(d, cx - dx, cy - dy, r, MAGENTA);
  disc(d, cx + dx, cy + dy, r, CYAN);
  return d;
}

const BOX = { x: 30, y: 35, w: 100, h: 50 };

/** The real flow samples ~30 frames while the player holds still; one disc is under the floor. */
function sample(frame: Uint8ClampedArray, n = 8): CalibrationSampler {
  const s = new CalibrationSampler();
  for (let i = 0; i < n; i++) s.addFrame(frame, W, H, BOX);
  return s;
}

function calibrate(frame = wandFrame(80, 60)): WandModel {
  const s = sample(frame);
  const res = s.finish();
  if (typeof res === 'string') throw new Error(`calibration failed: ${res}`);
  return res.model;
}

describe('wand colour model', () => {
  it('separates skin and wall from the marker discs', () => {
    expect(saturationOf(...MAGENTA)).toBeGreaterThan(90);
    expect(saturationOf(...CYAN)).toBeGreaterThan(80);
    expect(saturationOf(230, 180, 150)).toBeLessThan(30); // skin
    expect(saturationOf(...WALL)).toBeLessThan(15);
  });

  it('calibrates both discs from the box and finds them again', () => {
    const model = calibrate();
    const { a, b } = detect(wandFrame(80, 60), W, H, model);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.px).toBeCloseTo(58, 0);
    expect(b!.px).toBeCloseTo(102, 0);
    expect(a!.py).toBeCloseTo(60, 0);
  });

  it('reports a useful error when both ends are the same colour', () => {
    const d = blank();
    disc(d, 58, 60, 7, MAGENTA);
    disc(d, 102, 60, 7, MAGENTA);
    expect(sample(d).finish()).toBe<CalibrationError>('too-similar');
  });

  it('reports a useful error when nothing coloured is in the box', () => {
    expect(sample(blank()).finish()).toBe<CalibrationError>('no-marker-left');
  });

  it('reports a useful error when only one end is in the box', () => {
    const d = blank();
    disc(d, 58, 60, 7, MAGENTA);
    expect(sample(d).finish()).toBe<CalibrationError>('no-marker-right');
  });

  it('works with any two coloured objects, not just the printed marker', () => {
    const d = blank();
    disc(d, 58, 60, 8, [40, 180, 60]);  // a green bottle cap
    disc(d, 102, 60, 8, [230, 120, 20]); // an orange one
    const res = sample(d).finish();
    expect(typeof res).not.toBe('string');
    const found = detect(d, W, H, (res as { model: WandModel }).model);
    expect(found.a).not.toBeNull();
    expect(found.b).not.toBeNull();
  });
});

describe('wand detection robustness', () => {
  const model = calibrate();

  it('survives sensor noise', () => {
    const d = wandFrame(80, 60);
    noise(d, 26, 7);
    const { a, b } = detect(d, W, H, model);
    expect(a!.px).toBeCloseTo(58, -1);
    expect(b!.px).toBeCloseTo(102, -1);
  });

  it('survives the motion blur of a fast flick', () => {
    const d = blur(wandFrame(80, 60), 2);
    const { a, b } = detect(d, W, H, model);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(Math.abs(a!.px - 58)).toBeLessThan(3);
    expect(Math.abs(b!.px - 102)).toBeLessThan(3);
  });

  it('survives a large change in overall brightness', () => {
    for (const k of [0.55, 0.8, 1.3]) {
      const { a, b } = detect(dim(wandFrame(80, 60), k), W, H, model);
      expect(a, `magenta at ${k}x brightness`).not.toBeNull();
      expect(b, `cyan at ${k}x brightness`).not.toBeNull();
      expect(Math.abs(a!.px - 58)).toBeLessThan(2);
    }
  });

  it('ignores a same-coloured distractor elsewhere in the room', () => {
    const d = wandFrame(80, 60);
    disc(d, 14, 14, 9, MAGENTA);
    const { a } = detect(d, W, H, model, { a: gateFor({ px: 58, py: 60, x: 0, y: 0, n: 150, r: 7 }, W, H), b: null });
    expect(a!.px).toBeCloseTo(58, 0);
  });

  it('finds nothing when the wand leaves the frame', () => {
    const { a, b } = detect(blank(), W, H, model);
    expect(a).toBeNull();
    expect(b).toBeNull();
  });

  it('re-acquires after the wand outruns its gate', () => {
    const stale = gateFor({ px: 20, py: 100, x: 0, y: 0, n: 150, r: 7 }, W, H);
    const { a } = detect(wandFrame(80, 60), W, H, model, { a: stale, b: null });
    expect(a!.px).toBeCloseTo(58, 0);
  });
});

describe('pose', () => {
  const model = calibrate();

  function pose(cx: number, cy: number, half = 22, angle = 0) {
    const { a, b } = detect(wandFrame(cx, cy, half, 7, angle), W, H, model);
    return poseFrom(a!, b!);
  }

  it('reads a level wand as zero tilt', () => {
    expect(pose(80, 60).angle).toBeCloseTo(0, 2);
  });

  it('reads tilt in the right direction', () => {
    // Screen y grows downward, so a positive angle here lifts the cyan end: a right-hand tilt.
    expect(pose(80, 60, 22, 0.5).angle).toBeCloseTo(0.5, 1);
    expect(pose(80, 60, 22, -0.5).angle).toBeCloseTo(-0.5, 1);
  });

  it('reads separation shrinking as the wand moves away', () => {
    expect(pose(80, 60, 30).sep).toBeGreaterThan(pose(80, 60, 18).sep);
  });
});

describe('one euro filter', () => {
  it('converges on a constant signal', () => {
    const f = new OneEuro();
    let out = 0;
    for (let i = 0; i < 60; i++) out = f.filter(1, 1 / 60);
    expect(out).toBeCloseTo(1, 2);
  });

  it('cuts jitter while still', () => {
    const f = new OneEuro();
    const seq: number[] = [];
    for (let i = 0; i < 120; i++) seq.push(f.filter(i % 2 ? 0.05 : -0.05, 1 / 60));
    const tail = seq.slice(60);
    expect(Math.max(...tail.map(Math.abs))).toBeLessThan(0.02);
  });

  it('tracks a fast sweep closely instead of lagging behind it', () => {
    const f = new OneEuro();
    let out = 0;
    for (let i = 0; i < 20; i++) out = f.filter(i / 20, 1 / 60);
    // A third of a second into a sweep the filter must be within ~10% of the input, or steering
    // feels like it is being dragged through treacle.
    expect(out).toBeGreaterThan(0.85);
  });
});

describe('flick detector', () => {
  const opts = { threshold: 1.8, refractory: 0.25 };
  const dt = 1 / 60;

  function feed(d: FlickDetector, speeds: number[], step = dt): number {
    let fires = 0;
    let y = 0;
    for (const v of speeds) {
      y += v * step;
      if (d.push(y, step)) fires++;
    }
    return fires;
  }

  it('does not fire while the wand is held still', () => {
    const d = new FlickDetector({ ...opts });
    expect(feed(d, new Array(60).fill(0))).toBe(0);
  });

  it('does not fire on a slow deliberate raise', () => {
    const d = new FlickDetector({ ...opts });
    expect(feed(d, new Array(60).fill(0.8))).toBe(0);
  });

  it('fires once on a flick, not once per frame', () => {
    const d = new FlickDetector({ ...opts });
    expect(feed(d, [0, 0, 0, 3, 3.4, 3.2, 2.6, 1, 0, 0, 0, 0])).toBe(1);
  });

  it('fires within two frames of the flick starting', () => {
    const d = new FlickDetector({ ...opts });
    let y = 0;
    let fired = -1;
    const speeds = [0, 0, 0, 3, 3.4, 3.2, 2.6];
    for (let i = 0; i < speeds.length; i++) {
      y += speeds[i] * dt;
      if (d.push(y, dt) && fired < 0) fired = i;
    }
    expect(fired).toBeGreaterThanOrEqual(0);
    expect(fired - 3).toBeLessThanOrEqual(1);
  });

  it('fires on a flick even when the camera is slow', () => {
    // At 12fps an entire flick lands in one or two samples; the 2-frame confirmation must not
    // veto it, or jumps stop working on slower machines.
    const d = new FlickDetector({ ...opts });
    expect(feed(d, [0, 0, 0, 2.8, 0, 0, 0], 1 / 12)).toBe(1);
  });

  it('still ignores a slow raise on a slow camera', () => {
    const d = new FlickDetector({ ...opts });
    expect(feed(d, new Array(20).fill(0.8), 1 / 12)).toBe(0);
  });

  it('honours the refractory gap between two flicks', () => {
    const d = new FlickDetector({ ...opts });
    const one = [3, 3.4, 3.2, 0, 0];
    expect(feed(d, [0, 0, ...one, ...one])).toBe(1);
  });

  it('allows a second flick after the wand settles', () => {
    const d = new FlickDetector({ ...opts });
    const gap = new Array(20).fill(0);
    expect(feed(d, [0, 0, 3, 3.4, 3.2, ...gap, 3, 3.4, 3.2])).toBe(2);
  });
});

describe('axis shaping', () => {
  it('holds zero inside the deadzone', () => {
    expect(shapeAxis(0.08, 0.1)).toBe(0);
    expect(shapeAxis(-0.08, 0.1)).toBe(0);
  });

  it('reaches full deflection at the edge', () => {
    expect(shapeAxis(1, 0.1)).toBeCloseTo(1, 5);
    expect(shapeAxis(-1, 0.1)).toBeCloseTo(-1, 5);
  });

  it('is gentle just outside the deadzone', () => {
    expect(shapeAxis(0.3, 0.1)).toBeLessThan(0.3);
  });

  it('wraps angles to the shortest signed distance', () => {
    expect(wrapPi(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 6);
    expect(wrapPi(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1, 6);
  });
});

describe('wand mapper', () => {
  const dt = 1 / 60;
  const level = { angle: 0, sep: 0.35, x: 0, y: 0 };

  function settle(m: WandMapper, pose = level, frames = 30) {
    for (let i = 0; i < frames; i++) m.update({ ...pose }, dt);
  }

  it('is neutral when the wand is held level at the calibrated distance', () => {
    const m = new WandMapper();
    m.recentre(level);
    settle(m);
    expect(m.out.steer).toBe(0);
    expect(m.out.throttle).toBe(0);
    expect(m.out.jump).toBe(false);
    expect(m.status).toBe('tracking');
  });

  // A clockwise ("steering wheel right") tilt drops the right-hand disc, so in the y-up tracker
  // frame the A->B angle goes negative. These names describe the physical gesture, not the sign.
  const tiltRight = -DEFAULT_TUNING.steerRange;
  const tiltLeft = DEFAULT_TUNING.steerRange;

  it('steers right when the wand tilts right', () => {
    const m = new WandMapper();
    m.recentre(level);
    settle(m, { ...level, angle: tiltRight }, 60);
    expect(m.out.steer).toBeCloseTo(1, 1);
  });

  it('steers left when the wand tilts left', () => {
    const m = new WandMapper();
    m.recentre(level);
    settle(m, { ...level, angle: tiltLeft }, 60);
    expect(m.out.steer).toBeCloseTo(-1, 1);
  });

  it('accelerates when pushed towards the camera and brakes when pulled back', () => {
    const push = new WandMapper();
    push.recentre(level);
    settle(push, { ...level, sep: 0.35 * (1 + DEFAULT_TUNING.throttleRange) }, 90);
    expect(push.out.throttle).toBeCloseTo(1, 1);

    const pull = new WandMapper();
    pull.recentre(level);
    settle(pull, { ...level, sep: 0.35 * (1 - DEFAULT_TUNING.throttleRange) }, 90);
    expect(pull.out.throttle).toBeCloseTo(-1, 1);
  });

  it('inverts steering when asked', () => {
    const m = new WandMapper();
    m.setTuning({ invertSteer: true });
    m.recentre(level);
    settle(m, { ...level, angle: tiltRight }, 60);
    expect(m.out.steer).toBeLessThan(-0.5);
  });

  it('jumps on a flick and holds long enough for the sim jump buffer', () => {
    const m = new WandMapper();
    m.recentre(level);
    settle(m);
    let y = 0;
    let held = 0;
    for (let i = 0; i < 12; i++) {
      y += (i < 4 ? 3.2 : 0) * dt;
      m.update({ ...level, y }, dt);
      if (m.out.jump) held++;
    }
    expect(held).toBeGreaterThan(0);
    // The sim buffers a jump for 0.12s; the hold has to outlast a 60Hz frame comfortably.
    expect(held * dt).toBeGreaterThanOrEqual(0.05);
  });

  it('does not lurch the throttle while jumping', () => {
    const m = new WandMapper();
    m.recentre(level);
    settle(m);
    let y = 0;
    let peak = 0;
    for (let i = 0; i < 14; i++) {
      // The wand tips as it is flicked, so separation and height move together from frame 2.
      const flicking = i >= 2 && i < 6;
      y += (flicking ? 3.2 : 0) * dt;
      m.update({ ...level, sep: 0.35 * (i >= 2 && i < 8 ? 1.18 : 1), y }, dt);
      peak = Math.max(peak, Math.abs(m.out.throttle));
    }
    expect(peak).toBeLessThan(0.2);
  });

  it('fades the controls out and flags a loss when the wand disappears', () => {
    const m = new WandMapper();
    m.recentre(level);
    settle(m, { ...level, angle: tiltRight }, 60);
    expect(Math.abs(m.out.steer)).toBeGreaterThan(0.5);
    for (let i = 0; i < 18; i++) m.update(null, dt);
    expect(m.out.steer).toBe(0);
    expect(m.status).toBe('tracking');
    for (let i = 0; i < 30; i++) m.update(null, dt);
    expect(m.status).toBe('lost');
  });

  it('recovers tracking when the wand comes back', () => {
    const m = new WandMapper();
    m.recentre(level);
    settle(m);
    for (let i = 0; i < 60; i++) m.update(null, dt);
    expect(m.status).toBe('lost');
    settle(m, level, 5);
    expect(m.status).toBe('tracking');
    expect(m.active).toBe(true);
  });

  it('takes a new neutral from whatever pose is held when recentred', () => {
    const m = new WandMapper();
    const tilted = { angle: 0.3, sep: 0.5, x: 0, y: 0 };
    m.recentre(tilted);
    expect(m.neutral).toEqual(neutralFrom(tilted));
    settle(m, tilted, 60);
    expect(m.out.steer).toBe(0);
    expect(m.out.throttle).toBe(0);
  });
});
