import { gravityAccel, JUMP_V } from '../sim/constants';
import type { CellCode, RoadSource } from '../sim/types';
import { CODES } from './format';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const GRAVITIES = [500, 400, 600, 300, 800, 1000, 200, 1200];

/** Infinite road generated in segments. Every segment starts and ends on full-width floor so any lane is safe to enter. */
export class EndlessRoad implements RoadSource {
  id: string;
  name: string;
  gravity = 500;
  oxygen = 45;
  fuel = 1100;
  readonly length = Infinity;
  private cells = new Uint16Array(7 * 4096);
  private rows = 0;
  private rng: () => number;
  private sectorStarts: number[] = [0];
  private sectorGravity: number[] = [500];
  private nextSector = 700;
  private nextSupply = 180;
  private shade = 0;

  constructor(readonly seed: number, name: string) {
    this.id = `endless-${seed}`;
    this.name = name;
    this.rng = mulberry32(seed);
    this.emitRows('=======', 64);
  }

  cell(col: number, row: number): CellCode {
    if (col < 0 || col > 6 || row < 0) return 0;
    while (row >= this.rows) this.generate();
    return this.cells[row * 7 + col];
  }

  gravityAt(row: number): number {
    let lo = 0;
    let hi = this.sectorStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.sectorStarts[mid] <= row) lo = mid;
      else hi = mid - 1;
    }
    return this.sectorGravity[lo];
  }

  private push(line: string): void {
    if (this.rows * 7 + 7 > this.cells.length) {
      const next = new Uint16Array(this.cells.length * 2);
      next.set(this.cells);
      this.cells = next;
    }
    for (let c = 0; c < 7; c++) this.cells[this.rows * 7 + c] = CODES[line[c]] ?? 0;
    this.rows++;
  }

  private emitRows(line: string, n: number): void {
    for (let i = 0; i < n; i++) this.push(line);
  }

  private floorRow(): string {
    this.shade++;
    return this.shade % 12 < 6 ? '=======' : '-------';
  }

  private straight(n: number): void {
    for (let i = 0; i < n; i++) this.push(this.floorRow());
  }

  private int(a: number, b: number): number {
    return a + Math.floor(this.rng() * (b - a + 1));
  }

  private pick<T>(arr: T[]): T {
    return arr[Math.floor(this.rng() * arr.length)];
  }

  private get difficulty(): number {
    return Math.min(1, this.rows / 6000);
  }

  private get g(): number {
    return this.sectorGravity[this.sectorGravity.length - 1];
  }

  /** Longest gap (rows) that is comfortable at moderate speed under the current gravity. */
  private maxGap(speed = 13): number {
    const air = (2 * JUMP_V) / gravityAccel(this.g);
    return Math.max(1, Math.floor(air * speed * 0.65));
  }

  private apex(): number {
    return (JUMP_V * JUMP_V) / (2 * gravityAccel(this.g));
  }

  private line(fill: string, overrides: Record<number, string>): string {
    const a = fill.split('');
    for (const [k, v] of Object.entries(overrides)) {
      const i = Number(k);
      if (i >= 0 && i < 7) a[i] = v;
    }
    return a.join('');
  }

  private generate(): void {
    const d = this.difficulty;
    if (this.rows >= this.nextSector) {
      const choices = GRAVITIES.slice(0, 3 + Math.floor(d * (GRAVITIES.length - 3)));
      let g = this.pick(choices);
      if (g === this.g) g = 500;
      this.straight(20);
      this.sectorStarts.push(this.rows);
      this.sectorGravity.push(g);
      this.straight(24);
      this.nextSector = this.rows + this.int(650, 900);
    }
    if (this.rows >= this.nextSupply) {
      this.straight(8);
      const lane = this.int(1, 5);
      this.emitRows(this.line('=======', { [lane - 1]: 's', [lane]: 's', [lane + 1]: 's' }), 3);
      this.straight(8);
      this.nextSupply = this.rows + this.int(230, 320) + Math.floor(d * 60);
    }

    const canHalf = this.apex() > 0.8;
    const canFull = this.apex() > 1.3;
    const pool: (() => void)[] = [
      () => this.gap(),
      () => this.narrow(),
      () => this.wall(canFull),
      () => this.fire(),
      () => this.islands(),
      () => this.boostGap(),
      () => this.tunnel(),
      () => this.ice(),
      () => this.tar(),
    ];
    if (canHalf) pool.push(() => this.hurdles(), () => this.hurdles());
    if (canFull && this.difficulty > 0.15) pool.push(() => this.stairs());
    if (d > 0.25) pool.push(() => this.checker(), () => this.fire());
    this.pick(pool)();
    this.straight(this.int(Math.round(14 - d * 6), Math.round(24 - d * 10)));
  }

  private gap(): void {
    const n = this.int(1, Math.max(1, Math.round(this.maxGap() * (0.5 + this.difficulty * 0.5))));
    this.emitRows('.......', n);
  }

  private narrow(): void {
    const d = this.difficulty;
    let lane = this.int(2, 4);
    const width = d > 0.6 ? 1 : d > 0.25 ? this.int(1, 2) : 2;
    const edge = d > 0.4 && this.rng() < 0.5 ? 'x' : '.';
    const total = this.int(30, 60);
    let run = 0;
    for (let i = 0; i < total; i++) {
      const o: Record<number, string> = {};
      for (let k = 0; k < width; k++) o[lane + k] = '=';
      this.push(this.line(`${edge}${edge}${edge}${edge}${edge}${edge}${edge}`, o));
      run++;
      if (run > this.int(10, 16) && i < total - 8) {
        const nl = Math.max(0, Math.min(7 - width, lane + (this.rng() < 0.5 ? -1 : 1)));
        // Overlap rows so the lane change is always reachable.
        for (let j = 0; j < 7; j++) {
          const ov: Record<number, string> = {};
          for (let k = Math.min(lane, nl); k < Math.max(lane, nl) + width; k++) ov[k] = '=';
          this.push(this.line(`${edge}${edge}${edge}${edge}${edge}${edge}${edge}`, ov));
        }
        lane = nl;
        run = 0;
      }
    }
  }

  private wall(canFull: boolean): void {
    const d = this.difficulty;
    const n = this.int(1, 2 + Math.floor(d * 3));
    for (let w = 0; w < n; w++) {
      const block = canFull ? 'H' : 'h';
      const open = this.int(0, 6);
      const o: Record<number, string> = { [open]: '=' };
      if (d < 0.5) o[Math.min(6, open + 1)] = '=';
      if (canFull && this.rng() < 0.3) {
        this.emitRows(this.line(block.repeat(7), o), this.int(2, 3));
      } else {
        this.emitRows(this.line(block.repeat(7), o), this.int(4, 8));
      }
      this.straight(this.int(14, 20));
    }
  }

  private hurdles(): void {
    const n = this.int(2, 4);
    for (let i = 0; i < n; i++) {
      this.emitRows('hhhhhhh', this.int(1, 2));
      // Longer than a boosted jump plus landing room, so hurdles never chain into a frame-perfect rhythm.
      this.straight(this.int(18, 24));
    }
  }

  private stairs(): void {
    // Long first step: landing and jumping again must never need frame-perfect timing.
    this.emitRows('hhhhhhh', this.int(18, 24));
    this.emitRows('HHHHHHH', this.int(12, 18));
    if (this.rng() < 0.5) this.emitRows('.......', Math.min(3, this.maxGap(16)));
    this.emitRows('HHHHHHH', this.int(6, 10));
    this.emitRows('hhhhhhh', this.int(6, 10));
  }

  private fire(): void {
    const d = this.difficulty;
    const total = this.int(30, 50);
    let lane = this.int(1, 5);
    for (let i = 0; i < total; i++) {
      if (i % 14 === 13) lane = Math.max(0, Math.min(6, lane + (this.rng() < 0.5 ? -1 : 1)));
      const cells = '======='.split('').map((_, c) => {
        if (Math.abs(c - lane) <= (d > 0.5 ? 0 : 1)) return '=';
        return this.rng() < 0.25 + d * 0.45 ? 'x' : '=';
      });
      // Keep a buffer lane around the path while it shifts.
      if (i % 14 >= 10) cells[Math.max(0, lane - 1)] = cells[Math.min(6, lane + 1)] = '=';
      this.push(cells.join(''));
    }
  }

  private islands(): void {
    const n = this.int(3, 6);
    let lane = this.int(2, 4);
    for (let i = 0; i < n; i++) {
      const o: Record<number, string> = {};
      for (let k = -1; k <= 1; k++) o[lane + k] = '=';
      this.emitRows(this.line('.......', o), this.int(7, 10));
      this.emitRows('.......', this.int(1, Math.max(1, this.maxGap() - 1)));
      lane = Math.max(1, Math.min(5, lane + this.int(-1, 1)));
    }
  }

  private boostGap(): void {
    this.emitRows('bbbbbbb', this.int(6, 10));
    this.straight(4);
    this.emitRows('.......', Math.max(1, Math.round(this.maxGap(20) * 0.8)));
  }

  private tunnel(): void {
    const lanes = this.rng() < 0.5 ? [this.int(1, 5)] : [this.int(0, 2), this.int(4, 6)];
    const o: Record<number, string> = {};
    for (const l of lanes) o[l] = 'T';
    this.emitRows(this.line('HHHHHHH', o), this.int(10, 24));
  }

  private ice(): void {
    const lane = this.int(2, 4);
    this.emitRows(this.line('..iii..', {}).replace(/./g, (_ch, i) => (Math.abs(i - lane) <= 1 ? 'i' : '.')), this.int(16, 30));
  }

  private tar(): void {
    this.emitRows('kkkkkkk', this.int(4, 8));
  }

  private checker(): void {
    const n = this.int(8, 12);
    for (let i = 0; i < n; i++) {
      this.push('=.=.=.=');
      this.push('.=.=.=.');
    }
  }
}

export function dailySeed(date = new Date()): { seed: number; label: string } {
  const label = date.toISOString().slice(0, 10);
  return { seed: hashSeed(`neon-roads-daily-${label}`), label };
}

/** A finite prefix of an endless road, for offline solver checks. */
export class RoadPrefix implements RoadSource {
  id: string;
  name: string;
  gravity: number;
  oxygen: number;
  fuel: number;
  constructor(private src: EndlessRoad, readonly length: number) {
    this.id = src.id;
    this.name = src.name;
    this.gravity = src.gravity;
    this.oxygen = src.oxygen;
    this.fuel = src.fuel;
  }
  cell(col: number, row: number): CellCode {
    return row >= this.length ? 0 : this.src.cell(col, row);
  }
  gravityAt(row: number): number {
    return this.src.gravityAt(row);
  }
}
