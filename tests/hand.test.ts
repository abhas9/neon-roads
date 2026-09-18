import { describe, expect, it } from 'vitest';
import { HandAssigner, fingerExtension, handScale, openness, palmCentre, readHand } from '../src/hand/gestures';
import type { HandObservation, Landmark } from '../src/hand/gestures';
import { DEFAULT_HAND_TUNING, HandMapper, wheelAngle } from '../src/hand/mapping';
import type { HandPair } from '../src/hand/gestures';

const ASPECT = 4 / 3;

interface HandOpts {
  /** Palm position in centred height units of the *unmirrored* camera image, x right, y up. */
  x?: number;
  y?: number;
  /** Wrist-to-knuckle distance in height units. */
  scale?: number;
  /** 0 = flat open hand, 1 = tight fist. */
  curl?: number;
  /** Rotation of the hand in the image plane, radians. */
  rot?: number;
}

/**
 * Builds a plausible 21-point hand skeleton in MediaPipe's normalised image coordinates.
 *
 * Fingers are chains hinged at PIP and DIP, so curling folds the tips back towards the palm the
 * way a real hand does. The knuckles do not move with curl, which is the property the steering
 * position depends on.
 */
function hand({ x = 0, y = 0, scale = 0.12, curl = 0, rot = 0 }: HandOpts = {}): Landmark[] {
  const lm: Landmark[] = new Array(21);
  // Height units, y up, before conversion to image coordinates.
  const pt = (hx: number, hy: number): Landmark => ({ x: 0.5 + hx / ASPECT, y: 0.5 - hy });
  const rotate = (vx: number, vy: number, a: number): [number, number] => [
    vx * Math.cos(a) - vy * Math.sin(a),
    vx * Math.sin(a) + vy * Math.cos(a),
  ];
  // The palm sits below its knuckles; "up" is the direction the fingers point.
  const [ux, uy] = rotate(0, 1, rot);
  const [px, py] = rotate(1, 0, rot); // across the knuckles

  // Wrist is one scale below the middle knuckle, so the palm centre lands on `x, y`.
  const wx = x - ux * scale * 0.5;
  const wy = y - uy * scale * 0.5;
  lm[0] = pt(wx, wy);

  const spread = [-0.34, -0.02, 0.28, 0.56];
  const reach = [0.98, 1.06, 1.0, 0.88];
  const theta = curl * 2.6;
  for (let f = 0; f < 4; f++) {
    const mx = wx + ux * scale * reach[f] + px * scale * spread[f];
    const my = wy + uy * scale * reach[f] + py * scale * spread[f];
    const [d1x, d1y] = [ux, uy];
    const [d2x, d2y] = rotate(ux, uy, -theta);
    const [d3x, d3y] = rotate(ux, uy, -theta * 1.5);
    const pipx = mx + d1x * scale * 0.45;
    const pipy = my + d1y * scale * 0.45;
    const dipx = pipx + d2x * scale * 0.3;
    const dipy = pipy + d2y * scale * 0.3;
    const tipx = dipx + d3x * scale * 0.24;
    const tipy = dipy + d3y * scale * 0.24;
    const base = 5 + f * 4;
    lm[base] = pt(mx, my);
    lm[base + 1] = pt(pipx, pipy);
    lm[base + 2] = pt(dipx, dipy);
    lm[base + 3] = pt(tipx, tipy);
  }
  // Thumb: plausible, and deliberately not used by any measure here.
  for (let i = 1; i <= 4; i++) {
    const t = i / 4;
    lm[i] = pt(wx + px * scale * -0.5 * t + ux * scale * 0.5 * t, wy + py * scale * -0.5 * t + uy * scale * 0.5 * t);
  }
  return lm;
}

const obs = (o: HandOpts, label?: 'Left' | 'Right'): HandObservation => ({ landmarks: hand(o), label });

/** The player's right hand appears on the left of an unmirrored camera image. */
const rightHand = (o: HandOpts = {}) => obs({ x: -0.22, ...o }, 'Left');
const leftHand = (o: HandOpts = {}) => obs({ x: 0.22, ...o }, 'Right');

describe('hand geometry', () => {
  it('reads an open hand as open and a fist as closed', () => {
    expect(openness(hand({ curl: 0 }), ASPECT)).toBeGreaterThan(0.85);
    expect(openness(hand({ curl: 1 }), ASPECT)).toBeLessThan(0.15);
  });

  it('is monotonic between the two', () => {
    const steps = [0, 0.25, 0.5, 0.75, 1].map((c) => openness(hand({ curl: c }), ASPECT));
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeLessThan(steps[i - 1]);
  });

  it('reads the same openness near and far from the camera', () => {
    for (const curl of [0, 0.5, 1]) {
      const near = openness(hand({ scale: 0.2, curl }), ASPECT);
      const far = openness(hand({ scale: 0.06, curl }), ASPECT);
      expect(Math.abs(near - far), `curl ${curl}`).toBeLessThan(0.05);
    }
  });

  it('reads the same openness whichever way the hand is rotated', () => {
    const flat = openness(hand({ curl: 0 }), ASPECT);
    for (const rot of [0.5, 1.6, -1.2, 3]) {
      expect(Math.abs(openness(hand({ curl: 0, rot }), ASPECT) - flat), `rot ${rot}`).toBeLessThan(0.05);
    }
  });

  it('reads the same openness anywhere in the frame', () => {
    const middle = openness(hand({ curl: 1 }), ASPECT);
    expect(Math.abs(openness(hand({ curl: 1, x: -0.4, y: 0.3 }), ASPECT) - middle)).toBeLessThan(0.05);
  });

  it('reports finger extension shrinking as a finger curls', () => {
    for (let f = 0; f < 4; f++) {
      expect(fingerExtension(hand({ curl: 0 }), f, ASPECT)).toBeGreaterThan(fingerExtension(hand({ curl: 1 }), f, ASPECT));
    }
  });

  it('reports a hand size proportional to how close the hand is', () => {
    // Only proportionality matters: hand size is the denominator every other measure divides by.
    const small = handScale(hand({ scale: 0.1 }), ASPECT);
    const big = handScale(hand({ scale: 0.2 }), ASPECT);
    expect(big / small).toBeCloseTo(2, 2);
    expect(small).toBeGreaterThan(0);
  });

  it('keeps the palm centre still while the fingers curl', () => {
    // The steering position must not lurch when the player makes a fist. A naive centroid over
    // all 21 landmarks does exactly that, so compare against one.
    const centroid = (lm: Landmark[]) => ({
      x: lm.reduce((s, p) => s + p.x, 0) / lm.length,
      y: lm.reduce((s, p) => s + p.y, 0) / lm.length,
    });
    const open = hand({ curl: 0 });
    const fist = hand({ curl: 1 });
    const palmShift = Math.hypot(palmCentre(open).x - palmCentre(fist).x, palmCentre(open).y - palmCentre(fist).y);
    const naiveShift = Math.hypot(centroid(open).x - centroid(fist).x, centroid(open).y - centroid(fist).y);
    expect(palmShift).toBeLessThan(0.002);
    expect(naiveShift).toBeGreaterThan(palmShift * 10);
  });

  it('mirrors x so the player sees themselves as in a mirror', () => {
    // The player's right hand is on the left of the raw image and must read as positive x.
    expect(readHand(rightHand())!.x).toBeGreaterThan(0);
    expect(readHand(leftHand())!.x).toBeLessThan(0);
  });

  it('rejects a skeleton with missing landmarks', () => {
    expect(readHand({ landmarks: hand().slice(0, 12) })).toBeNull();
  });
});

describe('hand assignment', () => {
  it('assigns two hands by mirrored position, not by the detector label', () => {
    const a = new HandAssigner();
    // Deliberately mislabelled: position must win.
    const pair = a.assign([obs({ x: -0.25 }, 'Right'), obs({ x: 0.25 }, 'Left')], ASPECT);
    expect(pair.right!.x).toBeGreaterThan(0);
    expect(pair.left!.x).toBeLessThan(0);
  });

  it('uses the detector label for a lone hand, allowing for its selfie-flipped convention', () => {
    const a = new HandAssigner();
    expect(a.assign([rightHand()], ASPECT).right).not.toBeNull();
    expect(a.assign([leftHand()], ASPECT).left).not.toBeNull();
  });

  it('learns the label mapping from a two-handed frame and reuses it', () => {
    const a = new HandAssigner();
    // A detector whose handedness convention is the opposite of the assumed one.
    a.assign([obs({ x: -0.25 }, 'Right'), obs({ x: 0.25 }, 'Left')], ASPECT);
    const lone = a.assign([obs({ x: 0.05 }, 'Right')], ASPECT);
    expect(lone.right, 'label learned from the two-hand frame').not.toBeNull();
    expect(lone.left).toBeNull();
  });

  it('falls back to which side of centre an unlabelled hand is on', () => {
    const a = new HandAssigner();
    expect(a.assign([obs({ x: -0.3 })], ASPECT).right).not.toBeNull();
    expect(a.assign([obs({ x: 0.3 })], ASPECT).left).not.toBeNull();
  });

  it('reports nothing when no hands are visible', () => {
    expect(new HandAssigner().assign([], ASPECT)).toEqual({ left: null, right: null });
  });
});

describe('steering wheel mapper', () => {
  const dt = 1 / 30;
  const assigner = new HandAssigner();
  /** Both hands gripped closed, as they are held at rest. */
  const GRIP = 1;

  const pair = (r: HandOpts | null, l: HandOpts | null): HandPair =>
    assigner.assign(
      [...(r ? [rightHand({ curl: GRIP, ...r })] : []), ...(l ? [leftHand({ curl: GRIP, ...l })] : [])],
      ASPECT,
    );
  const level = () => pair({}, {});
  /**
   * Turning the wheel clockwise drops the right hand and raises the left. The hands sit 0.44
   * apart horizontally, so the vertical offset is a tangent, not a sine, if the resulting angle
   * is to match the one asked for.
   */
  const turn = (radians: number) => pair({ y: -Math.tan(radians) * 0.22 }, { y: Math.tan(radians) * 0.22 });

  function settle(m: HandMapper, p: HandPair, frames = 40) {
    for (let i = 0; i < frames; i++) m.update(p, dt);
  }

  function fresh() {
    const m = new HandMapper();
    settle(m, level(), 10);
    m.recentre(level());
    settle(m, level(), 10);
    return m;
  }

  function edges(m: HandMapper, frames: () => HandPair, n: number) {
    let count = 0;
    let was = m.out.jump;
    for (let i = 0; i < n; i++) {
      m.update(frames(), dt);
      if (m.out.jump && !was) count++;
      was = m.out.jump;
    }
    return count;
  }

  it('is neutral with both hands gripped and level', () => {
    const m = fresh();
    expect(m.out.steer).toBe(0);
    expect(m.out.throttle).toBe(0);
    expect(m.out.jump).toBe(false);
    expect(m.status).toBe('tracking');
  });

  it('steers right when the wheel turns clockwise', () => {
    const m = fresh();
    settle(m, turn(DEFAULT_HAND_TUNING.steerRange));
    expect(m.out.steer).toBeCloseTo(1, 1);
  });

  it('steers left when the wheel turns anticlockwise', () => {
    const m = fresh();
    settle(m, turn(-DEFAULT_HAND_TUNING.steerRange));
    expect(m.out.steer).toBeCloseTo(-1, 1);
  });

  it('accelerates when both hands rise and brakes when both drop', () => {
    const up = fresh();
    settle(up, pair({ y: DEFAULT_HAND_TUNING.throttleRange }, { y: DEFAULT_HAND_TUNING.throttleRange }));
    expect(up.out.throttle).toBeCloseTo(1, 1);

    const down = fresh();
    settle(down, pair({ y: -DEFAULT_HAND_TUNING.throttleRange }, { y: -DEFAULT_HAND_TUNING.throttleRange }));
    expect(down.out.throttle).toBeCloseTo(-1, 1);
  });

  it('keeps the steering still when the whole body shifts', () => {
    // The point of measuring between the hands rather than from one: leaning or sliding in a
    // chair moves both hands together and must not read as a turn.
    const m = fresh();
    for (const [dx, dy] of [[0.12, 0], [-0.12, 0], [0, 0.08], [0.1, -0.08]]) {
      settle(m, pair({ x: -0.22 + dx, y: dy }, { x: 0.22 + dx, y: dy }));
      expect(Math.abs(m.out.steer), `shifted by ${dx}, ${dy}`).toBeLessThan(0.05);
    }
  });

  it('does not change the throttle while steering', () => {
    // Steering is the difference in hand height and throttle is their mean, so the two axes are
    // independent by construction. This is the test that says so.
    const m = fresh();
    settle(m, turn(DEFAULT_HAND_TUNING.steerRange));
    expect(Math.abs(m.out.steer)).toBeGreaterThan(0.5);
    expect(Math.abs(m.out.throttle)).toBeLessThan(0.1);
  });

  it('does not change the steering while throttling', () => {
    const m = fresh();
    settle(m, pair({ y: DEFAULT_HAND_TUNING.throttleRange }, { y: DEFAULT_HAND_TUNING.throttleRange }));
    expect(Math.abs(m.out.throttle)).toBeGreaterThan(0.5);
    expect(Math.abs(m.out.steer)).toBeLessThan(0.05);
  });

  it('jumps when either hand opens', () => {
    for (const side of ['left', 'right'] as const) {
      const m = fresh();
      expect(m.out.jump).toBe(false);
      settle(m, side === 'left' ? pair({}, { curl: 0 }) : pair({ curl: 0 }, {}), 4);
      expect(m.out.jump, `${side} hand`).toBe(true);
    }
  });

  it('does not jump from hands that simply start open', () => {
    // Hands are open before the player grips the wheel; that must not fire a jump.
    const m = new HandMapper();
    expect(edges(m, () => pair({ curl: 0 }, { curl: 0 }), 20)).toBe(0);
  });

  it('holds one jump for as long as the hand stays open', () => {
    const m = fresh();
    expect(edges(m, () => pair({}, { curl: 0 }), 40)).toBe(1);
  });

  it('counts opening both hands at once as a single jump', () => {
    const m = fresh();
    expect(edges(m, () => pair({ curl: 0 }, { curl: 0 }), 40)).toBe(1);
  });

  it('allows a second jump after the hand closes again', () => {
    const m = fresh();
    let count = 0;
    let was = false;
    const script = [...Array(6).fill(0), ...Array(8).fill(1), ...Array(6).fill(0), ...Array(8).fill(1)];
    for (const open of script) {
      m.update(pair({}, { curl: open ? 0 : GRIP }), dt);
      if (m.out.jump && !was) count++;
      was = m.out.jump;
    }
    expect(count).toBe(2);
  });

  it('does not read one open hand as two jumps when a frame drops', () => {
    const m = fresh();
    let count = 0;
    let was = false;
    for (let i = 0; i < 30; i++) {
      m.update(i === 10 ? pair({}, null) : pair({}, { curl: 0 }), dt);
      if (m.out.jump && !was) count++;
      was = m.out.jump;
    }
    expect(count).toBe(1);
  });

  it('lets go of the steering when one hand leaves, and keeps the throttle', () => {
    const m = fresh();
    settle(m, turn(DEFAULT_HAND_TUNING.steerRange));
    settle(m, pair({ y: DEFAULT_HAND_TUNING.throttleRange }, { y: DEFAULT_HAND_TUNING.throttleRange }));
    const throttle = m.out.throttle;
    expect(Math.abs(throttle)).toBeGreaterThan(0.5);
    for (let i = 0; i < 10; i++) m.update(pair({ y: DEFAULT_HAND_TUNING.throttleRange }, null), dt);
    expect(m.out.steer, 'steering has no meaning with one hand').toBe(0);
    expect(m.out.throttle, 'throttle is left where the player set it').toBeCloseTo(throttle, 2);
    expect(m.status).toBe('tracking');
  });

  it('fades everything and flags a loss when both hands disappear', () => {
    const m = fresh();
    settle(m, turn(DEFAULT_HAND_TUNING.steerRange));
    expect(Math.abs(m.out.steer)).toBeGreaterThan(0.5);
    for (let i = 0; i < 7; i++) m.update(pair(null, null), dt);
    expect(m.out.steer).toBe(0);
    expect(m.status).toBe('tracking');
    for (let i = 0; i < 20; i++) m.update(pair(null, null), dt);
    expect(m.status).toBe('lost');
  });

  it('recovers when the hands come back', () => {
    const m = fresh();
    for (let i = 0; i < 30; i++) m.update(pair(null, null), dt);
    expect(m.status).toBe('lost');
    settle(m, level(), 5);
    expect(m.status).toBe('tracking');
    expect(m.active).toBe(true);
  });

  it('ignores hands too far away to read', () => {
    const m = fresh();
    settle(m, pair({ scale: 0.01 }, { scale: 0.01 }), 20);
    expect(m.status).toBe('lost');
  });

  it('treats level hands as straight ahead without any calibration', () => {
    // No recentre at all: the wheel has a natural zero, unlike a hand's resting height.
    const m = new HandMapper();
    settle(m, level(), 20);
    expect(Math.abs(m.out.steer)).toBeLessThan(0.05);
  });

  it('forgets a stale neutral on reset', () => {
    const m = new HandMapper();
    settle(m, pair({ y: 0.2 }, { y: 0.2 }), 20);
    expect(Math.abs(m.out.throttle)).toBeLessThan(0.1);
    m.reset();
    settle(m, level(), 20);
    expect(Math.abs(m.out.throttle)).toBeLessThan(0.1);
  });

  it('measures the wheel angle as zero when the hands are level', () => {
    const p = level();
    expect(wheelAngle(p.left!, p.right!)).toBeCloseTo(0, 2);
  });
});
