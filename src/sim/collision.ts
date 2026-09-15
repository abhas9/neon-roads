import {
  FLOOR_T,
  FULL_H,
  HALF_H,
  LANES,
  LANE_W,
  ROW_D,
  SHIP_HD,
  SHIP_HW,
  TUNNEL_RIN,
  TUNNEL_ROUT,
} from './constants';
import { Block, cellBlock, cellBlockTile, cellFloor, cellFloorTile, cellTunnel, RoadSource, Tile } from './types';
import type { CellCode } from './types';

const HALF_LANES = LANES / 2;

export function laneOf(x: number): number {
  return Math.floor(x / LANE_W + HALF_LANES);
}

export function laneCenter(col: number): number {
  return (col - HALF_LANES + 0.5) * LANE_W;
}

export function rowOf(z: number): number {
  return Math.floor(z / ROW_D);
}

export function blockHeight(b: Block): number {
  return b === Block.Full ? FULL_H : b === Block.Half ? HALF_H : 0;
}

/**
 * Solid vertical spans of a cell at lateral offset dx from the lane centre.
 * Writes [lo, hi, tile] triples into `out`, returns the span count (max 2).
 */
export function cellSpans(code: CellCode, dx: number, out: Float64Array): number {
  if (code === 0) return 0;
  const floor = cellFloor(code);
  const block = cellBlock(code);
  const base = floor ? -FLOOR_T : 0;
  const floorTile = cellFloorTile(code);
  const topTile = block !== Block.None ? cellBlockTile(code) : floorTile;
  const h = blockHeight(block);

  if (!cellTunnel(code)) {
    if (block !== Block.None) {
      out[0] = base; out[1] = h; out[2] = topTile;
      return 1;
    }
    if (!floor) return 0;
    out[0] = -FLOOR_T; out[1] = 0; out[2] = floorTile;
    return 1;
  }

  const adx = Math.abs(dx);
  const roofTop = block !== Block.None ? h : Math.sqrt(Math.max(0, TUNNEL_ROUT * TUNNEL_ROUT - adx * adx));
  if (adx < TUNNEL_RIN) {
    const inner = Math.sqrt(TUNNEL_RIN * TUNNEL_RIN - adx * adx);
    let n = 0;
    if (floor) {
      out[0] = -FLOOR_T; out[1] = 0; out[2] = floorTile;
      n = 1;
    }
    out[n * 3] = inner; out[n * 3 + 1] = roofTop; out[n * 3 + 2] = topTile;
    return n + 1;
  }
  out[0] = base; out[1] = roofTop; out[2] = topTile;
  return 1;
}

const spans = new Float64Array(6);
const seenKeys = new Int32Array(15);
let seenCount = 0;

/** Non-tunnel cells have the same spans at every lateral offset, so each is evaluated once per query. */
function seen(code: CellCode, key: number): boolean {
  if (cellTunnel(code)) return false;
  for (let i = 0; i < seenCount; i++) if (seenKeys[i] === key) return true;
  seenKeys[seenCount++] = key;
  return false;
}
const SAMPLE_X = [-1, -0.5, 0, 0.5, 1];
const SAMPLE_Z = [-1, 0, 1];

export interface ProbeResult {
  hit: boolean;
  /** Highest top among intersecting spans. */
  top: number;
  /** Lowest bottom among intersecting spans. */
  bottom: number;
}

/**
 * Tests the ship box (lateral centre x, forward centre z) spanning [yLo, yHi]
 * against the road's solids.
 */
export function probe(road: RoadSource, x: number, z: number, yLo: number, yHi: number, out: ProbeResult): ProbeResult {
  out.hit = false;
  out.top = -Infinity;
  out.bottom = Infinity;
  seenCount = 0;
  const len = road.length;
  for (let zi = 0; zi < 3; zi++) {
    const sz = z + SAMPLE_Z[zi] * SHIP_HD;
    const row = rowOf(sz);
    if (row < 0 || row >= len) continue;
    for (let xi = 0; xi < 5; xi++) {
      const sx = x + SAMPLE_X[xi] * SHIP_HW;
      const col = laneOf(sx);
      if (col < 0 || col >= LANES) continue;
      const code = road.cell(col, row);
      if (code === 0 || seen(code, row * 8 + col)) continue;
      const n = cellSpans(code, sx - laneCenter(col), spans);
      for (let i = 0; i < n; i++) {
        const lo = spans[i * 3];
        const hi = spans[i * 3 + 1];
        if (hi > yLo + 1e-6 && lo < yHi) {
          out.hit = true;
          if (hi > out.top) out.top = hi;
          if (lo < out.bottom) out.bottom = lo;
        }
      }
    }
  }
  return out;
}

export interface Support {
  found: boolean;
  height: number;
  tile: Tile;
}

/**
 * Highest surface at or below `y` under the ship footprint. Centre samples win
 * ties so the tile under the middle of the hull decides tile effects.
 */
export function supportBelow(road: RoadSource, x: number, z: number, y: number, maxDrop: number, out: Support): Support {
  out.found = false;
  out.height = -Infinity;
  out.tile = Tile.Normal;
  let centreFound = false;
  const len = road.length;
  for (let zi = 0; zi < 3; zi++) {
    const sz = z + SAMPLE_Z[zi] * SHIP_HD;
    const row = rowOf(sz);
    if (row < 0 || row >= len) continue;
    for (let xi = 0; xi < 5; xi++) {
      const sx = x + SAMPLE_X[xi] * SHIP_HW;
      const col = laneOf(sx);
      if (col < 0 || col >= LANES) continue;
      const code = road.cell(col, row);
      if (code === 0) continue;
      const n = cellSpans(code, sx - laneCenter(col), spans);
      for (let i = 0; i < n; i++) {
        const hi = spans[i * 3 + 1];
        if (hi > y + 1e-4 || hi < y - maxDrop) continue;
        const isCentre = xi === 2 && zi === 1;
        if (hi > out.height + 1e-6 || (isCentre && !centreFound && hi >= out.height - 1e-6)) {
          out.found = true;
          out.height = hi;
          out.tile = spans[i * 3 + 2] as Tile;
          if (isCentre) centreFound = true;
        }
      }
    }
  }
  return out;
}
