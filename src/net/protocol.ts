/** Shared wire format between the game (host) and phone controllers. */

export const PEER_PREFIX = 'neonroads-v1-';
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export const INPUT_LABEL = 'input';
export const CTL_LABEL = 'ctl';

export const BTN_JUMP = 1;

/** 6-byte analog frame sent on the unordered channel: type, seq(u16), steer(i8), throttle(i8), buttons(u8). */
export function encodeInput(seq: number, steer: number, throttle: number, buttons: number): ArrayBuffer {
  const buf = new ArrayBuffer(6);
  const v = new DataView(buf);
  v.setUint8(0, 1);
  v.setUint16(1, seq & 0xffff);
  v.setInt8(3, Math.round(Math.max(-1, Math.min(1, steer)) * 127));
  v.setInt8(4, Math.round(Math.max(-1, Math.min(1, throttle)) * 127));
  v.setUint8(5, buttons);
  return buf;
}

export interface InputPacket {
  seq: number;
  steer: number;
  throttle: number;
  buttons: number;
}

export function decodeInput(data: unknown): InputPacket | null {
  let buf: ArrayBuffer | null = null;
  if (data instanceof ArrayBuffer) buf = data;
  else if (ArrayBuffer.isView(data)) buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  if (!buf || buf.byteLength < 6) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== 1) return null;
  return { seq: v.getUint16(1), steer: v.getInt8(3) / 127, throttle: v.getInt8(4) / 127, buttons: v.getUint8(5) };
}

/** True when `seq` is newer than `last`, tolerating 16-bit wrap-around. */
export function isNewer(seq: number, last: number): boolean {
  const d = (seq - last + 0x10000) & 0xffff;
  return d !== 0 && d < 0x8000;
}

export type PhoneButton = 'pause' | 'restart' | 'ghost' | 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';
export type Haptic = 'jump' | 'land' | 'boost' | 'crash' | 'supply' | 'finish' | 'tick';

export type PhoneMsg =
  | { t: 'hello'; name: string }
  | { t: 'btn'; b: PhoneButton }
  | { t: 'ping'; ts: number };

export type HostMsg =
  | { t: 'welcome'; game: string; code: string }
  | { t: 'mode'; mode: 'menu' | 'game' }
  | { t: 'haptic'; p: Haptic }
  | { t: 'hud'; o2: number; fuel: number; spd: number; alive: boolean }
  | { t: 'pong'; ts: number };

export function peerOptions(): Record<string, unknown> {
  const env = import.meta.env;
  // Add ?peerdebug to either page URL for verbose WebRTC/signalling logs.
  const opts: Record<string, unknown> = { debug: /[?&]peerdebug/.test(location.search) ? 3 : 1 };
  if (env.VITE_PEER_HOST) {
    opts.host = env.VITE_PEER_HOST;
    opts.port = Number(env.VITE_PEER_PORT ?? 443);
    opts.path = env.VITE_PEER_PATH ?? '/';
    opts.secure = (env.VITE_PEER_SECURE ?? 'true') !== 'false';
  }
  return opts;
}

export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}
