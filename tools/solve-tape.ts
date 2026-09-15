import { writeFileSync } from 'node:fs';
import { getRoad } from '../src/levels/worlds';
import { solveRoad } from '../src/sim/solver';

// Usage: vite-node tools/solve-tape.ts w1r1 out.json — writes a winning input tape for browser tests.
const id = process.argv[2] ?? 'w1r1';
const out = process.argv[3] ?? 'tape.json';
const m = /^w(\d+)r(\d+)$/.exec(id);
if (!m) throw new Error(`Bad road id ${id}`);
const res = solveRoad(getRoad(Number(m[1]) - 1, Number(m[2]) - 1));
if (!res.solved || !res.tape) throw new Error(`Could not solve ${id}`);
writeFileSync(out, JSON.stringify({ roadId: id, time: res.time, tape: res.tape.encode() }));
console.log(`${id} solved in ${res.time.toFixed(2)}s -> ${out}`);
