import { describe, expect, it } from 'vitest';
import { HandAssigner, fingerExtension, handScale, openness, palmCentre, readHand } from '../src/hand/gestures';
import type { HandObservation, Landmark } from '../src/hand/gestures';
import { DEFAULT_HAND_TUNING, HandMapper } from '../src/hand/mapping';
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

describe('hand mapper', () => {
  const dt = 1 / 30;
  const assigner = new HandAssigner();
  const pair = (r: HandOpts | null, l: HandOpts | null): HandPair =>
    assigner.assign([...(r ? [rightHand(r)] : []), ...(l ? [leftHand(l)] : [])], ASPECT);

  const neutralPair = () => pair({}, {});

  function settle(m: HandMapper, p: HandPair, frames = 30) {
    for (let i = 0; i < frames; i++) m.update(p, dt);
  }

  function fresh(tuning = {}) {
    const m = new HandMapper();
    m.setTuning(tuning);
    settle(m, neutralPair(), 5);
    m.recentre(neutralPair());
    settle(m, neutralPair(), 10);
    return m;
  }

  it('is neutral with both hands open and still', () => {
    const m = fresh();
    expect(m.out.steer).toBe(0);
    expect(m.out.throttle).toBe(0);
    expect(m.out.jump).toBe(false);
    expect(m.status).toBe('tracking');
  });

  it('steers right when the flying hand moves right', () => {
    const m = fresh();
    // Moving right in the mirror means moving left in the raw image.
    settle(m, pair({ x: -0.22 - DEFAULT_HAND_TUNING.steerRange }, {}), 40);
    expect(m.out.steer).toBeCloseTo(1, 1);
  });

  it('steers left when the flying hand moves left', () => {
    const m = fresh();
    settle(m, pair({ x: -0.22 + DEFAULT_HAND_TUNING.steerRange }, {}), 40);
    expect(m.out.steer).toBeCloseTo(-1, 1);
  });

  it('accelerates when the flying hand rises and brakes when it drops', () => {
    const up = fresh();
    settle(up, pair({ y: DEFAULT_HAND_TUNING.throttleRange }, {}), 40);
    expect(up.out.throttle).toBeCloseTo(1, 1);

    const down = fresh();
    settle(down, pair({ y: -DEFAULT_HAND_TUNING.throttleRange }, {}), 40);
    expect(down.out.throttle).toBeCloseTo(-1, 1);
  });

  it('jumps when the other hand makes a fist', () => {
    const m = fresh();
    expect(m.out.jump).toBe(false);
    settle(m, pair({}, { curl: 1 }), 3);
    expect(m.out.jump).toBe(true);
  });

  it('holds one jump for as long as the fist is held', () => {
    // The simulation edge-triggers, so a steady true is exactly one jump; a flicker is two.
    const m = fresh();
    let edges = 0;
    let was = false;
    for (let i = 0; i < 40; i++) {
      m.update(pair({}, { curl: 1 }), dt);
      if (m.out.jump && !was) edges++;
      was = m.out.jump;
    }
    expect(edges).toBe(1);
  });

  it('releases the jump when the hand opens again', () => {
    const m = fresh();
    settle(m, pair({}, { curl: 1 }), 5);
    expect(m.out.jump).toBe(true);
    settle(m, pair({}, { curl: 0 }), 5);
    expect(m.out.jump).toBe(false);
  });

  it('does not chatter when a hand hovers at the fist threshold', () => {
    const m = fresh();
    let edges = 0;
    let was = false;
    // Openness wobbling either side of the threshold; hysteresis must absorb it.
    for (let i = 0; i < 60; i++) {
      m.update(pair({}, { curl: 0.62 + (i % 2) * 0.04 }), dt);
      if (m.out.jump && !was) edges++;
      was = m.out.jump;
    }
    expect(edges).toBeLessThanOrEqual(1);
  });

  it('does not read one fist as two jumps when a frame drops', () => {
    const m = fresh();
    let edges = 0;
    let was = false;
    for (let i = 0; i < 30; i++) {
      // The jumping hand vanishes for a single frame in the middle of the fist.
      m.update(i === 10 ? pair({}, null) : pair({}, { curl: 1 }), dt);
      if (m.out.jump && !was) edges++;
      was = m.out.jump;
    }
    expect(edges).toBe(1);
  });

  it('releases a held fist once the hand has been gone too long', () => {
    const m = fresh();
    settle(m, pair({}, { curl: 1 }), 5);
    expect(m.out.jump).toBe(true);
    settle(m, pair({}, null), 12);
    expect(m.out.jump).toBe(false);
  });

  it('does not move the steering when the flying hand closes', () => {
    // Cross-talk check: the palm centre must not drift as the fingers curl.
    const m = fresh();
    settle(m, pair({ curl: 1 }, {}), 30);
    expect(Math.abs(m.out.steer)).toBeLessThan(0.05);
  });

  it('fades the controls out and flags a loss when both hands disappear', () => {
    const m = fresh();
    settle(m, pair({ x: -0.22 - 0.2 }, {}), 30);
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
    settle(m, neutralPair(), 5);
    expect(m.status).toBe('tracking');
    expect(m.active).toBe(true);
  });

  it('ignores a hand too far away to read', () => {
    const m = fresh();
    settle(m, pair({ scale: 0.01 }, { scale: 0.01, curl: 1 }), 20);
    expect(m.out.jump).toBe(false);
    expect(m.status).toBe('lost');
  });

  it('swaps the hands for left-handed players', () => {
    const m = fresh({ swapHands: true });
    settle(m, pair({ curl: 1 }, {}), 5);
    expect(m.out.jump, 'the right hand now jumps').toBe(true);
    const s = fresh({ swapHands: true });
    settle(s, pair({}, { x: 0.22 - DEFAULT_HAND_TUNING.steerRange }), 40);
    expect(s.out.steer, 'the left hand now steers').toBeCloseTo(1, 1);
  });

  it('takes throttle from the other hand in split mode', () => {
    const m = fresh({ mode: 'split' });
    // Raising only the flying hand must not throttle in this mode.
    settle(m, pair({ y: DEFAULT_HAND_TUNING.throttleRange }, {}), 30);
    expect(Math.abs(m.out.throttle)).toBeLessThan(0.2);
    const t = fresh({ mode: 'split' });
    settle(t, pair({}, { y: DEFAULT_HAND_TUNING.throttleRange }), 40);
    expect(t.out.throttle).toBeCloseTo(1, 1);
  });

  it('still steers in split mode', () => {
    const m = fresh({ mode: 'split' });
    settle(m, pair({ x: -0.22 - DEFAULT_HAND_TUNING.steerRange }, {}), 40);
    expect(m.out.steer).toBeCloseTo(1, 1);
  });
});
