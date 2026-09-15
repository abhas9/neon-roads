import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import {
  BTN_JUMP,
  CODE_ALPHABET,
  CODE_LENGTH,
  CTL_LABEL,
  decodeInput,
  INPUT_LABEL,
  isNewer,
  PEER_PREFIX,
  peerOptions,
} from './protocol';
import type { HostMsg, PhoneButton, PhoneMsg } from './protocol';

declare const __DEV_LAN_ORIGIN__: string;

interface Controller {
  id: string;
  name: string;
  input: DataConnection | null;
  ctl: DataConnection | null;
  seq: number;
  steer: number;
  throttle: number;
  jump: boolean;
  lastPacket: number;
}

export type HostStatus = 'idle' | 'connecting' | 'ready' | 'error';

const STALE_MS = 400;
const CODE_KEY = 'neon-roads-controller-code';

/** Hosts phone controllers over WebRTC. Only signalling touches the PeerJS broker; inputs flow peer-to-peer. */
export class RemoteHost {
  status: HostStatus = 'idle';
  error = '';
  code = '';
  private peer: Peer | null = null;
  private controllers = new Map<string, Controller>();
  private retries = 0;
  onChange: (() => void) | null = null;
  onButton: ((b: PhoneButton) => void) | null = null;
  onConnect: ((name: string, connected: boolean) => void) | null = null;
  private mode: 'menu' | 'game' = 'menu';

  get count(): number {
    return [...this.controllers.values()].filter((c) => c.ctl?.open || c.input?.open).length;
  }

  get names(): string[] {
    return [...this.controllers.values()].filter((c) => c.ctl?.open || c.input?.open).map((c) => c.name);
  }

  start(): void {
    if (this.peer && !this.peer.destroyed) return;
    this.code = this.code || loadCode() || randomCode();
    this.status = 'connecting';
    this.error = '';
    this.changed();
    const peer = new Peer(PEER_PREFIX + this.code, peerOptions());
    this.peer = peer;
    peer.on('open', () => {
      this.status = 'ready';
      this.retries = 0;
      saveCode(this.code);
      this.changed();
    });
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      // Lost the signalling socket; existing P2P channels keep working. Reconnect for new phones.
      if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (err: Error & { type?: string }) => {
      if (err.type === 'unavailable-id' && this.retries < 3) {
        this.retries++;
        peer.destroy();
        this.peer = null;
        this.code = randomCode();
        this.start();
        return;
      }
      if (err.type === 'peer-unavailable') return;
      this.status = 'error';
      this.error = err.type === 'network' || err.type === 'server-error' ? 'Cannot reach the pairing server. Check your internet connection.' : err.message;
      this.changed();
    });
  }

  stop(): void {
    this.peer?.destroy();
    this.peer = null;
    this.controllers.clear();
    this.status = 'idle';
    this.changed();
  }

  newCode(): void {
    this.stop();
    this.code = randomCode();
    this.start();
  }

  controllerUrl(): string {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    const origin = local && __DEV_LAN_ORIGIN__ ? __DEV_LAN_ORIGIN__ : location.origin;
    const base = local && __DEV_LAN_ORIGIN__ ? '/' : location.pathname.replace(/[^/]*$/, '');
    return `${origin}${base}controller.html#${this.code}`;
  }

  private accept(conn: DataConnection): void {
    const id = conn.peer;
    let c = this.controllers.get(id);
    if (!c) {
      c = { id, name: 'Phone', input: null, ctl: null, seq: 0, steer: 0, throttle: 0, jump: false, lastPacket: 0 };
      this.controllers.set(id, c);
    }
    const ctrl = c;
    if (conn.label === INPUT_LABEL) {
      ctrl.input = conn;
      conn.on('data', (data) => {
        const p = decodeInput(data);
        if (!p) return;
        if (ctrl.lastPacket && !isNewer(p.seq, ctrl.seq)) return;
        ctrl.seq = p.seq;
        ctrl.steer = p.steer;
        ctrl.throttle = p.throttle;
        ctrl.jump = (p.buttons & BTN_JUMP) !== 0;
        ctrl.lastPacket = performance.now();
      });
    } else if (conn.label === CTL_LABEL) {
      ctrl.ctl = conn;
      conn.on('open', () => {
        this.sendTo(ctrl, { t: 'welcome', game: 'Neon Roads', code: this.code });
        this.sendTo(ctrl, { t: 'mode', mode: this.mode });
      });
      conn.on('data', (data) => this.handleCtl(ctrl, data as PhoneMsg));
    }
    conn.on('close', () => this.drop(ctrl, conn));
    conn.on('error', () => this.drop(ctrl, conn));
    this.changed();
  }

  private drop(c: Controller, conn: DataConnection): void {
    if (c.input === conn) c.input = null;
    if (c.ctl === conn) c.ctl = null;
    if (!c.input && !c.ctl) {
      this.controllers.delete(c.id);
      this.onConnect?.(c.name, false);
    }
    this.changed();
  }

  private handleCtl(c: Controller, msg: PhoneMsg): void {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'hello':
        c.name = String(msg.name || 'Phone').slice(0, 24);
        this.onConnect?.(c.name, true);
        this.changed();
        break;
      case 'btn':
        this.onButton?.(msg.b);
        break;
      case 'ping':
        this.sendTo(c, { t: 'pong', ts: msg.ts });
        break;
    }
  }

  private sendTo(c: Controller, msg: HostMsg): void {
    if (c.ctl?.open) void c.ctl.send(msg);
  }

  broadcast(msg: HostMsg): void {
    for (const c of this.controllers.values()) this.sendTo(c, msg);
  }

  setMode(mode: 'menu' | 'game'): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.broadcast({ t: 'mode', mode });
  }

  /** Merged analog state of all live controllers; stale streams are zeroed. */
  read(out: { steer: number; throttle: number; jump: boolean; active: boolean }): void {
    const now = performance.now();
    let steer = 0;
    let throttle = 0;
    let jump = false;
    let active = false;
    for (const c of this.controllers.values()) {
      if (!c.input?.open) continue;
      active = true;
      if (now - c.lastPacket > STALE_MS) continue;
      if (Math.abs(c.steer) > Math.abs(steer)) steer = c.steer;
      if (Math.abs(c.throttle) > Math.abs(throttle)) throttle = c.throttle;
      jump ||= c.jump;
    }
    out.steer = steer;
    out.throttle = throttle;
    out.jump = jump;
    out.active = active;
  }

  private changed(): void {
    this.onChange?.();
  }
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function loadCode(): string | null {
  try {
    return localStorage.getItem(CODE_KEY);
  } catch {
    return null;
  }
}

function saveCode(code: string): void {
  try {
    localStorage.setItem(CODE_KEY, code);
  } catch {
    // Non-persistent code is fine.
  }
}
