import type { InputFrame } from './types';

/** Inputs are quantised before reaching the sim so live play and replays match bit-for-bit. */
const Q = 31;

export function quantize(input: InputFrame, out: InputFrame): InputFrame {
  out.steer = Math.round(Math.max(-1, Math.min(1, input.steer)) * Q) / Q;
  out.throttle = Math.round(Math.max(-1, Math.min(1, input.throttle)) * Q) / Q;
  out.jump = input.jump;
  return out;
}

export function packFrame(f: InputFrame): number {
  const s = Math.round(f.steer * Q) + Q;
  const t = Math.round(f.throttle * Q) + Q;
  return (s << 7) | (t << 1) | (f.jump ? 1 : 0);
}

export function unpackFrame(v: number, out: InputFrame): InputFrame {
  out.steer = (((v >> 7) & 63) - Q) / Q;
  out.throttle = (((v >> 1) & 63) - Q) / Q;
  out.jump = (v & 1) === 1;
  return out;
}

export class InputTape {
  frames: number[] = [];

  push(f: InputFrame): void {
    this.frames.push(packFrame(f));
  }

  get length(): number {
    return this.frames.length;
  }

  read(i: number, out: InputFrame): InputFrame {
    const v = i < this.frames.length ? this.frames[i] : packFrame({ steer: 0, throttle: 0, jump: false });
    return unpackFrame(v, out);
  }

  /** Run-length encoded varints, base64url. */
  encode(): string {
    const bytes: number[] = [];
    const varint = (n: number) => {
      while (n >= 128) {
        bytes.push((n & 127) | 128);
        n >>>= 7;
      }
      bytes.push(n);
    };
    const f = this.frames;
    let i = 0;
    while (i < f.length) {
      let j = i + 1;
      while (j < f.length && f[j] === f[i]) j++;
      varint(f[i]);
      varint(j - i);
      i = j;
    }
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  static decode(str: string): InputTape {
    const tape = new InputTape();
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    let p = 0;
    const varint = () => {
      let n = 0;
      let shift = 0;
      for (;;) {
        const b = bin.charCodeAt(p++);
        n |= (b & 127) << shift;
        if (b < 128) return n;
        shift += 7;
      }
    };
    while (p < bin.length) {
      const v = varint();
      const run = varint();
      for (let k = 0; k < run; k++) tape.frames.push(v);
    }
    return tape;
  }
}
