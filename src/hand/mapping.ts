/** Turns a pair of hand readings into a game InputFrame. Pure and DOM-free, so it unit-tests. */
import type { InputFrame } from '../sim/types';
import { OneEuro, shapeAxis } from '../core/filter';
import type { HandPair, HandReading } from './gestures';

export type HandMode = 'joystick' | 'split';

export interface HandTuning {
  /** Hand travel, as a fraction of frame height, that produces full steering. */
  steerRange: number;
  throttleRange: number;
  /** Openness below this counts as a fist. */
  fistThreshold: number;
  steerDeadzone: number;
  throttleDeadzone: number;
  /** Swap which hand flies and which jumps, for left-handed players. */
  swapHands: boolean;
  /** joystick: one hand steers and throttles. split: one steers, the other throttles. */
  mode: HandMode;
}

export const DEFAULT_HAND_TUNING: HandTuning = {
  steerRange: 0.16,
  throttleRange: 0.14,
  fistThreshold: 0.35,
  steerDeadzone: 0.12,
  throttleDeadzone: 0.16,
  swapHands: false,
  mode: 'joystick',
};

/** Gap between the close and open thresholds, so a hand hovering at the boundary cannot chatter. */
const FIST_HYSTERESIS = 0.18;
/** A fist survives this long without a detection, so one dropped frame is not a second jump. */
const FIST_GRACE = 0.15;
/** Controls fade out over this long when a hand disappears, instead of sticking. */
const DECAY = 0.2;
/** No hands at all for this long pauses the run rather than flying the ship into a wall. */
export const LOST_AFTER = 0.5;
/** A hand smaller than this in the frame is too far away to read reliably. */
const MIN_HAND_SCALE = 0.035;

export type HandStatus = 'searching' | 'tracking' | 'lost';

export interface HandNeutral {
  fly: { x: number; y: number };
  throttle: { x: number; y: number };
}

export class HandMapper {
  readonly out: InputFrame = { steer: 0, throttle: 0, jump: false };
  status: HandStatus = 'searching';
  lostFor = 0;
  neutral: HandNeutral = { fly: { x: 0, y: 0 }, throttle: { x: 0, y: 0 } };
  tuning: HandTuning = { ...DEFAULT_HAND_TUNING };
  /** Live values for the tuning readout. */
  readonly raw = { steer: 0, throttle: 0, flyOpen: 1, jumpOpen: 1, fly: false, jumpHand: false };

  private steerF = new OneEuro(4, 1.5);
  private throttleF = new OneEuro(3, 1.0);
  private fist = false;
  private fistMissing = 0;
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
    this.fist = false;
    this.fistMissing = 0;
    this.steerF.reset();
    this.throttleF.reset();
  }

  setTuning(t: Partial<HandTuning>): void {
    this.tuning = { ...this.tuning, ...t };
  }

  /** The hand that steers, and in split mode the other one throttles. */
  private roles(pair: HandPair): { fly: HandReading | null; jump: HandReading | null } {
    const fly = this.tuning.swapHands ? pair.left : pair.right;
    const jump = this.tuning.swapHands ? pair.right : pair.left;
    return { fly: usable(fly), jump: usable(jump) };
  }

  /** Makes the pose being held right now the neutral. Returns false if the flying hand is absent. */
  recentre(pair: HandPair): boolean {
    const { fly, jump } = this.roles(pair);
    if (!fly) return false;
    this.neutral = {
      fly: { x: fly.x, y: fly.y },
      throttle: jump ? { x: jump.x, y: jump.y } : { x: fly.x, y: fly.y },
    };
    this.hasNeutral = true;
    this.steerF.reset();
    this.throttleF.reset();
    return true;
  }

  update(pair: HandPair, dt: number): void {
    const out = this.out;
    const t = this.tuning;
    const { fly, jump } = this.roles(pair);
    this.raw.fly = !!fly;
    this.raw.jumpHand = !!jump;
    this.raw.flyOpen = fly?.open ?? 1;
    this.raw.jumpOpen = jump?.open ?? 1;

    if (!fly && !jump) {
      this.lostFor += dt;
      const k = Math.max(0, 1 - this.lostFor / DECAY);
      out.steer *= k;
      out.throttle *= k;
      this.releaseFist(dt);
      out.jump = this.fist;
      if (this.seen && this.lostFor >= LOST_AFTER) this.status = 'lost';
      return;
    }

    this.lostFor = 0;
    this.seen = true;
    this.status = 'tracking';
    // The first hands seen become neutral, so play can start without an explicit calibration step.
    if (!this.hasNeutral) this.recentre(pair);

    if (fly) {
      const steer = this.steerF.filter((fly.x - this.neutral.fly.x) / t.steerRange, dt);
      this.raw.steer = steer;
      out.steer = shapeAxis(Math.max(-1, Math.min(1, steer)), t.steerDeadzone);
      if (t.mode === 'joystick') {
        const push = this.throttleF.filter((fly.y - this.neutral.fly.y) / t.throttleRange, dt);
        this.raw.throttle = push;
        out.throttle = shapeAxis(Math.max(-1, Math.min(1, push)), t.throttleDeadzone);
      }
    } else {
      const k = Math.max(0, 1 - dt / DECAY);
      out.steer *= k;
      if (t.mode === 'joystick') out.throttle *= k;
    }

    if (t.mode === 'split') {
      if (jump) {
        const push = this.throttleF.filter((jump.y - this.neutral.throttle.y) / t.throttleRange, dt);
        this.raw.throttle = push;
        out.throttle = shapeAxis(Math.max(-1, Math.min(1, push)), t.throttleDeadzone);
      } else {
        out.throttle *= Math.max(0, 1 - dt / DECAY);
      }
    }

    if (jump) {
      this.fistMissing = 0;
      // Hysteresis: close on a firm fist, release only once the hand is clearly open again.
      if (this.fist ? jump.open > t.fistThreshold + FIST_HYSTERESIS : jump.open < t.fistThreshold) {
        this.fist = !this.fist;
      }
    } else {
      this.releaseFist(dt);
    }
    // The simulation edge-triggers on jump, so a held fist is exactly one jump. Holding it
    // through a dropped detection frame is what stops one fist reading as two.
    out.jump = this.fist;
  }

  private releaseFist(dt: number): void {
    if (!this.fist) return;
    this.fistMissing += dt;
    if (this.fistMissing >= FIST_GRACE) {
      this.fist = false;
      this.fistMissing = 0;
    }
  }
}

function usable(h: HandReading | null): HandReading | null {
  return h && h.scale >= MIN_HAND_SCALE ? h : null;
}
