import { EndlessRoad } from '../src/levels/procedural';
import { solveRoad } from '../src/sim/solver';
import { cellFloor, cellBlock, cellTunnel } from '../src/sim/types';
import type { CellCode, RoadSource } from '../src/sim/types';

/** A finite window [offset, offset+length) of an endless road, starting on a safe full-width stretch. */
class Window implements RoadSource {
  id = 'win';
  name = 'win';
  gravity: number;
  oxygen: number;
  fuel: number;
  constructor(private src: EndlessRoad, private offset: number, readonly length: number) {
    this.gravity = src.gravityAt(offset);
    this.oxygen = src.oxygen;
    this.fuel = src.fuel;
  }
  cell(col: number, row: number): CellCode {
    return row < 0 || row >= this.length ? 0 : this.src.cell(col, row + this.offset);
  }
  gravityAt(row: number): number {
    return this.src.gravityAt(row + this.offset);
  }
}

function safeStart(src: EndlessRoad, from: number): number {
  const plain = (r: number) => [0, 1, 2, 3, 4, 5, 6].every((c) => { const k = src.cell(c, r); return cellFloor(k) && !cellBlock(k) && !cellTunnel(k); });
  for (let r = from; ; r++) {
    let ok = true;
    for (let k = 0; k < 12 && ok; k++) ok = plain(r + k);
    if (ok) return r;
  }
}

const seeds = (process.argv[2] ?? '1,2,3,4,5').split(',').map(Number);
const depths = [0, 2500, 5500];
let failed = 0;
for (const seed of seeds) {
  for (const depth of depths) {
    const src = new EndlessRoad(seed, 'test');
    const start = depth === 0 ? 0 : safeStart(src, depth);
    const win = new Window(src, start, 900);
    const t0 = Date.now();
    let res = solveRoad(win, { maxSeconds: 200, beam: 150 });
    let pass = 'fast';
    if (!res.solved) {
      res = solveRoad(win, { maxSeconds: 200, beam: 400, rich: true });
      pass = 'thorough';
    }
    if (!res.solved) failed++;
    const detail = res.solved ? `t=${res.time.toFixed(1)}s (${pass} pass)` : `stuck@${(res.furthest + start).toFixed(0)} ${JSON.stringify(res.causes).slice(0, 200)}`;
    console.log(`${res.solved ? '✔' : '✘'} seed=${seed} rows ${start}-${start + 900} G=${win.gravity} ${detail} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
}
process.exit(failed ? 1 : 0);
