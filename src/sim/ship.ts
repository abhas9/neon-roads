import {
  ACCEL,
  AIR_STRAFE_RESPONSE,
  BOOST_ACCEL,
  BRAKE,
  COYOTE_TIME,
  CRASH_V,
  DT,
  FUEL_PER_UNIT,
  gravityAccel,
  JUMP_BUFFER,
  JUMP_V,
  KILL_Y,
  OUT_OF_FUEL_DRAG,
  ROW_D,
  SHIP_H,
  SHIP_HD,
  STEP_UP,
  STICKY_DRAG,
  STRAFE_RESPONSE,
  STRAFE_V,
  V_BOOST,
  V_MAX,
  OVERDRIVE_DECAY,
} from './constants';
import { probe, rowOf, supportBelow } from './collision';
import type { ProbeResult, Support } from './collision';
import { Tile } from './types';
import type { InputFrame, RoadSource } from './types';

export type Phase = 'alive' | 'dead' | 'finished';
export type DeathCause = 'crash' | 'burn' | 'fall' | 'oxygen' | 'fuel';

/** Discrete events emitted during a step, for audio/FX. */
export const enum Ev {
  Jump = 1,
  Land = 2,
  Boost = 4,
  Supply = 8,
  Bump = 16,
  Death = 32,
  Finish = 64,
  Assist = 128,
  Sticky = 256,
}

export interface SimOptions {
  jumpAssist: boolean;
}

export class ShipState {
  x = 0;
  y = 0;
  z = 0.5;
  vx = 0;
  vy = 0;
  vz = 0;
  grounded = true;
  groundTile: Tile = Tile.Normal;
  oxygen = 0;
  fuel = 0;
  maxOxygen = 0;
  maxFuel = 0;
  time = 0;
  steps = 0;
  phase: Phase = 'alive';
  cause: DeathCause | null = null;
  phaseTime = 0;
  coyote = 0;
  jumpBuffer = 0;
  prevJump = false;
  /** Seconds since the last jump assist fired (for the HUD). */
  assistAge = 99;
  /** Downward speed at the last landing (for camera/FX). */
  lastLandSpeed = 0;
  events = 0;
  gravity = 500;

  reset(road: RoadSource, startLane = 3): void {
    this.x = startLane - 3;
    this.y = 0;
    this.z = SHIP_HD + 0.2;
    this.vx = this.vy = this.vz = 0;
    this.grounded = true;
    this.groundTile = Tile.Normal;
    this.oxygen = this.maxOxygen = road.oxygen;
    this.fuel = this.maxFuel = road.fuel;
    this.time = 0;
    this.steps = 0;
    this.phase = 'alive';
    this.cause = null;
    this.phaseTime = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.prevJump = false;
    this.assistAge = 99;
    this.lastLandSpeed = 0;
    this.events = 0;
    this.gravity = road.gravity;
  }

  copyFrom(o: ShipState): this {
    this.x = o.x; this.y = o.y; this.z = o.z;
    this.vx = o.vx; this.vy = o.vy; this.vz = o.vz;
    this.grounded = o.grounded; this.groundTile = o.groundTile;
    this.oxygen = o.oxygen; this.fuel = o.fuel;
    this.maxOxygen = o.maxOxygen; this.maxFuel = o.maxFuel;
    this.time = o.time; this.steps = o.steps;
    this.phase = o.phase; this.cause = o.cause; this.phaseTime = o.phaseTime;
    this.coyote = o.coyote; this.jumpBuffer = o.jumpBuffer; this.prevJump = o.prevJump;
    this.assistAge = o.assistAge; this.lastLandSpeed = o.lastLandSpeed;
    this.events = o.events; this.gravity = o.gravity;
    return this;
  }
}

const pr: ProbeResult = { hit: false, top: 0, bottom: 0 };
const sup: Support = { found: false, height: 0, tile: Tile.Normal };

function die(s: ShipState, cause: DeathCause): void {
  s.phase = 'dead';
  s.cause = cause;
  s.phaseTime = 0;
  s.events |= Ev.Death;
}

/** Tries to move horizontally to (nx, nz); climbs tiny ledges. Returns whether the move was blocked. */
function tryMove(road: RoadSource, s: ShipState, nx: number, nz: number): boolean {
  probe(road, nx, nz, s.y, s.y + SHIP_H, pr);
  if (!pr.hit) {
    s.x = nx; s.z = nz;
    return false;
  }
  if (pr.top <= s.y + STEP_UP) {
    const ny = pr.top;
    probe(road, nx, nz, ny, ny + SHIP_H, pr);
    if (!pr.hit) {
      s.x = nx; s.z = nz; s.y = ny;
      return false;
    }
  }
  return true;
}

export function stepShip(road: RoadSource, s: ShipState, input: InputFrame, opts: SimOptions): void {
  s.events = 0;
  s.steps++;
  s.phaseTime += DT;

  if (s.phase === 'dead') return;
  if (s.phase === 'finished') {
    // Victory fly-out: keep cruising and lift off, no collisions.
    s.vz = Math.min(V_MAX * 1.2, s.vz + ACCEL * DT);
    s.vy = Math.min(4, s.vy + 12 * DT);
    s.x += s.vx * DT; s.y += s.vy * DT; s.z += s.vz * DT;
    s.vx *= 0.95;
    return;
  }

  s.time += DT;
  const row = rowOf(s.z);
  s.gravity = road.gravityAt ? road.gravityAt(row) : road.gravity;
  const g = gravityAccel(s.gravity);

  s.oxygen -= DT;
  if (s.oxygen <= 0) {
    s.oxygen = 0;
    die(s, 'oxygen');
    return;
  }

  const onTile = s.grounded ? s.groundTile : -1;

  // Forward speed.
  const before = s.vz;
  if (s.fuel > 0) {
    if (input.throttle > 0) s.vz += ACCEL * input.throttle * DT;
    else if (input.throttle < 0) s.vz += BRAKE * input.throttle * DT;
  } else {
    s.vz -= OUT_OF_FUEL_DRAG * DT;
  }
  let cap = V_MAX;
  if (onTile === Tile.Boost) {
    s.vz += BOOST_ACCEL * DT;
    cap = V_BOOST;
  } else {
    if (onTile === Tile.Sticky) s.vz -= s.vz * STICKY_DRAG * DT;
    if (before > V_MAX) cap = Math.max(V_MAX, before - OVERDRIVE_DECAY * DT);
  }
  s.vz = Math.min(cap, Math.max(0, s.vz));

  if (s.fuel <= 0 && s.vz <= 0 && s.grounded) {
    die(s, 'fuel');
    return;
  }

  // Lateral speed. Slippery ground locks the current drift.
  if (onTile !== Tile.Slippery) {
    const target = input.steer * STRAFE_V;
    const k = Math.min(1, (s.grounded ? STRAFE_RESPONSE : AIR_STRAFE_RESPONSE) * DT);
    s.vx += (target - s.vx) * k;
  }

  // Jumping with coyote time and input buffering.
  if (input.jump && !s.prevJump) s.jumpBuffer = JUMP_BUFFER;
  s.prevJump = input.jump;
  s.coyote = s.grounded ? COYOTE_TIME : s.coyote - DT;
  if (s.jumpBuffer > 0) s.jumpBuffer -= DT;
  s.assistAge += DT;

  let jumped = false;
  if (s.jumpBuffer > 0 && s.coyote > 0) {
    jumped = true;
  } else if (opts.jumpAssist && s.grounded && s.vz > 1) {
    // Fire just before the hull's centre would leave the edge.
    const ahead = s.z + s.vz * DT * 3;
    supportBelow(road, s.x, ahead + SHIP_HD, s.y + 0.01, 0.35, sup);
    const front = sup.found;
    supportBelow(road, s.x, ahead, s.y + 0.01, 0.35, sup);
    if (!front && !sup.found) {
      jumped = true;
      s.assistAge = 0;
      s.events |= Ev.Assist;
    }
  }
  if (jumped) {
    s.vy = JUMP_V;
    s.jumpBuffer = 0;
    s.coyote = 0;
    s.grounded = false;
    s.events |= Ev.Jump;
  }

  s.vy -= g * DT;

  // Forward, then lateral, then vertical resolution.
  const nz = s.z + s.vz * DT;
  if (tryMove(road, s, s.x, nz)) {
    if (s.vz > CRASH_V) {
      die(s, 'crash');
      return;
    }
    if (s.vz > 0.5) s.events |= Ev.Bump;
    s.vz = 0;
  }
  if (s.vx !== 0 && tryMove(road, s, s.x + s.vx * DT, s.z)) s.vx = 0;

  const ny = s.y + s.vy * DT;
  const wasGrounded = s.grounded;
  if (s.vy <= 0) {
    probe(road, s.x, s.z, ny, s.y + SHIP_H, pr);
    if (pr.hit) {
      if (!wasGrounded) {
        s.lastLandSpeed = -s.vy;
        if (-s.vy > 2) s.events |= Ev.Land;
      }
      s.y = pr.top;
      s.vy = 0;
      s.grounded = true;
    } else {
      s.y = ny;
      s.grounded = false;
    }
  } else {
    probe(road, s.x, s.z, s.y, ny + SHIP_H, pr);
    if (pr.hit && pr.bottom > s.y + SHIP_H - 1e-6) {
      s.y = pr.bottom - SHIP_H;
      s.vy = 0;
    } else {
      s.y = ny;
    }
    s.grounded = false;
  }

  if (s.grounded) {
    supportBelow(road, s.x, s.z, s.y + 0.001, 0.01, sup);
    const prev = wasGrounded ? s.groundTile : -1;
    s.groundTile = sup.found ? sup.tile : Tile.Normal;
    if (s.groundTile === Tile.Burning) {
      die(s, 'burn');
      return;
    }
    if (s.groundTile === Tile.Supply) {
      if (s.oxygen < s.maxOxygen - 0.05 || s.fuel < s.maxFuel - 0.05) s.events |= Ev.Supply;
      s.oxygen = s.maxOxygen;
      s.fuel = s.maxFuel;
    } else if (s.groundTile === Tile.Boost && prev !== Tile.Boost) {
      s.events |= Ev.Boost;
    } else if (s.groundTile === Tile.Sticky && prev !== Tile.Sticky) {
      s.events |= Ev.Sticky;
    }
  }

  if (s.fuel > 0) {
    s.fuel = Math.max(0, s.fuel - s.vz * DT * FUEL_PER_UNIT);
  }

  if (s.y < KILL_Y) {
    die(s, 'fall');
    return;
  }

  if (s.z >= road.length * ROW_D) {
    s.phase = 'finished';
    s.phaseTime = 0;
    s.events |= Ev.Finish;
  }
}
