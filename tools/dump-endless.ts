import { EndlessRoad } from '../src/levels/procedural';
import { CODES } from '../src/levels/format';
const [seed, from, to] = process.argv.slice(2).map(Number);
const src = new EndlessRoad(seed, 't');
const rev = new Map(Object.entries(CODES).map(([k, v]) => [v, k]));
let prev = '';
let count = 0;
let startRow = from;
for (let r = from; r <= to; r++) {
  const line = [0, 1, 2, 3, 4, 5, 6].map((c) => rev.get(src.cell(c, r)) ?? '?').join('');
  if (line === prev) { count++; continue; }
  if (prev) console.log(`${String(startRow).padStart(5)} ${prev} *${count}  G=${src.gravityAt(startRow)}`);
  prev = line; count = 1; startRow = r;
}
console.log(`${String(startRow).padStart(5)} ${prev} *${count}  G=${src.gravityAt(startRow)}`);
