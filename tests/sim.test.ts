import { describe, expect, it } from 'vitest';
import { parseRoad } from '../src/levels/format';
import { DT, SIM_HZ } from '../src/sim/constants';
import { ShipState, stepShip } from '../src/sim/ship';
import { InputTape, quantize } from '../src/sim/replay';
import type { InputFrame, RoadSource } from '../src/sim/types';

const meta = { id: 't', name: 'test', gravity: 500, oxygen: 120, fuel: 5000 };
const opts = { jumpAssist: false };

function run(road: RoadSource, seconds: number, input: (s: ShipState) => InputFrame, ship = new ShipState()) {
  if (ship.steps === 0) ship.reset(road);
  const n = Math.round(seconds * SIM_HZ);
  for (let i = 0; i < n && ship.phase === 'alive'; i++) stepShip(road, ship, input(ship), opts);
  return ship;
}

const full: InputFrame = { steer: 0, throttle: 1, jump: false };

describe('ship sim', () => {
  it('accelerates along a flat road and finishes', () => {
    const road = parseRoad(meta, '=======*200');
    const s = run(road, 30, () => full);
    expect(s.phase).toBe('finished');
    expect(s.y).toBeCloseTo(0, 5);
  });

  it('falls into a gap and dies', () => {
    const road = parseRoad(meta, '=======*20\n.......*40\n=======*20');
    const s = run(road, 10, () => ({ steer: 0, throttle: 0.3, jump: false }));
    expect(s.phase).toBe('dead');
    expect(s.cause).toBe('fall');
  });

  it('jumps a gap when jumping at the edge', () => {
    const road = parseRoad(meta, '=======*40\n.......*4\n=======*60');
    const s = run(road, 20, (st) => ({ steer: 0, throttle: 1, jump: st.z > 38 && st.z < 39.5 }));
    expect(s.phase).toBe('finished');
  });

  it('crashes into a full block at speed but only bumps when slow', () => {
    const road = parseRoad(meta, '=======*30\n===H===*5\n=======*10');
    const fast = run(road, 10, () => full);
    expect(fast.cause).toBe('crash');
    const slow = run(road, 20, (st) => ({ steer: 0, throttle: st.vz < 2 ? 1 : 0, jump: false }));
    expect(slow.phase).toBe('alive');
    expect(slow.z).toBeLessThan(30);
  });

  it('lands on top of a half block', () => {
    const road = parseRoad(meta, '=======*20\n===h===*40');
    const s = run(road, 3, (st) => ({ steer: 0, throttle: 0.6, jump: st.z > 16 && st.z < 17 }));
    expect(s.phase).toBe('alive');
    expect(s.y).toBeCloseTo(0.5, 5);
  });

  it('drives through a tunnel when centred, crashes when misaligned', () => {
    const road = parseRoad(meta, '=======*20\n===t===*30\n=======*20');
    expect(run(road, 20, () => full).phase).toBe('finished');
    const off = run(road, 20, (st) => ({ steer: st.x < 0.25 ? 0.5 : 0, throttle: 1, jump: false }));
    expect(off.cause).toBe('crash');
  });

  it('burning tiles destroy, supplies refill', () => {
    const burn = parseRoad(meta, '=======*10\n=======*1\nxxxxxxx*3\n=======*20');
    expect(run(burn, 10, () => full).cause).toBe('burn');
    const sup = parseRoad({ ...meta, oxygen: 3 }, '=======*10\nsssssss*2\n=======*400');
    const s = run(sup, 2.9, () => ({ steer: 0, throttle: 0.4, jump: false }));
    expect(s.oxygen).toBeGreaterThan(2.5);
  });

  it('runs out of oxygen', () => {
    const road = parseRoad({ ...meta, oxygen: 2 }, '=======*400');
    expect(run(road, 5, () => ({ steer: 0, throttle: 0, jump: false })).cause).toBe('oxygen');
  });

  it('slippery tiles lock steering, boost accelerates, sticky slows', () => {
    const ice = parseRoad(meta, '=======*5\niiiiiii*200');
    const s = run(ice, 3, (st) => ({ steer: st.z < 7 ? 0 : 1, throttle: 0.3, jump: false }));
    expect(Math.abs(s.x)).toBeLessThan(0.01);
    const boost = parseRoad(meta, 'bbbbbbb*400');
    expect(run(boost, 1, () => ({ steer: 0, throttle: 0, jump: false })).vz).toBeGreaterThan(15);
    const sticky = parseRoad(meta, '=======*80\nkkkkkkk*400');
    const st = run(sticky, 9, (sh) => ({ steer: 0, throttle: sh.z < 70 ? 1 : 0, jump: false }));
    expect(st.vz).toBeLessThan(1);
  });

  it('boost overdrive exceeds top speed and decays afterwards', () => {
    const road = parseRoad(meta, '=======*40\nbbbbbbb*20\n=======*400');
    let peak = 0;
    const s = run(road, 12, (st) => {
      peak = Math.max(peak, st.vz);
      return full;
    });
    expect(peak).toBeGreaterThan(24);
    expect(s.vz).toBeLessThanOrEqual(21 + 1e-9);
  });

  it('higher gravity gives lower jumps', () => {
    const peak = (gravity: number) => {
      const road = parseRoad({ ...meta, gravity }, '=======*400');
      let maxY = 0;
      run(road, 2, (st) => {
        maxY = Math.max(maxY, st.y);
        return { steer: 0, throttle: 0, jump: st.time < 0.1 };
      });
      return maxY;
    };
    expect(peak(100)).toBeGreaterThan(peak(500) * 4);
    expect(peak(1700)).toBeLessThan(0.5);
  });

  it('jump assist fires at edges', () => {
    const road = parseRoad(meta, '=======*40\n.......*3\n=======*80');
    const ship = new ShipState();
    ship.reset(road);
    for (let i = 0; i < 20 * SIM_HZ && ship.phase === 'alive'; i++) stepShip(road, ship, full, { jumpAssist: true });
    expect(ship.phase).toBe('finished');
  });

  it('replays are deterministic through tape encoding', () => {
    const road = parseRoad(meta, '=======*30\n==...==*3\n=h===h=*30\n=======*60');
    const tape = new InputTape();
    const q: InputFrame = { steer: 0, throttle: 0, jump: false };
    const a = new ShipState();
    a.reset(road);
    for (let i = 0; i < 8 / DT && a.phase === 'alive'; i++) {
      const raw = { steer: Math.sin(i * 0.013) * 0.37, throttle: 0.8 + Math.cos(i * 0.05) * 0.2, jump: i % 90 < 5 };
      quantize(raw, q);
      tape.push(q);
      stepShip(road, a, q, opts);
    }
    const decoded = InputTape.decode(tape.encode());
    const b = new ShipState();
    b.reset(road);
    for (let i = 0; i < decoded.length; i++) stepShip(road, b, decoded.read(i, q), opts);
    expect(b.x).toBe(a.x);
    expect(b.z).toBe(a.z);
    expect(b.phase).toBe(a.phase);
  });
});

describe('road format', () => {
  it('expands groups and trailing comments', () => {
    const road = parseRoad(meta, `=======*2\n{\n=-=-=-=\n.......*2\n}*3  \nHHHHHHH # wall`);
    expect(road.length).toBe(2 + 9 + 1);
  });
});
