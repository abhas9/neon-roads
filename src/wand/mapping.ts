/** Turns tracked discs into a game InputFrame. Pure and stateful-but-DOM-free, so it unit-tests. */
import type { InputFrame } from '../sim/types';
import type { Blob } from './tracker';
import { FlickDetector, OneEuro, shapeAxis, wrapPi } from '../core/filter';

export interface WandPose {
  /** Angle of the A->B vector, radians, 0 = level with B to the right. */
  angle: number;
  /** Distance between the discs; shrinks as the wand moves away from the camera. */
  sep: number;
  /** Midpoint in centred, height-normalised coordinates. */
  x: number;
  y: number;
}

export interface WandNeutral {
  angle: number;
  sep: number;
}

export interface WandTuning {
  /** Tilt, in radians, that produces full steering. */
  steerRange: number;
  /** Fractional change in disc separation that produces full throttle. */
  throttleRange: number;
  steerDeadzone: number;
  throttleDeadzone: number;
  /** Upward speed, in height-normalised units per second, that fires a jump. */
  flick: number;
  invertSteer: boolean;
}

export const DEFAULT_TUNING: WandTuning = {
  steerRange: (40 * Math.PI) / 180,
  throttleRange: 0.22,
  steerDeadzone: 0.1,
  throttleDeadzone: 0.15,
  flick: 1.8,
  invertSteer: false,
};

/** Jump is held briefly so the simulation's 0.12s jump buffer always catches it. */
const JUMP_HOLD = 0.1;
/** A flick drags the discs apart slightly; ignore throttle for a moment so jumps do not lurch. */
const THROTTLE_FREEZE = 0.2;
/** Controls fade out over this long when the wand disappears, instead of sticking. */
const DECAY = 0.2;
/** Tracking lost for this long pauses the run rather than flying the ship into a wall. */
export const LOST_AFTER = 0.5;

export type WandStatus = 'searching' | 'tracking' | 'lost';

export function poseFrom(a: Blob, b: Blob): WandPose {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { angle: Math.atan2(dy, dx), sep: Math.hypot(dx, dy), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function neutralFrom(pose: WandPose): WandNeutral {
  return { angle: pose.angle, sep: pose.sep };
}

export class WandMapper {
  readonly out: InputFrame = { steer: 0, throttle: 0, jump: false };
  status: WandStatus = 'searching';
  lostFor = 0;
  /** Raw axis values before deadzone and curve, for the tuning readout. */
  readonly raw = { tilt: 0, push: 0, flick: 0 };
  neutral: WandNeutral = { angle: 0, sep: 0.35 };
  tuning: WandTuning = { ...DEFAULT_TUNING };

  // Angle and separation are filtered, never the flick velocity: smoothing the jump signal
  // would trade away the responsiveness this control scheme can least afford.
  private angleF = new OneEuro(4, 1.5);
  private sepF = new OneEuro(2.5, 0.8);
  private flickD = new FlickDetector({ threshold: DEFAULT_TUNING.flick, refractory: 0.25 });
  private jumpHold = 0;
  private freeze = 0;
  private seen = false;

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
    this.jumpHold = 0;
    this.freeze = 0;
    this.angleF.reset();
    this.sepF.reset();
    this.flickD.reset();
  }

  setTuning(t: Partial<WandTuning>): void {
    this.tuning = { ...this.tuning, ...t };
    this.flickD.setThreshold(this.tuning.flick);
  }

  /** Makes the wand's current pose the new neutral. */
  recentre(pose: WandPose): void {
    this.neutral = neutralFrom(pose);
    this.angleF.reset();
    this.sepF.reset();
  }

  update(pose: WandPose | null, dt: number): void {
    const out = this.out;
    if (this.jumpHold > 0) this.jumpHold = Math.max(0, this.jumpHold - dt);
    if (this.freeze > 0) this.freeze = Math.max(0, this.freeze - dt);

    if (!pose) {
      this.lostFor += dt;
      const k = Math.max(0, 1 - this.lostFor / DECAY);
      out.steer *= k;
      out.throttle *= k;
      out.jump = false;
      this.flickD.reset();
      if (this.seen && this.lostFor >= LOST_AFTER) this.status = 'lost';
      return;
    }

    this.lostFor = 0;
    this.seen = true;
    this.status = 'tracking';
    if (this.neutral.sep <= 0) this.neutral = neutralFrom(pose);

    const tilt = this.angleF.filter(wrapPi(pose.angle - this.neutral.angle), dt);
    const push = this.sepF.filter(pose.sep / this.neutral.sep - 1, dt);
    const flicked = this.flickD.push(pose.y, dt);
    this.raw.tilt = tilt;
    this.raw.push = push;
    this.raw.flick = this.flickD.velocity;

    const t = this.tuning;
    // Tilting the wand clockwise -- steering-wheel right -- drops the right-hand disc, which in a
    // y-up frame makes the A->B angle negative. Negate so a right tilt steers right.
    const steer = shapeAxis(Math.max(-1, Math.min(1, -tilt / t.steerRange)), t.steerDeadzone);
    out.steer = t.invertSteer ? -steer : steer;

    if (flicked) {
      this.jumpHold = JUMP_HOLD;
      this.freeze = THROTTLE_FREEZE;
    }
    if (this.freeze <= 0) {
      out.throttle = shapeAxis(Math.max(-1, Math.min(1, push / t.throttleRange)), t.throttleDeadzone);
    }
    out.jump = this.jumpHold > 0;
  }
}
