import { ShipState, stepShip } from './ship';
import type { SimOptions } from './ship';
import { InputTape } from './replay';
import type { InputFrame, RoadSource } from './types';

interface Node {
  s: ShipState;
  parent: Node | null;
  action: number;
}

function actionSet(rich: boolean): InputFrame[] {
  const out: InputFrame[] = [];
  const throttles = rich ? [1, 0, -1] : [1, -1];
  for (const throttle of throttles) for (const steer of [0, -1, 1, -0.35, 0.35]) for (const jump of [false, true]) out.push({ steer, throttle, jump });
  return out;
}
const BASIC = actionSet(false);
const RICH = actionSet(true);

export interface SolveResult {
  solved: boolean;
  time: number;
  furthest: number;
  tape: InputTape | null;
  causes: Record<string, number>;
}

export interface SolveOptions {
  beam?: number;
  stepsPerDecision?: number;
  maxSeconds?: number;
  sim?: SimOptions;
  /** Adds coasting inputs; slower but finds speed-sensitive lines. */
  rich?: boolean;
}

/** Beam search over coarse inputs; proves a road is completable and estimates a par time. */
export function solveRoad(road: RoadSource, o: SolveOptions = {}): SolveResult {
  const beam = o.beam ?? 100;
  const K = o.stepsPerDecision ?? 12;
  const maxSeconds = o.maxSeconds ?? 240;
  const sim = o.sim ?? { jumpAssist: false };
  const causes: Record<string, number> = {};
  const ACTIONS = o.rich ? RICH : BASIC;

  const start = new ShipState();
  start.reset(road);
  let frontier: Node[] = [{ s: start, parent: null, action: 0 }];
  let furthest = 0;
  const decisions = Math.ceil((maxSeconds * 120) / K);

  for (let d = 0; d < decisions && frontier.length; d++) {
    const next = new Map<number, Node>();
    let best: Node | null = null;
    for (const node of frontier) {
      for (let a = 0; a < ACTIONS.length; a++) {
        const act = ACTIONS[a];
        const s = new ShipState().copyFrom(node.s);
        for (let k = 0; k < K && s.phase === 'alive'; k++) stepShip(road, s, act, sim);
        if (s.phase === 'dead') {
          const k = `${s.cause}@${Math.floor(s.z / 10) * 10}`;
          causes[k] = (causes[k] ?? 0) + 1;
          continue;
        }
        const child: Node = { s, parent: node, action: a };
        if (s.phase === 'finished') {
          if (!best || s.time < best.s.time) best = child;
          continue;
        }
        furthest = Math.max(furthest, s.z);
        const key =
          ((((Math.round(s.z * 3) * 64 + (Math.round(s.x * 5) + 32)) * 128 + (Math.max(-60, Math.min(60, Math.round(s.y * 5))) + 64)) * 64 +
            Math.round(s.vz * 1.5)) * 2 + (s.grounded ? 1 : 0)) * 2 + (s.prevJump ? 1 : 0);
        const prev = next.get(key);
        if (!prev || score(s) > score(prev.s)) next.set(key, child);
      }
    }
    if (best) {
      return { solved: true, time: best.s.time, furthest: road.length, tape: buildTape(best, K, ACTIONS), causes };
    }
    frontier = selectBeam([...next.values()], beam);
  }
  return { solved: false, time: Infinity, furthest, tape: null, causes };
}

/**
 * Most of the beam goes to the furthest states; a reserved share keeps the best grounded
 * ones so long airborne arcs that are already doomed cannot crowd out every survivor.
 */
function selectBeam(nodes: Node[], beam: number): Node[] {
  if (nodes.length <= beam) return nodes;
  nodes.sort((a, b) => score(b.s) - score(a.s));
  const main = Math.floor(beam * 0.7);
  const out = nodes.slice(0, main);
  for (let i = main; i < nodes.length && out.length < beam; i++) if (nodes[i].s.grounded) out.push(nodes[i]);
  return out;
}

function score(s: ShipState): number {
  // Progress first; resources break ties so starved roads stay solvable.
  return s.z + s.oxygen * 0.1 + s.fuel * 0.004 + s.vz * 0.05;
}

function buildTape(end: Node, K: number, ACTIONS: InputFrame[]): InputTape {
  const actions: number[] = [];
  for (let n: Node | null = end; n && n.parent; n = n.parent) actions.push(n.action);
  actions.reverse();
  const tape = new InputTape();
  for (const a of actions) for (let k = 0; k < K; k++) tape.push(ACTIONS[a]);
  return tape;
}
