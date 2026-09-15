import { WORLDS, getRoad } from '../src/levels/worlds';
import { solveRoad } from '../src/sim/solver';
import { Road } from '../src/sim/types';
import { ShipState, stepShip } from '../src/sim/ship';

// Usage: vite-node tools/debugroad.ts w3r1 [fromRow]
const id = process.argv[2];
const from = Number(process.argv[3] ?? 0);
const m = /^w(\d+)r(\d+)$/.exec(id)!;
const full = getRoad(Number(m[1]) - 1, Number(m[2]) - 1);
const sliced = new Road(full, full.cells.slice(from * 7));
console.log(WORLDS[Number(m[1]) - 1].roads[Number(m[2]) - 1].name, 'rows', sliced.length, 'from', from);
const res = solveRoad(sliced, { beam: 300, rich: true, maxSeconds: 200 });
console.log('solved', res.solved, 'time', res.time, 'furthest', res.furthest + from, JSON.stringify(res.causes));
if (!res.solved) {
  // Replay a straight full-throttle run to show where naive play dies.
  const s = new ShipState();
  s.reset(sliced);
  while (s.phase === 'alive' && s.time < 60) stepShip(sliced, s, { steer: 0, throttle: 1, jump: false }, { jumpAssist: true });
  console.log('assist run:', s.phase, s.cause, 'at row', Math.floor(s.z) + from, 'y', s.y.toFixed(2));
}
