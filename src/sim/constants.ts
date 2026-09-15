/** Simulation tuning. All distances are in world units (1 lane = 1 unit). */
export const SIM_HZ = 120;
export const DT = 1 / SIM_HZ;

export const LANES = 7;
export const LANE_W = 1;
export const ROW_D = 1;

export const FLOOR_T = 0.25;
export const HALF_H = 0.5;
export const FULL_H = 1.0;
/** Tunnel arch radii, centred on the lane at floor level. */
export const TUNNEL_RIN = 0.45;
export const TUNNEL_ROUT = 0.5;

/** Ship bounding box (y is the bottom of the hull). */
export const SHIP_HW = 0.2;
export const SHIP_H = 0.2;
export const SHIP_HD = 0.3;

export const V_MAX = 21;
export const ACCEL = 9;
export const BRAKE = 18;
export const STRAFE_V = 4.6;
export const STRAFE_RESPONSE = 22;
export const AIR_STRAFE_RESPONSE = 14;

export const BOOST_ACCEL = 40;
/** Boost pads push past V_MAX; the overdrive bleeds off once off the pad. */
export const V_BOOST = 27;
export const OVERDRIVE_DECAY = 4;
/** Sticky tar is viscous drag (per second), so a throttling ship still crawls forward. */
export const STICKY_DRAG = 2.4;
/** Frontal impacts above this forward speed destroy the ship. */
export const CRASH_V = 4.5;
/** Ledges up to this height are climbed instead of blocking. */
export const STEP_UP = 0.07;

/** Gravity gauge value 500 ("standard") maps to this acceleration. */
export const G_STANDARD = 36;
export const JUMP_V = 10.4;
export const COYOTE_TIME = 0.07;
export const JUMP_BUFFER = 0.12;

export const KILL_Y = -5;
export const FALL_DEATH_DELAY = 0.5;

export const FUEL_PER_UNIT = 1;
export const OUT_OF_FUEL_DRAG = 6;

export function gravityAccel(gauge: number): number {
  return (G_STANDARD * gauge) / 500;
}
