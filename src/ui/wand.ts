/**
 * Setup screen for the camera wand: print, permission, calibration, tuning and a live readout.
 *
 * The diagnostics panel is deliberately visible rather than hidden behind a debug flag. This is a
 * webcam control scheme whose feel depends entirely on the room it is used in, so the player needs
 * to see frame rate, tracking lock and latency to know whether a bad run was their fault.
 */
import { CALIBRATION_HELP } from '../wand/calibrate';
import type { CalibrationError, Rect } from '../wand/calibrate';
import { LOST_AFTER } from '../wand/mapping';
import type { WandInput } from '../wand/wandInput';
import type { Settings } from '../core/save';

export type WandStep = 'intro' | 'denied' | 'error' | 'aim' | 'sampling' | 'live';

/** Calibration box as a fraction of the processing frame: a wide, shallow strip where a wand sits. */
const BOX_FRAC = { w: 0.64, h: 0.34 };

export function calibrationBox(w: number, h: number): Rect {
  const bw = w * BOX_FRAC.w;
  const bh = h * BOX_FRAC.h;
  return { x: (w - bw) / 2, y: (h - bh) / 2, w: bw, h: bh };
}

const bar = (v: number, cls: string) =>
  `<div class="wand-bar ${cls}"><i style="width:${Math.round(Math.min(1, Math.abs(v)) * 50)}%;${
    v < 0 ? 'right:50%' : 'left:50%'
  }"></i></div>`;

export class WandScreen {
  step: WandStep = 'intro';
  private root: HTMLElement | null = null;
  private lastError: CalibrationError | null = null;
  private raf = 0;

  constructor(
    private wand: WandInput,
    private settings: () => Settings,
    private onDone: () => void,
  ) {}

  /** Chooses the opening step from what the camera and a saved calibration already give us. */
  initialStep(): WandStep {
    if (this.wand.state === 'denied') return 'denied';
    if (this.wand.state === 'error') return 'error';
    if (this.wand.state !== 'ready') return 'intro';
    return this.wand.model ? 'live' : 'aim';
  }

  mount(root: HTMLElement): void {
    this.root = root;
    this.step = this.initialStep();
    this.render();
    this.tick();
  }

  unmount(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.root = null;
    this.wand.previewBox = null;
    // Leaving mid-sample must abandon the calibration, or it completes against a box the player
    // has walked away from and resolves into a screen that is no longer on show.
    if (this.step === 'sampling') {
      this.wand.cancelCalibration();
      this.step = 'aim';
    }
    // Persist on the way out too, so a calibration is kept even if the player never pressed Play.
    this.wand.save();
  }

  render(): void {
    if (!this.root) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.action;
    this.root.innerHTML = this.html();
    if (focused) this.root.querySelector<HTMLElement>(`[data-action="${focused}"]`)?.focus();
  }

  private html(): string {
    return `
  <div class="screen wand-screen no-anim">
    <div class="panel wide wand-panel">
      <div class="screen-head inline">
        <button class="nav btn ghost back" data-action="back">‹ Back</button>
        <h2>Wand Controller</h2>
        <span class="tag-exp">Experimental</span>
      </div>
      <div class="wand-grid">
        <div class="wand-view ${this.step}">
          <canvas class="wand-preview" width="480" height="360"></canvas>
          ${this.step === 'intro' || this.step === 'denied' || this.step === 'error' ? '<div class="wand-camera-off">📷</div>' : ''}
        </div>
        <div class="wand-side">${this.sideHtml()}</div>
      </div>
    </div>
  </div>`;
  }

  private sideHtml(): string {
    switch (this.step) {
      case 'intro':
        return `
          <p>Tape a two-colour marker to a pen and steer with it in front of your webcam.</p>
          <ul class="wand-steps">
            <li><b>Tilt</b> the wand like a steering wheel to steer.</li>
            <li><b>Push</b> it towards the camera to speed up, pull back to brake.</li>
            <li><b>Flick</b> it upwards to jump.</li>
          </ul>
          <p class="dim small">Video never leaves your device: frames are processed here in the page, nothing is recorded and nothing is uploaded.</p>
          <div class="actions left">
            <button class="nav btn primary" data-action="wand-enable">Enable camera</button>
            <a class="nav btn ghost" data-action="wand-print" href="./marker.html" target="_blank" rel="noopener">Print the marker</a>
          </div>
          <p class="dim small">No printer? Two clearly different coloured objects on a stick work just as well.</p>`;
      case 'denied':
      case 'error':
        return `
          <p class="wand-error">${this.wand.error}</p>
          <div class="actions left">
            <button class="nav btn primary" data-action="wand-enable">Try again</button>
            <button class="nav btn ghost" data-action="back">Back</button>
          </div>`;
      case 'aim':
      case 'sampling': {
        const counts = this.wand.sampleCounts;
        const sampling = this.step === 'sampling';
        return `
          <p>Hold the wand <b>level</b> inside the box, at the distance you want to play from.</p>
          <div class="wand-readout">
            <span>Left colour<b class="v-left">${counts.a}</b></span>
            <span>Right colour<b class="v-right">${counts.b}</b></span>
          </div>
          ${this.lastError ? `<p class="wand-error">${CALIBRATION_HELP[this.lastError]}</p>` : ''}
          <div class="actions left">
            <button class="nav btn primary" data-action="wand-calibrate" ${sampling ? 'disabled' : ''}>${
              sampling ? 'Hold still…' : 'Calibrate'
            }</button>
            <a class="nav btn ghost" data-action="wand-print" href="./marker.html" target="_blank" rel="noopener">Print the marker</a>
          </div>
          <div class="wand-progress"><i style="width:${Math.round(this.wand.calibrationProgress * 100)}%"></i></div>
          <p class="dim small">Whatever colour fills the left half becomes one end of the wand, the right half the other.</p>`;
      }
      case 'live': {
        const s = this.settings();
        const slider = (key: 'wandSensitivity' | 'wandThrottle' | 'wandFlick', label: string, min: number, max: number, step: number, hint: string) =>
          `<label class="setting wand-slider"><span><b>${label}</b><small>${hint}</small></span>
            <input class="nav" type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-slider="${key}"></label>`;
        return `
          <div class="wand-live">
            <div class="wand-axes">
              <span>Steer${bar(0, 'steer')}</span>
              <span>Throttle${bar(0, 'throttle')}</span>
              <span>Flick<div class="wand-bar flick"><i style="left:0;width:0"></i></div></span>
            </div>
            <div class="wand-diag">
              <span>Tracking<b class="v-lock">–</b></span>
              <span>Camera<b class="v-fps">–</b></span>
              <span>Lag<b class="v-lat">–</b></span>
              <span>CPU<b class="v-cost">–</b></span>
            </div>
          </div>
          ${slider('wandSensitivity', 'Steering range', 20, 70, 1, 'Tilt in degrees for a full turn. Lower is twitchier.')}
          ${slider('wandThrottle', 'Throttle range', 0.1, 0.4, 0.01, 'How far you push before full speed.')}
          ${slider('wandFlick', 'Flick strength', 1, 3, 0.05, 'Higher needs a sharper flick to jump.')}
          <label class="nav setting toggle" tabindex="0" data-toggle="wandInvert"><span><b>Invert steering</b><small>If tilting left turns right.</small></span><i class="switch ${s.wandInvert ? 'on' : ''}"></i></label>
          <div class="actions left">
            <button class="nav btn primary" data-action="wand-done">Play with the wand</button>
            <button class="nav btn ghost" data-action="wand-recentre">Recentre <kbd>C</kbd></button>
            <button class="nav btn ghost" data-action="wand-recalibrate">Recalibrate</button>
            <button class="nav btn ghost" data-action="wand-off">Turn off</button>
          </div>
          <p class="dim small">Hold the wand where it feels comfortable and hit <b>Recentre</b> to make that the neutral pose. Jump with <kbd>Space</kbd> any time — a flick is around 100 ms slower than a key press.</p>`;
      }
    }
  }

  async enable(): Promise<void> {
    const ok = await this.wand.start();
    if (!ok) {
      this.step = this.wand.state === 'denied' ? 'denied' : 'error';
    } else {
      this.step = this.wand.model ? 'live' : 'aim';
    }
    this.render();
  }

  async calibrate(): Promise<void> {
    if (this.step === 'sampling' || !this.wand.width) return;
    this.lastError = null;
    this.step = 'sampling';
    this.render();
    const box = calibrationBox(this.wand.width, this.wand.height);
    const res = await this.wand.beginCalibration(box);
    if (res === 'cancelled') return;
    if (typeof res === 'string') {
      this.lastError = res;
      this.step = 'aim';
    } else {
      this.wand.mapper.reset();
      this.applyTuning();
      this.step = 'live';
      // Neutral needs no extra step here: calibration clears it, and the mapper adopts the first
      // tracked pose, which is whatever the player was holding while sampling.
    }
    this.render();
  }

  recalibrate(): void {
    this.lastError = null;
    this.step = 'aim';
    this.render();
  }

  applyTuning(): void {
    const s = this.settings();
    this.wand.mapper.setTuning({
      steerRange: (s.wandSensitivity * Math.PI) / 180,
      throttleRange: s.wandThrottle,
      flick: s.wandFlick,
      invertSteer: s.wandInvert,
    });
  }

  done(): void {
    this.wand.save();
    this.onDone();
  }

  private tick = (): void => {
    if (!this.root) return;
    // Set here rather than on render: the frame size is only known once a frame has arrived,
    // which is usually after the step has already been rendered.
    const aiming = this.step === 'aim' || this.step === 'sampling';
    this.wand.previewBox = aiming && this.wand.width ? calibrationBox(this.wand.width, this.wand.height) : null;
    this.draw();
    this.updateReadouts();
    this.raf = requestAnimationFrame(this.tick);
  };

  private draw(): void {
    const canvas = this.root?.querySelector<HTMLCanvasElement>('.wand-preview');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width: cw, height: ch } = canvas;
    ctx.clearRect(0, 0, cw, ch);
    if (this.wand.state !== 'ready' || !this.wand.width) {
      ctx.fillStyle = '#120a28';
      ctx.fillRect(0, 0, cw, ch);
      return;
    }
    // The preview mirrors the video for the same reason the tracker does: people expect a mirror.
    ctx.save();
    ctx.setTransform(-1, 0, 0, 1, cw, 0);
    ctx.drawImage(this.wand.video, 0, 0, cw, ch);
    ctx.restore();

    const sx = cw / this.wand.width;
    const sy = ch / this.wand.height;

    if (this.step === 'aim' || this.step === 'sampling') {
      const box = calibrationBox(this.wand.width, this.wand.height);
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(box.x * sx, box.y * sy, box.w * sx, box.h * sy);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo((box.x + box.w / 2) * sx, box.y * sy);
      ctx.lineTo((box.x + box.w / 2) * sx, (box.y + box.h) * sy);
      ctx.strokeStyle = 'rgba(0,229,255,.35)';
      ctx.stroke();
    }

    const { a, b } = this.wand.blobs;
    if (a && b) {
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(a.px * sx, a.py * sy);
      ctx.lineTo(b.px * sx, b.py * sy);
      ctx.stroke();
    }
    for (const [blob, color] of [
      [a, '#ff00a8'],
      [b, '#00e5ff'],
    ] as const) {
      if (!blob) continue;
      ctx.beginPath();
      ctx.arc(blob.px * sx, blob.py * sy, Math.max(6, blob.r * sx), 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (this.step === 'live' && !this.wand.pose) {
      ctx.fillStyle = 'rgba(10,4,26,.72)';
      ctx.fillRect(0, ch / 2 - 26, cw, 52);
      ctx.fillStyle = '#fff';
      ctx.font = '600 20px Rajdhani, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Hold the wand where the camera can see it', cw / 2, ch / 2 + 7);
    }
  }

  private updateReadouts(): void {
    const root = this.root;
    if (!root) return;
    const set = (sel: string, text: string) => {
      const el = root.querySelector(sel);
      if (el && el.textContent !== text) el.textContent = text;
    };
    if (this.step === 'aim' || this.step === 'sampling') {
      const c = this.wand.sampleCounts;
      set('.v-left', String(c.a));
      set('.v-right', String(c.b));
      const prog = root.querySelector<HTMLElement>('.wand-progress i');
      if (prog) prog.style.width = `${Math.round(this.wand.calibrationProgress * 100)}%`;
      return;
    }
    if (this.step !== 'live') return;
    const m = this.wand.mapper;
    const st = this.wand.stats;
    const fill = (sel: string, v: number) => {
      const el = root.querySelector<HTMLElement>(`${sel} i`);
      if (!el) return;
      const w = Math.min(1, Math.abs(v)) * 50;
      el.style.width = `${w}%`;
      el.style.left = v < 0 ? `${50 - w}%` : '50%';
    };
    fill('.wand-bar.steer', m.out.steer);
    fill('.wand-bar.throttle', m.out.throttle);
    const flick = root.querySelector<HTMLElement>('.wand-bar.flick i');
    if (flick) {
      flick.style.left = '0';
      flick.style.width = `${Math.min(100, Math.max(0, (m.raw.flick / (this.settings().wandFlick * 1.5)) * 100))}%`;
      flick.style.background = m.out.jump ? '#7dff9b' : '';
    }
    set('.v-lock', m.status === 'lost' ? 'lost' : `${Math.round(st.lockRate * 100)}%`);
    set('.v-fps', `${Math.round(st.fps)} fps`);
    set('.v-lat', st.latency > 0 ? `${Math.round(st.latency)} ms` : 'n/a');
    set('.v-cost', `${st.cost.toFixed(1)} ms`);
    const lock = root.querySelector('.v-lock');
    if (lock) lock.className = `v-lock ${m.status === 'tracking' && st.lockRate > 0.9 ? 'good' : m.status === 'lost' ? 'bad' : 'warn'}`;
  }
}

/** Text for the in-run banner when the camera loses the wand. */
export const WAND_LOST_TEXT = `Wand lost — paused after ${LOST_AFTER}s`;
