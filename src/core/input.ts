import type { InputFrame } from '../sim/types';

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';

const DEADZONE = 0.18;

export class Input {
  private keys = new Set<string>();
  private kbSteer = 0;
  private padPrev: boolean[] = [];
  private listeners: Record<string, (() => void)[]> = {};
  private menuListeners: ((a: MenuAction) => void)[] = [];
  touch = { steer: 0, throttle: 0, jump: false, active: false };
  /** Phone controller state, filled by RemoteHost each frame. */
  remote = { steer: 0, throttle: 0, jump: false, active: false };
  remoteSource: ((out: Input['remote']) => void) | null = null;
  /** Hand-tracking state, filled by HandInput each frame. */
  hand = { steer: 0, throttle: 0, jump: false, active: false };
  handSource: ((out: Input['hand']) => void) | null = null;
  lastDevice: 'keyboard' | 'gamepad' | 'touch' | 'remote' | 'hand' = 'keyboard';

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const code = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) e.preventDefault();
      this.lastDevice = 'keyboard';
      if (!e.repeat) {
        if (code === 'KeyR') this.fire('restart');
        if (code === 'Escape' || code === 'KeyP') this.fire('pause');
        if (code === 'KeyG') this.fire('ghost');
        if (code === 'KeyC') this.fire('recentre');
        const menu: Record<string, MenuAction> = {
          ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
          KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
          Enter: 'confirm', Escape: 'back', Backspace: 'back',
        };
        if (menu[code]) for (const l of this.menuListeners) l(menu[code]);
        this.fire('any');
      }
      this.keys.add(code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.lastDevice = 'touch';
    });
  }

  on(name: 'restart' | 'pause' | 'ghost' | 'recentre' | 'any', fn: () => void): void {
    (this.listeners[name] ??= []).push(fn);
  }

  onMenu(fn: (a: MenuAction) => void): void {
    this.menuListeners.push(fn);
  }

  /** Injects a discrete button from another device (phone controller). */
  emit(name: 'restart' | 'pause' | 'ghost' | 'recentre' | 'any' | MenuAction): void {
    if (['up', 'down', 'left', 'right', 'confirm', 'back'].includes(name)) {
      for (const l of this.menuListeners) l(name as MenuAction);
      if (name === 'confirm') this.fire('any');
    } else {
      this.fire(name);
    }
  }

  private fire(name: string): void {
    for (const fn of this.listeners[name] ?? []) fn();
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Samples all devices into one frame. Call once per rendered frame. */
  poll(dt: number, out: InputFrame): InputFrame {
    const left = this.down('ArrowLeft', 'KeyA');
    const right = this.down('ArrowRight', 'KeyD');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    // A short ramp keeps keyboard steering precise without feeling binary.
    const rate = target === 0 || Math.sign(target) !== Math.sign(this.kbSteer) ? 14 : 7;
    this.kbSteer += Math.sign(target - this.kbSteer) * Math.min(Math.abs(target - this.kbSteer), rate * dt);
    if (target !== 0 && Math.sign(target) !== Math.sign(this.kbSteer)) this.kbSteer = target * 0.35;

    let steer = this.kbSteer;
    let throttle = (this.down('ArrowUp', 'KeyW') ? 1 : 0) - (this.down('ArrowDown', 'KeyS') ? 1 : 0);
    let jump = this.down('Space');

    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const b = (i: number) => pad.buttons[i]?.pressed ?? false;
      const bv = (i: number) => pad.buttons[i]?.value ?? 0;
      if (Math.abs(ax) > DEADZONE) {
        steer = Math.sign(ax) * ((Math.abs(ax) - DEADZONE) / (1 - DEADZONE));
        this.lastDevice = 'gamepad';
      }
      if (b(14)) steer = -1;
      if (b(15)) steer = 1;
      const trig = bv(7) - bv(6);
      if (Math.abs(trig) > 0.1) throttle = trig;
      else if (Math.abs(ay) > 0.5) throttle = -Math.sign(ay);
      if (b(12)) throttle = 1;
      if (b(13)) throttle = -1;
      if (b(0) || b(1)) jump = true;

      const edge = (i: number, fn: () => void) => {
        const now = b(i);
        if (now && !this.padPrev[i]) {
          this.lastDevice = 'gamepad';
          fn();
        }
        this.padPrev[i] = now;
      };
      edge(9, () => this.fire('pause'));
      edge(8, () => this.fire('restart'));
      edge(3, () => this.fire('restart'));
      edge(2, () => this.fire('ghost'));
      const menu = (i: number, a: MenuAction) => edge(i, () => this.menuListeners.forEach((l) => l(a)));
      menu(0, 'confirm');
      menu(1, 'back');
      menu(12, 'up');
      menu(13, 'down');
      menu(14, 'left');
      menu(15, 'right');
      for (let i = 0; i < pad.buttons.length; i++) if (b(i) && ![0, 1, 12, 13, 14, 15].includes(i)) this.fire('any');
      if (b(0) && !this.padPrev[100]) this.fire('any');
      this.padPrev[100] = b(0);
      break;
    }

    if (this.remoteSource) {
      this.remoteSource(this.remote);
      if (this.remote.active) {
        if (Math.abs(this.remote.steer) > 0.02) steer = this.remote.steer;
        if (Math.abs(this.remote.throttle) > 0.02) throttle = this.remote.throttle;
        jump = jump || this.remote.jump;
        if (this.remote.jump || Math.abs(this.remote.steer) > 0.02) this.lastDevice = 'remote';
      }
    }

    // Hand tracking replaces the analog axes but only ever adds to jump: opening a hand is tens
    // of milliseconds slower than a key press, so it is designed to be played alongside the
    // keyboard rather than instead of it.
    if (this.handSource) {
      this.handSource(this.hand);
      const h = this.hand;
      if (h.active) {
        if (Math.abs(h.steer) > 0.02) steer = h.steer;
        if (Math.abs(h.throttle) > 0.02) throttle = h.throttle;
        jump = jump || h.jump;
        if (h.jump || Math.abs(h.steer) > 0.02) this.lastDevice = 'hand';
      }
    }

    if (this.touch.active) {
      if (Math.abs(this.touch.steer) > 0.02) steer = this.touch.steer;
      if (Math.abs(this.touch.throttle) > 0.02) throttle = this.touch.throttle;
      jump = jump || this.touch.jump;
    }

    out.steer = Math.max(-1, Math.min(1, steer));
    out.throttle = Math.max(-1, Math.min(1, throttle));
    out.jump = jump;
    return out;
  }
}
