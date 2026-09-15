import { parseRoad } from './format';
import type { Road } from '../sim/types';
import type { WorldDef } from './worldTypes';
import { W1, W2, W3 } from './roads/w1to3';
import { W4, W5, W6, W7 } from './roads/w4to7';
import { W8, W9, W10 } from './roads/w8to10';

export const WORLDS: WorldDef[] = [
  {
    id: 'launch-ring',
    name: 'Launch Ring',
    tagline: 'Steer, jump, survive',
    palette: { floor: ['#5b2a86', '#4a2170', '#6c3399'], block: '#8e3fc9', blockAlt: '#c24fd8', tunnel: '#7a37b8', edge: '#ff4fd8' },
    sky: { top: '#07021a', horizon: '#2a0b3d', nebulaA: '#6a1b9a', nebulaB: '#ff2e88', nebula: 0.7, stars: 1, feature: 'sun', featureColorA: '#ff6a3d', featureColorB: '#ffd23f', featureDir: [0, 7], featureSize: 0.33, grid: true, gridColor: '#ff2fb4' },
    props: 'pylons',
    music: 0,
    roads: W1,
  },
  {
    id: 'solar-forge',
    name: 'Solar Forge',
    tagline: 'The floor is literally lava',
    palette: { floor: ['#3a3340', '#2e2833', '#453c4d'], block: '#d9772b', blockAlt: '#f0a33a', tunnel: '#b85c1e', edge: '#ffae3c' },
    sky: { top: '#140404', horizon: '#4a1405', nebulaA: '#c23a10', nebulaB: '#ff9a3f', nebula: 0.55, stars: 0.6, feature: 'sun', featureColorA: '#ff4a12', featureColorB: '#ffc46a', featureDir: [-38, 20], featureSize: 0.3, grid: false, gridColor: '#ff7a1f' },
    props: 'shards',
    music: 1,
    roads: W2,
  },
  {
    id: 'glass-moon',
    name: 'Glass Moon',
    tagline: 'Low gravity, long falls',
    palette: { floor: ['#8a6fa8', '#76609a', '#9d82bb'], block: '#d8d2f0', blockAlt: '#a89ee0', tunnel: '#bdb2ea', edge: '#c9b8ff' },
    sky: { top: '#03030c', horizon: '#1c1840', nebulaA: '#3b2d7a', nebulaB: '#8a5cff', nebula: 0.6, stars: 1.4, feature: 'moon', featureColorA: '#d6d3e6', featureColorB: '#6e6a8a', featureDir: [22, 20], featureSize: 0.45, grid: false, gridColor: '#8a5cff' },
    props: 'asteroids',
    music: 2,
    roads: W3,
  },
  {
    id: 'ion-drift',
    name: 'Ion Drift',
    tagline: 'Ice, boost, and no brakes',
    palette: { floor: ['#34303f', '#2a2733', '#3d3849'], block: '#e8d44d', blockAlt: '#fff07a', tunnel: '#c9b52e', edge: '#fff04d' },
    sky: { top: '#020812', horizon: '#0b2a3a', nebulaA: '#00b8d9', nebulaB: '#6b00ff', nebula: 0.8, stars: 1.1, feature: 'ringed', featureColorA: '#9ad8ff', featureColorB: '#355a8a', featureDir: [30, 18], featureSize: 0.3, grid: false, gridColor: '#00e0ff' },
    props: 'rings',
    music: 3,
    roads: W4,
  },
  {
    id: 'tar-nebula',
    name: 'Tar Nebula',
    tagline: 'Heavy air, heavier tar',
    palette: { floor: ['#5a3a2e', '#4a2f25', '#6b4636'], block: '#b0567a', blockAlt: '#d47aa0', tunnel: '#8f4466', edge: '#ff7ab8' },
    sky: { top: '#0a0206', horizon: '#2a0f1a', nebulaA: '#8a1f4a', nebulaB: '#5a8a2f', nebula: 1.3, stars: 0.5, feature: 'planet', featureColorA: '#a0522d', featureColorB: '#ff9966', featureDir: [-32, 6], featureSize: 0.5, grid: false, gridColor: '#ff7ab8' },
    props: 'asteroids',
    music: 4,
    roads: W5,
  },
  {
    id: 'orbital-yard',
    name: 'Orbital Yard',
    tagline: 'Scaffolds over a blue world',
    palette: { floor: ['#3d4658', '#333b4b', '#475166'], block: '#9aa7bd', blockAlt: '#ff8a1f', tunnel: '#6f7d95', edge: '#7ce0ff' },
    sky: { top: '#01030a', horizon: '#0c1830', nebulaA: '#1a3a7a', nebulaB: '#3fa0ff', nebula: 0.5, stars: 1.2, feature: 'twin', featureColorA: '#2f6fd0', featureColorB: '#9fd3ff', featureDir: [-18, 8], featureSize: 0.6, grid: false, gridColor: '#7ce0ff' },
    props: 'cubes',
    music: 5,
    roads: W6,
  },
  {
    id: 'shatterfield',
    name: 'Shatterfield',
    tagline: 'Every breath is borrowed',
    palette: { floor: ['#2d2a3a', '#252230', '#36324a'], block: '#f2a8ff', blockAlt: '#c77dff', tunnel: '#8d5bd6', edge: '#ff9cf2' },
    sky: { top: '#050008', horizon: '#240a2e', nebulaA: '#ff3fa4', nebulaB: '#3f2bff', nebula: 1.0, stars: 1, feature: 'ringed', featureColorA: '#ffb3e6', featureColorB: '#6a2a7a', featureDir: [-24, 24], featureSize: 0.28, grid: false, gridColor: '#ff9cf2' },
    props: 'shards',
    music: 6,
    roads: W7,
  },
  {
    id: 'aurora-deep',
    name: 'Aurora Deep',
    tagline: 'Thread the needle',
    palette: { floor: ['#1e2350', '#191d44', '#262c60'], block: '#7a8cff', blockAlt: '#b19cff', tunnel: '#4a55c8', edge: '#78ffe0' },
    sky: { top: '#010512', horizon: '#06203a', nebulaA: '#10c890', nebulaB: '#6a3dff', nebula: 1.1, stars: 1.3, feature: 'moon', featureColorA: '#b8c8d8', featureColorB: '#304860', featureDir: [35, 26], featureSize: 0.22, grid: false, gridColor: '#78ffe0' },
    props: 'rings',
    music: 7,
    roads: W8,
  },
  {
    id: 'event-horizon',
    name: 'Event Horizon',
    tagline: 'Gravity stops making sense',
    palette: { floor: ['#2b2730', '#221f27', '#35303b'], block: '#d4a24a', blockAlt: '#f2c66d', tunnel: '#8a6a30', edge: '#ffcc66' },
    sky: { top: '#000000', horizon: '#120a04', nebulaA: '#5a3010', nebulaB: '#ff8a3a', nebula: 0.5, stars: 1.2, feature: 'blackhole', featureColorA: '#ffb347', featureColorB: '#ff4f1f', featureDir: [0, 12], featureSize: 0.22, grid: false, gridColor: '#ffcc66' },
    props: 'none',
    music: 8,
    roads: W9,
  },
  {
    id: 'neon-core',
    name: 'Neon Core',
    tagline: 'Everything, all at once',
    palette: { floor: ['#2a1140', '#200d33', '#34164f'], block: '#ff2fb4', blockAlt: '#8a2fff', tunnel: '#4a1aa0', edge: '#00f0ff' },
    sky: { top: '#05000c', horizon: '#1a0530', nebulaA: '#ff2fb4', nebulaB: '#00f0ff', nebula: 0.9, stars: 1, feature: 'core', featureColorA: '#ff2fb4', featureColorB: '#00f0ff', featureDir: [0, 10], featureSize: 0.4, grid: true, gridColor: '#00f0ff' },
    props: 'pylons',
    music: 9,
    roads: W10,
  },
];

const cache = new Map<string, Road>();

export function roadId(world: number, road: number): string {
  return `w${world + 1}r${road + 1}`;
}

export function getRoad(world: number, road: number): Road {
  const id = roadId(world, road);
  let r = cache.get(id);
  if (!r) {
    const def = WORLDS[world].roads[road];
    r = parseRoad({ id, name: def.name, gravity: def.gravity, oxygen: def.oxygen, fuel: def.fuel }, def.rows);
    cache.set(id, r);
  }
  return r;
}
