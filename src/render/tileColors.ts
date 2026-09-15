import { Tile } from '../sim/types';

/** Hazard/effect tiles keep one colour everywhere so players can learn them; patterns add a non-colour cue. */
export const SPECIAL_TILE_COLORS: Partial<Record<Tile, string>> = {
  [Tile.Burning]: '#ff3b2f',
  [Tile.Supply]: '#2fb8ff',
  [Tile.Boost]: '#1fc653',
  [Tile.Sticky]: '#3d5a1e',
  [Tile.Slippery]: '#b9c6d6',
};

export const TILE_NAMES: Partial<Record<Tile, string>> = {
  [Tile.Burning]: 'Burning — destroys your ship',
  [Tile.Supply]: 'Supply — refills oxygen & fuel',
  [Tile.Boost]: 'Boost — rapid acceleration',
  [Tile.Sticky]: 'Sticky — heavy drag',
  [Tile.Slippery]: 'Slippery — no steering',
};
