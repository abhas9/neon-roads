/**
 * Turns a pair of hand readings into a game InputFrame: an invisible steering wheel.
 *
 * Both hands are held closed, as if gripping a wheel. Steering comes from the *angle between the
 * palms* rather than either hand's position, which makes it self-correcting: shift in your seat
 * and both hands move together, so the steering does not budge. Throttle comes from their mean
 * height, which is mathematically independent of that angle — tilt without changing the mean, or
 * raise both without tilting. Opening either hand jumps.
 *
 * Pure and DOM-free, so all of it unit-tests against synthetic skeletons.
 */
import type { InputFrame } from '../sim/types';
import { OneEuro, shapeAxis, wrapPi } from '../core/filter';
import type { HandPair, HandReading } from './gestures';

export interface HandTuning {
  /** Wheel tilt, in radians, that produces full steering. */
  steerRange: number;
  /** Hand travel, as a fraction of frame height, that produces full throttle. */
  throttleRange: number;
  /** Openness above which a hand counts as open. Closing uses a lower threshold, see below. */
  openThreshold: number;
  steerDeadzone: number;
  throttleDeadzone: number;
}

export const DEFAULT_HAND_TUNING: HandTuning = {
  steerRange: (35 * Math.PI) / 180,
  throttleRange: 0.14,
  openThreshold: 0.68,
  steerDeadzone: 0.1,
  throttleDeadzone: 0.16,
};

/**
 * Gap between the open and closed thresholds. Wide on purpose: a loosely curled, relaxed hand
 * must still read as closed, because holding two tight fists for a whole run is exhausting and
 * fatigue is what kills a controller like this.
 */
const GRIP_HYSTERESIS = 0.2;
/** A hand's grip state survives this long without a detection, so one dropped frame is not a second jump. */
const GRIP_GRACE = 0.15;
/** Controls fade out over this long when a hand disappears, instead of sticking. */
const DECAY = 0.2;
/** No hands at all for this long pauses the run rather than flying the ship into a wall. */
export const LOST_AFTER = 0.5;
/** A hand smaller than this in the frame is too far away to read reliably. */
const MIN_HAND_SCALE = 0.035;

export type HandStatus = 'searching' | 'tracking' | 'lost';

/** Per-hand grip state machine driving the jump gesture. */
class Grip {
  /** True while the hand is open; hysteresis keeps it from chattering at the boundary. */
  open = false;
  /** Set once the hand has been closed, so hands that simply start open cannot fire a jump. */
  private armed = false;
  /** True from the moment an armed hand opens until it closes again. */
  triggered = false;
  private missing = 0;

  reset(): void {
    this.open = false;
    this.armed = false;
    this.triggered = false;
    this.missing = 0;
  }

  update(openness: number, threshold: number): void {
    this.missing = 0;
    const wasOpen = this.open;
    if (this.open ? openness < threshold - GRIP_HYSTERESIS : openness > threshold) this.open = !this.open;
    if (!this.open) {
      // Any closed hand is a loaded spring. Arming on the closed *state* rather than on the
      // open-to-closed transition matters, because the resting posture is already closed: a hand
      // that starts gripped never makes that transition and would never be able to jump.
      this.armed = true;
      this.triggered = false;
    } else if (!wasOpen && this.armed) {
      this.triggered = true;
      this.armed = false;
    }
  }

  /** Called when the hand is not visible; the grip is held briefly before being abandoned. */
  lost(dt: number): void {
    this.missing += dt;
    if (this.missing >= GRIP_GRACE) {
      this.open = false;
      this.triggered = false;
      this.armed = true;
    }
  }
}

export class HandMapper {
  readonly out: InputFrame = { steer: 0, throttle: 0, jump: false };
  status: HandStatus = 'searching';
  lostFor = 0;
  /** Level hands mean straight ahead, so the steering angle needs no calibration by default. */
  neutral = { angle: 0, height: 0 };
  tuning: HandTuning = { ...DEFAULT_HAND_TUNING };
  /** Live values for the tuning readout. */
  readonly raw = { tilt: 0, height: 0, leftOpen: 1, rightOpen: 1, hands: 0 };

  private steerF = new OneEuro(4, 1.5);
  private throttleF = new OneEuro(3, 1.0);
  private left = new Grip();
  private right = new Grip();
  private seen = false;
  private hasNeutral = false;

  get active(): boolean {
    return this.status === 'tracking';
  }

  reset(): void {
    this.out.steer = 0;
    this.out.throttle = 0;
    this.out.jump = false;
    this.status = 'searching';
    this.lostFor = 0;
    this.seen = false;
    // A stale neutral from a previous session would silently bias the next one.
    this.hasNeutral = false;
    this.neutral = { angle: 0, height: 0 };
    this.left.reset();
    this.right.reset();
    this.steerF.reset();
    this.throttleF.reset();
  }

  setTuning(t: Partial<HandTuning>): void {
    this.tuning = { ...this.tuning, ...t };
  }

  /** Makes the pose being held right now the neutral. Needs both hands. */
  recentre(pair: HandPair): boolean {
    const left = usable(pair.left);
    const right = usable(pair.right);
    if (!left || !right) return false;
    this.neutral = { angle: wheelAngle(left, right), height: (left.y + right.y) / 2 };
    this.hasNeutral = true;
    this.steerF.reset();
    this.throttleF.reset();
    return true;
  }

  update(pair: HandPair, dt: number): void {
    const out = this.out;
    const t = this.tuning;
    const left = usable(pair.left);
    const right = usable(pair.right);
    this.raw.hands = (left ? 1 : 0) + (right ? 1 : 0);
    this.raw.leftOpen = left?.open ?? 0;
    this.raw.rightOpen = right?.open ?? 0;

    if (left) this.left.update(left.open, t.openThreshold);
    else this.left.lost(dt);
    if (right) this.right.update(right.open, t.openThreshold);
    else this.right.lost(dt);
    out.jump = this.left.triggered || this.right.triggered;

    if (!left && !right) {
      this.lostFor += dt;
      const k = Math.max(0, 1 - this.lostFor / DECAY);
      out.steer *= k;
      out.throttle *= k;
      if (this.seen && this.lostFor >= LOST_AFTER) this.status = 'lost';
      return;
    }

    this.lostFor = 0;
    this.seen = true;
    this.status = 'tracking';

    if (!left || !right) {
      // Steering is a relation between two hands; with one it has no meaning, so it falls away
      // rather than freezing at whatever it last read. Throttle is left where the player set it.
      out.steer *= Math.max(0, 1 - dt / DECAY);
      this.steerF.reset();
      return;
    }

    // Height is only meaningful against a resting pose, so that one is calibrated; the angle is
    // not, because hands held level already means straight ahead.
    if (!this.hasNeutral) {
      this.neutral = { angle: 0, height: (left.y + right.y) / 2 };
      this.hasNeutral = true;
    }

    const tilt = this.steerF.filter(wrapPi(wheelAngle(left, right) - this.neutral.angle), dt);
    this.raw.tilt = tilt;
    // Turning the wheel clockwise drops the right hand, which in a y-up frame makes the
    // left-to-right angle negative. Negate so a clockwise turn steers right.
    out.steer = shapeAxis(Math.max(-1, Math.min(1, -tilt / t.steerRange)), t.steerDeadzone);

    const height = this.throttleF.filter((left.y + right.y) / 2 - this.neutral.height, dt);
    this.raw.height = height;
    out.throttle = shapeAxis(Math.max(-1, Math.min(1, height / t.throttleRange)), t.throttleDeadzone);
  }
}

/** Angle of the line from the left palm to the right palm; zero when the hands are level. */
export function wheelAngle(left: HandReading, right: HandReading): number {
  return Math.atan2(right.y - left.y, right.x - left.x);
}

function usable(h: HandReading | null): HandReading | null {
  return h && h.scale >= MIN_HAND_SCALE ? h : null;
}
