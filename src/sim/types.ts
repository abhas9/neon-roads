export enum Tile {
  Normal = 0,
  Normal2 = 1,
  Normal3 = 2,
  Burning = 3,
  Supply = 4,
  Boost = 5,
  Sticky = 6,
  Slippery = 7,
}

export enum Block {
  None = 0,
  Half = 1,
  Full = 2,
}

/**
 * One grid cell. Encoded as a small integer so roads stay compact:
 * bit0: has floor, bits1-4: floor tile, bits5-6: block, bit7: tunnel,
 * bits8-11: block top tile, bit12: alt block colour.
 */
export type CellCode = number;

export interface Cell {
  floor: boolean;
  floorTile: Tile;
  block: Block;
  blockTile: Tile;
  tunnel: boolean;
  altBlock: boolean;
}

export function encodeCell(c: Cell): CellCode {
  return (
    (c.floor ? 1 : 0) |
    (c.floorTile << 1) |
    (c.block << 5) |
    (c.tunnel ? 128 : 0) |
    (c.blockTile << 8) |
    (c.altBlock ? 4096 : 0)
  );
}

export const cellFloor = (c: CellCode) => (c & 1) === 1;
export const cellFloorTile = (c: CellCode): Tile => (c >> 1) & 15;
export const cellBlock = (c: CellCode): Block => (c >> 5) & 3;
export const cellTunnel = (c: CellCode) => (c & 128) === 128;
export const cellBlockTile = (c: CellCode): Tile => (c >> 8) & 15;
export const cellAltBlock = (c: CellCode) => (c & 4096) === 4096;
export const cellEmpty = (c: CellCode) => c === 0;

export interface RoadMeta {
  id: string;
  name: string;
  /** Gravity gauge, 100 (floaty) .. 1700 (crushing). */
  gravity: number;
  /** Seconds of oxygen. */
  oxygen: number;
  /** Units of distance the fuel lasts. */
  fuel: number;
}

/** Source of cells; endless mode supplies rows lazily. */
export interface RoadSource extends RoadMeta {
  /** Number of rows, or Infinity for endless roads. */
  readonly length: number;
  cell(col: number, row: number): CellCode;
  /** Gravity may change along endless roads. */
  gravityAt?(row: number): number;
}

export class Road implements RoadSource {
  id: string;
  name: string;
  gravity: number;
  oxygen: number;
  fuel: number;
  readonly cells: Uint16Array;
  readonly length: number;

  constructor(meta: RoadMeta, cells: Uint16Array) {
    this.id = meta.id;
    this.name = meta.name;
    this.gravity = meta.gravity;
    this.oxygen = meta.oxygen;
    this.fuel = meta.fuel;
    this.cells = cells;
    this.length = cells.length / 7;
  }

  cell(col: number, row: number): CellCode {
    if (col < 0 || col > 6 || row < 0 || row >= this.length) return 0;
    return this.cells[row * 7 + col];
  }
}

export interface InputFrame {
  /** -1 (left) .. 1 (right) */
  steer: number;
  /** -1 (brake) .. 1 (accelerate) */
  throttle: number;
  jump: boolean;
}

export const NO_INPUT: InputFrame = { steer: 0, throttle: 0, jump: false };
