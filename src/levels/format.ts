import { Block, encodeCell, Road, Tile } from '../sim/types';
import type { Cell, RoadMeta } from '../sim/types';

/**
 * Road text format. One line per row (first line = start of the road),
 * exactly 7 cell characters, optionally followed by `*N` to repeat the row.
 *
 *   .  gap              =  floor           -  floor (2nd shade)   :  floor (3rd shade)
 *   x  burning floor    s  supply floor    b  boost floor
 *   k  sticky floor     i  slippery floor
 *   h  half block       H  full block      g/G  half/full block, alt colour
 *   t  tunnel           T  tunnel through a full block
 *   X  half block, burning top   S  half block, supply top   B  half block, boost top
 *
 * `{` ... `}*N` repeats a group of rows. `#` starts a comment; blank lines are ignored.
 */
export const LEGEND: Record<string, Cell> = {};

function def(ch: string, partial: Partial<Cell>): void {
  LEGEND[ch] = {
    floor: true,
    floorTile: Tile.Normal,
    block: Block.None,
    blockTile: Tile.Normal,
    tunnel: false,
    altBlock: false,
    ...partial,
  };
}

def('.', { floor: false });
def('=', {});
def('-', { floorTile: Tile.Normal2 });
def(':', { floorTile: Tile.Normal3 });
def('x', { floorTile: Tile.Burning });
def('s', { floorTile: Tile.Supply });
def('b', { floorTile: Tile.Boost });
def('k', { floorTile: Tile.Sticky });
def('i', { floorTile: Tile.Slippery });
def('h', { block: Block.Half });
def('H', { block: Block.Full });
def('g', { block: Block.Half, altBlock: true });
def('G', { block: Block.Full, altBlock: true });
def('t', { tunnel: true });
def('T', { tunnel: true, block: Block.Full });
def('X', { block: Block.Half, blockTile: Tile.Burning });
def('S', { block: Block.Half, blockTile: Tile.Supply });
def('B', { block: Block.Half, blockTile: Tile.Boost });

export const CODES: Record<string, number> = {};
for (const [ch, cell] of Object.entries(LEGEND)) CODES[ch] = ch === '.' ? 0 : encodeCell(cell);

export function parseRows(text: string): Uint16Array {
  const out: number[] = [];
  // Stack of row groups; `{` opens a group, `}*N` repeats it.
  const stack: number[][] = [out];
  text.split('\n').forEach((raw, lineNo) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    if (line === '{') {
      stack.push([]);
      return;
    }
    const close = /^}\s*(?:\*\s*(\d+))?$/.exec(line);
    if (close) {
      if (stack.length < 2) throw new Error(`Unmatched "}" on line ${lineNo + 1}`);
      const group = stack.pop()!;
      const rep = close[1] ? parseInt(close[1], 10) : 1;
      const target = stack[stack.length - 1];
      for (let r = 0; r < rep; r++) for (const c of group) target.push(c);
      return;
    }
    const m = /^(\S{7})(?:\s*\*\s*(\d+))?(?:\s+#.*)?$/.exec(line);
    if (!m) throw new Error(`Bad road line ${lineNo + 1}: "${raw}"`);
    const rep = m[2] ? parseInt(m[2], 10) : 1;
    const codes: number[] = [];
    for (const ch of m[1]) {
      const c = CODES[ch];
      if (c === undefined) throw new Error(`Unknown cell "${ch}" on line ${lineNo + 1}`);
      codes.push(c);
    }
    const target = stack[stack.length - 1];
    for (let r = 0; r < rep; r++) for (const c of codes) target.push(c);
  });
  if (stack.length !== 1) throw new Error('Unclosed "{" group');
  return Uint16Array.from(out);
}

export function parseRoad(meta: RoadMeta, text: string): Road {
  return new Road(meta, parseRows(text));
}
