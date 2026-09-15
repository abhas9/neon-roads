export type SkyFeature = 'planet' | 'ringed' | 'sun' | 'blackhole' | 'moon' | 'twin' | 'core';
export type PropStyle = 'pylons' | 'asteroids' | 'rings' | 'shards' | 'cubes' | 'none';

export interface SkyStyle {
  top: string;
  horizon: string;
  nebulaA: string;
  nebulaB: string;
  nebula: number;
  stars: number;
  feature: SkyFeature;
  featureColorA: string;
  featureColorB: string;
  /** Direction to the feature: [azimuth deg (0 = straight ahead), elevation deg]. */
  featureDir: [number, number];
  featureSize: number;
  grid: boolean;
  gridColor: string;
}

export interface WorldPalette {
  floor: [string, string, string];
  block: string;
  blockAlt: string;
  tunnel: string;
  edge: string;
}

export interface RoadDef {
  name: string;
  gravity: number;
  oxygen: number;
  fuel: number;
  rows: string;
}

export interface WorldDef {
  id: string;
  name: string;
  tagline: string;
  palette: WorldPalette;
  sky: SkyStyle;
  props: PropStyle;
  music: number;
  roads: RoadDef[];
}
