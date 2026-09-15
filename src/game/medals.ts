export const MEDAL_NAMES = ['', 'Bronze', 'Silver', 'Gold', 'Neon'];
export const MEDAL_FACTORS = [Infinity, Infinity, 1.35, 1.15, 1.04];

/** Medal from a finish time relative to the solver's par. */
export function medalFor(time: number, par: number): number {
  if (time <= par * MEDAL_FACTORS[4]) return 4;
  if (time <= par * MEDAL_FACTORS[3]) return 3;
  if (time <= par * MEDAL_FACTORS[2]) return 2;
  return 1;
}

export function medalTarget(medal: number, par: number): number {
  return par * MEDAL_FACTORS[medal];
}

export function formatTime(t: number): string {
  if (!Number.isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}
