/**
 * Landmark geometry for the hand controller. Pure functions over a 21-point hand skeleton, so
 * every gesture can be unit-tested against synthetic skeletons with no camera and no ML runtime.
 *
 * Input landmarks use MediaPipe's convention: x and y normalised to image width and height,
 * origin top-left, in the *unmirrored* camera image.
 */

/** MediaPipe hand landmark indices used here. */
export const WRIST = 0;
const FINGERS = [
  { mcp: 5, pip: 6, tip: 8 }, // index
  { mcp: 9, pip: 10, tip: 12 }, // middle
  { mcp: 13, pip: 14, tip: 16 }, // ring
  { mcp: 17, pip: 18, tip: 20 }, // pinky
] as const;
const MIDDLE_MCP = 9;
const PALM = [0, 5, 9, 13, 17] as const;

export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

/** One hand as reported by the detector. */
export interface HandObservation {
  landmarks: Landmark[];
  /** Detector's own left/right guess. Only used to disambiguate a single visible hand. */
  label?: 'Left' | 'Right';
}

/** A hand reduced to what the game actually needs. */
export interface HandReading {
  /**
   * Palm centre in centred, height-normalised coordinates, mirrored so the player sees
   * themselves as in a mirror: x right, y up, both divided by height to preserve aspect.
   */
  x: number;
  y: number;
  /** 0 = tight fist, 1 = flat open hand. */
  open: number;
  /** Hand size in the same units, used to reject a hand that is too far away to read. */
  scale: number;
}

const dist = (a: Landmark, b: Landmark, aspect: number) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

/** Hand size: wrist to the middle knuckle. Every other measure is divided by this. */
export function handScale(lm: Landmark[], aspect = 1): number {
  return dist(lm[WRIST], lm[MIDDLE_MCP], aspect);
}

/**
 * How far a finger reaches past its own middle joint, in hand-widths.
 *
 * Measuring from the wrist rather than summing joint angles makes this invariant to hand
 * rotation and to distance from the camera, and it degrades gracefully: a noisy landmark moves
 * the number a little instead of flipping a decision.
 */
export function fingerExtension(lm: Landmark[], i: number, aspect = 1): number {
  const scale = handScale(lm, aspect);
  if (scale <= 0) return 0;
  const f = FINGERS[i];
  return (dist(lm[f.tip], lm[WRIST], aspect) - dist(lm[f.pip], lm[WRIST], aspect)) / scale;
}

/** Extension mapped to 0..1. The window is wide and the response linear, so the fist threshold stays tunable. */
const EXT_MIN = -0.35;
const EXT_SPAN = 0.8;

/** 0 = tight fist, 1 = flat open hand. The thumb is excluded: its geometry is different and noisy. */
export function openness(lm: Landmark[], aspect = 1): number {
  let sum = 0;
  for (let i = 0; i < FINGERS.length; i++) {
    sum += Math.max(0, Math.min(1, (fingerExtension(lm, i, aspect) - EXT_MIN) / EXT_SPAN));
  }
  return sum / FINGERS.length;
}

/**
 * Palm centre, averaged over the wrist and the four knuckles.
 *
 * Deliberately not the wrist and not the fingertips: the knuckles barely move when the fingers
 * curl, so making a fist does not drag the steering position with it.
 */
export function palmCentre(lm: Landmark[]): Landmark {
  let x = 0;
  let y = 0;
  for (const i of PALM) {
    x += lm[i].x;
    y += lm[i].y;
  }
  return { x: x / PALM.length, y: y / PALM.length };
}

/** Reduces one observation to a reading, mirroring x so the player sees a mirror image. */
export function readHand(o: HandObservation, aspect = 1): HandReading | null {
  const lm = o.landmarks;
  if (!lm || lm.length < 21) return null;
  const c = palmCentre(lm);
  return {
    x: (0.5 - c.x) * aspect,
    y: 0.5 - c.y,
    open: openness(lm, aspect),
    scale: handScale(lm, aspect),
  };
}

export interface HandPair {
  left: HandReading | null;
  right: HandReading | null;
}

/**
 * Splits observations into the player's left and right hands.
 *
 * With two hands visible this goes purely on mirrored screen position, which needs no trust in
 * the detector's handedness convention (it assumes a selfie-flipped image, and getting that
 * backwards silently swaps every control). The label is only consulted for a lone hand, and the
 * label-to-side mapping is learned from frames where both hands were visible, so even that path
 * self-corrects after the player has shown both hands once.
 */
export class HandAssigner {
  /** Detector label observed on the player's right hand, once both hands have been seen. */
  private rightLabel: 'Left' | 'Right' | null = null;

  reset(): void {
    this.rightLabel = null;
  }

  assign(observations: HandObservation[], aspect = 1): HandPair {
    const readings = observations
      .map((o) => ({ o, r: readHand(o, aspect) }))
      .filter((e): e is { o: HandObservation; r: HandReading } => e.r !== null);
    if (readings.length === 0) return { left: null, right: null };

    if (readings.length >= 2) {
      const sorted = [...readings].sort((a, b) => a.r.x - b.r.x);
      const left = sorted[0];
      const right = sorted[sorted.length - 1];
      if (right.o.label) this.rightLabel = right.o.label;
      return { left: left.r, right: right.r };
    }

    const only = readings[0];
    if (this.rightLabel && only.o.label) {
      return only.o.label === this.rightLabel ? { left: null, right: only.r } : { left: only.r, right: null };
    }
    // MediaPipe labels handedness as if the image were selfie-flipped; it is not flipped here,
    // so its "Left" is the player's right hand.
    if (only.o.label) return only.o.label === 'Left' ? { left: null, right: only.r } : { left: only.r, right: null };
    // No label at all: fall back to which side of centre the hand is on.
    return only.r.x >= 0 ? { left: null, right: only.r } : { left: only.r, right: null };
  }
}
