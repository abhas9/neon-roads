import { describe, expect, it } from 'vitest';
import { OneEuro, shapeAxis, wrapPi } from '../src/core/filter';

describe('one euro filter', () => {
  it('converges on a constant signal', () => {
    const f = new OneEuro();
    let out = 0;
    for (let i = 0; i < 60; i++) out = f.filter(1, 1 / 60);
    expect(out).toBeCloseTo(1, 2);
  });

  it('cuts jitter while still', () => {
    const f = new OneEuro();
    const seq: number[] = [];
    for (let i = 0; i < 120; i++) seq.push(f.filter(i % 2 ? 0.05 : -0.05, 1 / 60));
    expect(Math.max(...seq.slice(60).map(Math.abs))).toBeLessThan(0.02);
  });

  it('tracks a fast sweep closely instead of lagging behind it', () => {
    const f = new OneEuro();
    let out = 0;
    for (let i = 0; i < 20; i++) out = f.filter(i / 20, 1 / 60);
    // A third of a second into a sweep the filter must be within ~10% of the input, or steering
    // feels like it is being dragged through treacle.
    expect(out).toBeGreaterThan(0.85);
  });

  it('ignores a non-positive time step', () => {
    const f = new OneEuro();
    f.filter(1, 1 / 60);
    expect(f.filter(5, 0)).toBeCloseTo(1, 5);
  });
});

describe('axis shaping', () => {
  it('holds zero inside the deadzone', () => {
    expect(shapeAxis(0.08, 0.1)).toBe(0);
    expect(shapeAxis(-0.08, 0.1)).toBe(0);
  });

  it('reaches full deflection at the edge', () => {
    expect(shapeAxis(1, 0.1)).toBeCloseTo(1, 5);
    expect(shapeAxis(-1, 0.1)).toBeCloseTo(-1, 5);
  });

  it('is gentle just outside the deadzone', () => {
    expect(shapeAxis(0.3, 0.1)).toBeLessThan(0.3);
  });
});

describe('angle wrapping', () => {
  it('wraps to the shortest signed distance', () => {
    expect(wrapPi(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 6);
    expect(wrapPi(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1, 6);
    expect(wrapPi(0.4)).toBeCloseTo(0.4, 6);
  });
});
