import * as THREE from 'three';
import { FLOOR_T, FULL_H, HALF_H, TUNNEL_RIN, TUNNEL_ROUT } from '../sim/constants';
import {
  Block,
  cellAltBlock,
  cellBlock,
  cellBlockTile,
  cellFloor,
  cellFloorTile,
  cellTunnel,
  Tile,
} from '../sim/types';
import type { CellCode, RoadSource } from '../sim/types';
import type { WorldPalette } from '../levels/worldTypes';
import { SPECIAL_TILE_COLORS } from './tileColors';

const ARC_SEGMENTS = 12;

type V3 = [number, number, number];

class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  tile: number[] = [];
  edge: number[] = [];
  idx: number[] = [];

  /** Quad a-b-c-d with uv (0,0)(1,0)(1,1)(0,1); edges = strength of [ab, bc, cd, da]. */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3, color: THREE.Color, tile: number, edges: [number, number, number, number]) {
    const base = this.pos.length / 3;
    // Ensure winding matches the requested normal.
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const verts = [a, b, c, d];
    const uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    for (let i = 0; i < 4; i++) {
      this.pos.push(verts[i][0], verts[i][1], verts[i][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color.r, color.g, color.b);
      this.uv.push(uvs[i * 2], uvs[i * 2 + 1]);
      this.tile.push(tile);
      this.edge.push(edges[0], edges[1], edges[2], edges[3]);
    }
    if (flip) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Arbitrary triangle, used for tunnel caps. */
  tri(a: V3, b: V3, c: V3, n: V3, color: THREE.Color, uvs: number[], edges: [number, number, number, number]) {
    const base = this.pos.length / 3;
    for (const [i, v] of [a, b, c].entries()) {
      this.pos.push(v[0], v[1], v[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color.r, color.g, color.b);
      this.uv.push(uvs[i * 2], uvs[i * 2 + 1]);
      this.tile.push(0);
      this.edge.push(edges[0], edges[1], edges[2], edges[3]);
    }
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) this.idx.push(base, base + 2, base + 1);
    else this.idx.push(base, base + 1, base + 2);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aTile', new THREE.Float32BufferAttribute(this.tile, 1));
    g.setAttribute('aEdge', new THREE.Float32BufferAttribute(this.edge, 4));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export interface PaletteColors {
  floor: THREE.Color[];
  block: THREE.Color;
  blockAlt: THREE.Color;
  tunnel: THREE.Color;
  specials: Map<Tile, THREE.Color>;
}

export function paletteColors(p: WorldPalette): PaletteColors {
  const specials = new Map<Tile, THREE.Color>();
  for (const [k, v] of Object.entries(SPECIAL_TILE_COLORS)) specials.set(Number(k) as Tile, new THREE.Color(v));
  return {
    floor: p.floor.map((c) => new THREE.Color(c)),
    block: new THREE.Color(p.block),
    blockAlt: new THREE.Color(p.blockAlt),
    tunnel: new THREE.Color(p.tunnel),
    specials,
  };
}

function tileColor(pc: PaletteColors, t: Tile, fallback: THREE.Color): THREE.Color {
  if (t <= Tile.Normal3) return t === Tile.Normal ? fallback : pc.floor[t];
  return pc.specials.get(t) ?? fallback;
}

/** Height of a cell's flat top surface, or -1 when it has none (gap or rounded tunnel roof). */
function flatTop(code: CellCode): number {
  if (code === 0) return -1;
  const b = cellBlock(code);
  if (b !== Block.None) return b === Block.Full ? FULL_H : HALF_H;
  if (cellTunnel(code)) return -2;
  return cellFloor(code) ? 0 : -1;
}

function solidHeight(code: CellCode): number {
  if (code === 0) return -9;
  const b = cellBlock(code);
  if (b === Block.Full) return FULL_H;
  if (b === Block.Half) return HALF_H;
  if (cellTunnel(code)) return TUNNEL_ROUT;
  return cellFloor(code) ? 0 : -9;
}

function topKey(code: CellCode): number {
  const b = cellBlock(code);
  return b !== Block.None ? cellBlockTile(code) * 4 + (cellAltBlock(code) ? 1 : 0) + 100 : cellFloorTile(code);
}

const GRID = 0.1;
const SEAM = 0.45;
const OUTER = 1.0;

export function buildRoadChunk(road: RoadSource, r0: number, r1: number, pc: PaletteColors): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const dark = new THREE.Color();
  const tmp = new THREE.Color();

  for (let row = r0; row < r1; row++) {
    const zn = -row;
    const zf = -row - 1;
    for (let col = 0; col < 7; col++) {
      const code = road.cell(col, row);
      if (code === 0) continue;
      const x0 = col - 3.5;
      const x1 = x0 + 1;
      const L = road.cell(col - 1, row);
      const R = road.cell(col + 1, row);
      const N = road.cell(col, row - 1);
      const F = road.cell(col, row + 1);
      const floor = cellFloor(code);
      const block = cellBlock(code);
      const tunnel = cellTunnel(code);
      const h = block === Block.Full ? FULL_H : block === Block.Half ? HALF_H : 0;
      const bottom = floor ? -FLOOR_T : 0;
      const floorTile = cellFloorTile(code);
      const floorCol = tileColor(pc, floorTile, pc.floor[0]);
      const blockBase = cellAltBlock(code) ? pc.blockAlt : pc.block;
      const topTile = block !== Block.None ? cellBlockTile(code) : floorTile;
      const topCol = block !== Block.None ? tileColor(pc, topTile, blockBase) : floorCol;
      const myTop = flatTop(code);
      const myKey = topKey(code);

      const edgeTo = (nb: CellCode) => {
        const t = flatTop(nb);
        if (t !== myTop) return OUTER;
        return topKey(nb) !== myKey ? SEAM : GRID;
      };

      const solidTop = block !== Block.None ? h : 0;
      // Side walls, emitted only where the neighbour is lower.
      const sideH = (nb: CellCode) => solidHeight(nb);
      const sideCol = (c: THREE.Color, k: number) => dark.copy(c).multiplyScalar(k);

      const wallTop = block !== Block.None ? h : 0;
      const hasBox = floor || block !== Block.None;
      if (hasBox) {
        const top = tunnel && block === Block.None ? 0 : wallTop;
        const boxCol = block !== Block.None ? blockBase : floorCol;
        // Left / right
        if (sideH(L) < top || (L === 0)) {
          const lo = Math.max(bottom, L === 0 ? bottom : Math.min(top, sideH(L)));
          if (top > lo) g.quad([x0, lo, zn], [x0, lo, zf], [x0, top, zf], [x0, top, zn], [-1, 0, 0], sideCol(boxCol, 0.55), 0, [0.5, 0.6, 1, 0.6]);
        }
        if (sideH(R) < top || (R === 0)) {
          const lo = Math.max(bottom, R === 0 ? bottom : Math.min(top, sideH(R)));
          if (top > lo) g.quad([x1, lo, zf], [x1, lo, zn], [x1, top, zn], [x1, top, zf], [1, 0, 0], sideCol(boxCol, 0.55), 0, [0.5, 0.6, 1, 0.6]);
        }
        // Near (facing the player) / far
        const nearTop = tunnel && block !== Block.None ? -1 : top;
        if (nearTop > 0 || !tunnel) {
          if (sideH(N) < top || N === 0) {
            const lo = Math.max(bottom, N === 0 ? bottom : Math.min(top, sideH(N)));
            if (top > lo && !(tunnel && block !== Block.None)) g.quad([x0, lo, zn], [x1, lo, zn], [x1, top, zn], [x0, top, zn], [0, 0, 1], sideCol(boxCol, 0.75), 0, [0.5, 0.6, 1, 0.6]);
          }
          if (sideH(F) < top || F === 0) {
            const lo = Math.max(bottom, F === 0 ? bottom : Math.min(top, sideH(F)));
            if (top > lo && !(tunnel && block !== Block.None)) g.quad([x1, lo, zf], [x0, lo, zf], [x0, top, zf], [x1, top, zf], [0, 0, -1], sideCol(boxCol, 0.4), 0, [0.5, 0.6, 1, 0.6]);
          }
        }
        // Underside
        g.quad([x0, bottom, zn], [x1, bottom, zn], [x1, bottom, zf], [x0, bottom, zf], [0, -1, 0], sideCol(boxCol, 0.18), 0, [0.3, 0.3, 0.3, 0.3]);
        // Top surface
        if (!tunnel) {
          g.quad([x0, solidTop, zn], [x1, solidTop, zn], [x1, solidTop, zf], [x0, solidTop, zf], [0, 1, 0], topCol, topTile, [edgeTo(N), edgeTo(R), edgeTo(F), edgeTo(L)]);
        }
      }

      if (tunnel) {
        const tc = block !== Block.None ? blockBase : pc.tunnel;
        const cx = col - 3;
        // Floor strip inside the tunnel.
        if (floor) {
          g.quad([x0, 0, zn], [x1, 0, zn], [x1, 0, zf], [x0, 0, zf], [0, 1, 0], floorCol, floorTile, [GRID, OUTER, GRID, OUTER]);
        }
        const nearOpen = !cellTunnel(N);
        const farOpen = !cellTunnel(F);
        for (let i = 0; i < ARC_SEGMENTS; i++) {
          const a0 = (Math.PI * i) / ARC_SEGMENTS;
          const a1 = (Math.PI * (i + 1)) / ARC_SEGMENTS;
          const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
          const cm = Math.cos((a0 + a1) / 2), sm = Math.sin((a0 + a1) / 2);
          // Inner surface (normal points toward the axis).
          tmp.copy(tc).multiplyScalar(0.45 + 0.25 * sm);
          g.quad(
            [cx + c0 * TUNNEL_RIN, s0 * TUNNEL_RIN, zn], [cx + c1 * TUNNEL_RIN, s1 * TUNNEL_RIN, zn],
            [cx + c1 * TUNNEL_RIN, s1 * TUNNEL_RIN, zf], [cx + c0 * TUNNEL_RIN, s0 * TUNNEL_RIN, zf],
            [-cm, -sm, 0], tmp, 0, [0, 0, 0, 0],
          );
          if (block === Block.None) {
            g.quad(
              [cx + c0 * TUNNEL_ROUT, s0 * TUNNEL_ROUT, zn], [cx + c1 * TUNNEL_ROUT, s1 * TUNNEL_ROUT, zn],
              [cx + c1 * TUNNEL_ROUT, s1 * TUNNEL_ROUT, zf], [cx + c0 * TUNNEL_ROUT, s0 * TUNNEL_ROUT, zf],
              [cm, sm, 0], tc, 0, [0, i === 0 ? 0.8 : 0.12, 0, i === ARC_SEGMENTS - 1 ? 0.8 : 0],
            );
          }
          // End caps: annulus ring for a pipe, square-with-hole for a block tunnel.
          for (const [open, z, nz] of [[nearOpen, zn, 1], [farOpen, zf, -1]] as const) {
            if (!open) continue;
            const capCol = dark.copy(tc).multiplyScalar(nz > 0 ? 0.85 : 0.4);
            const outer = (c: number, s: number): V3 => {
              if (block === Block.None) return [cx + c * TUNNEL_ROUT, s * TUNNEL_ROUT, z];
              // Project the ray onto the block's square outline.
              const k = Math.min(0.5 / Math.max(Math.abs(c), 1e-6), h / Math.max(s, 1e-6));
              return [cx + c * k, s * k, z];
            };
            const p0 = outer(c0, s0), p1 = outer(c1, s1);
            const edgeStrength = block === Block.None ? 1 : 0.6;
            g.quad([cx + c0 * TUNNEL_RIN, s0 * TUNNEL_RIN, z], [cx + c1 * TUNNEL_RIN, s1 * TUNNEL_RIN, z], p1, p0, [0, 0, nz], capCol, 0, [1, 0, edgeStrength, 0]);
            if (block !== Block.None) {
              const onSide0 = Math.abs(Math.abs(p0[0] - cx) - 0.5) < 1e-6;
              const onSide1 = Math.abs(Math.abs(p1[0] - cx) - 0.5) < 1e-6;
              if (onSide0 !== onSide1) {
                const corner: V3 = [cx + (c0 + c1 > 0 ? 0.5 : -0.5), h, z];
                g.tri(p0, corner, p1, [0, 0, nz], capCol, [0, 0, 1, 0, 1, 1], [0, 0, 0, 0]);
              }
            }
          }
        }
        if (block !== Block.None) {
          g.quad([x0, h, zn], [x1, h, zn], [x1, h, zf], [x0, h, zf], [0, 1, 0], topCol, topTile, [edgeTo(N), edgeTo(R), edgeTo(F), edgeTo(L)]);
          if (sideH(L) < h) g.quad([x0, 0, zn], [x0, 0, zf], [x0, h, zf], [x0, h, zn], [-1, 0, 0], sideCol(tc, 0.55), 0, [0.5, 0.6, 1, 0.6]);
          if (sideH(R) < h) g.quad([x1, 0, zf], [x1, 0, zn], [x1, h, zn], [x1, h, zf], [1, 0, 0], sideCol(tc, 0.55), 0, [0.5, 0.6, 1, 0.6]);
        }
      }
    }
  }
  return g.build();
}
