import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { WORLDS, getRoad, roadId } from '../src/levels/worlds';
import { solveRoad } from '../src/sim/solver';

const only = process.argv[2];
const parsPath = new URL('../src/levels/pars.json', import.meta.url);
const pars: Record<string, number> = existsSync(parsPath) ? JSON.parse(readFileSync(parsPath, 'utf8')) : {};
let failed = 0;

for (let w = 0; w < WORLDS.length; w++) {
  for (let r = 0; r < WORLDS[w].roads.length; r++) {
    const id = roadId(w, r);
    if (only && !id.startsWith(only)) continue;
    const road = getRoad(w, r);
    const t0 = Date.now();
    let res = solveRoad(road, { maxSeconds: 240 });
    if (!res.solved) res = solveRoad(road, { maxSeconds: 240, beam: 400, rich: true });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (res.solved) {
      pars[id] = Math.round(res.time * 100) / 100;
      console.log(`✔ ${id} ${road.name.padEnd(14)} rows=${road.length} par=${res.time.toFixed(2)}s O2=${road.oxygen} (${secs}s)`);
    } else {
      failed++;
      delete pars[id];
      console.log(`✘ ${id} ${road.name.padEnd(14)} rows=${road.length} stuck at row ${res.furthest.toFixed(0)} causes=${JSON.stringify(res.causes)} (${secs}s)`);
    }
  }
}
writeFileSync(parsPath, JSON.stringify(pars, null, 2) + '\n');
process.exit(failed ? 1 : 0);
