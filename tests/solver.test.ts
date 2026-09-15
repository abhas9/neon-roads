import { describe, expect, it } from 'vitest';
import { parseRoad } from '../src/levels/format';
import { solveRoad } from '../src/sim/solver';
import { ShipState, stepShip } from '../src/sim/ship';

describe('solver', () => {
  it('solves a small obstacle road and its tape replays to the finish', () => {
    const road = parseRoad(
      { id: 's', name: 's', gravity: 500, oxygen: 60, fuel: 3000 },
      `=======*20\n==...==*3\n=======*10\nHHH.HHH*3\n=======*10\n..===..*10\n.......*3\n=======*20\n===t===*10\n=======*10`,
    );
    const r = solveRoad(road);
    expect(r.solved).toBe(true);
    const s = new ShipState();
    s.reset(road);
    const f = { steer: 0, throttle: 0, jump: false };
    for (let i = 0; i < r.tape!.length && s.phase === 'alive'; i++) stepShip(road, s, r.tape!.read(i, f), { jumpAssist: false });
    expect(s.phase).toBe('finished');
  }, 60000);
});
