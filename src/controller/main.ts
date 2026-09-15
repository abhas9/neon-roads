import './controller.css';
import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { BTN_JUMP, CODE_LENGTH, CTL_LABEL, encodeInput, INPUT_LABEL, normalizeCode, PEER_PREFIX, peerOptions } from '../net/protocol';
import type { Haptic, HostMsg, PhoneButton, PhoneMsg } from '../net/protocol';

const app = document.getElementById('app')!;
const HEARTBEAT_MS = 33;
const PREFS_KEY = 'neon-pad-prefs';

interface Prefs {
  tilt: boolean;
  cruise: boolean;
  haptics: boolean;
  sensitivity: number;
}

function loadPrefs(): Prefs {
  const d: Prefs = { tilt: false, cruise: false, haptics: true, sensitivity: 1 };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return d;
  }
}

class PadApp {
  private peer: Peer | null = null;
  private input: DataConnection | null = null;
  private ctl: DataConnection | null = null;
  private code = normalizeCode(decodeURIComponent(location.hash.slice(1)));
  private state = { steer: 0, throttle: 0, jump: false };
  private tiltSteer = 0;
  private tiltZero: number | null = null;
  private seq = 0;
  private lastSent = '';
  private lastSendTime = 0;
  private mode: 'menu' | 'game' = 'menu';
  private prefs = loadPrefs();
  private rtt = 0;
  private reconnectTimer = 0;
  private wakeLock: { release(): Promise<void> } | null = null;
  private connected = false;

  constructor() {
    this.renderConnect();
    if (this.code.length === CODE_LENGTH) this.connect();
    setInterval(() => this.tick(), HEARTBEAT_MS);
    setInterval(() => this.ping(), 1000);
    window.addEventListener('hashchange', () => {
      const c = normalizeCode(location.hash.slice(1));
      if (c.length === CODE_LENGTH && c !== this.code) {
        this.code = c;
        this.connect();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void this.requestWakeLock();
        if (!this.connected && this.code) this.connect();
      }
    });
  }

  // ---------- connection ----------

  private connect(): void {
    clearTimeout(this.reconnectTimer);
    this.teardown();
    this.setStatus('Connecting…', 'busy');
    const peer = new Peer(peerOptions());
    this.peer = peer;
    peer.on('open', () => {
      const host = PEER_PREFIX + this.code;
      this.ctl = peer.connect(host, { label: CTL_LABEL, reliable: true, serialization: 'json' });
      this.input = peer.connect(host, { label: INPUT_LABEL, reliable: false, serialization: 'raw' });
      this.ctl.on('open', () => {
        this.connected = true;
        this.send({ t: 'hello', name: deviceName() });
        this.renderPad();
        this.vibrate([20, 40, 20]);
        void this.requestWakeLock();
      });
      this.ctl.on('data', (d) => this.onHost(d as HostMsg));
      const lost = () => this.onLost();
      this.ctl.on('close', lost);
      this.ctl.on('error', lost);
      this.input.on('close', lost);
    });
    peer.on('error', (err: Error & { type?: string }) => {
      if (err.type === 'peer-unavailable') this.setStatus(`No game found for code ${this.code}. Is the pairing screen open?`, 'bad');
      else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') this.setStatus('Cannot reach the pairing server. Check your connection.', 'bad');
      else this.setStatus(err.message, 'bad');
      this.scheduleReconnect();
    });
  }

  private onLost(): void {
    if (!this.connected) return;
    this.connected = false;
    this.renderConnect();
    this.setStatus('Connection lost. Reconnecting…', 'busy');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.connect(), 2500);
  }

  private teardown(): void {
    this.connected = false;
    this.input = null;
    this.ctl = null;
    this.peer?.destroy();
    this.peer = null;
  }

  private send(msg: PhoneMsg): void {
    if (this.ctl?.open) void this.ctl.send(msg);
  }

  private onHost(msg: HostMsg): void {
    switch (msg.t) {
      case 'mode':
        this.mode = msg.mode;
        if (this.connected) this.renderPad();
        break;
      case 'haptic':
        this.haptic(msg.p);
        break;
      case 'pong':
        this.rtt = performance.now() - msg.ts;
        this.updateStatusBar();
        break;
      case 'hud':
        this.updateHud(msg.o2, msg.fuel, msg.spd, msg.alive);
        break;
      case 'welcome':
        break;
    }
  }

  private ping(): void {
    if (this.connected) this.send({ t: 'ping', ts: performance.now() });
  }

  /** Streams analog state: immediately on change, and as a heartbeat so a lost packet self-heals. */
  private tick(force = false): void {
    if (!this.input?.open) return;
    const steer = this.prefs.tilt && this.mode === 'game' ? this.tiltSteer : this.state.steer;
    let throttle = this.state.throttle;
    if (this.prefs.cruise && this.mode === 'game' && throttle > -0.25) throttle = 1;
    const buttons = this.state.jump ? BTN_JUMP : 0;
    const key = `${steer.toFixed(2)}|${throttle.toFixed(2)}|${buttons}`;
    const now = performance.now();
    if (!force && key === this.lastSent && now - this.lastSendTime < HEARTBEAT_MS * 0.9) return;
    this.lastSent = key;
    this.lastSendTime = now;
    this.seq = (this.seq + 1) & 0xffff;
    void this.input.send(encodeInput(this.seq, steer, throttle, buttons));
  }

  private button(b: PhoneButton): void {
    this.send({ t: 'btn', b });
    this.vibrate(8);
  }

  // ---------- feedback ----------

  private vibrate(p: number | number[]): void {
    if (this.prefs.haptics && 'vibrate' in navigator) navigator.vibrate(p);
  }

  private haptic(p: Haptic): void {
    const patterns: Record<Haptic, number | number[]> = {
      jump: 12,
      land: 22,
      boost: [15, 25, 15, 25, 15],
      crash: [90, 40, 140],
      supply: [10, 30, 10],
      finish: [30, 60, 30, 60, 90],
      tick: 6,
    };
    this.vibrate(patterns[p]);
    if (p === 'crash') this.flash('bad');
    if (p === 'finish') this.flash('good');
  }

  private flash(kind: string): void {
    app.classList.remove('flash-good', 'flash-bad');
    void app.offsetWidth;
    app.classList.add(`flash-${kind}`);
  }

  private async requestWakeLock(): Promise<void> {
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
    if (!nav.wakeLock || this.wakeLock) return;
    try {
      this.wakeLock = await nav.wakeLock.request('screen');
    } catch {
      // Unsupported or not a secure context.
    }
  }

  // ---------- UI ----------

  private setStatus(text: string, tone: 'busy' | 'bad' | 'good'): void {
    const el = document.querySelector<HTMLElement>('.connect-status');
    if (el) {
      el.textContent = text;
      el.dataset.tone = tone;
    }
  }

  private renderConnect(): void {
    app.className = 'screen-connect';
    app.innerHTML = `
      <div class="connect">
        <div class="brand">NEON <b>PAD</b></div>
        <p class="lead">Use your phone as a controller for <b>Neon Roads</b>.</p>
        <ol class="steps">
          <li>On your computer open <b>Phone Controller</b> from the title screen.</li>
          <li>Scan the QR code — or type the ${CODE_LENGTH}-letter code below.</li>
        </ol>
        <form class="code-form">
          <input class="code-input" maxlength="${CODE_LENGTH}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CODE" value="${this.code}" />
          <button class="connect-btn" type="submit">Connect</button>
        </form>
        <div class="connect-status" data-tone="busy">${this.code ? '' : 'Waiting for a code'}</div>
        <p class="hint">Controls go directly from this phone to the game over WebRTC. Same Wi-Fi gives the lowest latency.</p>
      </div>`;
    const form = app.querySelector<HTMLFormElement>('.code-form')!;
    const inputEl = app.querySelector<HTMLInputElement>('.code-input')!;
    inputEl.addEventListener('input', () => (inputEl.value = normalizeCode(inputEl.value)));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const c = normalizeCode(inputEl.value);
      if (c.length !== CODE_LENGTH) {
        this.setStatus(`Enter all ${CODE_LENGTH} characters`, 'bad');
        return;
      }
      this.code = c;
      history.replaceState(null, '', `#${c}`);
      this.connect();
    });
  }

  private renderPad(): void {
    this.state = { steer: 0, throttle: 0, jump: false };
    app.className = `screen-pad mode-${this.mode}`;
    const top = `
      <header class="bar">
        <span class="dot"></span><span class="bar-status">Connected</span><span class="bar-rtt"></span>
        <div class="hud-mini"><i class="o2"><b></b></i><i class="fuel"><b></b></i></div>
        <button class="chip" data-btn="restart">⟲</button>
        <button class="chip" data-btn="pause">❚❚</button>
        <button class="chip" data-act="settings">⚙</button>
      </header>`;
    const settings = `
      <div class="settings hidden">
        <h3>Controller</h3>
        <label><input type="checkbox" data-pref="tilt" ${this.prefs.tilt ? 'checked' : ''}/> Tilt to steer</label>
        <label><input type="checkbox" data-pref="cruise" ${this.prefs.cruise ? 'checked' : ''}/> Cruise (auto-accelerate, drag down to brake)</label>
        <label><input type="checkbox" data-pref="haptics" ${this.prefs.haptics ? 'checked' : ''}/> Vibration</label>
        <label class="range">Steering sensitivity <input type="range" min="0.6" max="1.8" step="0.1" value="${this.prefs.sensitivity}" data-pref="sensitivity"/></label>
        <div class="settings-actions">
          <button data-act="calibrate">Re-center tilt</button>
          <button data-act="fullscreen">Full screen</button>
          <button data-act="close">Done</button>
        </div>
      </div>`;
    if (this.mode === 'game') {
      app.innerHTML = `${top}
        <main class="pad">
          <section class="stick" aria-label="Steer and throttle">
            <div class="stick-ring"><div class="stick-knob"></div></div>
            <div class="stick-label">${this.prefs.tilt ? 'THROTTLE · tilt to steer' : 'DRAG TO STEER · UP/DOWN THROTTLE'}</div>
            ${this.prefs.cruise ? '<div class="cruise-tag">CRUISE</div>' : ''}
          </section>
          <section class="jump-zone">
            <div class="speed"><b></b></div>
            <button class="jump" aria-label="Jump">JUMP</button>
          </section>
        </main>${settings}`;
      this.bindStick();
      const jump = app.querySelector<HTMLElement>('.jump')!;
      const down = (e: Event) => {
        e.preventDefault();
        this.state.jump = true;
        jump.classList.add('down');
        this.vibrate(8);
        this.tick(true);
      };
      const up = () => {
        this.state.jump = false;
        jump.classList.remove('down');
        this.tick(true);
      };
      jump.addEventListener('pointerdown', down);
      jump.addEventListener('pointerup', up);
      jump.addEventListener('pointercancel', up);
      jump.addEventListener('pointerleave', up);
    } else {
      app.innerHTML = `${top}
        <main class="pad menu">
          <section class="dpad">
            <button data-btn="up" class="d d-up">▲</button>
            <button data-btn="left" class="d d-left">◀</button>
            <button data-btn="right" class="d d-right">▶</button>
            <button data-btn="down" class="d d-down">▼</button>
          </section>
          <div class="menu-hint">Navigate the game menus</div>
          <section class="ab">
            <button data-btn="back" class="b">B<small>BACK</small></button>
            <button data-btn="confirm" class="a">A<small>SELECT</small></button>
          </section>
        </main>${settings}`;
    }
    app.querySelectorAll<HTMLElement>('[data-btn]').forEach((el) =>
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.classList.add('down');
        this.button(el.dataset.btn as PhoneButton);
      }),
    );
    app.querySelectorAll<HTMLElement>('[data-btn]').forEach((el) => {
      const up = () => el.classList.remove('down');
      el.addEventListener('pointerup', up);
      el.addEventListener('pointerleave', up);
    });
    this.bindSettings();
    this.updateStatusBar();
    if (this.prefs.tilt) void this.enableTilt();
  }

  private bindSettings(): void {
    const panel = app.querySelector<HTMLElement>('.settings')!;
    app.querySelector('[data-act=settings]')?.addEventListener('click', () => panel.classList.remove('hidden'));
    panel.querySelector('[data-act=close]')?.addEventListener('click', () => {
      panel.classList.add('hidden');
      this.renderPad();
    });
    panel.querySelector('[data-act=fullscreen]')?.addEventListener('click', () => void goFullscreen());
    panel.querySelector('[data-act=calibrate]')?.addEventListener('click', () => (this.tiltZero = null));
    panel.querySelectorAll<HTMLInputElement>('[data-pref]').forEach((inp) =>
      inp.addEventListener('change', async () => {
        const key = inp.dataset.pref as keyof Prefs;
        (this.prefs as unknown as Record<string, unknown>)[key] = inp.type === 'checkbox' ? inp.checked : Number(inp.value);
        if (key === 'tilt' && inp.checked && !(await this.enableTilt())) {
          inp.checked = false;
          this.prefs.tilt = false;
          alert('Tilt needs motion-sensor permission (on iPhone this requires the page to be served over HTTPS).');
        }
        localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
      }),
    );
  }

  private bindStick(): void {
    const stick = app.querySelector<HTMLElement>('.stick')!;
    const ring = app.querySelector<HTMLElement>('.stick-ring')!;
    const knob = app.querySelector<HTMLElement>('.stick-knob')!;
    let id: number | null = null;
    let ox = 0;
    let oy = 0;
    const R = 70;
    const move = (e: PointerEvent) => {
      let dx = e.clientX - ox;
      let dy = e.clientY - oy;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const sx = (dx / R) * this.prefs.sensitivity;
      const sy = -dy / R;
      this.state.steer = Math.abs(sx) < 0.08 ? 0 : Math.max(-1, Math.min(1, sx));
      this.state.throttle = Math.abs(sy) < 0.22 ? 0 : sy;
      this.tick();
    };
    stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      stick.setPointerCapture(id);
      // The ring follows the thumb: wherever you touch becomes centre.
      const rect = stick.getBoundingClientRect();
      ox = e.clientX;
      oy = e.clientY;
      ring.style.left = `${e.clientX - rect.left}px`;
      ring.style.top = `${e.clientY - rect.top}px`;
      ring.classList.add('active');
      move(e);
    });
    stick.addEventListener('pointermove', (e) => e.pointerId === id && move(e));
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      this.state.steer = 0;
      this.state.throttle = 0;
      knob.style.transform = '';
      ring.classList.remove('active');
      this.tick(true);
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
  }

  private async enableTilt(): Promise<boolean> {
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    window.removeEventListener('deviceorientation', this.onOrientation);
    window.addEventListener('deviceorientation', this.onOrientation);
    return true;
  }

  private onOrientation = (e: DeviceOrientationEvent) => {
    if (!this.prefs.tilt || e.beta === null || e.gamma === null) return;
    // In landscape the "steering wheel" axis is beta; in portrait it is gamma.
    const angle = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
    let raw = Math.abs(angle) === 90 ? e.beta : e.gamma;
    if (angle === -90 || angle === 270) raw = -raw;
    if (this.tiltZero === null) this.tiltZero = raw;
    const deg = raw - this.tiltZero;
    const v = Math.max(-1, Math.min(1, (deg / 28) * this.prefs.sensitivity));
    this.tiltSteer = Math.abs(v) < 0.06 ? 0 : v;
    this.tick();
  };

  private updateStatusBar(): void {
    const rtt = app.querySelector<HTMLElement>('.bar-rtt');
    if (rtt) rtt.textContent = this.rtt ? `${Math.round(this.rtt)} ms` : '';
  }

  private updateHud(o2: number, fuel: number, spd: number, alive: boolean): void {
    const set = (sel: string, v: number) => {
      const el = app.querySelector<HTMLElement>(sel);
      if (el) el.style.transform = `scaleX(${Math.max(0, Math.min(1, v))})`;
    };
    set('.hud-mini .o2 b', o2);
    set('.hud-mini .fuel b', fuel);
    const sp = app.querySelector<HTMLElement>('.speed b');
    if (sp) sp.style.transform = `scaleY(${Math.max(0, Math.min(1.3, spd)) / 1.3})`;
    app.classList.toggle('dead', !alive);
  }
}

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  return 'Controller';
}

async function goFullscreen(): Promise<void> {
  try {
    await document.documentElement.requestFullscreen?.();
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    // Not supported (e.g. iOS Safari); the layout still works in the browser chrome.
  }
}

const pad = new PadApp();
if (/[?&]peerdebug/.test(location.search)) (window as unknown as { __pad: PadApp }).__pad = pad;
